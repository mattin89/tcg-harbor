import type { SupabaseClient } from '@supabase/supabase-js';

interface DataApiError {
  readonly code?: string;
  readonly message: string;
}

interface DataPage<T> {
  readonly data: T[] | null;
  readonly error: DataApiError | null;
}

interface ParticipantRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  hidden_at: string | null;
  left_at: string | null;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  participant_low_id: string;
  participant_high_id: string;
  context_community_id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  deleted_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

interface CommunityRow {
  id: string;
  name: string;
}

interface CommunityMemberProfileRow {
  community_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

const DATA_API_PAGE_SIZE = 1_000;
const DATA_API_ID_BATCH_SIZE = 200;

export interface ProductionDirectMessageV2 {
  readonly id: string;
  readonly conversationId: string;
  readonly senderId: string;
  readonly body: string;
  readonly createdAt: string;
  readonly own: boolean;
}

export interface ProductionDirectConversationPeerV2 {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface ProductionDirectConversationV2 {
  readonly id: string;
  readonly ownerId: string;
  readonly peer: ProductionDirectConversationPeerV2;
  readonly communityId: string;
  readonly communityName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastMessageAt: string | null;
  readonly lastReadAt: string | null;
  readonly unreadCount: number;
  readonly messages: readonly ProductionDirectMessageV2[];
}

export interface ProductionDirectInboxSnapshotV2 {
  readonly ownerId: string;
  readonly conversations: readonly ProductionDirectConversationV2[];
}

export interface SendProductionDirectMessageV2 {
  readonly conversationId: string;
  readonly body: string;
  readonly clientMessageId?: string;
}

function chunks<T>(values: readonly T[], size = DATA_API_ID_BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchEveryPage<T>(
  label: string,
  fetchPage: (from: number, to: number) => PromiseLike<DataPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += DATA_API_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + DATA_API_PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < DATA_API_PAGE_SIZE) return rows;
  }
}

function peerProfileKey(communityId: string, userId: string): string {
  return `${communityId}\u0000${userId}`;
}

function peerFallback(userId: string): ProductionDirectConversationPeerV2 {
  return {
    userId,
    username: 'member',
    displayName: 'Community member',
    avatarUrl: null,
  };
}

function messageTimestamp(conversation: ProductionDirectConversationV2): number {
  const value = conversation.lastMessageAt ?? conversation.updatedAt ?? conversation.createdAt;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function newClientMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  throw new Error('This browser cannot create an idempotent direct-message identifier.');
}

/**
 * Owner-private direct-message access through the browser Supabase client.
 *
 * RLS remains the authorization boundary. The explicit authenticated-owner
 * check is still required because conversation participants may legitimately
 * read both participant-state rows for a conversation.
 */
export class SupabaseDirectMessageRepositoryV2 {
  constructor(private readonly client: SupabaseClient) {}

  async load(expectedOwnerId: string): Promise<ProductionDirectInboxSnapshotV2> {
    await this.assertAuthenticatedOwner(expectedOwnerId);

    const participantRows = await fetchEveryPage<ParticipantRow>(
      'Load direct-message participant state',
      (from, to) => this.client
        .from('direct_conversation_participants')
        .select('conversation_id,user_id,last_read_at,hidden_at,left_at,updated_at')
        .eq('user_id', expectedOwnerId)
        .is('hidden_at', null)
        .is('left_at', null)
        .order('updated_at', { ascending: false })
        .range(from, to) as unknown as PromiseLike<DataPage<ParticipantRow>>,
    );

    if (participantRows.some((row) => row.user_id !== expectedOwnerId)) {
      throw new Error('Direct-message participant state was not scoped to the authenticated owner.');
    }
    if (participantRows.length === 0) {
      return { ownerId: expectedOwnerId, conversations: [] };
    }

    const participantByConversation = new Map(
      participantRows.map((row) => [row.conversation_id, row]),
    );
    const conversationIds = [...participantByConversation.keys()];
    const conversationRows: ConversationRow[] = [];

    for (const idBatch of chunks(conversationIds)) {
      conversationRows.push(...await fetchEveryPage<ConversationRow>(
        'Load direct conversations',
        (from, to) => this.client
          .from('direct_conversations')
          .select('id,participant_low_id,participant_high_id,context_community_id,created_at,updated_at,last_message_at,deleted_at')
          .in('id', idBatch)
          .or(`participant_low_id.eq.${expectedOwnerId},participant_high_id.eq.${expectedOwnerId}`)
          .is('deleted_at', null)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .range(from, to) as unknown as PromiseLike<DataPage<ConversationRow>>,
      ));
    }

    for (const row of conversationRows) {
      const belongsToOwner = row.participant_low_id === expectedOwnerId
        || row.participant_high_id === expectedOwnerId;
      if (!belongsToOwner || !participantByConversation.has(row.id)) {
        throw new Error('A direct conversation escaped the authenticated-owner scope.');
      }
    }

    const peerByConversation = new Map<string, string>();
    const communityIds = new Set<string>();
    for (const row of conversationRows) {
      peerByConversation.set(
        row.id,
        row.participant_low_id === expectedOwnerId
          ? row.participant_high_id
          : row.participant_low_id,
      );
      communityIds.add(row.context_community_id);
    }

    const messageRows: MessageRow[] = [];
    for (const idBatch of chunks(conversationRows.map((row) => row.id))) {
      messageRows.push(...await fetchEveryPage<MessageRow>(
        'Load direct messages',
        (from, to) => this.client
          .from('direct_messages')
          .select('id,conversation_id,sender_id,body,created_at,deleted_at')
          .in('conversation_id', idBatch)
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .range(from, to) as unknown as PromiseLike<DataPage<MessageRow>>,
      ));
    }

    const messagesByConversation = new Map<string, MessageRow[]>();
    for (const row of messageRows) {
      const peerId = peerByConversation.get(row.conversation_id);
      if (!peerId || (row.sender_id !== expectedOwnerId && row.sender_id !== peerId)) {
        throw new Error('A direct message escaped the authenticated conversation scope.');
      }
      if (row.deleted_at) continue;
      const group = messagesByConversation.get(row.conversation_id) ?? [];
      group.push(row);
      messagesByConversation.set(row.conversation_id, group);
    }

    const communityRows: CommunityRow[] = [];
    const allCommunityIds = [...communityIds];
    for (const idBatch of chunks(allCommunityIds)) {
      communityRows.push(...await fetchEveryPage<CommunityRow>(
        'Load direct-message communities',
        (from, to) => this.client
          .from('communities')
          .select('id,name')
          .in('id', idBatch)
          .order('name', { ascending: true })
          .range(from, to) as unknown as PromiseLike<DataPage<CommunityRow>>,
      ));
    }
    const communityNameById = new Map(communityRows.map((row) => [row.id, row.name]));

    const profileRows: CommunityMemberProfileRow[] = [];
    const peerIds = [...new Set(peerByConversation.values())];
    if (peerIds.length > 0 && allCommunityIds.length > 0) {
      for (const communityBatch of chunks(allCommunityIds)) {
        for (const peerBatch of chunks(peerIds)) {
          profileRows.push(...await fetchEveryPage<CommunityMemberProfileRow>(
            'Load direct-message participant profiles',
            (from, to) => this.client
              .from('community_member_profiles')
              .select('community_id,user_id,username,display_name,avatar_url')
              .in('community_id', communityBatch)
              .in('user_id', peerBatch)
              .order('username', { ascending: true })
              .range(from, to) as unknown as PromiseLike<DataPage<CommunityMemberProfileRow>>,
          ));
        }
      }
    }
    const profileByCommunityAndUser = new Map(
      profileRows.map((row) => [peerProfileKey(row.community_id, row.user_id), row]),
    );

    const conversations = conversationRows.map((row): ProductionDirectConversationV2 => {
      const participant = participantByConversation.get(row.id);
      const peerId = peerByConversation.get(row.id);
      if (!participant || !peerId) throw new Error('Direct conversation state is incomplete.');

      const profile = profileByCommunityAndUser.get(peerProfileKey(row.context_community_id, peerId));
      const peer = profile ? {
        userId: peerId,
        username: profile.username || 'member',
        displayName: profile.display_name || profile.username || 'Community member',
        avatarUrl: profile.avatar_url,
      } : peerFallback(peerId);
      const rows = messagesByConversation.get(row.id) ?? [];
      const messages = rows.map((message): ProductionDirectMessageV2 => ({
        id: message.id,
        conversationId: message.conversation_id,
        senderId: message.sender_id,
        body: message.body,
        createdAt: message.created_at,
        own: message.sender_id === expectedOwnerId,
      }));
      const lastReadAt = participant.last_read_at;
      const lastReadTimestamp = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY;
      const unreadCount = messages.filter((message) => (
        !message.own && Date.parse(message.createdAt) > lastReadTimestamp
      )).length;

      return {
        id: row.id,
        ownerId: expectedOwnerId,
        peer,
        communityId: row.context_community_id,
        communityName: communityNameById.get(row.context_community_id) ?? 'Store community',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastMessageAt: row.last_message_at,
        lastReadAt,
        unreadCount,
        messages,
      };
    }).sort((left, right) => messageTimestamp(right) - messageTimestamp(left));

    return { ownerId: expectedOwnerId, conversations };
  }

  async createConversation(
    otherUserId: string,
    communityId: string,
    expectedOwnerId: string,
  ): Promise<string> {
    await this.assertAuthenticatedOwner(expectedOwnerId);
    if (!otherUserId || !communityId || otherUserId === expectedOwnerId) {
      throw new Error('A direct conversation requires another community member.');
    }
    const { data, error } = await this.client.rpc('create_direct_conversation', {
      p_other_user_id: otherUserId,
      p_context_community_id: communityId,
    });
    if (error) throw new Error(`Create direct conversation: ${error.message}`);
    if (typeof data !== 'string' || !data) {
      throw new Error('Create direct conversation: the database returned no conversation id.');
    }
    return data;
  }

  async send(input: SendProductionDirectMessageV2, expectedOwnerId: string): Promise<void> {
    await this.assertAuthenticatedOwner(expectedOwnerId);
    const body = input.body.trim();
    if (!input.conversationId || body.length < 1 || body.length > 4_000) {
      throw new Error('Direct messages must contain 1–4000 characters.');
    }
    const { error } = await this.client.from('direct_messages').insert({
      conversation_id: input.conversationId,
      sender_id: expectedOwnerId,
      body,
      client_message_id: input.clientMessageId ?? newClientMessageId(),
    });
    if (error) throw new Error(`Send direct message: ${error.message}`);
  }

  async markRead(
    conversationId: string,
    expectedOwnerId: string,
    readAt = new Date().toISOString(),
  ): Promise<void> {
    await this.updateOwnParticipantState(
      conversationId,
      expectedOwnerId,
      { last_read_at: readAt },
      'Mark direct conversation read',
    );
  }

  async hide(
    conversationId: string,
    expectedOwnerId: string,
    hiddenAt = new Date().toISOString(),
  ): Promise<void> {
    await this.updateOwnParticipantState(
      conversationId,
      expectedOwnerId,
      { hidden_at: hiddenAt },
      'Hide direct conversation',
    );
  }

  private async assertAuthenticatedOwner(expectedOwnerId: string): Promise<void> {
    if (!expectedOwnerId) throw new Error('A signed-in direct-message owner is required.');
    const { data, error } = await this.client.auth.getUser();
    if (error) throw new Error(`Verify direct-message owner: ${error.message}`);
    if (!data.user || data.user.id !== expectedOwnerId) {
      throw new Error('The active Supabase identity does not match the requested direct-message owner.');
    }
  }

  private async updateOwnParticipantState(
    conversationId: string,
    expectedOwnerId: string,
    patch: Readonly<Record<string, string>>,
    label: string,
  ): Promise<void> {
    await this.assertAuthenticatedOwner(expectedOwnerId);
    if (!conversationId) throw new Error(`${label}: a conversation id is required.`);
    const { data, error } = await this.client
      .from('direct_conversation_participants')
      .update(patch)
      .eq('conversation_id', conversationId)
      .eq('user_id', expectedOwnerId)
      .is('left_at', null)
      .select('conversation_id,user_id');
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1 || rows[0]?.user_id !== expectedOwnerId) {
      throw new Error(`${label}: no owner-scoped participant row was updated.`);
    }
  }
}

/** Prevents a stale account snapshot from rendering after an identity switch. */
export function directConversationsForOwnerV2(
  snapshot: ProductionDirectInboxSnapshotV2 | null,
  activeOwnerId: string | null | undefined,
): readonly ProductionDirectConversationV2[] {
  return snapshot && activeOwnerId && snapshot.ownerId === activeOwnerId
    ? snapshot.conversations
    : [];
}

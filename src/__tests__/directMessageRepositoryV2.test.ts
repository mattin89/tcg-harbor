import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  directConversationsForOwnerV2,
  SupabaseDirectMessageRepositoryV2,
  type ProductionDirectInboxSnapshotV2,
} from '../services/supabase/directMessageRepositoryV2';

type MockRow = Record<string, unknown>;

interface QueryCall {
  readonly table: string;
  readonly operation: string;
  readonly args: readonly unknown[];
}

class MockQuery implements PromiseLike<{ data: MockRow[] | null; error: null }> {
  private mutation = false;

  constructor(
    private readonly table: string,
    private readonly rows: readonly MockRow[],
    private readonly calls: QueryCall[],
  ) {}

  select(columns = '*'): this {
    this.calls.push({ table: this.table, operation: 'select', args: [columns] });
    return this;
  }

  eq(column: string, value: unknown): this {
    this.calls.push({ table: this.table, operation: 'eq', args: [column, value] });
    return this;
  }

  in(column: string, value: readonly unknown[]): this {
    this.calls.push({ table: this.table, operation: 'in', args: [column, value] });
    return this;
  }

  is(column: string, value: unknown): this {
    this.calls.push({ table: this.table, operation: 'is', args: [column, value] });
    return this;
  }

  or(value: string): this {
    this.calls.push({ table: this.table, operation: 'or', args: [value] });
    return this;
  }

  order(column: string, options: unknown): this {
    this.calls.push({ table: this.table, operation: 'order', args: [column, options] });
    return this;
  }

  update(value: Record<string, unknown>): this {
    this.mutation = true;
    this.calls.push({ table: this.table, operation: 'update', args: [value] });
    return this;
  }

  insert(value: Record<string, unknown>): Promise<{ data: null; error: null }> {
    this.calls.push({ table: this.table, operation: 'insert', args: [value] });
    return Promise.resolve({ data: null, error: null });
  }

  range(from: number, to: number): Promise<{ data: MockRow[]; error: null }> {
    this.calls.push({ table: this.table, operation: 'range', args: [from, to] });
    return Promise.resolve({ data: [...this.rows].slice(from, to + 1), error: null });
  }

  then<TResult1 = { data: MockRow[] | null; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: MockRow[] | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const data = this.mutation ? [...this.rows] : null;
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

function mockClient(
  authenticatedUserId: string | null,
  rowsByTable: Readonly<Record<string, readonly MockRow[]>>,
  calls: QueryCall[],
): SupabaseClient {
  return {
    auth: {
      getUser() {
        return Promise.resolve({
          data: { user: authenticatedUserId ? { id: authenticatedUserId } : null },
          error: null,
        });
      },
    },
    from(table: string) {
      calls.push({ table, operation: 'from', args: [] });
      return new MockQuery(table, rowsByTable[table] ?? [], calls);
    },
    rpc(functionName: string, params: Record<string, unknown>) {
      calls.push({ table: functionName, operation: 'rpc', args: [params] });
      return Promise.resolve({ data: 'conversation-created', error: null });
    },
  } as unknown as SupabaseClient;
}

describe('SupabaseDirectMessageRepositoryV2', () => {
  it('loads only the authenticated owner participant rows, conversations, and messages', async () => {
    const calls: QueryCall[] = [];
    const rowsByTable: Record<string, readonly MockRow[]> = {
      direct_conversation_participants: [{
        conversation_id: 'conversation-1',
        user_id: 'owner-a',
        last_read_at: '2026-07-21T09:00:00.000Z',
        hidden_at: null,
        left_at: null,
        updated_at: '2026-07-21T10:00:00.000Z',
      }],
      direct_conversations: [{
        id: 'conversation-1',
        participant_low_id: 'owner-a',
        participant_high_id: 'peer-b',
        context_community_id: 'community-1',
        created_at: '2026-07-20T08:00:00.000Z',
        updated_at: '2026-07-21T10:00:00.000Z',
        last_message_at: '2026-07-21T10:00:00.000Z',
        deleted_at: null,
      }],
      direct_messages: [
        {
          id: 'message-1',
          conversation_id: 'conversation-1',
          sender_id: 'peer-b',
          body: 'Are you at the store today?',
          created_at: '2026-07-21T09:30:00.000Z',
          deleted_at: null,
        },
        {
          id: 'message-2',
          conversation_id: 'conversation-1',
          sender_id: 'owner-a',
          body: 'Yes, after 18:00.',
          created_at: '2026-07-21T10:00:00.000Z',
          deleted_at: null,
        },
      ],
      communities: [{ id: 'community-1', name: 'Dresden Card Dock' }],
      community_member_profiles: [{
        community_id: 'community-1',
        user_id: 'peer-b',
        username: 'lenak',
        display_name: 'Lena K.',
        avatar_url: null,
      }],
    };
    const repository = new SupabaseDirectMessageRepositoryV2(
      mockClient('owner-a', rowsByTable, calls),
    );

    const snapshot = await repository.load('owner-a');

    expect(snapshot.ownerId).toBe('owner-a');
    expect(snapshot.conversations).toHaveLength(1);
    expect(snapshot.conversations[0]).toMatchObject({
      id: 'conversation-1',
      ownerId: 'owner-a',
      peer: { userId: 'peer-b', username: 'lenak', displayName: 'Lena K.' },
      communityId: 'community-1',
      communityName: 'Dresden Card Dock',
      unreadCount: 1,
      messages: [
        { id: 'message-1', senderId: 'peer-b', own: false },
        { id: 'message-2', senderId: 'owner-a', own: true },
      ],
    });
    expect(calls).toContainEqual({
      table: 'direct_conversation_participants',
      operation: 'eq',
      args: ['user_id', 'owner-a'],
    });
    expect(calls).toContainEqual({
      table: 'direct_conversations',
      operation: 'or',
      args: ['participant_low_id.eq.owner-a,participant_high_id.eq.owner-a'],
    });
    expect(calls).toContainEqual({
      table: 'direct_messages',
      operation: 'in',
      args: ['conversation_id', ['conversation-1']],
    });
  });

  it('returns a genuinely empty production inbox for a fresh account without demo substitution', async () => {
    const calls: QueryCall[] = [];
    const repository = new SupabaseDirectMessageRepositoryV2(
      mockClient('fresh-owner', { direct_conversation_participants: [] }, calls),
    );

    await expect(repository.load('fresh-owner')).resolves.toEqual({
      ownerId: 'fresh-owner',
      conversations: [],
    });
    expect(calls.filter((call) => call.operation === 'from').map((call) => call.table))
      .toEqual(['direct_conversation_participants']);

    const demoSource = readFileSync(new URL('../data/demo.ts', import.meta.url), 'utf8');
    expect(demoSource).toContain('export const initialConversations: Conversation[] = [');
  });

  it('rejects an owner id that does not match the authenticated Supabase identity', async () => {
    const calls: QueryCall[] = [];
    const repository = new SupabaseDirectMessageRepositoryV2(
      mockClient('owner-b', {}, calls),
    );

    await expect(repository.load('owner-a')).rejects.toThrow(
      /active Supabase identity does not match the requested direct-message owner/,
    );
    expect(calls).toEqual([]);
  });

  it('binds sends and participant-state updates to the authenticated owner', async () => {
    const calls: QueryCall[] = [];
    const repository = new SupabaseDirectMessageRepositoryV2(
      mockClient('owner-a', {
        direct_conversation_participants: [{
          conversation_id: 'conversation-1',
          user_id: 'owner-a',
        }],
      }, calls),
    );

    await repository.send({
      conversationId: 'conversation-1',
      body: '  See you there.  ',
      clientMessageId: 'client-message-1',
    }, 'owner-a');
    await repository.markRead(
      'conversation-1',
      'owner-a',
      '2026-07-21T11:00:00.000Z',
    );

    expect(calls).toContainEqual({
      table: 'direct_messages',
      operation: 'insert',
      args: [{
        conversation_id: 'conversation-1',
        sender_id: 'owner-a',
        body: 'See you there.',
        client_message_id: 'client-message-1',
      }],
    });
    expect(calls).toContainEqual({
      table: 'direct_conversation_participants',
      operation: 'eq',
      args: ['user_id', 'owner-a'],
    });
    expect(calls).toContainEqual({
      table: 'direct_conversation_participants',
      operation: 'update',
      args: [{ last_read_at: '2026-07-21T11:00:00.000Z' }],
    });
  });

  it('never exposes a stale snapshot after the active account changes', () => {
    const snapshot = {
      ownerId: 'owner-a',
      conversations: [{ id: 'conversation-1' }],
    } as unknown as ProductionDirectInboxSnapshotV2;

    expect(directConversationsForOwnerV2(snapshot, 'owner-a')).toHaveLength(1);
    expect(directConversationsForOwnerV2(snapshot, 'owner-b')).toEqual([]);
    expect(directConversationsForOwnerV2(snapshot, null)).toEqual([]);
  });
});

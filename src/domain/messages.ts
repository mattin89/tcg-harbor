import { DomainError } from './errors';
import type {
  CommunityId,
  CommunityMembership,
  ConversationId,
  DirectConversation,
  DirectMessage,
  DirectMessageId,
  ISODateTime,
  UserBlock,
  UserId,
} from './types';

function activeCommunitiesFor(
  userId: UserId,
  memberships: readonly CommunityMembership[],
): ReadonlySet<CommunityId> {
  return new Set(
    memberships
      .filter((membership) => membership.userId === userId && membership.status === 'active')
      .map((membership) => membership.communityId),
  );
}

export function sharedActiveCommunityIds(
  firstUserId: UserId,
  secondUserId: UserId,
  memberships: readonly CommunityMembership[],
): readonly CommunityId[] {
  const first = activeCommunitiesFor(firstUserId, memberships);
  const second = activeCommunitiesFor(secondUserId, memberships);
  return Object.freeze([...first].filter((communityId) => second.has(communityId)).sort());
}

export function usersAreBlocked(
  firstUserId: UserId,
  secondUserId: UserId,
  blocks: readonly UserBlock[],
): boolean {
  return blocks.some(
    (block) =>
      (block.blockerId === firstUserId && block.blockedId === secondUserId) ||
      (block.blockerId === secondUserId && block.blockedId === firstUserId),
  );
}

export type DirectMessageAuthorization =
  | { readonly allowed: true; readonly sharedCommunityIds: readonly CommunityId[] }
  | {
      readonly allowed: false;
      readonly reason: 'same_user' | 'no_shared_community' | 'blocked' | 'not_participant';
    };

export function authorizeDirectConversation(
  firstUserId: UserId,
  secondUserId: UserId,
  memberships: readonly CommunityMembership[],
  blocks: readonly UserBlock[] = [],
): DirectMessageAuthorization {
  if (!firstUserId || !secondUserId || firstUserId === secondUserId) {
    return Object.freeze({ allowed: false, reason: 'same_user' });
  }
  if (usersAreBlocked(firstUserId, secondUserId, blocks)) {
    return Object.freeze({ allowed: false, reason: 'blocked' });
  }
  const sharedCommunityIds = sharedActiveCommunityIds(firstUserId, secondUserId, memberships);
  if (sharedCommunityIds.length === 0) {
    return Object.freeze({ allowed: false, reason: 'no_shared_community' });
  }
  return Object.freeze({ allowed: true, sharedCommunityIds });
}

export interface CreateDirectConversationOptions {
  readonly id: ConversationId;
  readonly initiatorId: UserId;
  readonly recipientId: UserId;
  readonly memberships: readonly CommunityMembership[];
  readonly blocks?: readonly UserBlock[];
  readonly now: ISODateTime;
}

export function createDirectConversation(options: CreateDirectConversationOptions): DirectConversation {
  const authorization = authorizeDirectConversation(
    options.initiatorId,
    options.recipientId,
    options.memberships,
    options.blocks,
  );
  if (!authorization.allowed) {
    if (authorization.reason === 'blocked') {
      throw new DomainError('USER_BLOCKED', 'A blocked user cannot start a direct conversation.');
    }
    throw new DomainError('NO_SHARED_COMMUNITY', 'Users need a shared active community to message privately.');
  }
  if (!Number.isFinite(Date.parse(options.now))) throw new DomainError('INVALID_INPUT', 'now is invalid.');
  const participantIds = Object.freeze([
    options.initiatorId,
    options.recipientId,
  ]) as readonly [UserId, UserId];
  return Object.freeze({
    id: options.id,
    participantIds,
    sharedCommunityId: authorization.sharedCommunityIds[0],
    createdAt: options.now,
    hiddenBy: Object.freeze([]),
  });
}

export function canReadDirectConversation(viewerId: UserId, conversation: DirectConversation): boolean {
  return conversation.participantIds.includes(viewerId);
}

export function assertCanReadDirectConversation(
  viewerId: UserId,
  conversation: DirectConversation,
): void {
  if (!canReadDirectConversation(viewerId, conversation)) {
    throw new DomainError('NOT_AUTHORIZED', 'Direct conversations are visible only to their participants.');
  }
}

export function authorizeDirectMessageSend(
  senderId: UserId,
  conversation: DirectConversation,
  memberships: readonly CommunityMembership[],
  blocks: readonly UserBlock[] = [],
): DirectMessageAuthorization {
  if (!conversation.participantIds.includes(senderId)) {
    return Object.freeze({ allowed: false, reason: 'not_participant' });
  }
  const recipientId = conversation.participantIds.find((participantId) => participantId !== senderId);
  if (!recipientId) return Object.freeze({ allowed: false, reason: 'same_user' });
  return authorizeDirectConversation(senderId, recipientId, memberships, blocks);
}

export interface CreateDirectMessageOptions {
  readonly id: DirectMessageId;
  readonly senderId: UserId;
  readonly conversation: DirectConversation;
  readonly memberships: readonly CommunityMembership[];
  readonly blocks?: readonly UserBlock[];
  readonly body: string;
  readonly now: ISODateTime;
}

export function createDirectMessage(options: CreateDirectMessageOptions): DirectMessage {
  const authorization = authorizeDirectMessageSend(
    options.senderId,
    options.conversation,
    options.memberships,
    options.blocks,
  );
  if (!authorization.allowed) {
    const code = authorization.reason === 'blocked' ? 'USER_BLOCKED' :
      authorization.reason === 'no_shared_community' ? 'NO_SHARED_COMMUNITY' : 'NOT_AUTHORIZED';
    throw new DomainError(code, 'The direct message is not authorized.');
  }
  const body = options.body.trim();
  if (!body || body.length > 4_000) {
    throw new DomainError('INVALID_INPUT', 'Direct messages must contain 1–4000 characters.');
  }
  if (!Number.isFinite(Date.parse(options.now))) throw new DomainError('INVALID_INPUT', 'now is invalid.');
  return Object.freeze({
    id: options.id,
    conversationId: options.conversation.id,
    senderId: options.senderId,
    body,
    sentAt: options.now,
  });
}

export function directMessagesForViewer(
  viewerId: UserId,
  conversation: DirectConversation,
  messages: readonly DirectMessage[],
): readonly DirectMessage[] {
  assertCanReadDirectConversation(viewerId, conversation);
  return messages.filter(
    (message) => message.conversationId === conversation.id && !message.deletedAt,
  );
}

export function visibleConversationsForViewer(
  viewerId: UserId,
  conversations: readonly DirectConversation[],
): readonly DirectConversation[] {
  return conversations.filter(
    (conversation) =>
      canReadDirectConversation(viewerId, conversation) && !conversation.hiddenBy.includes(viewerId),
  );
}

import { DomainError } from './errors';
import type {
  CommunityId,
  CommunityMembership,
  CommunityMembershipId,
  CommunityMessage,
  ISODateTime,
  StoreJoinCode,
  UserId,
} from './types';

export type JoinCodeValidation =
  | { readonly status: 'valid'; readonly code: StoreJoinCode }
  | { readonly status: 'invalid' }
  | { readonly status: 'revoked' }
  | { readonly status: 'expired' }
  | { readonly status: 'exhausted' }
  | { readonly status: 'already_member'; readonly membership: CommunityMembership }
  | { readonly status: 'membership_suspended'; readonly membership: CommunityMembership };

function normalizedPublicCode(value: string): string {
  return value.trim().toLocaleUpperCase('en-US');
}

function atMilliseconds(value: ISODateTime, label: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new DomainError('INVALID_INPUT', `${label} must be a valid date/time.`);
  return result;
}

export function activeMembership(
  memberships: readonly CommunityMembership[],
  userId: UserId,
  communityId: CommunityId,
): CommunityMembership | null {
  return memberships.find(
    (membership) =>
      membership.userId === userId &&
      membership.communityId === communityId &&
      membership.status === 'active',
  ) ?? null;
}

export function canAccessCommunity(
  memberships: readonly CommunityMembership[],
  userId: UserId,
  communityId: CommunityId,
): boolean {
  return activeMembership(memberships, userId, communityId) != null;
}

export function assertCommunityAccess(
  memberships: readonly CommunityMembership[],
  userId: UserId,
  communityId: CommunityId,
): void {
  if (!canAccessCommunity(memberships, userId, communityId)) {
    throw new DomainError('NOT_AUTHORIZED', 'Active community membership is required.');
  }
}

export function communityMessagesForViewer(
  messages: readonly CommunityMessage[],
  memberships: readonly CommunityMembership[],
  viewerId: UserId,
  communityId: CommunityId,
): readonly CommunityMessage[] {
  assertCommunityAccess(memberships, viewerId, communityId);
  return messages.filter((message) => message.communityId === communityId && !message.deletedAt);
}

export interface ValidateStoreJoinInput {
  readonly enteredCode: string;
  readonly codes: readonly StoreJoinCode[];
  readonly memberships: readonly CommunityMembership[];
  readonly userId: UserId;
  readonly now: ISODateTime;
}

export function validateStoreJoin(input: ValidateStoreJoinInput): JoinCodeValidation {
  const entered = normalizedPublicCode(input.enteredCode);
  if (!entered) return Object.freeze({ status: 'invalid' });
  const code = input.codes.find(
    (candidate) => normalizedPublicCode(candidate.publicCode) === entered,
  );
  if (!code) return Object.freeze({ status: 'invalid' });
  if (!code.active || code.revokedAt) return Object.freeze({ status: 'revoked' });
  const nowMs = atMilliseconds(input.now, 'now');
  if (code.expiresAt && atMilliseconds(code.expiresAt, 'expiresAt') <= nowMs) {
    return Object.freeze({ status: 'expired' });
  }
  if (code.maxUses != null && code.useCount >= code.maxUses) {
    return Object.freeze({ status: 'exhausted' });
  }

  const existing = input.memberships.find(
    (membership) =>
      membership.userId === input.userId && membership.communityId === code.communityId,
  );
  if (existing?.status === 'active') {
    return Object.freeze({ status: 'already_member', membership: existing });
  }
  if (existing?.status === 'suspended') {
    return Object.freeze({ status: 'membership_suspended', membership: existing });
  }
  return Object.freeze({ status: 'valid', code });
}

export type JoinCommunityResult =
  | {
      readonly status: 'joined' | 'rejoined';
      readonly membership: CommunityMembership;
      readonly updatedCode: StoreJoinCode;
      readonly memberships: readonly CommunityMembership[];
    }
  | Exclude<JoinCodeValidation, { readonly status: 'valid' }>;

export interface JoinCommunityInput extends ValidateStoreJoinInput {
  readonly newMembershipId: CommunityMembershipId;
}

/** Pure transaction model; persistence should atomically save updatedCode and memberships. */
export function joinCommunityWithCode(input: JoinCommunityInput): JoinCommunityResult {
  const validation = validateStoreJoin(input);
  if (validation.status !== 'valid') return validation;
  const code = validation.code;
  const prior = input.memberships.find(
    (membership) =>
      membership.userId === input.userId && membership.communityId === code.communityId,
  );
  const membership: CommunityMembership = Object.freeze({
    id: prior?.id ?? input.newMembershipId,
    communityId: code.communityId,
    userId: input.userId,
    status: 'active',
    role: prior?.role ?? 'member',
    joinedAt: prior?.joinedAt ?? input.now,
    updatedAt: input.now,
  });
  const memberships = prior
    ? input.memberships.map((candidate) => candidate.id === prior.id ? membership : candidate)
    : [...input.memberships, membership];
  const updatedCode: StoreJoinCode = Object.freeze({ ...code, useCount: code.useCount + 1 });

  return Object.freeze({
    status: prior ? 'rejoined' : 'joined',
    membership,
    updatedCode,
    memberships: Object.freeze(memberships),
  });
}

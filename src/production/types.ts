import type { Session } from "@supabase/supabase-js";

export type AccountKind = "player" | "store";

export type AppRole =
  | "collector"
  | "store_administrator"
  | "community_moderator"
  | "platform_administrator";

export type StoreApplicationStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "rejected"
  | "withdrawn";

export interface ProductionProfile {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  accountKind: AccountKind;
  roles: AppRole[];
  accountStatus: "active" | "suspended" | "deactivated";
}

export interface StoreApplication {
  id: string;
  applicantUserId: string;
  status: StoreApplicationStatus;
  storeName: string;
  contactName: string;
  contactEmail: string;
  phone: string | null;
  websiteUrl: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postcode: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  applicantNote: string | null;
  evidenceUrl: string | null;
  reviewerId: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  approvedStoreId: string | null;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreApplicationDraft {
  storeName: string;
  contactName: string;
  contactEmail: string;
  phone?: string;
  websiteUrl?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;
  postcode: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  applicantNote?: string;
  evidenceUrl?: string;
}

export interface ManagedStore {
  id: string;
  slug: string;
  name: string;
  city: string;
  postcode: string;
  countryCode: string;
  isVerified: boolean;
  isActive: boolean;
  community: {
    id: string;
    name: string;
    isActive: boolean;
  } | null;
}

export interface RegisteredStore {
  id: string;
  slug: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  region: string | null;
  postcode: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  openingHours: Record<string, unknown>;
  contactEmail: string | null;
  phone: string | null;
  websiteUrl: string | null;
  imageUrl: string | null;
}

export interface CommunityChannel {
  id: string;
  communityId: string;
  slug: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CommunityChannelDraft {
  communityId: string;
  name: string;
  slug: string;
  description?: string;
}

export interface StoreQrInvite {
  inviteId: string;
  storeId: string;
  communityId: string;
  tokenPrefix: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  lastUsedAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
}

/** The raw token is deliberately returned only when an invite is created or rotated. */
export interface GeneratedStoreQrInvite {
  inviteId: string;
  storeId: string;
  communityId: string;
  rawToken: string;
  tokenPrefix: string;
  createdAt: string;
}

export type StoreJoinCodeState = "valid" | "expired" | "revoked" | "invalid";

export interface StoreJoinCodeValidation {
  storeId: string;
  communityId: string;
  storeName: string;
  communityName: string;
  codeState: StoreJoinCodeState;
}

export type StoreJoinOutcome =
  | "joined"
  | "already_member"
  | "invalid"
  | "expired"
  | "revoked"
  | "rate_limited";

export interface StoreJoinResult {
  outcome: StoreJoinOutcome;
  communityId: string | null;
}

export interface CommunityMessage {
  id: string;
  communityId: string;
  channelId: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  body: string;
  createdAt: string;
}

export interface ProductionAccessSnapshot {
  session: Session;
  profile: ProductionProfile;
  application: StoreApplication | null;
  managedStores: ManagedStore[];
  registeredStores: RegisteredStore[];
}

export interface PendingApplication extends StoreApplication {
  applicant: {
    username: string;
    displayName: string | null;
  } | null;
}

export interface SignUpDraft {
  email: string;
  password: string;
  username: string;
  displayName?: string;
  accountKind: AccountKind;
  emailRedirectPath?: string;
}

export interface SignUpResult {
  session: Session | null;
  emailConfirmationRequired: boolean;
}

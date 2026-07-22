import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { verifiedSupabaseSessionV3 } from "../services/supabase/authSessionIsolationV3";
import type {
  AppRole,
  CommunityChannel,
  CommunityChannelDraft,
  CommunityMessage,
  GeneratedStoreQrInvite,
  ManagedStore,
  PendingApplication,
  ProductionAccessSnapshot,
  ProductionNotificationPreferences,
  ProductionProfile,
  ProductionProfileSettingsDraft,
  RegisteredStore,
  SignUpDraft,
  SignUpResult,
  StoreJoinCodeValidation,
  StoreJoinOutcome,
  StoreJoinResult,
  StoreQrInvite,
  StoreApplication,
  StoreApplicationDraft,
  StoreApplicationStatus,
} from "./types";

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function optionalText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(row: Row, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : Number(value);
}

function boolean(row: Row, key: string, fallback: boolean): boolean {
  const value = row[key];
  return typeof value === "boolean" ? value : fallback;
}

function mapNotificationPreferences(value: unknown): ProductionNotificationPreferences {
  const row = asRow(value);
  return {
    directMessages: boolean(row, "direct_messages", true),
    communityReplies: boolean(row, "community_replies", true),
    matchingTrades: boolean(row, "matching_trades", true),
    tradeUpdates: boolean(row, "trade_updates", true),
    emailEnabled: boolean(row, "email_enabled", false),
  };
}

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? value as Row : {};
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(asRow) : [];
}

function mapApplication(value: unknown): StoreApplication {
  const row = asRow(value);
  return {
    id: text(row, "id"),
    applicantUserId: text(row, "applicant_user_id"),
    status: text(row, "status") as StoreApplicationStatus,
    storeName: text(row, "store_name"),
    contactName: text(row, "contact_name"),
    contactEmail: text(row, "contact_email"),
    phone: optionalText(row, "phone"),
    websiteUrl: optionalText(row, "website_url"),
    addressLine1: text(row, "address_line_1"),
    addressLine2: optionalText(row, "address_line_2"),
    city: text(row, "city"),
    region: optionalText(row, "region"),
    postcode: text(row, "postcode"),
    countryCode: text(row, "country_code"),
    latitude: number(row, "latitude"),
    longitude: number(row, "longitude"),
    timezone: text(row, "timezone"),
    applicantNote: optionalText(row, "applicant_note"),
    evidenceUrl: optionalText(row, "evidence_url"),
    reviewerId: optionalText(row, "reviewer_id"),
    reviewNote: optionalText(row, "review_note"),
    reviewedAt: optionalText(row, "reviewed_at"),
    approvedStoreId: optionalText(row, "approved_store_id"),
    submittedAt: text(row, "submitted_at"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapManagedStores(value: unknown): ManagedStore[] {
  return asRows(value).flatMap((assignment) => {
    const rawStore = assignment.stores;
    const store = Array.isArray(rawStore) ? asRow(rawStore[0]) : asRow(rawStore);
    if (!text(store, "id")) return [];
    const rawCommunity = store.communities;
    const community = Array.isArray(rawCommunity) ? asRow(rawCommunity[0]) : asRow(rawCommunity);
    return [{
      id: text(store, "id"),
      slug: text(store, "slug"),
      name: text(store, "name"),
      city: text(store, "city"),
      postcode: text(store, "postcode"),
      countryCode: text(store, "country_code"),
      isVerified: Boolean(store.is_verified),
      isActive: Boolean(store.is_active),
      community: text(community, "id") ? {
        id: text(community, "id"),
        name: text(community, "name"),
        isActive: Boolean(community.is_active),
      } : null,
    }];
  });
}

function mapRegisteredStores(value: unknown): RegisteredStore[] {
  return asRows(value).flatMap((store) => text(store, "id") ? [{
    id: text(store, "id"),
    slug: text(store, "slug"),
    name: text(store, "name"),
    addressLine1: text(store, "address_line_1"),
    addressLine2: optionalText(store, "address_line_2"),
    city: text(store, "city"),
    region: optionalText(store, "region"),
    postcode: text(store, "postcode"),
    countryCode: text(store, "country_code"),
    latitude: number(store, "latitude"),
    longitude: number(store, "longitude"),
    openingHours: asRow(store.opening_hours),
    contactEmail: optionalText(store, "contact_email"),
    phone: optionalText(store, "phone"),
    websiteUrl: optionalText(store, "website_url"),
    imageUrl: optionalText(store, "image_url"),
  }] : []);
}

function mapChannel(value: unknown): CommunityChannel {
  const row = asRow(value);
  return {
    id: text(row, "id"),
    communityId: text(row, "community_id"),
    slug: text(row, "slug"),
    name: text(row, "name"),
    description: optionalText(row, "description"),
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    archivedAt: optionalText(row, "archived_at"),
  };
}

function mapStoreQrInvite(value: unknown): StoreQrInvite {
  const row = asRow(value);
  return {
    inviteId: text(row, "invite_id"),
    storeId: text(row, "store_id"),
    communityId: text(row, "community_id"),
    tokenPrefix: text(row, "token_prefix"),
    label: optionalText(row, "label"),
    createdAt: text(row, "created_at"),
    expiresAt: optionalText(row, "expires_at"),
    maxUses: row.max_uses === null || row.max_uses === undefined ? null : number(row, "max_uses"),
    useCount: number(row, "use_count"),
    lastUsedAt: optionalText(row, "last_used_at"),
    revokedAt: optionalText(row, "revoked_at"),
    isActive: Boolean(row.is_active),
  };
}

function mapGeneratedStoreQrInvite(value: unknown): GeneratedStoreQrInvite {
  const row = asRow(value);
  return {
    inviteId: text(row, "invite_id"),
    storeId: text(row, "store_id"),
    communityId: text(row, "community_id"),
    rawToken: text(row, "raw_token"),
    tokenPrefix: text(row, "token_prefix"),
    createdAt: text(row, "created_at"),
  };
}

function mapStoreJoinValidation(value: unknown): StoreJoinCodeValidation | null {
  const row = asRow(Array.isArray(value) ? value[0] : value);
  if (!text(row, "store_id")) return null;
  return {
    storeId: text(row, "store_id"),
    communityId: text(row, "community_id"),
    storeName: text(row, "store_name"),
    communityName: text(row, "community_name"),
    codeState: text(row, "code_state") as StoreJoinCodeValidation["codeState"],
  };
}

function mapStoreJoinResult(value: unknown): StoreJoinResult {
  const row = asRow(Array.isArray(value) ? value[0] : value);
  return {
    outcome: text(row, "outcome") as StoreJoinOutcome,
    communityId: optionalText(row, "community_id"),
  };
}

function message(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "Something went wrong. Please try again.";
}

export class ProductionAccessError extends Error {
  constructor(readonly operation: string, cause: unknown) {
    super(message(cause));
    this.name = "ProductionAccessError";
  }
}

export class SupabaseProductionAccess {
  constructor(readonly client: SupabaseClient) {}

  async getSession(): Promise<Session | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw new ProductionAccessError("getSession", error);
    if (!data.session) return null;
    try {
      return await verifiedSupabaseSessionV3(this.client, data.session);
    } catch (verificationError) {
      throw new ProductionAccessError("verifySession", verificationError);
    }
  }

  onAuthChange(listener: (event: string, session: Session | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event, session) => listener(event, session));
    return () => data.subscription.unsubscribe();
  }

  onStoreApplicationChange(userId: string, listener: () => void): () => void {
    const channel = this.client
      .channel(`store-application:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "store_applications", filter: `applicant_user_id=eq.${userId}` },
        listener,
      )
      .subscribe();
    return () => { void this.client.removeChannel(channel); };
  }

  async signIn(email: string, password: string): Promise<Session> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.session) throw new ProductionAccessError("signIn", error ?? new Error("No session returned."));
    return data.session;
  }

  async signUp(draft: SignUpDraft): Promise<SignUpResult> {
    const redirectPath = draft.emailRedirectPath?.startsWith("/") ? draft.emailRedirectPath : "/";
    const redirectTo = typeof window === "undefined" ? undefined : `${window.location.origin}${redirectPath}`;
    const { data, error } = await this.client.auth.signUp({
      email: draft.email,
      password: draft.password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          username: draft.username.toLowerCase(),
          display_name: draft.displayName?.trim() || draft.username,
          account_kind: draft.accountKind,
        },
      },
    });
    if (error) throw new ProductionAccessError("signUp", error);
    return { session: data.session, emailConfirmationRequired: data.session === null };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw new ProductionAccessError("signOut", error);
  }

  async signOutEverywhere(): Promise<void> {
    const { error } = await this.client.auth.signOut({ scope: "global" });
    if (error) throw new ProductionAccessError("signOutEverywhere", error);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const redirectTo = typeof window === "undefined" ? undefined : `${window.location.origin}/`;
    const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new ProductionAccessError("requestPasswordReset", error);
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw new ProductionAccessError("updatePassword", error);
  }

  async changePassword(currentPassword: string, password: string): Promise<void> {
    const { data: currentUserData, error: currentUserError } = await this.client.auth.getUser();
    const currentUser = currentUserData.user;
    if (currentUserError || !currentUser?.email) {
      throw new ProductionAccessError("changePassword", currentUserError ?? new Error("A verified email account is required to change the password."));
    }
    const { data: verification, error: verificationError } = await this.client.auth.signInWithPassword({
      email: currentUser.email,
      password: currentPassword,
    });
    if (verificationError || verification.user?.id !== currentUser.id) {
      throw new ProductionAccessError("changePassword", verificationError ?? new Error("The current password could not be verified."));
    }
    const { error } = await this.client.auth.updateUser({
      current_password: currentPassword,
      password,
    });
    if (error) throw new ProductionAccessError("changePassword", error);
  }

  async updateProfileSettings(userId: string, draft: ProductionProfileSettingsDraft): Promise<void> {
    const username = draft.username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(username)) {
      throw new ProductionAccessError("updateProfileSettings", new Error("Username must be 3–30 lowercase letters, numbers, dots, dashes, or underscores."));
    }
    const approximateCity = draft.approximateCity.trim();
    const approximatePostcode = draft.approximatePostcode.trim();
    if (approximateCity.length > 120 || approximatePostcode.length > 24) {
      throw new ProductionAccessError("updateProfileSettings", new Error("City or postcode is too long."));
    }

    const { data, error } = await this.client
      .from("user_profiles")
      .update({
        username,
        primary_market: draft.primaryMarket === "tcgplayer" ? "united_states" : "europe",
        preferred_currency: draft.preferredCurrency,
        approximate_city: approximateCity || null,
        approximate_postcode: approximatePostcode || null,
      })
      .eq("user_id", userId)
      .select("user_id")
      .single();
    if (error) throw new ProductionAccessError("updateProfileSettings", error);
    if (text(asRow(data), "user_id") !== userId) {
      throw new ProductionAccessError("updateProfileSettings", new Error("The account profile was not updated."));
    }
  }

  async updateNotificationPreferences(userId: string, preferences: ProductionNotificationPreferences): Promise<void> {
    const { data, error } = await this.client
      .from("notification_preferences")
      .update({
        direct_messages: preferences.directMessages,
        community_replies: preferences.communityReplies,
        matching_trades: preferences.matchingTrades,
        trade_updates: preferences.tradeUpdates,
        email_enabled: preferences.emailEnabled,
      })
      .eq("user_id", userId)
      .select("user_id")
      .single();
    if (error) throw new ProductionAccessError("updateNotificationPreferences", error);
    if (text(asRow(data), "user_id") !== userId) {
      throw new ProductionAccessError("updateNotificationPreferences", new Error("Notification preferences were not updated."));
    }
  }

  async loadSnapshot(session: Session): Promise<ProductionAccessSnapshot> {
    const userId = session.user.id;
    const [appUserResult, profileResult, preferencesResult, applicationResult, storesResult, registeredStoresResult] = await Promise.all([
      this.client.from("app_users").select("status,roles").eq("id", userId).single(),
      this.client.from("user_profiles").select("username,display_name,avatar_url,account_kind,primary_market,preferred_currency,approximate_city,approximate_postcode").eq("user_id", userId).single(),
      this.client.from("notification_preferences").select("direct_messages,community_replies,matching_trades,trade_updates,email_enabled").eq("user_id", userId).single(),
      this.client.from("store_applications").select("*").eq("applicant_user_id", userId).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
      this.client
        .from("store_administrators")
        .select("store_id,stores!inner(id,slug,name,city,postcode,country_code,is_verified,is_active,communities(id,name,is_active))")
        .eq("user_id", userId)
        .is("revoked_at", null),
      this.client
        .from("stores")
        .select("id,slug,name,address_line_1,address_line_2,city,region,postcode,country_code,latitude,longitude,opening_hours,contact_email,phone,website_url,image_url")
        .eq("is_verified", true)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
    ]);

    for (const result of [appUserResult, profileResult, preferencesResult, applicationResult, storesResult, registeredStoresResult]) {
      if (result.error) throw new ProductionAccessError("loadSnapshot", result.error);
    }

    const appUser = asRow(appUserResult.data);
    const profile = asRow(profileResult.data);
    const rawRoles = Array.isArray(appUser.roles) ? appUser.roles : [];
    const roles = rawRoles.filter((role): role is AppRole => typeof role === "string") as AppRole[];
    const productionProfile: ProductionProfile = {
      id: userId,
      email: session.user.email ?? "",
      username: text(profile, "username"),
      displayName: optionalText(profile, "display_name"),
      avatarUrl: optionalText(profile, "avatar_url"),
      accountKind: text(profile, "account_kind") === "store" ? "store" : "player",
      primaryMarket: text(profile, "primary_market") === "united_states" ? "tcgplayer" : "cardmarket",
      preferredCurrency: text(profile, "preferred_currency") === "USD" ? "USD" : "EUR",
      approximateCity: optionalText(profile, "approximate_city") ?? "",
      approximatePostcode: optionalText(profile, "approximate_postcode") ?? "",
      roles,
      accountStatus: text(appUser, "status") as ProductionProfile["accountStatus"],
    };

    return {
      session,
      profile: productionProfile,
      notificationPreferences: mapNotificationPreferences(preferencesResult.data),
      application: applicationResult.data ? mapApplication(applicationResult.data) : null,
      managedStores: mapManagedStores(storesResult.data),
      registeredStores: mapRegisteredStores(registeredStoresResult.data),
    };
  }

  async submitStoreApplication(draft: StoreApplicationDraft): Promise<StoreApplication> {
    const { data, error } = await this.client.rpc("submit_store_application", {
      p_store_name: draft.storeName,
      p_contact_name: draft.contactName,
      p_contact_email: draft.contactEmail,
      p_address_line_1: draft.addressLine1,
      p_city: draft.city,
      p_postcode: draft.postcode,
      p_country_code: draft.countryCode.toUpperCase(),
      p_latitude: draft.latitude,
      p_longitude: draft.longitude,
      p_timezone: draft.timezone,
      p_address_line_2: draft.addressLine2?.trim() || null,
      p_region: draft.region?.trim() || null,
      p_phone: draft.phone?.trim() || null,
      p_website_url: draft.websiteUrl?.trim() || null,
      p_evidence_url: draft.evidenceUrl?.trim() || null,
      p_applicant_note: draft.applicantNote?.trim() || null,
    });
    if (error) throw new ProductionAccessError("submitStoreApplication", error);
    return mapApplication(Array.isArray(data) ? data[0] : data);
  }

  async withdrawStoreApplication(applicationId: string): Promise<StoreApplication> {
    const { data, error } = await this.client.rpc("withdraw_store_application", {
      p_application_id: applicationId,
    });
    if (error) throw new ProductionAccessError("withdrawStoreApplication", error);
    return mapApplication(Array.isArray(data) ? data[0] : data);
  }

  async listPendingApplications(): Promise<PendingApplication[]> {
    const { data, error } = await this.client
      .from("store_applications")
      .select("*")
      .in("status", ["pending", "under_review"])
      .order("submitted_at", { ascending: true });
    if (error) throw new ProductionAccessError("listPendingApplications", error);
    return asRows(data).map((row) => ({ ...mapApplication(row), applicant: null }));
  }

  async reviewApplication(
    applicationId: string,
    decision: "approved" | "rejected",
    reviewNote?: string,
  ): Promise<StoreApplication> {
    const { data, error } = await this.client.rpc("review_store_application", {
      p_application_id: applicationId,
      p_decision: decision,
      p_review_note: reviewNote?.trim() || null,
    });
    if (error) throw new ProductionAccessError("reviewApplication", error);
    return mapApplication(Array.isArray(data) ? data[0] : data);
  }

  async beginReviewApplication(applicationId: string): Promise<StoreApplication> {
    const { data, error } = await this.client.rpc("begin_store_application_review", {
      p_application_id: applicationId,
    });
    if (error) throw new ProductionAccessError("beginReviewApplication", error);
    return mapApplication(Array.isArray(data) ? data[0] : data);
  }

  async listCommunityChannels(communityId: string): Promise<CommunityChannel[]> {
    const { data, error } = await this.client
      .from("community_channels")
      .select("id,community_id,slug,name,description,is_default,is_active,created_at,updated_at,archived_at")
      .eq("community_id", communityId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw new ProductionAccessError("listCommunityChannels", error);
    return asRows(data).map(mapChannel);
  }

  async createCommunityChannel(draft: CommunityChannelDraft): Promise<CommunityChannel> {
    const { data, error } = await this.client.rpc("create_community_channel", {
      p_community_id: draft.communityId,
      p_name: draft.name,
      p_slug: draft.slug,
      p_description: draft.description?.trim() || null,
    });
    if (error) throw new ProductionAccessError("createCommunityChannel", error);
    return mapChannel(Array.isArray(data) ? data[0] : data);
  }

  async updateCommunityChannel(channelId: string, draft: Omit<CommunityChannelDraft, "communityId">): Promise<CommunityChannel> {
    const { data, error } = await this.client.rpc("update_community_channel", {
      p_channel_id: channelId,
      p_name: draft.name,
      p_slug: draft.slug,
      p_description: draft.description?.trim() || null,
    });
    if (error) throw new ProductionAccessError("updateCommunityChannel", error);
    return mapChannel(Array.isArray(data) ? data[0] : data);
  }

  async archiveCommunityChannel(channelId: string): Promise<void> {
    const { error } = await this.client.rpc("archive_community_channel", { p_channel_id: channelId });
    if (error) throw new ProductionAccessError("archiveCommunityChannel", error);
  }

  async listStoreQrInvites(storeId: string): Promise<StoreQrInvite[]> {
    const { data, error } = await this.client.rpc("list_store_qr_invites", { p_store_id: storeId });
    if (error) throw new ProductionAccessError("listStoreQrInvites", error);
    return asRows(data).map(mapStoreQrInvite);
  }

  async generateStoreQrInvite(storeId: string, label = "In-store QR"): Promise<GeneratedStoreQrInvite> {
    const { data, error } = await this.client.rpc("generate_store_qr_invite", {
      p_store_id: storeId,
      p_label: label.trim() || "In-store QR",
    });
    if (error) throw new ProductionAccessError("generateStoreQrInvite", error);
    return mapGeneratedStoreQrInvite(Array.isArray(data) ? data[0] : data);
  }

  async rotateStoreQrInvite(storeId: string, label?: string): Promise<GeneratedStoreQrInvite> {
    const { data, error } = await this.client.rpc("rotate_store_qr_invite", {
      p_store_id: storeId,
      p_label: label?.trim() || null,
    });
    if (error) throw new ProductionAccessError("rotateStoreQrInvite", error);
    return mapGeneratedStoreQrInvite(Array.isArray(data) ? data[0] : data);
  }

  async revokeStoreQrInvite(storeId: string, reason?: string): Promise<void> {
    const { error } = await this.client.rpc("revoke_store_qr_invite", {
      p_store_id: storeId,
      p_reason: reason?.trim() || null,
    });
    if (error) throw new ProductionAccessError("revokeStoreQrInvite", error);
  }

  async validateStoreJoinCode(rawToken: string): Promise<StoreJoinCodeValidation | null> {
    const { data, error } = await this.client.rpc("validate_store_join_code", { p_code: rawToken.trim() });
    if (error) throw new ProductionAccessError("validateStoreJoinCode", error);
    return mapStoreJoinValidation(data);
  }

  async redeemStoreJoinCode(rawToken: string): Promise<StoreJoinResult> {
    const { data, error } = await this.client.rpc("redeem_store_join_code", {
      p_code: rawToken.trim(),
      p_request_fingerprint: null,
    });
    if (error) throw new ProductionAccessError("redeemStoreJoinCode", error);
    return mapStoreJoinResult(data);
  }

  async listCommunityMessages(communityId: string, channelId: string): Promise<CommunityMessage[]> {
    const { data, error } = await this.client
      .from("community_messages")
      .select("id,community_id,channel_id,author_id,body,created_at")
      .eq("community_id", communityId)
      .eq("channel_id", channelId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new ProductionAccessError("listCommunityMessages", error);

    const rows = asRows(data);
    const authorIds = [...new Set(rows.map((row) => text(row, "author_id")).filter(Boolean))];
    const names = new Map<string, { username: string; displayName: string }>();
    if (authorIds.length > 0) {
      const { data: memberData, error: memberError } = await this.client
        .from("community_member_profiles")
        .select("user_id,username,display_name")
        .eq("community_id", communityId)
        .in("user_id", authorIds);
      if (memberError) throw new ProductionAccessError("listCommunityMessageAuthors", memberError);
      for (const member of asRows(memberData)) {
        names.set(text(member, "user_id"), {
          username: text(member, "username"),
          displayName: optionalText(member, "display_name") ?? text(member, "username"),
        });
      }
    }

    return rows.reverse().map((row) => {
      const authorId = text(row, "author_id");
      const author = names.get(authorId);
      return {
        id: text(row, "id"),
        communityId: text(row, "community_id"),
        channelId: text(row, "channel_id"),
        authorId,
        authorName: author?.displayName || "Community member",
        authorUsername: author?.username || "member",
        body: text(row, "body"),
        createdAt: text(row, "created_at"),
      };
    });
  }

  async moderateCommunityMessage(messageId: string, reason?: string): Promise<void> {
    const { error } = await this.client.rpc("moderate_community_message", {
      p_message_id: messageId,
      p_reason: reason?.trim() || null,
    });
    if (error) throw new ProductionAccessError("moderateCommunityMessage", error);
  }
}

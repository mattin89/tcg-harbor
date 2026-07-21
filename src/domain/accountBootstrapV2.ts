export interface AccountBootstrapIdentityV2 {
  userId: string;
  accountKind: 'player' | 'store';
}

export interface AccountBootstrapSeedsV2<CommunityMessage, TradePost, Conversation, Notification, Activity> {
  communityMessages: Record<string, CommunityMessage[]>;
  tradePosts: TradePost[];
  conversations: Conversation[];
  notifications: Notification[];
  recentActivity: Activity[];
}

/**
 * Fixture data belongs only to the explicit local demo. A real Supabase account
 * starts from empty account-owned state and is populated only by its repositories.
 */
export function resolveAccountBootstrapSeedsV2<CommunityMessage, TradePost, Conversation, Notification, Activity>(
  identity: AccountBootstrapIdentityV2 | undefined,
  demoSeeds: AccountBootstrapSeedsV2<CommunityMessage, TradePost, Conversation, Notification, Activity>,
): AccountBootstrapSeedsV2<CommunityMessage, TradePost, Conversation, Notification, Activity> {
  if (!identity) return demoSeeds;

  return {
    communityMessages: {},
    tradePosts: [],
    conversations: [],
    notifications: [],
    recentActivity: [],
  };
}

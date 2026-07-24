import type { SupabaseClient } from '@supabase/supabase-js';
import type { DemoAsset } from '../../data/demo';
import {
  initialsV6,
  validateCommunityTradeDraftV6,
  type CommunityTradeDraftV6,
  type CommunityTradeExchangeModeV6,
  type CommunityTradePostKindV6,
  type CommunityTradePostV6,
  type CommunityTradeStatusV6,
} from '../../domain/communityTradingV6';
import { assertRowsOwnedByV3, requireAuthenticatedOwnerV3 } from './authSessionIsolationV3';

type JsonRecord = Record<string, unknown>;

interface MembershipRowV6 {
  community_id: string;
  user_id: string;
  role: 'member' | 'moderator';
  status: 'active' | 'suspended' | 'left';
}

interface ProfileRowV6 {
  community_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
}

interface TradeItemRowV6 {
  quantity: number;
  condition?: string | null;
  desired_condition?: string | null;
  language?: string | null;
  desired_language?: string | null;
  card_variant?: { external_identifiers?: JsonRecord } | { external_identifiers?: JsonRecord }[] | null;
}

interface TradePostRowV6 {
  id: string;
  community_id: string;
  author_id: string;
  post_kind: CommunityTradePostKindV6;
  exchange_mode: CommunityTradeExchangeModeV6;
  cash_amount_cents: number | string | null;
  status: CommunityTradeStatusV6;
  notes: string | null;
  created_at: string;
  offered_items?: TradeItemRowV6[] | TradeItemRowV6 | null;
  wanted_items?: TradeItemRowV6[] | TradeItemRowV6 | null;
}

export interface CommunityMembershipV6 {
  readonly communityId: string;
  readonly role: 'member' | 'moderator';
}

export interface CommunityTradingSnapshotV6 {
  readonly ownerId: string;
  readonly memberships: CommunityMembershipV6[];
  readonly posts: CommunityTradePostV6[];
}

function rowsV6<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function relationV6<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function externalAssetIdV6(item: TradeItemRowV6 | undefined): string | null {
  const variant = relationV6(item?.card_variant);
  const identifiers = variant?.external_identifiers;
  if (!identifiers) return null;
  const value = identifiers.tcg_harbor_asset_id
    ?? identifiers.tcgHarborAssetId
    ?? identifiers.source_asset_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function databaseErrorV6(operation: string, error: unknown): Error {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return new Error(`${operation}: ${message}`);
  }
  return new Error(`${operation}: the database request failed.`);
}

function languageCodeV6(language: string): string {
  const normalized = language.trim().toLocaleLowerCase('en-US');
  const codes: Record<string, string> = {
    english: 'EN',
    german: 'DE',
    french: 'FR',
    italian: 'IT',
    spanish: 'ES',
    portuguese: 'PT',
    japanese: 'JP',
    korean: 'KR',
    chinese: 'ZH',
  };
  return codes[normalized] ?? language.toUpperCase();
}

function safeCardAssetV6(asset: DemoAsset | undefined, context: string): DemoAsset {
  if (!asset || asset.kind !== 'card') throw new Error(`${context} must be a card printing.`);
  if (languageCodeV6(asset.language) === 'DE') {
    throw new Error('German One Piece card versions are not supported.');
  }
  return asset;
}

function catalogIdentityV6(asset: DemoAsset): string {
  return asset.catalogId ?? asset.id;
}

const TRADE_POST_SELECT_V6 = `
  id, community_id, author_id, post_kind, exchange_mode, cash_amount_cents,
  status, notes, created_at,
  offered_items:trade_post_offered_items(
    quantity, condition, language,
    card_variant:card_variants!trade_post_offered_items_card_variant_id_fkey(
      external_identifiers
    )
  ),
  wanted_items:trade_post_wanted_items(
    quantity, desired_condition, desired_language,
    card_variant:card_variants!trade_post_wanted_items_card_variant_id_fkey(
      external_identifiers
    )
  )
`;

export class SupabaseCommunityTradingRepositoryV6 {
  constructor(private readonly client: SupabaseClient) {}

  async load(expectedOwnerId: string): Promise<CommunityTradingSnapshotV6> {
    await requireAuthenticatedOwnerV3(this.client, expectedOwnerId, 'Load communities and trades');
    const membershipResult = await this.client
      .from('community_memberships')
      .select('community_id,user_id,role,status')
      .eq('user_id', expectedOwnerId)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });
    if (membershipResult.error) throw databaseErrorV6('Load community memberships', membershipResult.error);
    const membershipRows = (membershipResult.data ?? []) as MembershipRowV6[];
    assertRowsOwnedByV3(membershipRows, expectedOwnerId, 'Load community memberships', 'user_id');
    const memberships = membershipRows.map((row) => ({
      communityId: row.community_id,
      role: row.role,
    }));
    const communityIds = memberships.map((membership) => membership.communityId);
    if (communityIds.length === 0) return { ownerId: expectedOwnerId, memberships, posts: [] };

    const [postsResult, profilesResult] = await Promise.all([
      this.client
        .from('trade_posts')
        .select(TRADE_POST_SELECT_V6)
        .in('community_id', communityIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1_000),
      this.client
        .from('community_member_profiles')
        .select('community_id,user_id,username,display_name')
        .in('community_id', communityIds)
        .limit(1_000),
    ]);
    if (postsResult.error) throw databaseErrorV6('Load community trade posts', postsResult.error);
    if (profilesResult.error) throw databaseErrorV6('Load community member names', profilesResult.error);

    const profiles = new Map(
      ((profilesResult.data ?? []) as ProfileRowV6[]).map((row) => [
        `${row.community_id}:${row.user_id}`,
        row.display_name?.trim() || row.username,
      ]),
    );
    const posts = ((postsResult.data ?? []) as unknown as TradePostRowV6[]).map((row) => {
      const offered = rowsV6(row.offered_items)[0];
      const wanted = rowsV6(row.wanted_items)[0];
      const primary = row.post_kind === 'offering_card' ? offered : wanted;
      const specific = row.exchange_mode === 'specific_card'
        ? row.post_kind === 'offering_card' ? wanted : offered
        : undefined;
      const primaryAssetId = externalAssetIdV6(primary);
      if (!primaryAssetId) {
        throw new Error('A community trade post is missing its verified card catalog mapping.');
      }
      const authorName = profiles.get(`${row.community_id}:${row.author_id}`) ?? 'Collector';
      return {
        id: row.id,
        communityId: row.community_id,
        authorId: row.author_id,
        authorName,
        authorInitials: initialsV6(authorName),
        postKind: row.post_kind,
        exchangeMode: row.exchange_mode,
        cashAmountCents: row.cash_amount_cents === null ? null : Number(row.cash_amount_cents),
        primaryAssetId,
        specificAssetId: externalAssetIdV6(specific),
        quantity: Number(primary?.quantity ?? 1),
        condition: String(primary?.condition ?? primary?.desired_condition ?? 'near_mint'),
        language: String(primary?.language ?? primary?.desired_language ?? ''),
        notes: row.notes ?? '',
        status: row.status,
        createdAt: row.created_at,
        own: row.author_id === expectedOwnerId,
      } satisfies CommunityTradePostV6;
    });

    return { ownerId: expectedOwnerId, memberships, posts };
  }

  async joinOpen(communityId: string, expectedOwnerId: string): Promise<'joined' | 'rejoined' | 'already_member'> {
    await requireAuthenticatedOwnerV3(this.client, expectedOwnerId, 'Join open community');
    const { data, error } = await this.client.rpc('join_open_community_v6', {
      p_community_id: communityId,
    });
    if (error) throw databaseErrorV6('Join open community', error);
    const row = rowsV6(data as { outcome?: unknown }[] | { outcome?: unknown } | null)[0];
    if (row?.outcome === 'joined' || row?.outcome === 'rejoined' || row?.outcome === 'already_member') {
      return row.outcome;
    }
    throw new Error('Join open community: the database returned an unexpected result.');
  }

  async create(
    draft: CommunityTradeDraftV6,
    collectionAssets: readonly DemoAsset[],
    catalogAssets: readonly DemoAsset[],
    expectedOwnerId: string,
  ): Promise<string> {
    await requireAuthenticatedOwnerV3(this.client, expectedOwnerId, 'Create community trade post');
    const normalized = validateCommunityTradeDraftV6(draft);
    const collectionById = new Map(collectionAssets.map((asset) => [asset.id, asset]));
    const catalogById = new Map(catalogAssets.map((asset) => [asset.id, asset]));
    let primaryCollectionItemId: string | null = null;
    let primaryCardVariantId: string | null = null;
    let specificCollectionItemId: string | null = null;
    let specificCardVariantId: string | null = null;

    if (draft.postKind === 'offering_card') {
      const primary = safeCardAssetV6(collectionById.get(draft.primaryAssetId), 'The offered collection item');
      if (!primary.collectionItemId) throw new Error('The offered card is missing its account record. Refresh the collection.');
      if (draft.quantity > primary.quantity) throw new Error('The offered quantity exceeds the quantity in your collection.');
      primaryCollectionItemId = primary.collectionItemId;
      if (draft.exchangeMode === 'specific_card') {
        const specific = safeCardAssetV6(catalogById.get(draft.specificAssetId ?? ''), 'The wanted card');
        specificCardVariantId = await this.resolveVariantId(catalogIdentityV6(specific));
      }
    } else {
      const primary = safeCardAssetV6(catalogById.get(draft.primaryAssetId), 'The wanted card');
      primaryCardVariantId = await this.resolveVariantId(catalogIdentityV6(primary));
      if (draft.exchangeMode === 'specific_card') {
        const specific = safeCardAssetV6(collectionById.get(draft.specificAssetId ?? ''), 'The offered return card');
        if (!specific.collectionItemId) throw new Error('The offered return card is missing its account record. Refresh the collection.');
        specificCollectionItemId = specific.collectionItemId;
      }
    }

    const { data, error } = await this.client.rpc('create_community_trade_post_v6', {
      p_community_id: draft.communityId,
      p_post_kind: draft.postKind,
      p_exchange_mode: draft.exchangeMode,
      p_primary_collection_item_id: primaryCollectionItemId,
      p_primary_card_variant_id: primaryCardVariantId,
      p_specific_collection_item_id: specificCollectionItemId,
      p_specific_card_variant_id: specificCardVariantId,
      p_quantity: draft.quantity,
      p_desired_condition: draft.desiredCondition,
      p_cash_amount_cents: normalized.cashAmountCents,
      p_notes: normalized.notes,
      p_client_request_id: globalThis.crypto.randomUUID(),
    });
    if (error) throw databaseErrorV6('Create community trade post', error);
    if (typeof data !== 'string' || !data) {
      throw new Error('Create community trade post: the database returned no post identifier.');
    }
    return data;
  }

  async setStatus(
    tradePostId: string,
    status: CommunityTradeStatusV6,
    expectedOwnerId: string,
  ): Promise<void> {
    await requireAuthenticatedOwnerV3(this.client, expectedOwnerId, 'Update community trade post');
    const { error } = await this.client.rpc('set_community_trade_post_status_v6', {
      p_trade_post_id: tradePostId,
      p_status: status,
    });
    if (error) throw databaseErrorV6('Update community trade post', error);
  }

  private async resolveVariantId(assetId: string): Promise<string> {
    const { data, error } = await this.client
      .from('card_variants')
      .select('id')
      .contains('external_identifiers', { tcg_harbor_asset_id: assetId })
      .is('archived_at', null)
      .limit(2);
    if (error) throw databaseErrorV6('Resolve card printing', error);
    const rows = (data ?? []) as { id?: unknown }[];
    if (rows.length !== 1 || typeof rows[0]?.id !== 'string') {
      throw new Error('The selected card printing does not have one verified database mapping.');
    }
    return rows[0].id;
  }
}

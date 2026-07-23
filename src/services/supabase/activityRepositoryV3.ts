import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertRowsOwnedByV3,
  requireAuthenticatedOwnerV3,
} from './authSessionIsolationV3';

interface ActivityPageV3 {
  readonly data: ActivityRowV3[] | null;
  readonly error: { readonly message: string } | null;
}

export interface ActivityRowV3 {
  readonly id: number | string;
  readonly user_id: string;
  readonly activity_type: string;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly occurred_at: string;
}

export interface ProductionActivityViewV3 {
  readonly id: string;
  readonly ownerId: string;
  readonly icon: string;
  readonly title: string;
  readonly detail: string;
  readonly createdAt: string;
  readonly time: string;
}

export interface ProductionActivitySnapshotV3 {
  readonly ownerId: string;
  readonly activities: readonly ProductionActivityViewV3[];
}

function metadataStringV3(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadataCountV3(
  metadata: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = metadata?.[key];
  const parsed = typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function humanizeActivityValueV3(value: string | null): string {
  if (!value) return '';
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase('en-US')}${part.slice(1)}`)
    .join(' ');
}

function quantityLabelV3(quantity: number, singular = 'copy'): string {
  const plural = singular.endsWith('y')
    ? `${singular.slice(0, -1)}ies`
    : `${singular}s`;
  return `${quantity} ${quantity === 1 ? singular : plural}`;
}

export function activityRelativeTimeV3(createdAt: string, now = Date.now()): string {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return '';
  const elapsedSeconds = Math.max(0, Math.floor((now - created) / 1_000));
  if (elapsedSeconds < 60) return 'Just now';
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} ${elapsedDays === 1 ? 'day' : 'days'} ago`;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: new Date(created).getFullYear() === new Date(now).getFullYear()
      ? undefined
      : 'numeric',
  }).format(new Date(created));
}

function collectionActivityViewV3(
  row: ActivityRowV3,
  expectedOwnerId: string,
  now: number,
): ProductionActivityViewV3 {
  const metadata = row.metadata;
  const assetKind = metadataStringV3(metadata, 'asset_kind');
  const assetName = metadataStringV3(metadata, 'asset_name')
    ?? (assetKind === 'sealed' ? 'sealed product' : 'card');
  const identifier = metadataStringV3(metadata, 'card_number')
    ?? metadataStringV3(metadata, 'set_code');
  const subtype = metadataStringV3(metadata, 'variant_name')
    ?? humanizeActivityValueV3(metadataStringV3(metadata, 'product_type'));
  const language = metadataStringV3(metadata, 'language');
  const itemDetails = [identifier, subtype, language].filter(Boolean).join(' · ');

  if (row.activity_type === 'collection_item_added') {
    const quantity = metadataCountV3(metadata, 'added_quantity') ?? 1;
    return {
      id: String(row.id),
      ownerId: expectedOwnerId,
      icon: 'plus',
      title: `Added ${assetName}`,
      detail: [itemDetails, `+${quantityLabelV3(quantity)}`].filter(Boolean).join(' · '),
      createdAt: row.occurred_at,
      time: activityRelativeTimeV3(row.occurred_at, now),
    };
  }

  if (row.activity_type === 'collection_quantity_decreased') {
    const removed = metadataCountV3(metadata, 'removed_quantity') ?? 1;
    const remaining = metadataCountV3(metadata, 'quantity_after');
    return {
      id: String(row.id),
      ownerId: expectedOwnerId,
      icon: 'cards',
      title: `Reduced ${assetName}`,
      detail: [
        itemDetails,
        `−${quantityLabelV3(removed)}`,
        remaining === null ? null : `${quantityLabelV3(remaining)} remaining`,
      ].filter(Boolean).join(' · '),
      createdAt: row.occurred_at,
      time: activityRelativeTimeV3(row.occurred_at, now),
    };
  }

  const removed = metadataCountV3(metadata, 'removed_quantity');
  return {
    id: String(row.id),
    ownerId: expectedOwnerId,
    icon: 'trash',
    title: `Removed ${assetName}`,
    detail: [
      itemDetails,
      removed === null ? null : quantityLabelV3(removed),
      'Private audit history retained',
    ].filter(Boolean).join(' · '),
    createdAt: row.occurred_at,
    time: activityRelativeTimeV3(row.occurred_at, now),
  };
}

function generalActivityViewV3(
  row: ActivityRowV3,
  expectedOwnerId: string,
  now: number,
): ProductionActivityViewV3 {
  const titles: Record<string, string> = {
    community_joined: 'Joined store community',
    community_rejoined: 'Rejoined store community',
    community_left: 'Left store community',
    store_application_submitted: 'Store application submitted',
    store_application_withdrawn: 'Store application withdrawn',
    store_application_approved: 'Store application approved',
    store_application_rejected: 'Store application not approved',
    store_qr_invite_generated: 'Store QR code generated',
    store_qr_invite_rotated: 'Store QR code rotated',
    store_qr_invite_revoked: 'Store QR code revoked',
    store_join_code_generated: 'Store join code generated',
    store_join_code_deactivated: 'Store join code deactivated',
    store_administrator_revoked: 'Store administrator access revoked',
  };
  const activityType = row.activity_type.trim();
  const title = (titles[activityType] ?? humanizeActivityValueV3(activityType)) || 'Account activity';
  const icon = activityType.startsWith('community_')
    ? 'users'
    : activityType.startsWith('store_application')
      ? 'store'
      : activityType.includes('revoked') || activityType.includes('deactivated')
        ? 'shield'
        : 'cards';

  return {
    id: String(row.id),
    ownerId: expectedOwnerId,
    icon,
    title,
    detail: humanizeActivityValueV3(row.entity_type) || 'Private account activity',
    createdAt: row.occurred_at,
    time: activityRelativeTimeV3(row.occurred_at, now),
  };
}

/** Converts only activity rows owned by the verified active account. */
export function mapActivityRowsForOwnerV3(
  rows: readonly ActivityRowV3[],
  expectedOwnerId: string,
  now = Date.now(),
): ProductionActivityViewV3[] {
  if (!expectedOwnerId) throw new Error('A signed-in activity owner is required.');
  assertRowsOwnedByV3(rows, expectedOwnerId, 'Load recent activity', 'user_id');

  return rows.map((row) => (
    row.activity_type === 'collection_item_added'
      || row.activity_type === 'collection_quantity_decreased'
      || row.activity_type === 'collection_item_removed'
      ? collectionActivityViewV3(row, expectedOwnerId, now)
      : generalActivityViewV3(row, expectedOwnerId, now)
  ));
}

/** Prevents a prior account's activity from rendering during an identity switch. */
export function activitiesForOwnerV3(
  snapshot: ProductionActivitySnapshotV3 | null,
  activeOwnerId: string | null | undefined,
): readonly ProductionActivityViewV3[] {
  return snapshot && activeOwnerId && snapshot.ownerId === activeOwnerId
    ? snapshot.activities
    : [];
}

/** Owner-private recent activity access through the browser Supabase client. */
export class SupabaseActivityRepositoryV3 {
  constructor(private readonly client: SupabaseClient) {}

  async load(
    expectedOwnerId: string,
    now = Date.now(),
    limit = 20,
  ): Promise<ProductionActivitySnapshotV3> {
    await requireAuthenticatedOwnerV3(this.client, expectedOwnerId, 'Load recent activity');
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const response = await this.client
      .from('activity_logs')
      .select('id,user_id,activity_type,entity_type,entity_id,metadata,occurred_at')
      .eq('user_id', expectedOwnerId)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, boundedLimit - 1) as unknown as ActivityPageV3;
    if (response.error) throw new Error(`Load recent activity: ${response.error.message}`);

    return {
      ownerId: expectedOwnerId,
      activities: mapActivityRowsForOwnerV3(response.data ?? [], expectedOwnerId, now),
    };
  }
}

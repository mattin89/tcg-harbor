import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

interface DataApiErrorV5 {
  readonly message: string;
}

interface NotificationPageV5 {
  readonly data: NotificationRowV5[] | null;
  readonly error: DataApiErrorV5 | null;
}

interface NotificationMutationResultV5 {
  readonly data: Array<Pick<NotificationRowV5, 'id' | 'user_id' | 'read_at'>> | null;
  readonly error: DataApiErrorV5 | null;
}

export type ProductionNotificationKindV5 =
  | 'direct_message'
  | 'community_reply'
  | 'matching_trade'
  | 'wanted_card_owned'
  | 'trade_status_changed'
  | 'community_joined'
  | 'system';

export type ProductionNotificationVisualTypeV5 = 'message' | 'trade' | 'community' | 'status';

export interface ProductionNotificationViewV5 {
  readonly id: string;
  readonly ownerId: string;
  readonly kind: ProductionNotificationKindV5;
  readonly type: ProductionNotificationVisualTypeV5;
  readonly title: string;
  readonly detail: string;
  readonly actionUrl: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly time: string;
  readonly unread: boolean;
}

export interface ProductionNotificationSnapshotV5 {
  readonly ownerId: string;
  readonly notifications: readonly ProductionNotificationViewV5[];
}

export interface NotificationRowV5 {
  readonly id: string;
  readonly user_id: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string | null;
  readonly action_url: string | null;
  readonly created_at: string;
  readonly read_at: string | null;
  readonly dismissed_at: string | null;
}

const DATA_API_PAGE_SIZE = 1_000;
let realtimeChannelSequence = 0;

function notificationKindV5(value: string): ProductionNotificationKindV5 {
  switch (value) {
    case 'direct_message':
    case 'community_reply':
    case 'matching_trade':
    case 'wanted_card_owned':
    case 'trade_status_changed':
    case 'community_joined':
    case 'system':
      return value;
    default:
      return 'system';
  }
}

function notificationVisualTypeV5(kind: ProductionNotificationKindV5): ProductionNotificationVisualTypeV5 {
  if (kind === 'direct_message') return 'message';
  if (kind === 'community_reply' || kind === 'community_joined') return 'community';
  if (kind === 'matching_trade' || kind === 'wanted_card_owned' || kind === 'trade_status_changed') return 'trade';
  return 'status';
}

export function safeNotificationActionUrlV5(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized.startsWith('/') || normalized.startsWith('//')) return null;
  if (normalized.includes('\\') || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

export function notificationRelativeTimeV5(createdAt: string, now = Date.now()): string {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return '';
  const elapsedSeconds = Math.max(0, Math.floor((now - created) / 1_000));
  if (elapsedSeconds < 60) return 'Just now';
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes} min`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} h`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} d`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(created));
}

/** Maps only rows belonging to the verified active owner. */
export function mapNotificationRowsForOwnerV5(
  rows: readonly NotificationRowV5[],
  expectedOwnerId: string,
  now = Date.now(),
): ProductionNotificationViewV5[] {
  if (!expectedOwnerId) throw new Error('A signed-in notification owner is required.');
  if (rows.some((row) => row.user_id !== expectedOwnerId)) {
    throw new Error('The notification service returned data owned by another account.');
  }

  return rows
    .filter((row) => row.dismissed_at === null)
    .map((row) => {
      const kind = notificationKindV5(row.kind);
      return {
        id: row.id,
        ownerId: expectedOwnerId,
        kind,
        type: notificationVisualTypeV5(kind),
        title: row.title,
        detail: row.body ?? '',
        actionUrl: safeNotificationActionUrlV5(row.action_url),
        createdAt: row.created_at,
        readAt: row.read_at,
        time: notificationRelativeTimeV5(row.created_at, now),
        unread: row.read_at === null,
      };
    });
}

/** Prevents an old account snapshot from rendering after an auth identity switch. */
export function notificationsForOwnerV5(
  snapshot: ProductionNotificationSnapshotV5 | null,
  activeOwnerId: string | null | undefined,
): readonly ProductionNotificationViewV5[] {
  return snapshot && activeOwnerId && snapshot.ownerId === activeOwnerId
    ? snapshot.notifications
    : [];
}

/** Owner-private notification access through the browser Supabase client. */
export class SupabaseNotificationRepositoryV5 {
  constructor(private readonly client: SupabaseClient) {}

  async load(expectedOwnerId: string, now = Date.now()): Promise<ProductionNotificationSnapshotV5> {
    await this.assertAuthenticatedOwner(expectedOwnerId);
    const rows: NotificationRowV5[] = [];

    for (let from = 0; ; from += DATA_API_PAGE_SIZE) {
      const response = await this.client
        .from('notifications')
        .select('id,user_id,kind,title,body,action_url,created_at,read_at,dismissed_at')
        .eq('user_id', expectedOwnerId)
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .range(from, from + DATA_API_PAGE_SIZE - 1) as unknown as NotificationPageV5;
      if (response.error) throw new Error(`Load notifications: ${response.error.message}`);
      const page = response.data ?? [];
      rows.push(...page);
      if (page.length < DATA_API_PAGE_SIZE) break;
    }

    return {
      ownerId: expectedOwnerId,
      notifications: mapNotificationRowsForOwnerV5(rows, expectedOwnerId, now),
    };
  }

  async markAllRead(expectedOwnerId: string, readAt = new Date().toISOString()): Promise<number> {
    await this.assertAuthenticatedOwner(expectedOwnerId);
    const response = await this.client
      .from('notifications')
      .update({ read_at: readAt })
      .eq('user_id', expectedOwnerId)
      .is('read_at', null)
      .is('dismissed_at', null)
      .select('id,user_id,read_at') as unknown as NotificationMutationResultV5;
    if (response.error) throw new Error(`Mark notifications read: ${response.error.message}`);
    const rows = response.data ?? [];
    if (rows.some((row) => row.user_id !== expectedOwnerId)) {
      throw new Error('Mark notifications read: another account row was returned.');
    }
    return rows.length;
  }

  async subscribe(
    expectedOwnerId: string,
    onChange: () => void,
    onFailure: (reason: Error) => void = () => undefined,
  ): Promise<() => void> {
    await this.assertAuthenticatedOwner(expectedOwnerId);
    const filter = `user_id=eq.${expectedOwnerId}`;
    const channel = this.client
      .channel(`notifications-v5:${expectedOwnerId}:${++realtimeChannelSequence}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter,
      }, onChange)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter,
      }, onChange)
      .subscribe((status, reason) => {
        // Reload once the stream is live to close the load/subscribe race.
        if (status === 'SUBSCRIBED') onChange();
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          onFailure(new Error(
            reason?.message
              ? `Live notifications disconnected: ${reason.message}`
              : `Live notifications disconnected (${status.toLowerCase().replace('_', ' ')}).`,
          ));
        }
      });

    return () => {
      void this.removeChannel(channel);
    };
  }

  private async assertAuthenticatedOwner(expectedOwnerId: string): Promise<void> {
    if (!expectedOwnerId) throw new Error('A signed-in notification owner is required.');
    const { data, error } = await this.client.auth.getUser();
    if (error) throw new Error(`Verify notification owner: ${error.message}`);
    if (!data.user || data.user.id !== expectedOwnerId) {
      throw new Error('The active Supabase identity does not match the requested notification owner.');
    }
  }

  private async removeChannel(channel: RealtimeChannel): Promise<void> {
    await this.client.removeChannel(channel);
  }
}

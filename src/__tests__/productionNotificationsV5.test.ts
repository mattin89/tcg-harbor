import { describe, expect, it, vi } from 'vitest';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import {
  mapNotificationRowsForOwnerV5,
  notificationsForOwnerV5,
  safeNotificationActionUrlV5,
  SupabaseNotificationRepositoryV5,
  type NotificationRowV5,
} from '../services/supabase/notificationRepositoryV5';

interface QueryCallV5 {
  readonly operation: string;
  readonly args: readonly unknown[];
}

class MockNotificationQueryV5 implements PromiseLike<{
  data: NotificationRowV5[];
  error: null;
}> {
  private mutation = false;

  constructor(
    private readonly rows: readonly NotificationRowV5[],
    private readonly calls: QueryCallV5[],
  ) {}

  select(columns: string): this {
    this.calls.push({ operation: 'select', args: [columns] });
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.mutation = true;
    this.calls.push({ operation: 'update', args: [patch] });
    return this;
  }

  eq(column: string, value: unknown): this {
    this.calls.push({ operation: 'eq', args: [column, value] });
    return this;
  }

  is(column: string, value: unknown): this {
    this.calls.push({ operation: 'is', args: [column, value] });
    return this;
  }

  order(column: string, options: unknown): this {
    this.calls.push({ operation: 'order', args: [column, options] });
    return this;
  }

  range(from: number, to: number): Promise<{ data: NotificationRowV5[]; error: null }> {
    this.calls.push({ operation: 'range', args: [from, to] });
    return Promise.resolve({ data: [...this.rows].slice(from, to + 1), error: null });
  }

  then<TResult1 = { data: NotificationRowV5[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: NotificationRowV5[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const data = this.mutation ? [...this.rows] : [];
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class MockRealtimeChannelV5 {
  readonly filters: unknown[] = [];
  private statusCallback?: (status: string, reason?: Error) => void;

  on(_eventType: string, filter: unknown, _callback: () => void): this {
    this.filters.push(filter);
    return this;
  }

  subscribe(callback?: (status: string, reason?: Error) => void): this {
    this.statusCallback = callback;
    callback?.('SUBSCRIBED');
    return this;
  }

  emitStatus(status: string, reason?: Error): void {
    this.statusCallback?.(status, reason);
  }
}

function row(overrides: Partial<NotificationRowV5> = {}): NotificationRowV5 {
  return {
    id: 'notification-1',
    user_id: 'owner-a',
    kind: 'direct_message',
    title: 'New private message',
    body: 'See you at locals.',
    action_url: '/messages/conversation-1',
    created_at: '2026-07-22T09:58:00.000Z',
    read_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function mockClientV5(
  authenticatedUserId: string | null,
  rows: readonly NotificationRowV5[],
  calls: QueryCallV5[],
  realtimeChannel = new MockRealtimeChannelV5(),
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
      calls.push({ operation: 'from', args: [table] });
      return new MockNotificationQueryV5(rows, calls);
    },
    channel(name: string) {
      calls.push({ operation: 'channel', args: [name] });
      return realtimeChannel;
    },
    removeChannel(channel: RealtimeChannel) {
      calls.push({ operation: 'removeChannel', args: [channel] });
      return Promise.resolve('ok');
    },
  } as unknown as SupabaseClient;
}

describe('production notifications v5', () => {
  it('maps database kinds and source fields to the existing bell view without unsafe routes', () => {
    const now = Date.parse('2026-07-22T10:00:00.000Z');
    const mapped = mapNotificationRowsForOwnerV5([
      row(),
      row({ id: 'notification-2', kind: 'matching_trade', title: 'Trade match', body: null, action_url: 'https://malicious.example', created_at: '2026-07-22T09:00:00.000Z' }),
      row({ id: 'notification-3', kind: 'community_joined', title: 'Community joined', action_url: '/communities/community-1', read_at: '2026-07-22T09:59:00.000Z' }),
      row({ id: 'notification-4', kind: 'unexpected_future_kind', title: 'Account update', action_url: '//malicious.example' }),
    ], 'owner-a', now);

    expect(mapped).toEqual([
      expect.objectContaining({ id: 'notification-1', ownerId: 'owner-a', kind: 'direct_message', type: 'message', title: 'New private message', detail: 'See you at locals.', actionUrl: '/messages/conversation-1', time: '2 min', unread: true }),
      expect.objectContaining({ id: 'notification-2', kind: 'matching_trade', type: 'trade', detail: '', actionUrl: null, time: '1 h', unread: true }),
      expect.objectContaining({ id: 'notification-3', kind: 'community_joined', type: 'community', actionUrl: '/communities/community-1', unread: false }),
      expect.objectContaining({ id: 'notification-4', kind: 'system', type: 'status', actionUrl: null }),
    ]);
    expect(safeNotificationActionUrlV5('/settings?tab=security')).toBe('/settings?tab=security');
    expect(safeNotificationActionUrlV5('/\\malicious.example')).toBeNull();
  });

  it('loads a genuinely empty owner-scoped list for a fresh production account', async () => {
    const calls: QueryCallV5[] = [];
    const repository = new SupabaseNotificationRepositoryV5(mockClientV5('fresh-owner', [], calls));

    await expect(repository.load('fresh-owner')).resolves.toEqual({
      ownerId: 'fresh-owner',
      notifications: [],
    });
    expect(calls).toContainEqual({ operation: 'eq', args: ['user_id', 'fresh-owner'] });
    expect(calls).toContainEqual({ operation: 'is', args: ['dismissed_at', null] });
  });

  it('rejects mismatched identities and any foreign row returned despite the owner filter', async () => {
    const mismatchedCalls: QueryCallV5[] = [];
    await expect(new SupabaseNotificationRepositoryV5(
      mockClientV5('owner-b', [], mismatchedCalls),
    ).load('owner-a')).rejects.toThrow(/active Supabase identity does not match/i);
    expect(mismatchedCalls).toEqual([]);

    const escapedCalls: QueryCallV5[] = [];
    await expect(new SupabaseNotificationRepositoryV5(
      mockClientV5('owner-a', [row({ user_id: 'owner-b' })], escapedCalls),
    ).load('owner-a')).rejects.toThrow(/owned by another account/i);
  });

  it('marks only the active owner unread rows and verifies the returned ownership', async () => {
    const calls: QueryCallV5[] = [];
    const readAt = '2026-07-22T10:05:00.000Z';
    const repository = new SupabaseNotificationRepositoryV5(
      mockClientV5('owner-a', [row({ read_at: readAt })], calls),
    );

    await expect(repository.markAllRead('owner-a', readAt)).resolves.toBe(1);
    expect(calls).toContainEqual({ operation: 'update', args: [{ read_at: readAt }] });
    expect(calls).toContainEqual({ operation: 'eq', args: ['user_id', 'owner-a'] });
    expect(calls).toContainEqual({ operation: 'is', args: ['read_at', null] });
    expect(calls).toContainEqual({ operation: 'is', args: ['dismissed_at', null] });
    expect(calls).toContainEqual({ operation: 'select', args: ['id,user_id,read_at'] });
  });

  it('subscribes INSERT and UPDATE events with the active owner filter and cleans up', async () => {
    const calls: QueryCallV5[] = [];
    const channel = new MockRealtimeChannelV5();
    const onChange = vi.fn();
    const repository = new SupabaseNotificationRepositoryV5(
      mockClientV5('owner-a', [], calls, channel),
    );

    const unsubscribe = await repository.subscribe('owner-a', onChange);
    expect(channel.filters).toEqual([
      expect.objectContaining({ event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.owner-a' }),
      expect.objectContaining({ event: 'UPDATE', schema: 'public', table: 'notifications', filter: 'user_id=eq.owner-a' }),
    ]);
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    await Promise.resolve();
    expect(calls.some((call) => call.operation === 'removeChannel')).toBe(true);
  });

  it('reports realtime channel failures so the hook can reconnect instead of going stale silently', async () => {
    const calls: QueryCallV5[] = [];
    const channel = new MockRealtimeChannelV5();
    const onFailure = vi.fn();
    const repository = new SupabaseNotificationRepositoryV5(
      mockClientV5('owner-a', [], calls, channel),
    );

    await repository.subscribe('owner-a', vi.fn(), onFailure);
    channel.emitStatus('CHANNEL_ERROR', new Error('socket lost'));

    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Live notifications disconnected: socket lost',
    }));
  });

  it('never exposes a stale snapshot after an account switch', () => {
    const notifications = mapNotificationRowsForOwnerV5([row()], 'owner-a');
    const snapshot = { ownerId: 'owner-a', notifications };
    expect(notificationsForOwnerV5(snapshot, 'owner-a')).toHaveLength(1);
    expect(notificationsForOwnerV5(snapshot, 'owner-b')).toEqual([]);
    expect(notificationsForOwnerV5(snapshot, null)).toEqual([]);
  });
});

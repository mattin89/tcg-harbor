import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LatestRequestGateV2 } from '../../domain/latestRequestGateV2';
import { getSupabaseClient } from './client';
import {
  notificationsForOwnerV5,
  SupabaseNotificationRepositoryV5,
  type ProductionNotificationSnapshotV5,
  type ProductionNotificationViewV5,
} from './notificationRepositoryV5';

export interface ProductionNotificationsRuntimeV5 {
  readonly notifications: readonly ProductionNotificationViewV5[];
  readonly unreadCount: number;
  readonly loading: boolean;
  readonly mutating: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly markAllRead: () => Promise<boolean>;
  readonly clearError: () => void;
}

function notificationErrorMessageV5(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Notifications could not be loaded.';
}

/**
 * Production-only, owner-scoped notification state. Disabled/demo mode stays
 * empty so App can keep using its explicit local demo fixtures.
 */
export function useProductionNotificationsV5(
  enabled: boolean,
  ownerId?: string,
): ProductionNotificationsRuntimeV5 {
  const client = useMemo(() => getSupabaseClient(), []);
  const repository = useMemo(
    () => client ? new SupabaseNotificationRepositoryV5(client) : null,
    [client],
  );
  const [snapshot, setSnapshot] = useState<ProductionNotificationSnapshotV5 | null>(null);
  const [settledOwnerId, setSettledOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled && ownerId));
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeOwnerRef = useRef<string | null>(enabled ? ownerId ?? null : null);
  const requestGateRef = useRef(new LatestRequestGateV2());
  const mutationTokenRef = useRef<object | null>(null);

  activeOwnerRef.current = enabled ? ownerId ?? null : null;

  const loadNotifications = useCallback(async (throwOnError: boolean) => {
    const expectedOwnerId = enabled ? ownerId ?? null : null;
    const isCurrentRequest = requestGateRef.current.begin();
    const isCurrentOwnerRequest = () => isCurrentRequest()
      && activeOwnerRef.current === expectedOwnerId;

    if (!expectedOwnerId) {
      if (isCurrentOwnerRequest()) {
        setSnapshot(null);
        setSettledOwnerId(null);
        setLoading(false);
        setError(null);
      }
      return;
    }
    if (!repository) {
      const message = 'The production notification service is not configured.';
      if (isCurrentOwnerRequest()) {
        setSnapshot(null);
        setSettledOwnerId(expectedOwnerId);
        setLoading(false);
        setError(message);
      }
      if (throwOnError) throw new Error(message);
      return;
    }

    if (isCurrentOwnerRequest()) {
      setLoading(true);
      setError(null);
    }
    try {
      const nextSnapshot = await repository.load(expectedOwnerId);
      if (isCurrentOwnerRequest()) {
        setSnapshot(nextSnapshot);
        setSettledOwnerId(expectedOwnerId);
      }
    } catch (reason) {
      const message = notificationErrorMessageV5(reason);
      if (isCurrentOwnerRequest()) {
        setSettledOwnerId(expectedOwnerId);
        setError(message);
      }
      if (throwOnError) throw new Error(message);
    } finally {
      if (isCurrentOwnerRequest()) setLoading(false);
    }
  }, [enabled, ownerId, repository]);

  const refresh = useCallback(async () => {
    await loadNotifications(false);
  }, [loadNotifications]);

  useEffect(() => {
    requestGateRef.current.invalidate();
    mutationTokenRef.current = null;
    setSnapshot(null);
    setSettledOwnerId(null);
    setLoading(Boolean(enabled && ownerId));
    setMutating(false);
    setError(null);

    const expectedOwnerId = enabled ? ownerId ?? null : null;
    if (!repository || !expectedOwnerId) {
      void refresh();
      return () => requestGateRef.current.invalidate();
    }

    let active = true;
    let unsubscribe: (() => void) | null = null;
    let refreshTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let subscriptionAttempt = 0;
    const queueRefresh = () => {
      if (!active || activeOwnerRef.current !== expectedOwnerId) return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (active && activeOwnerRef.current === expectedOwnerId) void loadNotifications(false);
      }, 60);
    };

    const subscribeToChanges = () => {
      if (!active || activeOwnerRef.current !== expectedOwnerId) return;
      const attempt = ++subscriptionAttempt;
      const fail = (reason: unknown) => {
        if (!active || attempt !== subscriptionAttempt || activeOwnerRef.current !== expectedOwnerId) return;
        // Invalidate this attempt before removing its channel so an intentional
        // CLOSED status during cleanup cannot schedule a second reconnect.
        subscriptionAttempt += 1;
        const cleanup = unsubscribe;
        unsubscribe = null;
        cleanup?.();
        setError(`Live notification updates are reconnecting. ${notificationErrorMessageV5(reason)}`);
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          subscribeToChanges();
        }, 5_000);
      };

      void repository.subscribe(expectedOwnerId, () => {
        if (!active || attempt !== subscriptionAttempt || activeOwnerRef.current !== expectedOwnerId) return;
        setError(null);
        queueRefresh();
      }, fail).then((cleanup) => {
        if (!active || attempt !== subscriptionAttempt || activeOwnerRef.current !== expectedOwnerId) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
      }).catch(fail);
    };

    void refresh();
    subscribeToChanges();

    return () => {
      active = false;
      subscriptionAttempt += 1;
      requestGateRef.current.invalidate();
      mutationTokenRef.current = null;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      unsubscribe?.();
    };
  }, [enabled, loadNotifications, ownerId, refresh, repository]);

  const markAllRead = useCallback(async (): Promise<boolean> => {
    const mutationOwnerId = activeOwnerRef.current;
    if (!mutationOwnerId) {
      const message = 'A signed-in notification owner is required.';
      setError(message);
      throw new Error(message);
    }
    if (!repository) {
      const message = 'The production notification service is not configured.';
      setError(message);
      throw new Error(message);
    }
    if (mutationTokenRef.current) {
      const message = 'Another notification change is still being saved.';
      setError(message);
      throw new Error(message);
    }

    const token = {};
    mutationTokenRef.current = token;
    setMutating(true);
    setError(null);
    let saved = false;
    try {
      await repository.markAllRead(mutationOwnerId);
      saved = true;
      if (activeOwnerRef.current !== mutationOwnerId) return false;
      await loadNotifications(true);
      return activeOwnerRef.current === mutationOwnerId;
    } catch (reason) {
      if (activeOwnerRef.current !== mutationOwnerId) return false;
      const detail = notificationErrorMessageV5(reason);
      const message = saved
        ? `Notifications were marked read, but the list could not be reloaded. Refresh before continuing. ${detail}`
        : detail;
      setError(message);
      throw new Error(message);
    } finally {
      if (mutationTokenRef.current === token) {
        mutationTokenRef.current = null;
        setMutating(false);
      }
    }
  }, [loadNotifications, repository]);

  const activeOwnerId = enabled ? ownerId ?? null : null;
  const notifications = notificationsForOwnerV5(snapshot, activeOwnerId);
  const isWaitingForActiveOwner = Boolean(activeOwnerId && settledOwnerId !== activeOwnerId);

  return {
    notifications,
    unreadCount: notifications.filter((notification) => notification.unread).length,
    loading: loading || isWaitingForActiveOwner,
    mutating,
    error: settledOwnerId === activeOwnerId ? error : null,
    refresh,
    markAllRead,
    clearError: () => setError(null),
  };
}

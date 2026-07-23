import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LatestRequestGateV2 } from '../../domain/latestRequestGateV2';
import {
  activitiesForOwnerV3,
  SupabaseActivityRepositoryV3,
  type ProductionActivitySnapshotV3,
  type ProductionActivityViewV3,
} from './activityRepositoryV3';
import { getSupabaseClient } from './client';

export interface ProductionActivityRuntimeV3 {
  readonly activities: readonly ProductionActivityViewV3[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly clearError: () => void;
}

function activityErrorMessageV3(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Recent activity could not be loaded.';
}

/**
 * Production-only owner-scoped activity feed. Collection mutations explicitly
 * call refresh after their database transaction commits.
 */
export function useProductionActivityV3(
  enabled: boolean,
  ownerId?: string,
): ProductionActivityRuntimeV3 {
  const client = useMemo(() => getSupabaseClient(), []);
  const repository = useMemo(
    () => client ? new SupabaseActivityRepositoryV3(client) : null,
    [client],
  );
  const [snapshot, setSnapshot] = useState<ProductionActivitySnapshotV3 | null>(null);
  const [settledOwnerId, setSettledOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled && ownerId));
  const [error, setError] = useState<string | null>(null);
  const activeOwnerRef = useRef<string | null>(enabled ? ownerId ?? null : null);
  const requestGateRef = useRef(new LatestRequestGateV2());

  activeOwnerRef.current = enabled ? ownerId ?? null : null;

  const loadActivity = useCallback(async (throwOnError: boolean) => {
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
      const message = 'The production activity service is not configured.';
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
      const message = activityErrorMessageV3(reason);
      if (isCurrentOwnerRequest()) {
        setSnapshot(null);
        setSettledOwnerId(expectedOwnerId);
        setError(message);
      }
      if (throwOnError) throw new Error(message);
    } finally {
      if (isCurrentOwnerRequest()) setLoading(false);
    }
  }, [enabled, ownerId, repository]);

  const refresh = useCallback(async () => {
    await loadActivity(false);
  }, [loadActivity]);

  useEffect(() => {
    requestGateRef.current.invalidate();
    setSnapshot(null);
    setSettledOwnerId(null);
    setLoading(Boolean(enabled && ownerId));
    setError(null);
    void refresh();
    return () => requestGateRef.current.invalidate();
  }, [enabled, ownerId, refresh]);

  const activeOwnerId = enabled ? ownerId ?? null : null;
  const activities = activitiesForOwnerV3(snapshot, activeOwnerId);
  const isWaitingForActiveOwner = Boolean(activeOwnerId && settledOwnerId !== activeOwnerId);

  return {
    activities,
    loading: loading || isWaitingForActiveOwner,
    error: settledOwnerId === activeOwnerId ? error : null,
    refresh,
    clearError: () => setError(null),
  };
}

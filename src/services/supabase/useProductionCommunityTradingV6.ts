import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DemoAsset } from '../../data/demo';
import type {
  CommunityTradeDraftV6,
  CommunityTradePostV6,
  CommunityTradeStatusV6,
} from '../../domain/communityTradingV6';
import { getSupabaseClient } from './client';
import {
  SupabaseCommunityTradingRepositoryV6,
  type CommunityMembershipV6,
} from './communityTradingRepositoryV6';

export interface ProductionCommunityTradingRuntimeV6 {
  readonly memberships: readonly CommunityMembershipV6[];
  readonly posts: readonly CommunityTradePostV6[];
  readonly loading: boolean;
  readonly mutating: boolean;
  readonly error: string | null;
  readonly isMember: (communityId: string | null | undefined) => boolean;
  readonly refresh: () => Promise<void>;
  readonly joinOpen: (communityId: string) => Promise<'joined' | 'rejoined' | 'already_member'>;
  readonly create: (
    draft: CommunityTradeDraftV6,
    collectionAssets: readonly DemoAsset[],
    catalogAssets: readonly DemoAsset[],
  ) => Promise<void>;
  readonly setStatus: (tradePostId: string, status: CommunityTradeStatusV6) => Promise<void>;
  readonly clearError: () => void;
}

export function useProductionCommunityTradingV6(
  enabled: boolean,
  ownerId?: string,
): ProductionCommunityTradingRuntimeV6 {
  const client = useMemo(() => getSupabaseClient(), []);
  const repository = useMemo(
    () => client ? new SupabaseCommunityTradingRepositoryV6(client) : null,
    [client],
  );
  const [memberships, setMemberships] = useState<CommunityMembershipV6[]>([]);
  const [posts, setPosts] = useState<CommunityTradePostV6[]>([]);
  const [loading, setLoading] = useState(Boolean(enabled && ownerId));
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOwnerId, setLoadedOwnerId] = useState<string | null>(null);
  const activeOwnerRef = useRef<string | null>(enabled ? ownerId ?? null : null);
  const requestVersionRef = useRef(0);
  const mutationInFlightRef = useRef(false);
  activeOwnerRef.current = enabled ? ownerId ?? null : null;

  const load = useCallback(async (throwOnError: boolean) => {
    const expectedOwnerId = enabled ? ownerId ?? null : null;
    const version = ++requestVersionRef.current;
    const current = () => (
      requestVersionRef.current === version
      && activeOwnerRef.current === expectedOwnerId
    );
    if (!expectedOwnerId) {
      if (current()) {
        setMemberships([]);
        setPosts([]);
        setLoadedOwnerId(null);
        setLoading(false);
      }
      return;
    }
    if (!repository) {
      const message = 'The production community service is not configured.';
      if (current()) {
        setMemberships([]);
        setPosts([]);
        setLoadedOwnerId(null);
        setError(message);
        setLoading(false);
      }
      if (throwOnError) throw new Error(message);
      return;
    }
    if (current()) {
      setLoading(true);
      setError(null);
    }
    try {
      const snapshot = await repository.load(expectedOwnerId);
      if (current()) {
        if (snapshot.ownerId !== expectedOwnerId) {
          throw new Error('The community response belongs to a different account. No data was displayed.');
        }
        setMemberships(snapshot.memberships);
        setPosts(snapshot.posts);
        setLoadedOwnerId(expectedOwnerId);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Communities could not be loaded.';
      if (current()) {
        setMemberships([]);
        setPosts([]);
        setLoadedOwnerId(null);
        setError(message);
      }
      if (throwOnError) throw new Error(message);
    } finally {
      if (current()) setLoading(false);
    }
  }, [enabled, ownerId, repository]);

  const refresh = useCallback(async () => {
    await load(false);
  }, [load]);

  useEffect(() => {
    requestVersionRef.current += 1;
    setMemberships([]);
    setPosts([]);
    setLoadedOwnerId(null);
    setError(null);
    setLoading(Boolean(enabled && ownerId));
    void refresh();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [refresh]);

  const mutate = useCallback(async <T,>(
    operation: (expectedOwnerId: string) => Promise<T>,
  ): Promise<T> => {
    const mutationOwnerId = activeOwnerRef.current;
    if (!mutationOwnerId) throw new Error('A signed-in account is required.');
    if (mutationInFlightRef.current) throw new Error('Another community change is still being saved.');
    mutationInFlightRef.current = true;
    setMutating(true);
    setError(null);
    try {
      const result = await operation(mutationOwnerId);
      if (activeOwnerRef.current === mutationOwnerId) await load(true);
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The community change could not be saved.';
      if (activeOwnerRef.current === mutationOwnerId) setError(message);
      throw new Error(message);
    } finally {
      mutationInFlightRef.current = false;
      setMutating(false);
    }
  }, [load]);

  const joinOpen = useCallback(async (communityId: string) => {
    if (!repository) throw new Error('The production community service is not configured.');
    return mutate((expectedOwnerId) => repository.joinOpen(communityId, expectedOwnerId));
  }, [mutate, repository]);

  const create = useCallback(async (
    draft: CommunityTradeDraftV6,
    collectionAssets: readonly DemoAsset[],
    allCatalogAssets: readonly DemoAsset[],
  ) => {
    if (!repository) throw new Error('The production community service is not configured.');
    await mutate((expectedOwnerId) => repository.create(
      draft,
      collectionAssets,
      allCatalogAssets,
      expectedOwnerId,
    ));
  }, [mutate, repository]);

  const setStatus = useCallback(async (
    tradePostId: string,
    status: CommunityTradeStatusV6,
  ) => {
    if (!repository) throw new Error('The production community service is not configured.');
    await mutate((expectedOwnerId) => repository.setStatus(tradePostId, status, expectedOwnerId));
  }, [mutate, repository]);

  const ownerReady = Boolean(enabled && ownerId && loadedOwnerId === ownerId);
  const visibleMemberships = ownerReady ? memberships : [];
  const membershipIds = new Set(visibleMemberships.map((membership) => membership.communityId));

  return {
    memberships: visibleMemberships,
    posts: ownerReady ? posts : [],
    loading: loading || Boolean(enabled && ownerId && loadedOwnerId !== ownerId),
    mutating,
    error,
    isMember: (communityId) => Boolean(communityId && membershipIds.has(communityId)),
    refresh,
    joinOpen,
    create,
    setStatus,
    clearError: () => setError(null),
  };
}

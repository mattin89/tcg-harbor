import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { catalogAssets, type DemoAsset } from '../../data/demo';
import { getSupabaseClient } from './client';
import {
  SupabaseCollectionRepositoryV2,
  type AddCollectionItemV2,
  type PortfolioDailySnapshotV2,
} from './collectionRepositoryV2';

export interface ProductionCollectionRuntimeV2 {
  readonly assets: DemoAsset[];
  readonly dailySnapshots: PortfolioDailySnapshotV2[];
  readonly loading: boolean;
  readonly mutating: boolean;
  readonly error: string | null;
  readonly unmappedHoldingCount: number;
  readonly refresh: () => Promise<void>;
  readonly add: (input: AddCollectionItemV2) => Promise<boolean>;
  readonly setQuantity: (asset: DemoAsset, quantity: number) => Promise<boolean>;
  readonly updateNote: (asset: DemoAsset, note?: string) => Promise<boolean>;
  readonly remove: (asset: DemoAsset) => Promise<boolean>;
  readonly clearError: () => void;
}

export function useProductionCollectionV2(
  enabled: boolean,
  ownerId?: string,
): ProductionCollectionRuntimeV2 {
  const client = useMemo(() => getSupabaseClient(), []);
  const repository = useMemo(
    () => client ? new SupabaseCollectionRepositoryV2(client) : null,
    [client],
  );
  const [assets, setAssets] = useState<DemoAsset[]>([]);
  const [dailySnapshots, setDailySnapshots] = useState<PortfolioDailySnapshotV2[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unmappedHoldingCount, setUnmappedHoldingCount] = useState(0);
  const [loadedOwnerId, setLoadedOwnerId] = useState<string | null>(null);
  const [settledOwnerId, setSettledOwnerId] = useState<string | null>(null);
  const activeOwnerRef = useRef<string | null>(enabled ? ownerId ?? null : null);
  const requestVersionRef = useRef(0);
  const mutationInFlightRef = useRef(false);

  // Keep the current owner available to in-flight requests before effects run.
  // Returned data is also owner-gated below, so a render can never expose the
  // previous account's collection while the next account is loading.
  activeOwnerRef.current = enabled ? ownerId ?? null : null;

  const loadCollection = useCallback(async (throwOnError: boolean) => {
    const expectedOwnerId = enabled ? ownerId ?? null : null;
    const requestVersion = ++requestVersionRef.current;
    const isCurrentRequest = () => requestVersionRef.current === requestVersion
      && activeOwnerRef.current === expectedOwnerId;

    if (!expectedOwnerId) {
      if (isCurrentRequest()) {
        setAssets([]);
        setDailySnapshots([]);
        setUnmappedHoldingCount(0);
        setLoadedOwnerId(null);
        setSettledOwnerId(null);
        setLoading(false);
      }
      return;
    }
    if (!repository) {
      const message = 'The production collection service is not configured.';
      if (isCurrentRequest()) {
        setAssets([]);
        setDailySnapshots([]);
        setUnmappedHoldingCount(0);
        setLoadedOwnerId(null);
        setSettledOwnerId(expectedOwnerId);
        setError(message);
        setLoading(false);
      }
      if (throwOnError) throw new Error(message);
      return;
    }
    if (isCurrentRequest()) {
      setLoading(true);
      setError(null);
    }
    try {
      const snapshot = await repository.load(catalogAssets);
      if (isCurrentRequest()) {
        setAssets(snapshot.assets);
        setDailySnapshots(snapshot.dailySnapshots);
        setUnmappedHoldingCount(snapshot.unmappedHoldingCount);
        setLoadedOwnerId(expectedOwnerId);
        setSettledOwnerId(expectedOwnerId);
        setError(snapshot.unmappedHoldingCount > 0
          ? `${snapshot.unmappedHoldingCount} holding is waiting for a verified catalog mapping.`
          : null);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The collection could not be loaded.';
      if (isCurrentRequest()) {
        setAssets([]);
        setDailySnapshots([]);
        setUnmappedHoldingCount(0);
        setLoadedOwnerId(null);
        setSettledOwnerId(expectedOwnerId);
        setError(message);
      }
      if (throwOnError) throw new Error(message);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [enabled, repository, ownerId]);

  const refresh = useCallback(async () => {
    await loadCollection(false);
  }, [loadCollection]);

  useEffect(() => {
    requestVersionRef.current += 1;
    setAssets([]);
    setDailySnapshots([]);
    setUnmappedHoldingCount(0);
    setLoadedOwnerId(null);
    setSettledOwnerId(null);
    setError(null);
    setLoading(Boolean(enabled && ownerId));
    void refresh();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [refresh]);

  const mutate = useCallback(async (operation: (expectedOwnerId: string) => Promise<void>): Promise<boolean> => {
    const mutationOwnerId = activeOwnerRef.current;
    if (!mutationOwnerId) {
      const message = 'A signed-in collection owner is required.';
      setError(message);
      throw new Error(message);
    }
    if (mutationInFlightRef.current) {
      const message = 'Another collection change is still being saved. Wait for it to finish and try again.';
      if (activeOwnerRef.current === mutationOwnerId) setError(message);
      throw new Error(message);
    }
    mutationInFlightRef.current = true;
    setMutating(true);
    setError(null);
    let saved = false;
    try {
      await operation(mutationOwnerId);
      saved = true;
      if (activeOwnerRef.current !== mutationOwnerId) return false;
      await loadCollection(true);
      return activeOwnerRef.current === mutationOwnerId;
    } catch (reason) {
      if (activeOwnerRef.current !== mutationOwnerId) return false;
      const detail = reason instanceof Error ? reason.message : 'The collection change could not be saved.';
      const message = saved
        ? `The change was saved, but the updated collection could not be reloaded. Refresh before making another change. ${detail}`
        : detail;
      if (activeOwnerRef.current === mutationOwnerId) setError(message);
      throw new Error(message);
    } finally {
      mutationInFlightRef.current = false;
      setMutating(false);
    }
  }, [loadCollection]);

  const add = useCallback(async (input: AddCollectionItemV2) => {
    if (!repository) throw new Error('The production collection service is not configured.');
    return mutate((expectedOwnerId) => repository.add(input, expectedOwnerId));
  }, [mutate, repository]);

  const setQuantity = useCallback(async (asset: DemoAsset, quantity: number) => {
    if (!repository || !asset.collectionItemId) {
      throw new Error('This holding is missing its account record. Refresh the collection and try again.');
    }
    return mutate(() => repository.setQuantity(asset.collectionItemId!, quantity));
  }, [mutate, repository]);

  const updateNote = useCallback(async (asset: DemoAsset, note?: string) => {
    if (!repository || !asset.collectionItemId) {
      throw new Error('This holding is missing its account record. Refresh the collection and try again.');
    }
    return mutate(() => repository.updateNote(asset.collectionItemId!, note));
  }, [mutate, repository]);

  const remove = useCallback(async (asset: DemoAsset) => {
    if (!repository || !asset.collectionItemId) {
      throw new Error('This holding is missing its account record. Refresh the collection and try again.');
    }
    return mutate(() => repository.remove(asset.collectionItemId!));
  }, [mutate, repository]);

  const hasLoadedActiveOwner = Boolean(enabled && ownerId && loadedOwnerId === ownerId);
  const isWaitingForActiveOwner = Boolean(enabled && ownerId && settledOwnerId !== ownerId);

  return {
    assets: hasLoadedActiveOwner ? assets : [],
    dailySnapshots: hasLoadedActiveOwner ? dailySnapshots : [],
    loading: loading || isWaitingForActiveOwner,
    mutating,
    error: settledOwnerId === ownerId ? error : null,
    unmappedHoldingCount: hasLoadedActiveOwner ? unmappedHoldingCount : 0,
    refresh,
    add,
    setQuantity,
    updateNote,
    remove,
    clearError: () => setError(null),
  };
}

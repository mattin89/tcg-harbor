import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LatestRequestGateV2 } from '../../domain/latestRequestGateV2';
import { getSupabaseClient } from './client';
import {
  directConversationsForOwnerV2,
  SupabaseDirectMessageRepositoryV2,
  type ProductionDirectConversationV2,
  type ProductionDirectInboxSnapshotV2,
  type SendProductionDirectMessageV2,
} from './directMessageRepositoryV2';

export interface ProductionDirectMessagesRuntimeV2 {
  readonly conversations: readonly ProductionDirectConversationV2[];
  readonly unreadCount: number;
  readonly loading: boolean;
  readonly mutating: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly createConversation: (otherUserId: string, communityId: string) => Promise<string | null>;
  readonly send: (input: SendProductionDirectMessageV2) => Promise<boolean>;
  readonly markRead: (conversationId: string) => Promise<boolean>;
  readonly hide: (conversationId: string) => Promise<boolean>;
  readonly clearError: () => void;
}

/**
 * Production-only inbox state. Disabled/demo mode intentionally returns an
 * empty result; App's existing `initialConversations` remain the demo source.
 */
export function useProductionDirectMessagesV2(
  enabled: boolean,
  ownerId?: string,
): ProductionDirectMessagesRuntimeV2 {
  const client = useMemo(() => getSupabaseClient(), []);
  const repository = useMemo(
    () => client ? new SupabaseDirectMessageRepositoryV2(client) : null,
    [client],
  );
  const [snapshot, setSnapshot] = useState<ProductionDirectInboxSnapshotV2 | null>(null);
  const [settledOwnerId, setSettledOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled && ownerId));
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeOwnerRef = useRef<string | null>(enabled ? ownerId ?? null : null);
  const requestGateRef = useRef(new LatestRequestGateV2());
  const mutationInFlightRef = useRef(false);

  activeOwnerRef.current = enabled ? ownerId ?? null : null;

  const loadInbox = useCallback(async (throwOnError: boolean) => {
    const expectedOwnerId = enabled ? ownerId ?? null : null;
    const isCurrentRequest = requestGateRef.current.begin();
    const isCurrentOwnerRequest = () => isCurrentRequest()
      && activeOwnerRef.current === expectedOwnerId;

    if (!expectedOwnerId) {
      if (isCurrentOwnerRequest()) {
        setSnapshot(null);
        setSettledOwnerId(null);
        setError(null);
        setLoading(false);
      }
      return;
    }
    if (!repository) {
      const message = 'The production direct-message service is not configured.';
      if (isCurrentOwnerRequest()) {
        setSnapshot(null);
        setSettledOwnerId(expectedOwnerId);
        setError(message);
        setLoading(false);
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
      const message = reason instanceof Error ? reason.message : 'The private inbox could not be loaded.';
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
    await loadInbox(false);
  }, [loadInbox]);

  useEffect(() => {
    requestGateRef.current.invalidate();
    setSnapshot(null);
    setSettledOwnerId(null);
    setError(null);
    setLoading(Boolean(enabled && ownerId));
    void refresh();
    return () => requestGateRef.current.invalidate();
  }, [enabled, ownerId, refresh]);

  const mutate = useCallback(async <Result,>(
    operation: (expectedOwnerId: string) => Promise<Result>,
  ): Promise<{ saved: boolean; result: Result | null }> => {
    const mutationOwnerId = activeOwnerRef.current;
    if (!mutationOwnerId) {
      const message = 'A signed-in direct-message owner is required.';
      setError(message);
      throw new Error(message);
    }
    if (mutationInFlightRef.current) {
      const message = 'Another direct-message change is still being saved.';
      if (activeOwnerRef.current === mutationOwnerId) setError(message);
      throw new Error(message);
    }

    mutationInFlightRef.current = true;
    setMutating(true);
    setError(null);
    let saved = false;
    try {
      const result = await operation(mutationOwnerId);
      saved = true;
      if (activeOwnerRef.current !== mutationOwnerId) return { saved: false, result: null };
      await loadInbox(true);
      if (activeOwnerRef.current !== mutationOwnerId) return { saved: false, result: null };
      return { saved: true, result };
    } catch (reason) {
      if (activeOwnerRef.current !== mutationOwnerId) return { saved: false, result: null };
      const detail = reason instanceof Error ? reason.message : 'The direct-message change could not be saved.';
      const message = saved
        ? `The change was saved, but the private inbox could not be reloaded. Refresh before continuing. ${detail}`
        : detail;
      setError(message);
      throw new Error(message);
    } finally {
      mutationInFlightRef.current = false;
      setMutating(false);
    }
  }, [loadInbox]);

  const createConversation = useCallback(async (otherUserId: string, communityId: string) => {
    if (!repository) throw new Error('The production direct-message service is not configured.');
    const outcome = await mutate((expectedOwnerId) => (
      repository.createConversation(otherUserId, communityId, expectedOwnerId)
    ));
    return outcome.saved ? outcome.result : null;
  }, [mutate, repository]);

  const send = useCallback(async (input: SendProductionDirectMessageV2) => {
    if (!repository) throw new Error('The production direct-message service is not configured.');
    return (await mutate((expectedOwnerId) => repository.send(input, expectedOwnerId))).saved;
  }, [mutate, repository]);

  const markRead = useCallback(async (conversationId: string) => {
    if (!repository) throw new Error('The production direct-message service is not configured.');
    return (await mutate((expectedOwnerId) => repository.markRead(conversationId, expectedOwnerId))).saved;
  }, [mutate, repository]);

  const hide = useCallback(async (conversationId: string) => {
    if (!repository) throw new Error('The production direct-message service is not configured.');
    return (await mutate((expectedOwnerId) => repository.hide(conversationId, expectedOwnerId))).saved;
  }, [mutate, repository]);

  const activeOwnerId = enabled ? ownerId ?? null : null;
  const conversations = directConversationsForOwnerV2(snapshot, activeOwnerId);
  const isWaitingForActiveOwner = Boolean(activeOwnerId && settledOwnerId !== activeOwnerId);

  return {
    conversations,
    unreadCount: conversations.reduce((total, conversation) => total + conversation.unreadCount, 0),
    loading: loading || isWaitingForActiveOwner,
    mutating,
    error: settledOwnerId === activeOwnerId ? error : null,
    refresh,
    createConversation,
    send,
    markRead,
    hide,
    clearError: () => setError(null),
  };
}

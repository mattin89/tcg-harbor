import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "../services/supabase/client";
import { SupabaseProductionAccess } from "./supabaseProductionAccess";
import type {
  CommunityChannel,
  CommunityChannelDraft,
  CommunityMessage,
  GeneratedStoreQrInvite,
  PendingApplication,
  ProductionAccessSnapshot,
  SignUpDraft,
  SignUpResult,
  StoreJoinCodeValidation,
  StoreJoinResult,
  StoreQrInvite,
  StoreApplicationDraft,
} from "./types";

export type ProductionAccessPhase =
  | "unconfigured"
  | "loading"
  | "signed-out"
  | "ready"
  | "error";

export interface ProductionAccessController {
  configured: boolean;
  phase: ProductionAccessPhase;
  snapshot: ProductionAccessSnapshot | null;
  error: string | null;
  passwordRecovery: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(draft: SignUpDraft): Promise<SignUpResult>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  submitStoreApplication(draft: StoreApplicationDraft): Promise<void>;
  withdrawStoreApplication(applicationId: string): Promise<void>;
  listPendingApplications(): Promise<PendingApplication[]>;
  beginReviewApplication(applicationId: string): Promise<void>;
  reviewApplication(applicationId: string, decision: "approved" | "rejected", note?: string): Promise<void>;
  listCommunityChannels(communityId: string): Promise<CommunityChannel[]>;
  createCommunityChannel(draft: CommunityChannelDraft): Promise<CommunityChannel>;
  updateCommunityChannel(channelId: string, draft: Omit<CommunityChannelDraft, "communityId">): Promise<CommunityChannel>;
  archiveCommunityChannel(channelId: string): Promise<void>;
  listStoreQrInvites(storeId: string): Promise<StoreQrInvite[]>;
  generateStoreQrInvite(storeId: string, label?: string): Promise<GeneratedStoreQrInvite>;
  rotateStoreQrInvite(storeId: string, label?: string): Promise<GeneratedStoreQrInvite>;
  revokeStoreQrInvite(storeId: string, reason?: string): Promise<void>;
  validateStoreJoinCode(rawToken: string): Promise<StoreJoinCodeValidation | null>;
  redeemStoreJoinCode(rawToken: string): Promise<StoreJoinResult>;
  listCommunityMessages(communityId: string, channelId: string): Promise<CommunityMessage[]>;
  moderateCommunityMessage(messageId: string, reason?: string): Promise<void>;
  refresh(): Promise<void>;
  clearError(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function useProductionAccess(): ProductionAccessController {
  const client = useMemo(() => getSupabaseClient(), []);
  const service = useMemo(() => client ? new SupabaseProductionAccess(client) : null, [client]);
  const [phase, setPhase] = useState<ProductionAccessPhase>(service ? "loading" : "unconfigured");
  const [snapshot, setSnapshot] = useState<ProductionAccessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  const loadSession = useCallback(async () => {
    if (!service) return;
    setPhase("loading");
    try {
      const session = await service.getSession();
      if (!session) {
        setSnapshot(null);
        setPhase("signed-out");
        return;
      }
      const next = await service.loadSnapshot(session);
      setSnapshot(next);
      setError(null);
      setPhase("ready");
    } catch (nextError) {
      setError(errorMessage(nextError));
      setPhase("error");
    }
  }, [service]);

  useEffect(() => {
    if (!service) return;
    let active = true;
    void loadSession();
    const unsubscribe = service.onAuthChange((event) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      // Deferring avoids making another Supabase call while the auth client is
      // still holding its internal session lock.
      window.setTimeout(() => {
        if (active) void loadSession();
      }, 0);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadSession, service]);

  const subscribedUserId = snapshot?.profile.id;
  useEffect(() => {
    if (!service || !subscribedUserId) return;
    return service.onStoreApplicationChange(subscribedUserId, () => { void loadSession(); });
  }, [loadSession, service, subscribedUserId]);

  const run = useCallback(async (operation: () => Promise<void>, options?: { refresh?: boolean }) => {
    setError(null);
    try {
      await operation();
      if (options?.refresh) await loadSession();
    } catch (nextError) {
      const nextMessage = errorMessage(nextError);
      setError(nextMessage);
      throw nextError;
    }
  }, [loadSession]);

  return {
    configured: Boolean(service),
    phase,
    snapshot,
    error,
    passwordRecovery,
    async signIn(email, password) {
      if (!service) return;
      await run(async () => {
        const session = await service.signIn(email.trim(), password);
        const next = await service.loadSnapshot(session);
        setSnapshot(next);
        setPhase("ready");
      });
    },
    async signUp(draft) {
      if (!service) return { session: null, emailConfirmationRequired: true };
      let result: SignUpResult = { session: null, emailConfirmationRequired: true };
      await run(async () => {
        result = await service.signUp(draft);
        if (result.session) {
          const next = await service.loadSnapshot(result.session);
          setSnapshot(next);
          setPhase("ready");
        }
      });
      return result;
    },
    async signOut() {
      if (!service) return;
      await run(async () => {
        await service.signOut();
        setSnapshot(null);
        setPhase("signed-out");
      });
    },
    async requestPasswordReset(email) {
      if (!service) return;
      await run(() => service.requestPasswordReset(email.trim()));
    },
    async updatePassword(password) {
      if (!service) return;
      await run(async () => {
        await service.updatePassword(password);
        setPasswordRecovery(false);
      });
    },
    async submitStoreApplication(draft) {
      if (!service) return;
      await run(() => service.submitStoreApplication(draft).then(() => undefined), { refresh: true });
    },
    async withdrawStoreApplication(applicationId) {
      if (!service) return;
      await run(() => service.withdrawStoreApplication(applicationId).then(() => undefined), { refresh: true });
    },
    async listPendingApplications() {
      if (!service) return [];
      try {
        return await service.listPendingApplications();
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async reviewApplication(applicationId, decision, note) {
      if (!service) return;
      await run(() => service.reviewApplication(applicationId, decision, note).then(() => undefined), { refresh: true });
    },
    async beginReviewApplication(applicationId) {
      if (!service) return;
      await run(() => service.beginReviewApplication(applicationId).then(() => undefined), { refresh: true });
    },
    async listCommunityChannels(communityId) {
      if (!service) return [];
      try {
        return await service.listCommunityChannels(communityId);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async createCommunityChannel(draft) {
      if (!service) throw new Error("Production Supabase is not configured.");
      try {
        return await service.createCommunityChannel(draft);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async updateCommunityChannel(channelId, draft) {
      if (!service) throw new Error("Production Supabase is not configured.");
      try {
        return await service.updateCommunityChannel(channelId, draft);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async archiveCommunityChannel(channelId) {
      if (!service) return;
      await run(() => service.archiveCommunityChannel(channelId));
    },
    async listStoreQrInvites(storeId) {
      if (!service) return [];
      try {
        return await service.listStoreQrInvites(storeId);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async generateStoreQrInvite(storeId, label) {
      if (!service) throw new Error("Production Supabase is not configured.");
      try {
        return await service.generateStoreQrInvite(storeId, label);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async rotateStoreQrInvite(storeId, label) {
      if (!service) throw new Error("Production Supabase is not configured.");
      try {
        return await service.rotateStoreQrInvite(storeId, label);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async revokeStoreQrInvite(storeId, reason) {
      if (!service) return;
      await run(() => service.revokeStoreQrInvite(storeId, reason));
    },
    async validateStoreJoinCode(rawToken) {
      if (!service) return null;
      try {
        return await service.validateStoreJoinCode(rawToken);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async redeemStoreJoinCode(rawToken) {
      if (!service) return { outcome: "invalid", communityId: null };
      try {
        return await service.redeemStoreJoinCode(rawToken);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async listCommunityMessages(communityId, channelId) {
      if (!service) return [];
      try {
        return await service.listCommunityMessages(communityId, channelId);
      } catch (nextError) {
        setError(errorMessage(nextError));
        throw nextError;
      }
    },
    async moderateCommunityMessage(messageId, reason) {
      if (!service) return;
      await run(() => service.moderateCommunityMessage(messageId, reason));
    },
    refresh: loadSession,
    clearError() {
      setError(null);
    },
  };
}

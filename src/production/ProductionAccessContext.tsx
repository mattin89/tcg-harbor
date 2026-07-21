import { createContext, useContext, type ReactNode } from "react";
import { useProductionAccess, type ProductionAccessController } from "./useProductionAccess";
import type { AppRole } from "./types";

const ProductionAccessContext = createContext<ProductionAccessController | null>(null);

export function ProductionAccessProvider({ children }: { children: ReactNode }) {
  const controller = useProductionAccess();
  return (
    <ProductionAccessContext.Provider value={controller}>
      {children}
    </ProductionAccessContext.Provider>
  );
}

export function useProductionAccessContext(): ProductionAccessController {
  const controller = useContext(ProductionAccessContext);
  if (!controller) {
    throw new Error("useProductionAccessContext must be used inside ProductionAccessProvider.");
  }
  return controller;
}

export function useProductionIdentity() {
  const access = useProductionAccessContext();
  const roles = access.snapshot?.profile.roles ?? [];
  const hasRole = (role: AppRole) => roles.includes(role);
  return {
    configured: access.configured,
    authenticated: access.phase === "ready" && Boolean(access.snapshot),
    loading: access.phase === "loading",
    user: access.snapshot?.session.user ?? null,
    profile: access.snapshot?.profile ?? null,
    roles,
    hasRole,
    isPlatformAdministrator: hasRole("platform_administrator"),
    canManageStore: access.snapshot?.managedStores.length ? true : false,
    managedStores: access.snapshot?.managedStores ?? [],
    registeredStores: access.snapshot?.registeredStores ?? [],
    storeApplication: access.snapshot?.application ?? null,
    signOut: access.signOut,
  };
}

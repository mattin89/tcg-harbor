import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { preferredPortalAreaV2, type PortalAreaV2 } from "../domain/portalAreaV2";
import { ProductionAccessProvider, useProductionAccessContext } from "./ProductionAccessContext";
import { ProductionAuthPanel } from "./ProductionAuthPanel";
import { ProductionStoreJoinPage } from "./ProductionStoreJoinPage";
import { PlatformApprovalPanel, StoreApplicationPanel, StoreWorkspacePanel } from "./StoreAccessPanels";
import {
  captureStoreJoinIntentFromBrowser,
  clearStoredStoreJoinIntent,
  persistStoreJoinEmailHandoff,
} from "./storeJoinRoute";
import type { ProductionAccessSnapshot } from "./types";
import "./production-access.css";

export interface ProductionAccessGateProps {
  children: ReactNode;
  renderPlayer?: (snapshot: ProductionAccessSnapshot) => ReactNode;
  renderStoreWorkspace?: (snapshot: ProductionAccessSnapshot) => ReactNode;
  renderPlatformApprovals?: (snapshot: ProductionAccessSnapshot) => ReactNode;
}

/** Self-contained gate for a root-level integration. */
export function ProductionAccessGate(props: ProductionAccessGateProps) {
  return <ProductionAccessProvider><ProductionAccessBoundary {...props} /></ProductionAccessProvider>;
}

/** Use inside an existing ProductionAccessProvider when App also needs the context hook. */
export function ProductionAccessBoundary({ children, renderPlayer, renderStoreWorkspace, renderPlatformApprovals }: ProductionAccessGateProps) {
  const access = useProductionAccessContext();
  const [area, setArea] = useState<PortalAreaV2>("player");
  const [storeJoinIntent, setStoreJoinIntent] = useState(() => typeof window === "undefined" || !access.configured ? null : captureStoreJoinIntentFromBrowser());
  const [pathname, setPathname] = useState(() => typeof window === "undefined" ? "/" : window.location.pathname);
  const snapshot = access.snapshot;
  const storeJoinToken = storeJoinIntent?.token ?? null;
  const onCanonicalJoinRoute = /^\/join\/store\/?$/i.test(pathname);

  useEffect(() => {
    if (!access.configured) return;
    const updateLocation = () => {
      setStoreJoinIntent(captureStoreJoinIntentFromBrowser());
      setPathname(window.location.pathname);
    };
    window.addEventListener("popstate", updateLocation);
    window.addEventListener("hashchange", updateLocation);
    return () => {
      window.removeEventListener("popstate", updateLocation);
      window.removeEventListener("hashchange", updateLocation);
    };
  }, [access.configured]);

  const clearJoinStorage = useCallback(() => clearStoredStoreJoinIntent(window.sessionStorage, window.localStorage), []);
  const cancelJoin = useCallback(() => {
    clearJoinStorage();
    setStoreJoinIntent(null);
    window.history.replaceState({}, "", "/dashboard");
    setPathname("/dashboard");
  }, [clearJoinStorage]);

  const preferredArea = snapshot
    ? preferredPortalAreaV2({
      roles: snapshot.profile.roles,
      accountKind: snapshot.profile.accountKind,
      managedStoreCount: snapshot.managedStores.length,
    })
    : "player";

  useEffect(() => {
    setArea(preferredArea);
  }, [preferredArea, snapshot?.profile.id]);

  if (!access.configured || access.phase === "unconfigured") {
    return (
      <main className="production-loading-page">
        <span className="production-status-icon"><Icon name="info" size={24} /></span>
        <h1>Account service unavailable</h1>
        <p>TCG Harbor is missing its public account-service configuration. Please try again after the deployment is repaired.</p>
      </main>
    );
  }

  if (access.phase === "loading") {
    return (
      <main className="production-loading-page" aria-busy="true">
        <span className="production-brand-mark"><Icon name="cards" size={26} /></span>
        <h1>Opening TCG Harbor</h1>
        <div className="production-loading-bar"><span /></div>
        <p>Restoring your secure session…</p>
      </main>
    );
  }

  if (access.phase === "error") {
    return (
      <main className="production-loading-page">
        <span className="production-status-icon"><Icon name="info" size={24} /></span>
        <h1>We could not open your account</h1>
        <p>{access.error}</p>
        <div className="production-inline-actions">
          <button className="production-primary" type="button" onClick={() => void access.refresh()}>Try again</button>
          <button className="production-secondary" type="button" onClick={() => void access.signOut()}>Return to sign in</button>
        </div>
      </main>
    );
  }

  if (onCanonicalJoinRoute && !storeJoinToken) {
    return <ProductionStoreJoinPage access={access} rawToken={null} onClearStoredIntent={clearJoinStorage} />;
  }

  if (access.phase === "signed-out" || !snapshot) {
    return <ProductionAuthPanel
      access={access}
      pendingStoreJoin={Boolean(storeJoinToken)}
      onCancelPendingStoreJoin={cancelJoin}
      onEmailConfirmationHandoff={() => storeJoinToken
        ? persistStoreJoinEmailHandoff(storeJoinToken, window.localStorage)
        : false}
    />;
  }

  if (snapshot.profile.accountStatus !== "active") {
    return (
      <main className="production-loading-page">
        <span className="production-status-icon"><Icon name="lock" size={24} /></span>
        <h1>Account unavailable</h1>
        <p>This account is {snapshot.profile.accountStatus}. Contact TCG Harbor support if you believe this is a mistake.</p>
        <button className="production-secondary" type="button" onClick={() => void access.signOut()}>Sign out</button>
      </main>
    );
  }

  if (storeJoinToken) {
    return <ProductionStoreJoinPage access={access} rawToken={storeJoinToken} onClearStoredIntent={clearJoinStorage} />;
  }

  const canUseStoreArea = snapshot.profile.accountKind === "store" || snapshot.managedStores.length > 0;
  const isPlatformAdmin = snapshot.profile.roles.includes("platform_administrator");
  const playerContent = renderPlayer?.(snapshot) ?? children;

  if (!canUseStoreArea && !isPlatformAdmin) return <>{playerContent}</>;

  return (
    <div className="production-portal-shell">
      <header className="production-portal-bar">
        <div className="production-portal-identity">
          <span className="production-brand-mark"><Icon name="cards" size={20} /></span>
          <div><strong>TCG Harbor</strong><small>{snapshot.profile.displayName || snapshot.profile.username}</small></div>
        </div>
        <nav aria-label="Account areas">
          <button type="button" className={area === "player" ? "is-active" : ""} onClick={() => setArea("player")}><Icon name="cards" size={16} />Player area</button>
          {canUseStoreArea && <button type="button" className={area === "store" ? "is-active" : ""} onClick={() => setArea("store")}><Icon name="store" size={16} />Store workspace{snapshot.application?.status === "pending" && <i />}</button>}
          {isPlatformAdmin && <button type="button" className={area === "approvals" ? "is-active" : ""} onClick={() => setArea("approvals")}><Icon name="shield" size={16} />Approvals</button>}
        </nav>
        <button className="production-signout" type="button" onClick={() => void access.signOut()} aria-label="Sign out"><Icon name="logout" size={17} /><span>Sign out</span></button>
      </header>

      <div className={area === "player" ? "production-player-outlet" : "production-portal-outlet"}>
        {area === "player" && playerContent}
        {area === "store" && canUseStoreArea && (snapshot.managedStores.length > 0
          ? renderStoreWorkspace?.(snapshot) ?? <StoreWorkspacePanel stores={snapshot.managedStores} access={access} />
          : <StoreApplicationPanel access={access} />)}
        {area === "approvals" && isPlatformAdmin && (renderPlatformApprovals?.(snapshot) ?? <PlatformApprovalPanel access={access} />)}
      </div>
    </div>
  );
}

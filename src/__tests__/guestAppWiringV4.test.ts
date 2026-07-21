import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const app = source('App.tsx');
const productionApp = source('ProductionApp_v2.tsx');
const accessGate = source('production/ProductionAccessGate.tsx');

describe('guest application wiring v4', () => {
  it('mounts guest and authenticated runtimes under separate React identities', () => {
    expect(productionApp).toContain('<ProductionAccessGate renderGuest=');
    expect(productionApp).toContain('<App key="guest-v4" guest={{');
    expect(productionApp).toContain('<App key={identity.profile.id} identity={{');
  });

  it('resolves the guest allowlist before dispatching a page', () => {
    const routeResolution = app.indexOf("const path = resolveViewerPathV4(requestedPath, isGuest ? 'guest' : 'authenticated')");
    const pageDispatch = app.indexOf('const page =');

    expect(routeResolution).toBeGreaterThan(-1);
    expect(pageDispatch).toBeGreaterThan(routeResolution);
    expect(app).toContain("const guestNavItems = [");
    expect(app).toContain("{ path: '/cards', label: 'Cards'");
    expect(app).toContain("{ path: '/stores', label: 'Stores'");
  });

  it('keeps guest state out of demo persistence and account fixtures', () => {
    expect(app).toContain("identity || isGuest ? false : localStorage.getItem('tcg-harbor-session')");
    expect(app).toContain('identity || isGuest ? [] : safeAssets()');
    expect(app).toContain("if (!identity && !isGuest) localStorage.setItem('tcg-harbor-assets-source-backed-v5'");
    expect(app).toContain("resolveAccountBootstrapSeedsV2(isGuest ? { userId: 'guest-v4', accountKind: 'player' } : identity");
    expect(app).toContain('const conversations = identity ? productionConversations : isGuest ? [] : demoConversations;');
  });

  it('renders catalog details without collection inputs or mutation controls for guests', () => {
    expect(app).toContain('browseOnly={isGuest} onRequestAuthentication={guest?.onRequestAuthentication}');
    expect(app).toContain("viewerMutationDecisionV4('guest', 'save_collection') === 'requires_auth'");
    expect(app).toContain("browseOnly ? <div className=\"guest-card-details\"");
    expect(app).toContain('{!browseOnly && <Modal');
    expect(app).toContain('Guest browsing never creates a collection or stores card activity.');
  });

  it('removes join and scanner controls from guest store views', () => {
    expect(app).toContain("browseOnly ? <Button type=\"button\" onClick={onRequestAuthentication} icon=\"lock\">Sign in to join</Button>");
    expect(app).toContain("browseOnly ? <article className=\"panel guest-store-gate\"");
    expect(app).toContain('Guest browsing never creates a membership.');
  });

  it('keeps the complete public directory recoverable and loading-safe', () => {
    expect(app).toContain('storesRefresh(): Promise<void>;');
    expect(app).toContain('isGuest && guest?.storesLoading');
    expect(app).toContain('void guest.storesRefresh()');
    expect(app).toContain('Dresden · all approved locations');
    expect(productionApp).toContain('storesRefresh: directory.refresh');
  });

  it('keeps authentication mandatory for recovery and QR invitation flows', () => {
    const recoveryBoundary = accessGate.indexOf('if (access.passwordRecovery)');
    const guestBoundary = accessGate.indexOf('if (!storeJoinToken && renderGuest && !authRequested)');

    expect(recoveryBoundary).toBeGreaterThan(-1);
    expect(guestBoundary).toBeGreaterThan(recoveryBoundary);
    expect(accessGate).toContain('pendingStoreJoin={Boolean(storeJoinToken)}');
    expect(accessGate).toContain('onBrowseAsGuest={!storeJoinToken && renderGuest');
  });
});

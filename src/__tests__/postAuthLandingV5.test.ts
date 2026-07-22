import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolvePostAuthLandingV5 } from '../domain/postAuthLandingV5';

const gateSource = readFileSync(new URL('../production/ProductionAccessGate.tsx', import.meta.url), 'utf8');

describe('resolvePostAuthLandingV5', () => {
  it('lands an explicitly authenticated guest on the dashboard', () => {
    expect(resolvePostAuthLandingV5({
      authenticationRequested: true,
      snapshotReady: true,
      passwordRecovery: false,
      pendingStoreJoin: false,
    })).toBe('/dashboard');
  });

  it.each([
    ['restored session', false, true, false, false],
    ['session still loading', true, false, false, false],
    ['password recovery', true, true, true, false],
    ['store QR continuation', true, true, false, true],
  ] as const)('preserves the current route for %s', (_label, authenticationRequested, snapshotReady, passwordRecovery, pendingStoreJoin) => {
    expect(resolvePostAuthLandingV5({
      authenticationRequested,
      snapshotReady,
      passwordRecovery,
      pendingStoreJoin,
    })).toBeNull();
  });

  it('opens the player dashboard first for store operators and platform administrators too', () => {
    const postAuthEffect = gateSource.slice(
      gateSource.indexOf('if (postAuthLanding) {'),
      gateSource.indexOf('setAuthRequested(false);'),
    );
    expect(postAuthEffect).toContain('window.history.replaceState({}, "", postAuthLanding)');
    expect(postAuthEffect).toContain('setArea("player")');
  });
});

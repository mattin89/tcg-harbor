import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveAccountBootstrapSeedsV2 } from '../domain/accountBootstrapV2';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const productionRootSource = readFileSync(new URL('../ProductionApp_v2.tsx', import.meta.url), 'utf8');

const demoSeeds = {
  communityMessages: { community: [{ id: 'message' }] },
  tradePosts: [{ id: 'trade' }],
  conversations: [{ id: 'conversation' }],
  notifications: [{ id: 'notification' }],
  recentActivity: [{ id: 'activity' }],
};

describe('account bootstrap state', () => {
  it.each(['player', 'store'] as const)('starts a new %s account without demo-owned data', (accountKind) => {
    expect(resolveAccountBootstrapSeedsV2({ userId: `${accountKind}-id`, accountKind }, demoSeeds)).toEqual({
      communityMessages: {},
      tradePosts: [],
      conversations: [],
      notifications: [],
      recentActivity: [],
    });
  });

  it('retains fixtures only for the explicit local demo', () => {
    expect(resolveAccountBootstrapSeedsV2(undefined, demoSeeds)).toBe(demoSeeds);
  });

  it('wires the production shell to empty-safe, account-owned sources', () => {
    expect(appSource).toContain('() => identity || isGuest ? [] : safeAssets()');
    expect(appSource).toContain('useProductionDirectMessagesV2(Boolean(identity), identity?.userId)');
    expect(appSource).toContain('identity ? identity.notifications ?? [] : accountSeeds.notifications');
    expect(productionRootSource).toContain('notifications: productionNotifications.notifications');
    expect(appSource).toContain('if (!active) {');
    expect(appSource).not.toContain('<em>2</em>');
    expect(appSource).not.toContain('{notifications.map(');
    expect(appSource).not.toContain('{recentActivity.map(');
  });
});

import { describe, expect, it } from 'vitest';
import { preferredPortalAreaV2 } from '../domain/portalAreaV2';

describe('account-scoped portal area', () => {
  it('never carries an administrator area into a player or store account', () => {
    expect(preferredPortalAreaV2({
      roles: ['platform_administrator'],
      accountKind: 'player',
      managedStoreCount: 0,
    })).toBe('approvals');
    expect(preferredPortalAreaV2({
      roles: [],
      accountKind: 'store',
      managedStoreCount: 1,
    })).toBe('store');
    expect(preferredPortalAreaV2({
      roles: [],
      accountKind: 'player',
      managedStoreCount: 0,
    })).toBe('player');
  });
});

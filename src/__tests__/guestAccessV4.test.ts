import { describe, expect, it } from 'vitest';
import {
  GUEST_DEFAULT_PATH_V4,
  guestCapabilitiesV4,
  isGuestPublicPathV4,
  resolveViewerPathV4,
  viewerMutationDecisionV4,
  type GuestMutationV4,
} from '../domain/guestAccessV4';

describe('guest access v4', () => {
  it.each([
    ['/cards', '/cards'],
    ['/cards/', '/cards'],
    ['/stores', '/stores'],
    ['/stores/', '/stores'],
    ['/stores/store-123', '/stores/store-123'],
  ])('keeps public guest route %s available', (requestedPath, expectedPath) => {
    expect(isGuestPublicPathV4(requestedPath)).toBe(true);
    expect(resolveViewerPathV4(requestedPath, 'guest')).toBe(expectedPath);
  });

  it.each([
    '/',
    '/dashboard',
    '/collection',
    '/collection/add',
    '/market-comparison',
    '/messages',
    '/settings',
    '/stores/store-123/community',
    '/join/store',
  ])('redirects private or unknown guest route %s to the catalog', (requestedPath) => {
    expect(isGuestPublicPathV4(requestedPath)).toBe(false);
    expect(resolveViewerPathV4(requestedPath, 'guest')).toBe(GUEST_DEFAULT_PATH_V4);
  });

  it('does not constrain authenticated navigation', () => {
    expect(resolveViewerPathV4('/collection/add/', 'authenticated')).toBe('/collection/add');
    expect(resolveViewerPathV4('/settings', 'authenticated')).toBe('/settings');
  });

  it('exposes only browsing capabilities to guests', () => {
    expect(guestCapabilitiesV4).toEqual({
      browseCatalog: true,
      browseStores: true,
      saveCollection: false,
      joinStore: false,
      readCommunities: false,
      readMessages: false,
      manageStore: false,
    });
  });

  it.each<GuestMutationV4>([
    'save_collection',
    'redeem_store_join',
    'send_message',
    'publish_trade',
    'manage_store',
  ])('requires authentication for guest mutation %s', (operation) => {
    expect(viewerMutationDecisionV4('guest', operation)).toBe('requires_auth');
    expect(viewerMutationDecisionV4('authenticated', operation)).toBe('allowed');
  });
});

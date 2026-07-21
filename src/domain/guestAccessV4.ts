export const GUEST_DEFAULT_PATH_V4 = '/cards';

export const guestCapabilitiesV4 = Object.freeze({
  browseCatalog: true,
  browseStores: true,
  saveCollection: false,
  joinStore: false,
  readCommunities: false,
  readMessages: false,
  manageStore: false,
});

export type GuestMutationV4 =
  | 'save_collection'
  | 'redeem_store_join'
  | 'send_message'
  | 'publish_trade'
  | 'manage_store';

export type ViewerModeV4 = 'guest' | 'authenticated';

function normalizedPathV4(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/+$/, '') || '/';
}

export function isGuestPublicPathV4(pathname: string): boolean {
  const path = normalizedPathV4(pathname);
  return path === '/cards'
    || path === '/stores'
    || /^\/stores\/[^/]+$/.test(path);
}

/**
 * Guests never dispatch private pages. Unknown and private deep links resolve
 * to the public catalog before the page switch executes.
 */
export function resolveViewerPathV4(pathname: string, viewer: ViewerModeV4): string {
  const path = normalizedPathV4(pathname);
  if (viewer === 'authenticated') return path;
  return isGuestPublicPathV4(path) ? path : GUEST_DEFAULT_PATH_V4;
}

export function viewerMutationDecisionV4(
  viewer: ViewerModeV4,
  _operation: GuestMutationV4,
): 'allowed' | 'requires_auth' {
  return viewer === 'authenticated' ? 'allowed' : 'requires_auth';
}

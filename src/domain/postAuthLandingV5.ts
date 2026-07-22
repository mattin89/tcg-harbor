export interface PostAuthLandingContextV5 {
  readonly authenticationRequested: boolean;
  readonly snapshotReady: boolean;
  readonly passwordRecovery: boolean;
  readonly pendingStoreJoin: boolean;
}

/**
 * Chooses a landing route only for an authentication flow that the visitor
 * explicitly opened from the guest experience. Restored sessions and deep
 * links keep their current route, while password recovery and store QR joins
 * retain their dedicated continuation flows.
 */
export function resolvePostAuthLandingV5(
  context: PostAuthLandingContextV5,
): '/dashboard' | null {
  if (
    !context.authenticationRequested
    || !context.snapshotReady
    || context.passwordRecovery
    || context.pendingStoreJoin
  ) return null;

  return '/dashboard';
}

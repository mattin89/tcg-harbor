export type RecoverableAuthActionV2 = 'sign_in' | 'sign_out';
export type RecoverableAuthPhaseV2 = 'signed-out' | 'ready';

export function authFailurePhaseV2(
  action: RecoverableAuthActionV2,
  hadAuthenticatedSnapshot: boolean,
): RecoverableAuthPhaseV2 {
  if (action === 'sign_in') return 'signed-out';
  return hadAuthenticatedSnapshot ? 'ready' : 'signed-out';
}

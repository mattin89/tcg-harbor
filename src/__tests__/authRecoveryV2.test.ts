import { describe, expect, it } from 'vitest';
import { authFailurePhaseV2 } from '../domain/authRecoveryV2';

describe('interactive authentication recovery', () => {
  it('returns failed sign-in to the form and failed sign-out to the prior account', () => {
    expect(authFailurePhaseV2('sign_in', false)).toBe('signed-out');
    expect(authFailurePhaseV2('sign_out', true)).toBe('ready');
    expect(authFailurePhaseV2('sign_out', false)).toBe('signed-out');
  });
});

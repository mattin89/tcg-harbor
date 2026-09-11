import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resendConfirmationNoticeV13,
  signupConfirmationNoticeV13,
} from '../production/storeSignupStatusV13';

describe('existing-account store onboarding v13', () => {
  it('keeps signup confirmation status accurate without exposing whether an email exists', () => {
    const notice = signupConfirmationNoticeV13({
      email: 'owner@example.test',
      pendingStoreJoin: false,
      handoffReady: true,
    });

    expect(notice).toContain('If this is a new account, a confirmation link was sent');
    expect(notice).toContain('If the address already belongs to an account');
    expect(notice).toContain('sign in instead');
  });

  it('preserves a pending physical-store invitation through the confirmation handoff', () => {
    expect(signupConfirmationNoticeV13({
      email: 'owner@example.test',
      pendingStoreJoin: true,
      handoffReady: true,
    })).toContain('waiting for up to 15 minutes');
  });

  it('does not promise that a resend was delivered to an existing confirmed account', () => {
    const notice = resendConfirmationNoticeV13('owner@example.test');
    expect(notice).toContain('unconfirmed account');
    expect(notice).toContain('already confirmed');
  });

  it('lets an authenticated player register a store without creating a duplicate identity', () => {
    const source = readFileSync(new URL('../ProductionApp_v2.tsx', import.meta.url), 'utf8');

    expect(source).toContain("identity.profile.accountKind === 'player'");
    expect(source).toContain('<StoreApplicationPanel access={access} />');
    expect(source).toContain('storePortal: existingPlayerStorePortal');
  });
});

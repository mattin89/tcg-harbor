export interface SignupConfirmationNoticeInputV13 {
  email: string;
  pendingStoreJoin: boolean;
  handoffReady: boolean;
}

/**
 * Supabase deliberately obscures duplicate signups when email confirmation is
 * enabled. Keep the message accurate for both a new account and an existing
 * confirmed account without turning the signup form into an email-enumeration
 * endpoint.
 */
export function signupConfirmationNoticeV13(input: SignupConfirmationNoticeInputV13): string {
  const delivery = `Check ${input.email}. If this is a new account, a confirmation link was sent. If the address already belongs to an account, no new email is sent—sign in instead.`;
  if (!input.pendingStoreJoin) return delivery;
  return input.handoffReady
    ? `${delivery} This store invitation will be waiting for up to 15 minutes.`
    : `${delivery} Keep this tab open, or scan the store QR again afterwards.`;
}

export function resendConfirmationNoticeV13(email: string): string {
  return `If ${email} belongs to an unconfirmed account, another confirmation email was requested. If it is already confirmed, sign in instead.`;
}

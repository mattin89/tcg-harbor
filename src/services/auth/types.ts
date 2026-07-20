import type { DemoAdapterUnsubscribe, DemoSessionRecord } from "../demo/types";
import type { LivePricingProviderId, QuoteCurrency } from "../pricing/types";

export type DemoUserRole = "collector" | "store-admin" | "community-moderator" | "platform-admin";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  role: DemoUserRole;
  primaryMarket: LivePricingProviderId;
  preferredCurrency: QuoteCurrency;
  approximateLocation: string | null;
  onboardingComplete: boolean;
  isDemoAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AuthSession = DemoSessionRecord<AuthUser>;

export interface SignInInput {
  email: string;
  password: string;
}

export interface SignUpInput extends SignInInput {
  username: string;
}

export interface AuthProfileUpdate {
  username?: string;
  avatarUrl?: string | null;
  primaryMarket?: LivePricingProviderId;
  preferredCurrency?: QuoteCurrency;
  approximateLocation?: string | null;
  onboardingComplete?: boolean;
}

export interface PasswordResetRequestResult {
  accepted: true;
  delivery: "demo-only";
  message: string;
}

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  signIn(input: SignInInput): Promise<AuthSession>;
  signUp(input: SignUpInput): Promise<AuthSession>;
  signOut(): Promise<void>;
  updateProfile(update: AuthProfileUpdate): Promise<AuthUser>;
  requestPasswordReset(email: string): Promise<PasswordResetRequestResult>;
  onSessionChange(listener: (session: AuthSession | null) => void): DemoAdapterUnsubscribe;
}

export type DemoAuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "EMAIL_IN_USE"
  | "NO_SESSION"
  | "VALIDATION_ERROR";

export class DemoAuthError extends Error {
  constructor(
    readonly code: DemoAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DemoAuthError";
  }
}


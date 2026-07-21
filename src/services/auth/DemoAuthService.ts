import type { DemoDataAdapter } from "../demo/types";
import type {
  AuthProfileUpdate,
  AuthService,
  AuthSession,
  AuthUser,
  PasswordResetRequestResult,
  SignInInput,
  SignUpInput,
} from "./types";
import { DemoAuthError } from "./types";

interface DemoCredentialRecord {
  user: AuthUser;
  passwordSalt: string;
  passwordDigest: string;
}

const CREDENTIALS_KEY = "auth.credentials";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): void {
  if (!/^\S+@\S+\.\S+$/.test(normalizeEmail(email))) {
    throw new DemoAuthError("VALIDATION_ERROR", "Enter a valid email address.");
  }
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new DemoAuthError("VALIDATION_ERROR", "Password must contain at least 8 characters.");
  }
}

function randomId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function digestDemoPassword(password: string, salt: string): Promise<string> {
  const value = `${salt}:${password}`;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  // Compatibility fallback for a local demo runtime only; this is not secure auth.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `demo-fnv-${(hash >>> 0).toString(16)}`;
}

function publicUser(record: DemoCredentialRecord): AuthUser {
  return { ...record.user };
}

/**
 * Offline demo auth with persistent browser sessions. It is intentionally not a
 * substitute for server-authenticated sessions, HttpOnly cookies, or RLS.
 */
export class DemoAuthService implements AuthService {
  constructor(private readonly adapter: DemoDataAdapter) {}

  async getSession(): Promise<AuthSession | null> {
    const session = await this.adapter.getSession<AuthUser>();
    if (!session) return null;
    if (!Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
      await this.adapter.clearSession();
      return null;
    }
    return session;
  }

  async signIn(input: SignInInput): Promise<AuthSession> {
    const email = normalizeEmail(input.email);
    const records = (await this.adapter.read<DemoCredentialRecord[]>(CREDENTIALS_KEY)) ?? [];
    const record = records.find((candidate) => candidate.user.email === email);
    if (!record) throw new DemoAuthError("INVALID_CREDENTIALS", "Email or password is incorrect.");

    const digest = await digestDemoPassword(input.password, record.passwordSalt);
    if (digest !== record.passwordDigest) {
      throw new DemoAuthError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    }

    return this.createSession(publicUser(record));
  }

  async signUp(input: SignUpInput): Promise<AuthSession> {
    validateEmail(input.email);
    validatePassword(input.password);
    const username = input.username.trim();
    if (username.length < 2 || username.length > 32) {
      throw new DemoAuthError("VALIDATION_ERROR", "Username must be between 2 and 32 characters.");
    }

    const email = normalizeEmail(input.email);
    const passwordSalt = randomId("salt");
    const passwordDigest = await digestDemoPassword(input.password, passwordSalt);
    const now = new Date().toISOString();
    const user: AuthUser = {
      id: randomId("user"),
      email,
      username,
      avatarUrl: null,
      role: "collector",
      primaryMarket: "cardmarket",
      preferredCurrency: "EUR",
      approximateLocation: null,
      onboardingComplete: false,
      isDemoAccount: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.adapter.update<DemoCredentialRecord[]>(CREDENTIALS_KEY, (current) => {
      const records = current ?? [];
      if (records.some((record) => record.user.email === email)) {
        throw new DemoAuthError("EMAIL_IN_USE", "An account with this email already exists.");
      }
      return [...records, { user, passwordSalt, passwordDigest }];
    });

    return this.createSession(user);
  }

  async signOut(): Promise<void> {
    await this.adapter.clearSession();
  }

  async updateProfile(update: AuthProfileUpdate): Promise<AuthUser> {
    const session = await this.getSession();
    if (!session) throw new DemoAuthError("NO_SESSION", "Sign in before updating your profile.");

    if (update.username !== undefined) {
      const length = update.username.trim().length;
      if (length < 2 || length > 32) {
        throw new DemoAuthError("VALIDATION_ERROR", "Username must be between 2 and 32 characters.");
      }
    }

    let updatedUser: AuthUser | null = null;
    await this.adapter.update<DemoCredentialRecord[]>(CREDENTIALS_KEY, (current) =>
      (current ?? []).map((record) => {
        if (record.user.id !== session.userId) return record;
        updatedUser = {
          ...record.user,
          ...update,
          username: update.username?.trim() ?? record.user.username,
          updatedAt: new Date().toISOString(),
        };
        return { ...record, user: updatedUser } as DemoCredentialRecord;
      }),
    );

    if (!updatedUser) throw new DemoAuthError("NO_SESSION", "The signed-in demo user no longer exists.");
    await this.adapter.setSession({ ...session, user: updatedUser });
    return updatedUser;
  }

  async requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
    validateEmail(email);
    return {
      accepted: true,
      delivery: "demo-only",
      message: "Demo reset request recorded. No email is sent by the local adapter.",
    };
  }

  onSessionChange(listener: (session: AuthSession | null) => void) {
    return this.adapter.subscribeToSession<AuthUser>(listener);
  }

  private async createSession(user: AuthUser): Promise<AuthSession> {
    const createdAt = new Date().toISOString();
    const session: AuthSession = {
      id: randomId("session"),
      userId: user.id,
      user,
      createdAt,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    };
    await this.adapter.setSession(session);
    return session;
  }
}

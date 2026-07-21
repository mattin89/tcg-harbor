import { useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import type { ProductionAccessController } from "./useProductionAccess";
import type { AccountKind } from "./types";

type AuthMode = "sign-in" | "sign-up" | "reset";

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  placeholder,
  required = true,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="production-field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
      />
    </label>
  );
}

export function ProductionAuthPanel({
  access,
  pendingStoreJoin = false,
  onEmailConfirmationHandoff,
  onCancelPendingStoreJoin,
}: {
  access: ProductionAccessController;
  pendingStoreJoin?: boolean;
  onEmailConfirmationHandoff?: () => boolean;
  onCancelPendingStoreJoin?: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [accountKind, setAccountKind] = useState<AccountKind>("player");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (access.passwordRecovery) {
    return (
      <AuthShell title="Choose a new password" detail="Your recovery link is verified. Set a new password to secure your account.">
        <form className="production-form" onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const password = String(data.get("password") ?? "");
          setBusy(true);
          try {
            await access.updatePassword(password);
            setNotice("Password updated. You can continue to TCG Harbor.");
          } catch {
            // The controller exposes a safe message through access.error.
          } finally {
            setBusy(false);
          }
        }}>
          <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={12} />
          <AuthError message={access.error} />
          {notice && <p className="production-notice production-notice-success" role="status"><Icon name="check" size={16} />{notice}</p>}
          <button className="production-primary" type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
        </form>
      </AuthShell>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    access.clearError();
    setNotice(null);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    setBusy(true);
    try {
      if (mode === "sign-in") {
        await access.signIn(email, String(data.get("password") ?? ""));
      } else if (mode === "reset") {
        await access.requestPasswordReset(email);
        setNotice("If that email belongs to an account, a secure reset link is on its way.");
      } else {
        const result = await access.signUp({
          email,
          password: String(data.get("password") ?? ""),
          username: String(data.get("username") ?? "").trim(),
          displayName: String(data.get("displayName") ?? "").trim(),
          accountKind,
          emailRedirectPath: pendingStoreJoin ? "/join/store" : "/",
        });
        if (result.emailConfirmationRequired) {
          const handoffReady = !pendingStoreJoin || Boolean(onEmailConfirmationHandoff?.());
          setNotice(handoffReady
            ? "Check your inbox to confirm your email. This invitation will be waiting for up to 15 minutes."
            : "Check your inbox to confirm your email. Keep this tab open, or scan the store QR again afterwards.");
          setMode("sign-in");
        }
      }
    } catch {
      // The controller exposes a safe message through access.error.
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "sign-in" ? "Welcome aboard" : mode === "sign-up" ? "Create your harbor account" : "Reset your password";
  const detail = mode === "sign-in"
    ? pendingStoreJoin
      ? "Sign in to securely accept this physical store's community invitation."
      : "Sign in to access your collection, community, and store tools."
    : mode === "sign-up"
      ? "Start as a player or apply to run a verified store community."
      : "We will email you a secure link to choose a new password.";

  return (
    <AuthShell title={title} detail={detail}>
      {pendingStoreJoin && <div className="production-pending-join" role="status"><Icon name="qr" size={18} /><span><strong>Store invitation ready</strong><small>This QR will be validated after you sign in. You will choose whether to join before membership is created.</small></span>{onCancelPendingStoreJoin && <button type="button" onClick={onCancelPendingStoreJoin}>Cancel</button>}</div>}
      {mode === "sign-up" && (
        <fieldset className="production-account-choice">
          <legend>I am joining as</legend>
          <label className={accountKind === "player" ? "is-selected" : ""}>
            <input type="radio" name="accountKind" value="player" checked={accountKind === "player"} onChange={() => setAccountKind("player")} />
            <Icon name="cards" size={22} />
            <span><strong>Player</strong><small>Collection, prices, trades, maps and chats</small></span>
          </label>
          <label className={accountKind === "store" ? "is-selected" : ""}>
            <input type="radio" name="accountKind" value="store" checked={accountKind === "store"} onChange={() => setAccountKind("store")} />
            <Icon name="store" size={22} />
            <span><strong>Store</strong><small>Player tools plus a verified store workspace</small></span>
          </label>
          {accountKind === "store" && <p><Icon name="shield" size={15} />Choosing store starts an application. Store permissions are granted only after platform approval.</p>}
        </fieldset>
      )}

      <form className="production-form" onSubmit={submit}>
        {mode === "sign-up" && <>
          <Field label="Username" name="username" autoComplete="username" placeholder="harbor_player" minLength={3} />
          <Field label="Display name" name="displayName" autoComplete="name" placeholder="How others see you" required={false} />
        </>}
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
        {mode !== "reset" && <Field label="Password" name="password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} minLength={12} />}
        <AuthError message={access.error} />
        {notice && <p className="production-notice production-notice-success" role="status"><Icon name="check" size={16} />{notice}</p>}
        <button className="production-primary" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : "Send reset link"}
        </button>
      </form>

      <div className="production-auth-links">
        {mode === "sign-in" && <>
          <button type="button" onClick={() => { setMode("sign-up"); setNotice(null); access.clearError(); }}>Create an account</button>
          <button type="button" onClick={() => { setMode("reset"); setNotice(null); access.clearError(); }}>Forgot password?</button>
        </>}
        {mode !== "sign-in" && <button type="button" onClick={() => { setMode("sign-in"); setNotice(null); access.clearError(); }}>Back to sign in</button>}
      </div>
    </AuthShell>
  );
}

function AuthShell({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <main className="production-auth-page">
      <section className="production-auth-card">
        <div className="production-brand-mark"><Icon name="cards" size={26} /></div>
        <p className="production-eyebrow">TCG Harbor</p>
        <h1>{title}</h1>
        <p className="production-auth-detail">{detail}</p>
        {children}
        <p className="production-security-note"><Icon name="lock" size={14} />Accounts are protected by Supabase Auth and database row-level security.</p>
      </section>
    </main>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="production-notice production-notice-error" role="alert"><Icon name="info" size={16} />{message}</p>;
}

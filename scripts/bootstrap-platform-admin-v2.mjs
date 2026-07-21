import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const CONFIRMATION = "CREATE_TCG_HARBOR_PLATFORM_ADMIN";

function required(name, fallback) {
  const value = String(process.env[name] ?? fallback ?? "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function safeUsername(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 30);
  return normalized.length >= 3 ? normalized : "platform_admin";
}

function temporaryPassword() {
  const supplied = String(process.env.ADMIN_TEMP_PASSWORD ?? "");
  if (supplied) {
    if (
      supplied.length < 12
      || !/[a-z]/.test(supplied)
      || !/[A-Z]/.test(supplied)
      || !/\d/.test(supplied)
      || !/[^A-Za-z0-9]/.test(supplied)
    ) {
      throw new Error("ADMIN_TEMP_PASSWORD must contain 12+ characters with upper, lower, number, and symbol.");
    }
    return supplied;
  }
  return `${randomBytes(24).toString("base64url")}!Aa9`;
}

function assertServerSecret(value) {
  if (value.startsWith("sb_publishable_")) {
    throw new Error("A publishable key cannot create an administrator. Use a server-only Supabase secret key.");
  }
  if (!value.startsWith("eyJ")) return;
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1] ?? "", "base64url").toString("utf8"));
    if (payload.role !== "service_role") {
      throw new Error("The legacy JWT is not a service-role key.");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "The legacy JWT is not a service-role key.") throw error;
    throw new Error("The supplied legacy Supabase key is malformed.");
  }
}

async function main() {
  if (process.env.BOOTSTRAP_ADMIN_CONFIRM !== CONFIRMATION) {
    throw new Error(`Set BOOTSTRAP_ADMIN_CONFIRM=${CONFIRMATION} to authorize this one-time account creation.`);
  }

  const supabaseUrl = required("SUPABASE_URL");
  const secretKey = required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  const email = required("ADMIN_EMAIL").toLowerCase();
  const displayName = String(process.env.ADMIN_DISPLAY_NAME ?? "Platform Administrator").trim() || "Platform Administrator";
  const username = safeUsername(process.env.ADMIN_USERNAME ?? "platform_admin");
  const password = temporaryPassword();

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)) {
    throw new Error("SUPABASE_URL must be the HTTPS URL of a hosted Supabase project.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAIL must be a deliverable email address.");
  }
  assertServerSecret(secretKey);

  const supabase = createClient(supabaseUrl.replace(/\/$/, ""), secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      display_name: displayName,
      account_kind: "player",
    },
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? "Supabase did not return the created user.");
  }

  // Authorization is deliberately NOT assigned here. Promote this exact UUID
  // through `supabase db query --linked` only after account creation succeeds.
  process.stdout.write(JSON.stringify({
    userId: data.user.id,
    email,
    temporaryPassword: password,
    username,
    displayName,
    emailConfirmed: Boolean(data.user.email_confirmed_at),
    requiresPlatformRolePromotion: true,
    passwordMustBeChanged: true,
  }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Admin bootstrap failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

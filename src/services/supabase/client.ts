import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isBrowserSafeSupabaseKeyV3, supabaseAuthStorageKeyV3 } from "./authSessionIsolationV3";

export interface SupabaseRuntimeConfig {
  url: string | null;
  anonKey: string | null;
  configured: boolean;
}

function readEnvironmentValue(name: "VITE_SUPABASE_URL" | "VITE_SUPABASE_PUBLISHABLE_KEY" | "VITE_SUPABASE_ANON_KEY"): string | null {
  const value = import.meta.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getSupabaseRuntimeConfig(): SupabaseRuntimeConfig {
  const url = readEnvironmentValue("VITE_SUPABASE_URL");
  const configuredKey = readEnvironmentValue("VITE_SUPABASE_PUBLISHABLE_KEY")
    ?? readEnvironmentValue("VITE_SUPABASE_ANON_KEY");
  const anonKey = configuredKey && isBrowserSafeSupabaseKeyV3(configuredKey) ? configuredKey : null;
  return { url, anonKey, configured: Boolean(url && anonKey) };
}

export const isProductionSupabaseConfigured = getSupabaseRuntimeConfig().configured;

let singleton: SupabaseClient | null | undefined;

/**
 * Returns null when production credentials are absent so the production access
 * gate can fail closed instead of silently substituting a local identity.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (singleton !== undefined) return singleton;

  const config = getSupabaseRuntimeConfig();
  if (!config.configured || !config.url || !config.anonKey) {
    singleton = null;
    return singleton;
  }

  singleton = createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      persistSession: true,
      storageKey: supabaseAuthStorageKeyV3(config.url),
    },
  });

  return singleton;
}

/**
 * Secrets for Cardmarket/TCGPlayer belong in server-only routes or functions.
 * This runtime guard catches the most damaging integration mistake: passing a
 * credential into code that Vite executes in a browser.
 */
export function assertServerOnlyCredentials(
  providerName: string,
  credentials: Readonly<Record<string, string | undefined>> | undefined,
): void {
  if (!credentials) return;
  const hasSecret = Object.values(credentials).some((value) => Boolean(value?.trim()));
  if (hasSecret && typeof window !== "undefined") {
    throw new Error(`${providerName} credentials must never be constructed or used in a browser runtime.`);
  }
}


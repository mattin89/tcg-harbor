import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260726164054_store_signup_onboarding_details.sql", import.meta.url),
  "utf8",
);

describe("store signup onboarding migration v12", () => {
  it("persists private store details from Auth metadata without granting capabilities", () => {
    for (const column of [
      "store_signup_name",
      "store_signup_address_line_1",
      "store_signup_city",
      "store_signup_postcode",
      "store_signup_country_code",
      "store_signup_website_url",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toMatch(/create or replace function public\.handle_new_auth_user\(\)/i);
    expect(migration).toMatch(/new\.raw_user_meta_data\s*->>\s*'store_name'/i);
    expect(migration).toMatch(/Never use for authorization or public discovery/i);
    expect(migration).not.toMatch(/insert into public\.store_administrators/i);
    expect(migration).not.toMatch(/array_append[\s\S]*store_administrator/i);
  });

  it("keeps the trigger function out of the public API", () => {
    expect(migration).toMatch(/revoke execute on function public\.handle_new_auth_user\(\) from public, anon, authenticated/i);
  });
});

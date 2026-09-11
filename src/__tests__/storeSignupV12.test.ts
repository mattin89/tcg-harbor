import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseProductionAccess } from "../production/supabaseProductionAccess";
import { storeSignupMetadataV12 } from "../production/storeSignupV12";

describe("store signup details v12", () => {
  it("normalizes the required physical-store details and optional website", () => {
    expect(storeSignupMetadataV12({
      storeName: "  Test   Dresden Community ",
      addressLine1: " An der Frauenkirche 1 ",
      city: " Dresden ",
      postcode: " 01067 ",
      countryCode: " de ",
      websiteUrl: "https://example.com/store",
    })).toEqual({
      store_name: "Test Dresden Community",
      store_address_line_1: "An der Frauenkirche 1",
      store_city: "Dresden",
      store_postcode: "01067",
      store_country_code: "DE",
      store_website_url: "https://example.com/store",
    });
  });

  it("sends the normalized store details to Supabase Auth metadata", async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
    const client = { auth: { signUp } } as unknown as SupabaseClient;

    await new SupabaseProductionAccess(client).signUp({
      email: "store@example.test",
      password: "Strong-password-42!",
      username: "dresden_store",
      accountKind: "store",
      storeDetails: {
        storeName: " Test Dresden Community ",
        addressLine1: " An der Frauenkirche 1 ",
        city: "Dresden",
        postcode: "01067",
        countryCode: "de",
      },
    });

    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        data: expect.objectContaining({
          account_kind: "store",
          store_name: "Test Dresden Community",
          store_address_line_1: "An der Frauenkirche 1",
          store_country_code: "DE",
        }),
      }),
    }));
  });

  it("uses Supabase's signup resend flow", async () => {
    const resend = vi.fn().mockResolvedValue({ error: null });
    const client = { auth: { resend } } as unknown as SupabaseClient;

    await new SupabaseProductionAccess(client).resendSignUpConfirmation("store@example.test", "/");

    expect(resend).toHaveBeenCalledWith({
      type: "signup",
      email: "store@example.test",
      options: { emailRedirectTo: undefined },
    });
  });

  it("allows a store to register without a website", () => {
    expect(storeSignupMetadataV12({
      storeName: "Card Harbor",
      addressLine1: "Hauptstrasse 10",
      city: "Dresden",
      postcode: "01097",
      countryCode: "DE",
      websiteUrl: " ",
    })).not.toHaveProperty("store_website_url");
  });

  it.each([
    ["http website", { websiteUrl: "http://example.com" }, "public HTTPS"],
    ["credentialed website", { websiteUrl: "https://user:pass@example.com" }, "public HTTPS"],
    ["invalid country", { countryCode: "Germany" }, "two letters"],
    ["missing address", { addressLine1: " " }, "Store address"],
  ])("rejects %s", (_label, override, expected) => {
    expect(() => storeSignupMetadataV12({
      storeName: "Card Harbor",
      addressLine1: "Hauptstrasse 10",
      city: "Dresden",
      postcode: "01097",
      countryCode: "DE",
      ...override,
    })).toThrow(expected);
  });
});

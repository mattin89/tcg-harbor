import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SupabaseProductionAccess } from "../production/supabaseProductionAccess";

describe("storeSignupAutoApplication", () => {
  const sampleApplicationRow = {
    id: "app-123",
    applicant_user_id: "user-456",
    status: "pending",
    store_name: "Man of Games",
    contact_name: "Man of Games",
    contact_email: "info@man-of-games.de",
    phone: null,
    website_url: "https://www.man-of-games.de/",
    address_line_1: "Paradiesstr. 42",
    address_line_2: null,
    city: "Dresden",
    region: null,
    postcode: "01217",
    country_code: "DE",
    latitude: 51.023841,
    longitude: 13.743766,
    timezone: "Europe/Berlin",
    applicant_note: null,
    evidence_url: null,
    reviewer_id: null,
    review_note: null,
    reviewed_at: null,
    approved_store_id: null,
    submitted_at: "2026-09-15T11:37:54.000Z",
    created_at: "2026-09-15T11:37:54.000Z",
    updated_at: "2026-09-15T11:37:54.000Z",
    applicant_username: "manofgamesde",
  };

  it("lists all applications with full history via platform_admin_list_applications", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [sampleApplicationRow],
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    const applications = await access.listAllApplications();

    expect(rpc).toHaveBeenCalledWith("platform_admin_list_applications");
    expect(applications).toHaveLength(1);
    expect(applications[0].storeName).toBe("Man of Games");
    expect(applications[0].status).toBe("pending");
    expect(applications[0].applicant?.username).toBe("manofgamesde");
  });

  it("falls back to store_applications select if RPC is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("RPC not found"),
    });
    const order = vi.fn().mockResolvedValue({
      data: [sampleApplicationRow],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ order });
    const from = vi.fn().mockReturnValue({ select });
    const client = { rpc, from } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    const applications = await access.listAllApplications();

    expect(from).toHaveBeenCalledWith("store_applications");
    expect(select).toHaveBeenCalledWith("*");
    expect(applications).toHaveLength(1);
    expect(applications[0].storeName).toBe("Man of Games");
  });

  it("verifies migration safeguards prevent deletion and auto-create store application on signup", () => {
    const migrationPath = resolve(
      process.cwd(),
      "supabase/migrations/20260916143000_auto_store_application_and_history.sql"
    );
    const sql = readFileSync(migrationPath, "utf-8");

    expect(sql).toContain("create or replace function public.prevent_store_application_deletion()");
    expect(sql).toContain("before delete on public.store_applications");
    expect(sql).toContain("Store applications cannot be deleted");
    expect(sql).toContain("insert into public.store_applications");
    expect(sql).toContain("platform_admin_list_applications");
  });
});

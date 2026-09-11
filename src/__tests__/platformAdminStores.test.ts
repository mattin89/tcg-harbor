import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseProductionAccess } from "../production/supabaseProductionAccess";
import type { PlatformAdminUpdateStoreDraft } from "../production/types";
import { fitLocations, type StoreMapStore } from "../components/StoreMap";

vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(),
    Popup: vi.fn(),
    Marker: vi.fn(),
  },
}));

describe("platformAdminStores", () => {
  const sampleStoreRow = {
    id: "store-123",
    name: "Dresden TCG Haven",
    slug: "dresden-tcg-haven",
    owner_user_id: "user-abc",
    owner_username: "mario_admin",
    owner_display_name: "Mario Delor",
    address_line_1: "Prager Straße 10",
    address_line_2: "Suite 4B",
    city: "Dresden",
    region: "Saxony",
    postcode: "01069",
    country_code: "DE",
    latitude: 51.0456,
    longitude: 13.7389,
    contact_email: "contact@haven.de",
    phone: "+49 351 123456",
    website_url: "https://haven.de",
    is_active: true,
    is_verified: true,
    created_at: "2026-01-01T10:00:00Z",
    community_id: "comm-456",
    community_name: "Haven Players",
    community_slug: "haven-players",
  };

  it("lists and maps approved stores via platform_admin_list_stores RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [sampleStoreRow],
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    const stores = await access.platformAdminListStores();

    expect(rpc).toHaveBeenCalledWith("platform_admin_list_stores");
    expect(stores).toHaveLength(1);
    expect(stores[0]).toEqual({
      id: "store-123",
      name: "Dresden TCG Haven",
      slug: "dresden-tcg-haven",
      description: null,
      ownerUserId: "user-abc",
      ownerUsername: "mario_admin",
      ownerDisplayName: "Mario Delor",
      addressLine1: "Prager Straße 10",
      addressLine2: "Suite 4B",
      city: "Dresden",
      region: "Saxony",
      postcode: "01069",
      countryCode: "DE",
      latitude: 51.0456,
      longitude: 13.7389,
      timezone: "Europe/Berlin",
      openingHours: {},
      contactEmail: "contact@haven.de",
      phone: "+49 351 123456",
      websiteUrl: "https://haven.de",
      imageUrl: null,
      isActive: true,
      isVerified: true,
      createdAt: "2026-01-01T10:00:00Z",
      communityId: "comm-456",
      communityName: "Haven Players",
    });
  });

  it("handles null and omitted optional fields gracefully in store mapping", async () => {
    const sparseRow = {
      id: "store-sparse",
      name: "Minimal Store",
      slug: "minimal-store",
      owner_user_id: null,
      owner_username: null,
      owner_display_name: null,
      address_line_1: "Altmarkt 1",
      address_line_2: null,
      city: "Dresden",
      region: null,
      postcode: "01067",
      country_code: "DE",
      latitude: "51.0500",
      longitude: "13.7400",
      contact_email: null,
      phone: null,
      website_url: null,
      is_active: true,
      is_verified: true,
      created_at: "2026-01-01T10:00:00Z",
      community_id: null,
      community_name: null,
      community_slug: null,
    };
    const rpc = vi.fn().mockResolvedValue({
      data: [sparseRow],
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    const stores = await access.platformAdminListStores();
    expect(stores[0].ownerUsername).toBeNull();
    expect(stores[0].addressLine2).toBeNull();
    expect(stores[0].latitude).toBe(51.05);
    expect(stores[0].longitude).toBe(13.74);
    expect(stores[0].communityId).toBeNull();
  });

  it("throws a descriptive error if platform_admin_list_stores fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Permission denied: platform_administrator role required" },
    });
    const client = { rpc } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    await expect(access.platformAdminListStores()).rejects.toThrow(
      "Permission denied: platform_administrator role required"
    );
  });

  it("updates store details via platform_admin_update_store RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: sampleStoreRow,
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    const draft: PlatformAdminUpdateStoreDraft = {
      storeId: "store-123",
      name: " Dresden TCG Haven ",
      slug: " dresden-tcg-haven ",
      ownerUsername: " mario_admin ",
      addressLine1: " Prager Straße 10 ",
      addressLine2: " Suite 4B ",
      city: " Dresden ",
      region: " Saxony ",
      postcode: " 01069 ",
      countryCode: " de ",
      latitude: 51.0456,
      longitude: 13.7389,
      contactEmail: " contact@haven.de ",
      phone: " +49 351 123456 ",
      websiteUrl: " https://haven.de ",
    };

    await access.platformAdminUpdateStore(draft);

    expect(rpc).toHaveBeenCalledWith("platform_admin_update_store", {
      p_store_id: "store-123",
      p_name: "Dresden TCG Haven",
      p_slug: "dresden-tcg-haven",
      p_owner_username: "mario_admin",
      p_address_line_1: "Prager Straße 10",
      p_address_line_2: "Suite 4B",
      p_city: "Dresden",
      p_region: "Saxony",
      p_postcode: "01069",
      p_country_code: "DE",
      p_latitude: 51.0456,
      p_longitude: 13.7389,
      p_contact_email: "contact@haven.de",
      p_phone: "+49 351 123456",
      p_website_url: "https://haven.de",
    });
  });

  it("throws error when platform_admin_update_store fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Username "unknown_user" does not exist' },
    });
    const client = { rpc } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    await expect(
      access.platformAdminUpdateStore({
        storeId: "store-123",
        name: "Test",
        slug: "test",
        ownerUsername: "unknown_user",
        addressLine1: "Test",
        addressLine2: null,
        city: "Test",
        region: null,
        postcode: "12345",
        countryCode: "DE",
        latitude: 51,
        longitude: 13,
        contactEmail: null,
        phone: null,
        websiteUrl: null,
      })
    ).rejects.toThrow('Username "unknown_user" does not exist');
  });

  it("deletes an approved store via platform_admin_delete_store RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: true,
      error: null,
    });
    const client = { rpc } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    await access.platformAdminDeleteStore("store-123");

    expect(rpc).toHaveBeenCalledWith("platform_admin_delete_store", {
      p_store_id: "store-123",
    });
  });

  it("throws an error when platform_admin_delete_store fails", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Store not found or already deleted" },
    });
    const client = { rpc } as unknown as SupabaseClient;
    const access = new SupabaseProductionAccess(client);

    await expect(access.platformAdminDeleteStore("store-missing")).rejects.toThrow(
      "Store not found or already deleted"
    );
  });

  describe("StoreMap camera and street zoom", () => {
    it("zooms into street level (zoom: 16) for a single store", () => {
      const easeTo = vi.fn();
      const mockMap = { easeTo, fitBounds: vi.fn() } as unknown as Parameters<typeof fitLocations>[0];

      const location = {
        store: { id: "store-1", name: "Dresden Cards", city: "Dresden", country: "DE", accent: "coral", members: 10, trades: 2, hours: "10-18", address: "Prager Str 1", source: "registered" } as unknown as StoreMapStore,
        coordinates: [13.7389, 51.0456] as [number, number],
        usesFallbackCoordinates: false,
      };

      fitLocations(mockMap, [location]);

      expect(easeTo).toHaveBeenCalledWith(
        expect.objectContaining({
          center: [13.7389, 51.0456],
          zoom: 16,
        })
      );
    });

    it("avoids Atlantic Ocean centering when stores span multiple continents (>15 deg span)", () => {
      const easeTo = vi.fn();
      const fitBounds = vi.fn();
      const mockMap = { easeTo, fitBounds } as unknown as Parameters<typeof fitLocations>[0];

      const dresdenStore = {
        store: { id: "store-de", name: "Dresden Cards", city: "Dresden", country: "DE", accent: "coral", members: 10, trades: 2, hours: "10-18", address: "Prager Str 1", source: "registered" } as unknown as StoreMapStore,
        coordinates: [13.7389, 51.0456] as [number, number],
        usesFallbackCoordinates: false,
      };
      const nycStore = {
        store: { id: "store-us", name: "NYC TCG", city: "New York", country: "US", accent: "azure", members: 20, trades: 5, hours: "11-20", address: "Broadway 100", source: "registered" } as unknown as StoreMapStore,
        coordinates: [-74.006, 40.7128] as [number, number],
        usesFallbackCoordinates: false,
      };

      // Longitudinal span: |13.7389 - (-74.006)| = 87.74 degrees (> 15 deg)
      fitLocations(mockMap, [dresdenStore, nycStore]);

      // Must NOT fit bounds across the Atlantic Ocean
      expect(fitBounds).not.toHaveBeenCalled();
      // Must center on the primary cluster instead
      expect(easeTo).toHaveBeenCalledWith(
        expect.objectContaining({
          center: [13.7389, 51.0456],
          zoom: 13.5,
        })
      );
    });

    it("uses fitBounds for local store clusters within 15 degrees", () => {
      const easeTo = vi.fn();
      const fitBounds = vi.fn();
      const mockMap = { easeTo, fitBounds } as unknown as Parameters<typeof fitLocations>[0];

      const storeA = {
        store: { id: "store-a", name: "Altstadt Cards", city: "Dresden", country: "DE", accent: "coral", members: 10, trades: 2, hours: "10-18", address: "Prager Str 1", source: "registered" } as unknown as StoreMapStore,
        coordinates: [13.7389, 51.0456] as [number, number],
        usesFallbackCoordinates: false,
      };
      const storeB = {
        store: { id: "store-b", name: "Neustadt Cards", city: "Dresden", country: "DE", accent: "gold", members: 15, trades: 3, hours: "10-20", address: "Alaunstr 12", source: "registered" } as unknown as StoreMapStore,
        coordinates: [13.7521, 51.0673] as [number, number],
        usesFallbackCoordinates: false,
      };

      fitLocations(mockMap, [storeA, storeB]);

      expect(easeTo).not.toHaveBeenCalled();
      expect(fitBounds).toHaveBeenCalledWith(
        [
          [13.7389, 51.0456],
          [13.7521, 51.0673],
        ],
        expect.objectContaining({ padding: 72, maxZoom: 13.5 })
      );
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  mapPublicStoreRowV4,
  PUBLIC_STORE_PAGE_SIZE_V4,
  PublicStoreDirectoryRepositoryV4,
} from '../services/supabase/usePublicStoreDirectoryV4';

function publicStoreRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'store-1',
    slug: 'harbor-dresden',
    name: 'Harbor Dresden',
    address_line_1: 'Altmarkt 1',
    address_line_2: null,
    city: 'Dresden',
    region: 'Saxony',
    postcode: '01067',
    country_code: 'DE',
    latitude: '51.0504',
    longitude: 13.7373,
    opening_hours: { saturday: ['10:00', '18:00'] },
    website_url: 'https://example.test',
    image_url: 'https://example.test/store.jpg',
    is_verified: true,
    is_active: true,
    deleted_at: null,
    ...overrides,
  };
}

function publicStoreClient(pages: unknown[][]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockImplementation((pageStart: number) => Promise.resolve({
    data: pages[Math.floor(pageStart / PUBLIC_STORE_PAGE_SIZE_V4)] ?? [],
    error: null,
  }));

  const getUser = vi.fn();
  const from = vi.fn().mockReturnValue(query);
  const client = { from, auth: { getUser } } as unknown as SupabaseClient;
  return { client, from, getUser, query };
}

describe('public store directory v4', () => {
  it('loads only approved, active, non-deleted stores without touching auth', async () => {
    const { client, from, getUser, query } = publicStoreClient([[publicStoreRow()]]);

    const stores = await new PublicStoreDirectoryRepositoryV4(client).list();

    expect(from).toHaveBeenCalledWith('stores');
    expect(query.eq.mock.calls).toEqual([
      ['is_verified', true],
      ['is_active', true],
    ]);
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.order.mock.calls).toEqual([
      ['name', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(query.range).toHaveBeenCalledWith(0, PUBLIC_STORE_PAGE_SIZE_V4 - 1);
    expect(getUser).not.toHaveBeenCalled();
    expect(stores).toHaveLength(1);
    expect(stores[0]).toMatchObject({
      name: 'Harbor Dresden',
      city: 'Dresden',
      latitude: 51.0504,
      longitude: 13.7373,
    });
  });

  it('never requests or maps private store contact fields', async () => {
    const row = publicStoreRow({
      contact_email: 'private@example.test',
      phone: '+49 000 000000',
    });
    const { client, query } = publicStoreClient([[row]]);

    const [store] = await new PublicStoreDirectoryRepositoryV4(client).list();
    const selectedColumns = String(query.select.mock.calls[0]?.[0]);

    expect(selectedColumns).not.toContain('contact_email');
    expect(selectedColumns).not.toMatch(/\bphone\b/);
    expect(store.contactEmail).toBeNull();
    expect(store.phone).toBeNull();
  });

  it('continues after a full page and stops after the first short page', async () => {
    const firstPage = Array.from({ length: PUBLIC_STORE_PAGE_SIZE_V4 }, (_, index) => publicStoreRow({
      id: `store-${String(index).padStart(4, '0')}`,
      slug: `store-${String(index).padStart(4, '0')}`,
      name: `Store ${String(index).padStart(4, '0')}`,
    }));
    const finalPage = [publicStoreRow({
      id: 'store-final',
      slug: 'store-final',
      name: 'Store final',
    })];
    const { client, from, query } = publicStoreClient([firstPage, finalPage]);

    const stores = await new PublicStoreDirectoryRepositoryV4(client).list();

    expect(stores).toHaveLength(PUBLIC_STORE_PAGE_SIZE_V4 + 1);
    expect(stores.at(-1)?.id).toBe('store-final');
    expect(from).toHaveBeenCalledTimes(2);
    expect(query.range.mock.calls).toEqual([
      [0, PUBLIC_STORE_PAGE_SIZE_V4 - 1],
      [PUBLIC_STORE_PAGE_SIZE_V4, (PUBLIC_STORE_PAGE_SIZE_V4 * 2) - 1],
    ]);
    expect(query.order.mock.calls).toEqual([
      ['name', { ascending: true }],
      ['id', { ascending: true }],
      ['name', { ascending: true }],
      ['id', { ascending: true }],
    ]);
  });

  it.each([
    { is_verified: false },
    { is_active: false },
    { deleted_at: '2026-07-21T00:00:00.000Z' },
  ])('fails closed if an unsafe row reaches the mapper: %o', (override) => {
    expect(() => mapPublicStoreRowV4(publicStoreRow(override)))
      .toThrow(/not approved and active/i);
  });
});

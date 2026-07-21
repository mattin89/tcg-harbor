import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegisteredStore } from '../../production/types';
import { getSupabaseClient } from './client';

type PublicStoreRowV4 = {
  id: string;
  slug: string;
  name: string;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  region: string | null;
  postcode: string;
  country_code: string;
  latitude: number | string;
  longitude: number | string;
  opening_hours: unknown;
  website_url: string | null;
  image_url: string | null;
  is_verified: boolean;
  is_active: boolean;
  deleted_at: string | null;
};

const PUBLIC_STORE_COLUMNS_V4 = `
  id, slug, name, address_line_1, address_line_2, city, region, postcode,
  country_code, latitude, longitude, opening_hours, website_url, image_url,
  is_verified, is_active, deleted_at
`;

export const PUBLIC_STORE_PAGE_SIZE_V4 = 1_000;

function publicStoreErrorV4(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'The approved store directory is temporarily unavailable.';
}

function publicRecordV4(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredTextV4(row: PublicStoreRowV4, key: keyof PublicStoreRowV4): string {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Public store directory returned an invalid ${String(key)} value.`);
  }
  return value;
}

function optionalTextV4(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function mapPublicStoreRowV4(row: PublicStoreRowV4): RegisteredStore {
  if (!row.is_verified || !row.is_active || row.deleted_at !== null) {
    throw new Error('Public store directory returned a store that is not approved and active.');
  }

  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('Public store directory returned invalid map coordinates.');
  }

  return {
    id: requiredTextV4(row, 'id'),
    slug: requiredTextV4(row, 'slug'),
    name: requiredTextV4(row, 'name'),
    addressLine1: requiredTextV4(row, 'address_line_1'),
    addressLine2: optionalTextV4(row.address_line_2),
    city: requiredTextV4(row, 'city'),
    region: optionalTextV4(row.region),
    postcode: requiredTextV4(row, 'postcode'),
    countryCode: requiredTextV4(row, 'country_code'),
    latitude,
    longitude,
    openingHours: publicRecordV4(row.opening_hours),
    contactEmail: null,
    phone: null,
    websiteUrl: optionalTextV4(row.website_url),
    imageUrl: optionalTextV4(row.image_url),
  };
}

export class PublicStoreDirectoryRepositoryV4 {
  constructor(private readonly client: SupabaseClient) {}

  async list(): Promise<RegisteredStore[]> {
    const stores: RegisteredStore[] = [];

    for (let pageStart = 0; ; pageStart += PUBLIC_STORE_PAGE_SIZE_V4) {
      const { data, error } = await this.client
        .from('stores')
        .select(PUBLIC_STORE_COLUMNS_V4)
        .eq('is_verified', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name', { ascending: true })
        .order('id', { ascending: true })
        .range(pageStart, pageStart + PUBLIC_STORE_PAGE_SIZE_V4 - 1);

      if (error) throw new Error(`Load public store directory: ${error.message}`);

      const rows = (data ?? []) as PublicStoreRowV4[];
      stores.push(...rows.map(mapPublicStoreRowV4));
      if (rows.length < PUBLIC_STORE_PAGE_SIZE_V4) return stores;
    }
  }
}

export interface PublicStoreDirectoryRuntimeV4 {
  stores: RegisteredStore[];
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

export function usePublicStoreDirectoryV4(): PublicStoreDirectoryRuntimeV4 {
  const client = useMemo(() => getSupabaseClient(), []);
  const repository = useMemo(
    () => client ? new PublicStoreDirectoryRepositoryV4(client) : null,
    [client],
  );
  const [stores, setStores] = useState<RegisteredStore[]>([]);
  const [loading, setLoading] = useState(Boolean(repository));
  const [error, setError] = useState<string | null>(
    repository ? null : 'The account service is not configured, so stores cannot be loaded.',
  );

  const refresh = useCallback(async () => {
    if (!repository) return;
    setLoading(true);
    setError(null);
    try {
      setStores(await repository.list());
    } catch (nextError) {
      setStores([]);
      setError(publicStoreErrorV4(nextError));
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => {
    let active = true;
    if (!repository) return;
    setLoading(true);
    repository.list()
      .then((nextStores) => {
        if (!active) return;
        setStores(nextStores);
        setError(null);
      })
      .catch((nextError) => {
        if (!active) return;
        setStores([]);
        setError(publicStoreErrorV4(nextError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [repository]);

  return { stores, loading, error, refresh };
}

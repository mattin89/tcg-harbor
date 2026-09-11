export interface StoreAddressQuery {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postcode?: string;
  countryCode?: string;
}

export interface StoreGeocodedLocation {
  latitude: number;
  longitude: number;
  displayName: string;
  road?: string;
  city?: string;
  postcode?: string;
  countryCode?: string;
}

export interface StoreReverseGeocodedLocation {
  latitude: number;
  longitude: number;
  displayName: string;
  road?: string;
  city?: string;
  postcode?: string;
  countryCode?: string;
}

export function isValidLatitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function buildAddressSearchQuery(query: StoreAddressQuery): string {
  const parts: string[] = [];
  if (query.addressLine1?.trim()) parts.push(query.addressLine1.trim());
  if (query.postcode?.trim()) parts.push(query.postcode.trim());
  if (query.city?.trim()) parts.push(query.city.trim());
  if (query.countryCode?.trim()) parts.push(query.countryCode.trim());
  return parts.join(', ');
}

// In-memory caching for repeated lookups
const geocodeCache = new Map<string, StoreGeocodedLocation | null>();
const reverseCache = new Map<string, StoreReverseGeocodedLocation | null>();

/**
 * Geocodes an address into latitude and longitude coordinates using OpenStreetMap Nominatim.
 * Returns null if the address cannot be resolved or if offline.
 */
export async function geocodeAddress(
  query: StoreAddressQuery,
  signal?: AbortSignal,
): Promise<StoreGeocodedLocation | null> {
  const queryStr = buildAddressSearchQuery(query);
  if (!queryStr || queryStr.length < 3) return null;

  const cacheKey = queryStr.toLowerCase();
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey) ?? null;
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'json');
    url.searchParams.set('q', queryStr);
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'TCG-Harbor/1.0' },
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      geocodeCache.set(cacheKey, null);
      return null;
    }

    const item = data[0];
    const latitude = Number(item.lat);
    const longitude = Number(item.lon);

    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
      geocodeCache.set(cacheKey, null);
      return null;
    }

    const result: StoreGeocodedLocation = {
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
      displayName: typeof item.display_name === 'string' ? item.display_name : queryStr,
      road: item.address?.road,
      city: item.address?.city ?? item.address?.town ?? item.address?.village,
      postcode: item.address?.postcode,
      countryCode: item.address?.country_code ? String(item.address.country_code).toUpperCase() : undefined,
    };

    geocodeCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Reverse geocodes coordinates into an address using OpenStreetMap Nominatim.
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<StoreReverseGeocodedLocation | null> {
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;

  const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if (reverseCache.has(cacheKey)) {
    return reverseCache.get(cacheKey) ?? null;
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'json');
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'TCG-Harbor/1.0' },
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') {
      reverseCache.set(cacheKey, null);
      return null;
    }

    const result: StoreReverseGeocodedLocation = {
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
      displayName: typeof data.display_name === 'string' ? data.display_name : `${latitude}, ${longitude}`,
      road: data.address?.road,
      city: data.address?.city ?? data.address?.town ?? data.address?.village,
      postcode: data.address?.postcode,
      countryCode: data.address?.country_code ? String(data.address.country_code).toUpperCase() : undefined,
    };

    reverseCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

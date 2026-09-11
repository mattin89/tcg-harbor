import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAddressSearchQuery,
  geocodeAddress,
  isValidLatitude,
  isValidLongitude,
  reverseGeocodeCoordinates,
} from '../domain/storeGeocoding';

describe('storeGeocoding', () => {
  describe('isValidLatitude', () => {
    it('accepts valid latitude values', () => {
      expect(isValidLatitude(0)).toBe(true);
      expect(isValidLatitude(51.0504)).toBe(true);
      expect(isValidLatitude(-90)).toBe(true);
      expect(isValidLatitude(90)).toBe(true);
      expect(isValidLatitude(-33.8688)).toBe(true);
    });

    it('rejects invalid or non-numeric latitude values', () => {
      expect(isValidLatitude(null)).toBe(false);
      expect(isValidLatitude(undefined)).toBe(false);
      expect(isValidLatitude(NaN)).toBe(false);
      expect(isValidLatitude(Infinity)).toBe(false);
      expect(isValidLatitude(-90.001)).toBe(false);
      expect(isValidLatitude(90.001)).toBe(false);
      expect(isValidLatitude(100)).toBe(false);
    });
  });

  describe('isValidLongitude', () => {
    it('accepts valid longitude values', () => {
      expect(isValidLongitude(0)).toBe(true);
      expect(isValidLongitude(13.7373)).toBe(true);
      expect(isValidLongitude(-180)).toBe(true);
      expect(isValidLongitude(180)).toBe(true);
      expect(isValidLongitude(151.2093)).toBe(true);
    });

    it('rejects invalid or non-numeric longitude values', () => {
      expect(isValidLongitude(null)).toBe(false);
      expect(isValidLongitude(undefined)).toBe(false);
      expect(isValidLongitude(NaN)).toBe(false);
      expect(isValidLongitude(Infinity)).toBe(false);
      expect(isValidLongitude(-180.001)).toBe(false);
      expect(isValidLongitude(180.001)).toBe(false);
      expect(isValidLongitude(200)).toBe(false);
    });
  });

  describe('buildAddressSearchQuery', () => {
    it('assembles a full address query with comma separation', () => {
      const query = buildAddressSearchQuery({
        addressLine1: ' Prager Straße 10 ',
        postcode: ' 01069 ',
        city: ' Dresden ',
        countryCode: ' DE ',
      });
      expect(query).toBe('Prager Straße 10, 01069, Dresden, DE');
    });

    it('omits blank or whitespace-only fields', () => {
      const query = buildAddressSearchQuery({
        addressLine1: 'Wilsdruffer Str. 5',
        city: '   ',
        postcode: '01067',
      });
      expect(query).toBe('Wilsdruffer Str. 5, 01067');
    });

    it('returns empty string if all fields are empty', () => {
      expect(buildAddressSearchQuery({})).toBe('');
      expect(buildAddressSearchQuery({ addressLine1: '   ', city: '' })).toBe('');
    });
  });

  describe('geocodeAddress', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns null if query string is empty or shorter than 3 chars', async () => {
      const res = await geocodeAddress({ addressLine1: 'a' });
      expect(res).toBeNull();
    });

    it('resolves coordinates and address details from Nominatim search response', async () => {
      const mockResponse = [
        {
          lat: '51.050401',
          lon: '13.737302',
          display_name: 'Wilsdruffer Straße, Innere Altstadt, Dresden, Sachsen, 01067, Deutschland',
          address: {
            road: 'Wilsdruffer Straße',
            city: 'Dresden',
            postcode: '01067',
            country_code: 'de',
          },
        },
      ];

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await geocodeAddress({
        addressLine1: 'Wilsdruffer Straße',
        city: 'Dresden',
        countryCode: 'DE',
      });

      expect(result).not.toBeNull();
      expect(result?.latitude).toBe(51.050401);
      expect(result?.longitude).toBe(13.737302);
      expect(result?.displayName).toContain('Wilsdruffer Straße');
      expect(result?.city).toBe('Dresden');
      expect(result?.countryCode).toBe('DE');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Verify User-Agent header was included
      const fetchArgs = (globalThis.fetch as any).mock.calls[0];
      expect(fetchArgs[1].headers).toEqual({ 'User-Agent': 'TCG-Harbor/1.0' });
    });

    it('returns cached result on subsequent lookups with the same query', async () => {
      const mockResponse = [
        {
          lat: '51.060000',
          lon: '13.740000',
          display_name: 'Cached Location',
          address: { city: 'Dresden' },
        },
      ];

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);
      globalThis.fetch = fetchMock;

      const first = await geocodeAddress({ addressLine1: 'CacheTestRoad', city: 'Dresden' });
      const second = await geocodeAddress({ addressLine1: 'CacheTestRoad', city: 'Dresden' });

      expect(first).toEqual(second);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('handles empty results array gracefully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      } as Response);

      const result = await geocodeAddress({ addressLine1: 'Nonexistent Place 999999' });
      expect(result).toBeNull();
    });

    it('handles network failure without throwing', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      const result = await geocodeAddress({ addressLine1: 'Offline Query Street' });
      expect(result).toBeNull();
    });
  });

  describe('reverseGeocodeCoordinates', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('returns null for out of range coordinates', async () => {
      expect(await reverseGeocodeCoordinates(100, 200)).toBeNull();
      expect(await reverseGeocodeCoordinates(NaN, 10)).toBeNull();
    });

    it('resolves address details from valid coordinates', async () => {
      const mockResponse = {
        lat: '51.050400',
        lon: '13.737300',
        display_name: 'Altmarkt, 01067 Dresden, Deutschland',
        address: {
          road: 'Altmarkt',
          city: 'Dresden',
          postcode: '01067',
          country_code: 'de',
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await reverseGeocodeCoordinates(51.0504, 13.7373);
      expect(result).not.toBeNull();
      expect(result?.latitude).toBe(51.0504);
      expect(result?.longitude).toBe(13.7373);
      expect(result?.displayName).toBe('Altmarkt, 01067 Dresden, Deutschland');
      expect(result?.road).toBe('Altmarkt');
      expect(result?.city).toBe('Dresden');
      expect(result?.postcode).toBe('01067');
      expect(result?.countryCode).toBe('DE');
    });

    it('handles network failure without throwing', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await reverseGeocodeCoordinates(51.01, 13.01);
      expect(result).toBeNull();
    });
  });
});

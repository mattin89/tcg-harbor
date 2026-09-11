import type { StoreSignupDetails } from "./types";

export interface StoreSignupMetadataV12 {
  store_name: string;
  store_address_line_1: string;
  store_city: string;
  store_postcode: string;
  store_country_code: string;
  store_website_url?: string;
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2) throw new Error(`${label} must contain at least 2 characters.`);
  if (normalized.length > maximum) throw new Error(`${label} must contain no more than ${maximum} characters.`);
  return normalized;
}

function optionalWebsite(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 500) throw new Error("Store website must contain no more than 500 characters.");

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Store website must be a complete HTTPS link, for example https://example.com.");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new Error("Store website must be a public HTTPS link without embedded credentials.");
  }
  return url.toString();
}

/**
 * Normalizes the store identity supplied during Auth signup. These values are
 * onboarding data only; reviewed database roles remain the authorization source.
 */
export function storeSignupMetadataV12(details: StoreSignupDetails): StoreSignupMetadataV12 {
  const countryCode = details.countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("Country code must contain exactly two letters.");

  const websiteUrl = optionalWebsite(details.websiteUrl);
  return {
    store_name: requiredText(details.storeName, "Store name", 160),
    store_address_line_1: requiredText(details.addressLine1, "Store address", 200),
    store_city: requiredText(details.city, "Store city", 120),
    store_postcode: requiredText(details.postcode, "Store postcode", 24),
    store_country_code: countryCode,
    ...(websiteUrl ? { store_website_url: websiteUrl } : {}),
  };
}

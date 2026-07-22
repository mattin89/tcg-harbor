import type {
  ProductionNotificationPreferences,
  ProductionProfileSettingsDraft,
} from '../production/types';

export const DEMO_PROFILE_SETTINGS_KEY_V5 = 'tcg-harbor-demo-profile-settings-v5';
export const DEMO_NOTIFICATION_SETTINGS_KEY_V5 = 'tcg-harbor-demo-notification-settings-v5';

export const DEFAULT_NOTIFICATION_PREFERENCES_V5: ProductionNotificationPreferences = {
  directMessages: true,
  communityReplies: true,
  matchingTrades: true,
  tradeUpdates: true,
  emailEnabled: false,
};

interface StorageReaderV5 {
  getItem(key: string): string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function storedObject(storage: StorageReaderV5, key: string): Record<string, unknown> | null {
  try {
    const raw = storage.getItem(key);
    return raw ? record(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Reads only a complete, valid local-preview profile; malformed storage fails closed. */
export function readDemoProfileSettingsV5(
  storage: StorageReaderV5,
  fallback: ProductionProfileSettingsDraft,
): ProductionProfileSettingsDraft {
  const value = storedObject(storage, DEMO_PROFILE_SETTINGS_KEY_V5);
  if (!value) return fallback;
  const username = typeof value.username === 'string' ? value.username.trim().toLowerCase() : '';
  const approximateCity = typeof value.approximateCity === 'string' ? value.approximateCity.trim() : '';
  const approximatePostcode = typeof value.approximatePostcode === 'string' ? value.approximatePostcode.trim() : '';
  if (
    !/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(username)
    || (value.primaryMarket !== 'cardmarket' && value.primaryMarket !== 'tcgplayer')
    || (value.preferredCurrency !== 'EUR' && value.preferredCurrency !== 'USD')
    || approximateCity.length > 120
    || approximatePostcode.length > 24
  ) return fallback;

  return {
    username,
    primaryMarket: value.primaryMarket,
    preferredCurrency: value.preferredCurrency,
    approximateCity,
    approximatePostcode,
  };
}

/** Reads only a complete boolean preference record; malformed storage uses safe defaults. */
export function readDemoNotificationPreferencesV5(
  storage: StorageReaderV5,
  fallback: ProductionNotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES_V5,
): ProductionNotificationPreferences {
  const value = storedObject(storage, DEMO_NOTIFICATION_SETTINGS_KEY_V5);
  if (!value) return fallback;
  const keys = [
    'directMessages',
    'communityReplies',
    'matchingTrades',
    'tradeUpdates',
    'emailEnabled',
  ] as const;
  if (keys.some((key) => typeof value[key] !== 'boolean')) return fallback;
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as unknown as ProductionNotificationPreferences;
}

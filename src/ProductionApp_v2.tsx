import App from './App';
import { ProductionAccessGate, useProductionIdentity } from './production';
import type { RegisteredStore } from './production';
import type { Store } from './data/demo';

const storeAccents = ['coral', 'gold', 'violet', 'azure', 'jade', 'amber'];

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function toMapStore(store: RegisteredStore, index: number): Store {
  const addressParts = [store.addressLine1, store.addressLine2, `${store.postcode} ${store.city}`].filter(Boolean);
  return {
    id: store.id,
    code: '',
    name: store.name,
    city: store.city,
    country: countryName(store.countryCode),
    address: addressParts.join(', '),
    distance: store.city.toLowerCase() === 'dresden' ? 'Dresden' : store.city,
    members: 0,
    trades: 0,
    joined: false,
    x: 50,
    y: 50,
    latitude: store.latitude,
    longitude: store.longitude,
    hours: Object.keys(store.openingHours).length ? 'Opening hours available' : 'Hours not provided',
    phone: store.phone ?? '',
    email: store.contactEmail ?? '',
    accent: storeAccents[index % storeAccents.length],
    source: 'registered',
  };
}

/**
 * Production-aware root. Blank Supabase environment values intentionally keep
 * the existing offline demo available; configured values switch the same app
 * shell to server-verified sessions and capability-based account navigation.
 */
export default function ProductionAppV2() {
  return <ProductionAccessGate><ProductionIdentityBridge /></ProductionAccessGate>;
}

function ProductionIdentityBridge() {
  const identity = useProductionIdentity();

  if (!identity.configured || !identity.authenticated || !identity.profile) {
    return <App />;
  }

  return <App identity={{
    username: identity.profile.username,
    displayName: identity.profile.displayName,
    email: identity.profile.email,
    accountKind: identity.profile.accountKind,
    roles: identity.roles,
    registeredStores: identity.registeredStores.map(toMapStore),
    onSignOut: identity.signOut,
  }} />;
}

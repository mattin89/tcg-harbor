import App from './App';
import { ProductionAccessGate, useProductionIdentity } from './production';
import type { RegisteredStore } from './production';
import type { Store } from './data/demo';
import { useProductionNotificationsV5 } from './services/supabase/useProductionNotificationsV5';
import { usePublicStoreDirectoryV4 } from './services/supabase/usePublicStoreDirectoryV4';

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
 * Production-aware root. Guests receive an explicit read-only browsing
 * runtime, while account data remains behind a server-verified session.
 */
export default function ProductionAppV2() {
  return (
    <ProductionAccessGate renderGuest={({ requestAuthentication }) => (
      <ProductionGuestBridge onRequestAuthentication={requestAuthentication} />
    )}>
      <ProductionIdentityBridge />
    </ProductionAccessGate>
  );
}

function ProductionGuestBridge({ onRequestAuthentication }: { onRequestAuthentication: () => void }) {
  const directory = usePublicStoreDirectoryV4();

  return <App key="guest-v4" guest={{
    registeredStores: directory.stores.map(toMapStore),
    storesLoading: directory.loading,
    storesError: directory.error,
    storesRefresh: directory.refresh,
    onRequestAuthentication,
  }} />;
}

function ProductionIdentityBridge() {
  const identity = useProductionIdentity();
  const productionNotifications = useProductionNotificationsV5(
    identity.configured && identity.authenticated,
    identity.profile?.id,
  );

  if (!identity.configured || !identity.authenticated || !identity.profile) {
    return <main className="production-loading-page" aria-busy="true"><h1>Opening your account</h1></main>;
  }

  return <App key={identity.profile.id} identity={{
    userId: identity.profile.id,
    username: identity.profile.username,
    displayName: identity.profile.displayName,
    email: identity.profile.email,
    accountKind: identity.profile.accountKind,
    roles: identity.roles,
    registeredStores: identity.registeredStores.map(toMapStore),
    profileSettings: {
      username: identity.profile.username,
      primaryMarket: identity.profile.primaryMarket,
      preferredCurrency: identity.profile.preferredCurrency,
      approximateCity: identity.profile.approximateCity,
      approximatePostcode: identity.profile.approximatePostcode,
    },
    notificationPreferences: identity.notificationPreferences ?? undefined,
    notifications: productionNotifications.notifications,
    notificationsLoading: productionNotifications.loading,
    notificationsMutating: productionNotifications.mutating,
    notificationsError: productionNotifications.error,
    onRefreshNotifications: productionNotifications.refresh,
    onMarkAllNotificationsRead: productionNotifications.markAllRead,
    onUpdateProfileSettings: identity.updateProfileSettings,
    onUpdateNotificationPreferences: identity.updateNotificationPreferences,
    onChangePassword: identity.changePassword,
    onSignOut: identity.signOut,
    onSignOutEverywhere: identity.signOutEverywhere,
  }} />;
}

import { useEffect, useState, type FormEvent } from 'react';
import type {
  ProductionNotificationPreferences,
  ProductionProfileSettingsDraft,
} from '../production/types';
import {
  DEFAULT_NOTIFICATION_PREFERENCES_V5,
  DEMO_NOTIFICATION_SETTINGS_KEY_V5,
  DEMO_PROFILE_SETTINGS_KEY_V5,
  readDemoNotificationPreferencesV5,
  readDemoProfileSettingsV5,
} from '../domain/accountSettingsV5';
import { currencyFor, type Market } from '../data/demo';
import { Icon } from './Icon';
import { Avatar, Button, Chip, MarketDataBadge, Toggle } from './ui';

type SettingsTabV5 = 'profile' | 'notifications' | 'privacy' | 'security';

interface SettingsIdentityV5 {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string | null;
  readonly email: string;
  readonly accountKind: 'player' | 'store';
  readonly roles: readonly string[];
  readonly profileSettings?: ProductionProfileSettingsDraft;
  readonly notificationPreferences?: ProductionNotificationPreferences;
  readonly onUpdateProfileSettings?: (draft: ProductionProfileSettingsDraft) => void | Promise<void>;
  readonly onUpdateNotificationPreferences?: (preferences: ProductionNotificationPreferences) => void | Promise<void>;
  readonly onChangePassword?: (currentPassword: string, password: string) => void | Promise<void>;
  readonly onSignOutEverywhere?: () => void | Promise<void>;
}

interface SettingsPageV5Props {
  readonly market: Market;
  readonly setMarket: (market: Market) => void;
  readonly navigate: (path: string) => void;
  readonly notify: (message: string) => void;
  readonly signOut: () => void | Promise<void>;
  readonly identity?: SettingsIdentityV5;
}

function passwordPolicyError(password: string, confirmation: string): string | null {
  if (password !== confirmation) return 'The new passwords do not match.';
  if (password.length < 12) return 'Use at least 12 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Include a lowercase letter, uppercase letter, number, and symbol.';
  }
  return null;
}

function roleLabel(identity?: SettingsIdentityV5): string {
  if (identity?.roles.includes('platform_administrator')) return 'Platform administrator';
  if (identity?.roles.includes('store_administrator')) return 'Player and store operator';
  if (identity?.accountKind === 'store') return 'Player and store applicant';
  return 'Player';
}

export function SettingsPageV5({ market, setMarket, navigate, notify, signOut, identity }: SettingsPageV5Props) {
  const [initialProfile] = useState<ProductionProfileSettingsDraft>(() => identity?.profileSettings
    ?? readDemoProfileSettingsV5(localStorage, {
      username: identity?.username ?? 'player',
      primaryMarket: market,
      preferredCurrency: currencyFor(market),
      approximateCity: '',
      approximatePostcode: '',
    }));
  const [tab, setTab] = useState<SettingsTabV5>('profile');
  const [username, setUsername] = useState(initialProfile.username);
  const [city, setCity] = useState(initialProfile.approximateCity);
  const [postcode, setPostcode] = useState(initialProfile.approximatePostcode);
  const [draftMarket, setDraftMarket] = useState<Market>(initialProfile.primaryMarket);
  const [currency, setCurrency] = useState<'EUR' | 'USD'>(initialProfile.preferredCurrency);
  const [preferences, setPreferences] = useState<ProductionNotificationPreferences>(
    identity?.notificationPreferences
      ?? readDemoNotificationPreferencesV5(localStorage, DEFAULT_NOTIFICATION_PREFERENCES_V5),
  );
  const [profileBusy, setProfileBusy] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [securityBusy, setSecurityBusy] = useState<'password' | 'device' | 'all' | null>(null);
  const [error, setError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (!identity?.profileSettings) return;
    setUsername(identity.profileSettings.username);
    setCity(identity.profileSettings.approximateCity);
    setPostcode(identity.profileSettings.approximatePostcode);
    setDraftMarket(identity.profileSettings.primaryMarket);
    setCurrency(identity.profileSettings.preferredCurrency);
  }, [
    identity?.profileSettings?.username,
    identity?.profileSettings?.approximateCity,
    identity?.profileSettings?.approximatePostcode,
    identity?.profileSettings?.primaryMarket,
    identity?.profileSettings?.preferredCurrency,
  ]);

  useEffect(() => {
    if (identity?.notificationPreferences) setPreferences(identity.notificationPreferences);
  }, [
    identity?.notificationPreferences?.directMessages,
    identity?.notificationPreferences?.communityReplies,
    identity?.notificationPreferences?.matchingTrades,
    identity?.notificationPreferences?.tradeUpdates,
    identity?.notificationPreferences?.emailEnabled,
  ]);

  useEffect(() => {
    if (identity || initialProfile.primaryMarket === market) return;
    setMarket(initialProfile.primaryMarket);
  }, [identity, initialProfile.primaryMarket, market, setMarket]);

  useEffect(() => {
    if (tab === 'security') return;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, [tab]);

  const displayName = identity?.displayName || identity?.username || 'Player';
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P';

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(normalizedUsername)) {
      setError('Username must be 3–30 lowercase letters, numbers, dots, dashes, or underscores.');
      return;
    }
    const draft: ProductionProfileSettingsDraft = {
      username: normalizedUsername,
      primaryMarket: draftMarket,
      preferredCurrency: currency,
      approximateCity: city.trim(),
      approximatePostcode: postcode.trim(),
    };
    setProfileBusy(true);
    setError('');
    try {
      if (identity?.onUpdateProfileSettings) await identity.onUpdateProfileSettings(draft);
      else localStorage.setItem(DEMO_PROFILE_SETTINGS_KEY_V5, JSON.stringify(draft));
      setMarket(draftMarket);
      notify(identity ? 'Profile and market settings saved to your account' : 'Profile and market settings saved on this browser');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Profile settings could not be saved.');
    } finally {
      setProfileBusy(false);
    }
  };

  const saveNotifications = async () => {
    setNotificationBusy(true);
    setError('');
    try {
      if (identity?.onUpdateNotificationPreferences) await identity.onUpdateNotificationPreferences(preferences);
      else localStorage.setItem(DEMO_NOTIFICATION_SETTINGS_KEY_V5, JSON.stringify(preferences));
      notify(identity ? 'Notification preferences saved to your account' : 'Notification preferences saved on this browser');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Notification preferences could not be saved.');
    } finally {
      setNotificationBusy(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Choose a new password that is different from your current password.');
      return;
    }
    const policyError = passwordPolicyError(newPassword, confirmPassword);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (!identity?.onChangePassword) {
      setError('Password changes require a connected account.');
      return;
    }
    setSecurityBusy('password');
    setError('');
    try {
      await identity.onChangePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      notify('Password changed securely');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Password could not be changed.');
    } finally {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSecurityBusy(null);
    }
  };

  const signOutDevice = async () => {
    setSecurityBusy('device');
    setError('');
    try {
      await signOut();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This device could not be signed out.');
      setSecurityBusy(null);
    }
  };

  const signOutEverywhere = async () => {
    if (!identity?.onSignOutEverywhere || !window.confirm('Sign out every device currently using this account?')) return;
    setSecurityBusy('all');
    setError('');
    try {
      await identity.onSignOutEverywhere();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Active sessions could not be revoked.');
      setSecurityBusy(null);
    }
  };

  const tabs: Array<{ id: SettingsTabV5; label: string; icon: 'settings' | 'bell' | 'lock' | 'shield' }> = [
    { id: 'profile', label: 'Profile & market', icon: 'settings' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
    { id: 'privacy', label: 'Privacy & safety', icon: 'lock' },
    { id: 'security', label: 'Account security', icon: 'shield' },
  ];

  return <div className="page settings-page"><div className="settings-layout">
    <aside className="settings-nav panel" role="tablist" aria-label="Profile and settings" aria-orientation="vertical">
      {tabs.map((item) => <button type="button" role="tab" key={item.id} id={`settings-tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`settings-panel-${item.id}`} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); setError(''); }}><Icon name={item.icon}/>{item.label}</button>)}
    </aside>
    <div className="settings-content">
      {error && <div className="form-error" role="alert"><Icon name="info"/>{error}</div>}

      {tab === 'profile' && <div className="settings-section-stack" role="tabpanel" id="settings-panel-profile" aria-labelledby="settings-tab-profile" tabIndex={0}>
        <form className="panel settings-card" onSubmit={saveProfile}>
          <div className="panel-header"><div><p className="eyebrow">Player identity</p><h2>Profile</h2></div><Chip tone={identity ? 'positive' : 'neutral'}><Icon name="shield" size={13}/>{identity ? 'Authenticated account' : 'Local development session'}</Chip></div>
          <div className="profile-editor"><Avatar initials={initials} size="lg"/><div><strong>{displayName}</strong><small>{identity ? 'Account-owned profile' : 'Local preview profile'}</small></div></div>
          <div className="form-grid"><label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={30}/></label><label>Email<input type="email" value={identity?.email ?? ''} disabled/><small>Managed by authentication provider</small></label><label>Approximate city<input value={city} onChange={(event) => setCity(event.target.value)} maxLength={120}/><small>Never shown as an exact location</small></label><label>Approximate postcode<input value={postcode} onChange={(event) => setPostcode(event.target.value)} maxLength={24}/></label><label>Role<input value={roleLabel(identity)} disabled/></label></div>
          <hr/>
          <div className="panel-header"><div><p className="eyebrow">Valuation defaults</p><h2>Market & currency</h2></div><MarketDataBadge compact/></div>
          <div className="preference-options">
            <label className={draftMarket === 'cardmarket' ? 'selected' : ''}><input type="radio" name="market" checked={draftMarket === 'cardmarket'} onChange={() => { setDraftMarket('cardmarket'); setCurrency('EUR'); }}/><span><i>€</i><strong>Europe · Cardmarket</strong><small>Official daily trend in native EUR</small></span><Icon name="check"/></label>
            <label className={draftMarket === 'tcgplayer' ? 'selected' : ''}><input type="radio" name="market" checked={draftMarket === 'tcgplayer'} onChange={() => { setDraftMarket('tcgplayer'); setCurrency('USD'); }}/><span><i>$</i><strong>United States · source-backed market</strong><small>TCGplayer and OPTCG USD snapshots</small></span><Icon name="check"/></label>
          </div>
          <label>Preferred display currency<select value={currency} onChange={(event) => setCurrency(event.target.value as 'EUR' | 'USD')}><option>EUR</option><option>USD</option></select><small>Provider-native prices are never silently converted.</small></label>
          <div className="form-actions"><Button type="submit" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save changes'}</Button></div>
        </form>
      </div>}

      {tab === 'notifications' && <div className="settings-section-stack" role="tabpanel" id="settings-panel-notifications" aria-labelledby="settings-tab-notifications" tabIndex={0}>
        <section className="panel settings-card"><div className="panel-header"><div><p className="eyebrow">Account-owned preferences</p><h2>Notifications</h2></div><Chip tone={identity ? 'positive' : 'neutral'}>{identity ? 'Private Supabase record' : 'Local preview'}</Chip></div><p className="settings-intro">{identity ? 'Choose which in-app activity may create notifications. The database applies these preferences before saving a matching notification, and your choices follow you across devices.' : 'Choose which in-app activity should notify you in this local preview. Your choices persist on this browser.'}</p><div className="toggle-list"><Toggle label="Private messages" detail="When another verified collector messages you" checked={preferences.directMessages} onChange={(directMessages) => setPreferences({ ...preferences, directMessages })}/><Toggle label="Community replies" detail="Replies and mentions in store chat" checked={preferences.communityReplies} onChange={(communityReplies) => setPreferences({ ...preferences, communityReplies })}/><Toggle label="Collection trade matches" detail="Someone is looking for a card you own" checked={preferences.matchingTrades} onChange={(matchingTrades) => setPreferences({ ...preferences, matchingTrades })}/><Toggle label="Trade status changes" detail="When a post moves to discussing, completed, or closed" checked={preferences.tradeUpdates} onChange={(tradeUpdates) => setPreferences({ ...preferences, tradeUpdates })}/><Toggle label="Email digest" detail="Preference is stored; outbound email delivery is not enabled yet" checked={preferences.emailEnabled} onChange={(emailEnabled) => setPreferences({ ...preferences, emailEnabled })}/></div><div className="form-actions"><Button type="button" onClick={() => void saveNotifications()} disabled={notificationBusy}>{notificationBusy ? 'Saving…' : 'Save notification preferences'}</Button></div></section>
      </div>}

      {tab === 'privacy' && <div className="settings-section-stack" role="tabpanel" id="settings-panel-privacy" aria-labelledby="settings-tab-privacy" tabIndex={0}>
        <section className="panel privacy-card"><span><Icon name="lock"/></span><div><h2>Your collection is private</h2><p>Portfolio value, cost basis, acquisition history, and notes are restricted to your authenticated account by row-level security. Communities see only trade cards you deliberately publish.</p><div><Chip tone="positive">RLS protected</Chip><Chip tone="positive">Private by default</Chip><Chip tone="neutral">No exact location</Chip></div></div></section>
        <section className="panel settings-card"><div className="panel-header"><div><p className="eyebrow">Enforced boundaries</p><h2>Privacy & safety</h2></div><Chip tone="positive"><Icon name="shield" size={13}/>Server enforced</Chip></div><div className="privacy-status-list"><div><Icon name="collection"/><span><strong>Collection visibility</strong><small>Only the signed-in owner can read holdings and valuation history.</small></span><Chip tone="positive">Private</Chip></div><div><Icon name="message"/><span><strong>Direct messages</strong><small>Available only between players who share an active store community.</small></span><Chip tone="positive">Restricted</Chip></div><div><Icon name="store"/><span><strong>Store administrators</strong><small>Can moderate store group messages, but cannot read private collections or direct messages.</small></span><Chip tone="positive">Separated</Chip></div></div><div className="form-actions"><Button type="button" variant="secondary" onClick={() => navigate('/communities')} icon="users">Review communities</Button><Button type="button" variant="secondary" onClick={() => navigate('/messages')} icon="message">Open private messages</Button></div></section>
      </div>}

      {tab === 'security' && <div className="settings-section-stack" role="tabpanel" id="settings-panel-security" aria-labelledby="settings-tab-security" tabIndex={0}>
        <form className="panel settings-card" onSubmit={changePassword}><div className="panel-header"><div><p className="eyebrow">Verified password change</p><h2>Change password</h2></div><Chip tone="positive"><Icon name="lock" size={13}/>Current password required</Chip></div><p className="settings-intro">Your current password is verified with Supabase before the update is attempted. Use at least 12 characters with upper- and lowercase letters, a number, and a symbol.</p><div className="form-grid"><label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required/></label><label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={12} required/></label><label>Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required/></label></div><div className="form-actions"><Button type="submit" disabled={securityBusy !== null || !identity?.onChangePassword}>{securityBusy === 'password' ? 'Changing…' : 'Change password'}</Button></div></form>
        <section className="panel danger-zone"><div><h2>Active sessions</h2><p>{identity ? 'Sign out this browser, or revoke all refresh tokens if you do not recognize another login. Existing access tokens remain valid only until the hosted project’s configured expiry.' : 'Sign out of the local development session on this browser.'}</p></div><div className="session-actions"><Button variant="danger" disabled={securityBusy !== null} onClick={() => void signOutDevice()} icon="logout">{securityBusy === 'device' ? 'Signing out…' : 'Sign out this device'}</Button>{identity?.onSignOutEverywhere && <Button variant="secondary" disabled={securityBusy !== null} onClick={() => void signOutEverywhere()} icon="shield">{securityBusy === 'all' ? 'Revoking…' : 'Sign out all devices'}</Button>}</div></section>
      </div>}
    </div>
  </div></div>;
}

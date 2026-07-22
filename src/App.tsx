import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Icon } from './components/Icon';
import { AccountMenuButton } from './components/AccountMenuButton';
import { ScannerPage as WorkingScannerPage } from './components/ScannerPage';
import { MarketComparisonPage } from './components/MarketComparisonPage';
import { SettingsPageV5 } from './components/SettingsPageV5';
import { StoreMap } from './components/StoreMap';
import { Avatar, Button, CardArt, Chip, DemoBadge, EmptyState, MarketDataBadge, Modal, PriceChart, Segmented, Trend } from './components/ui';
import type { ProductionNotificationPreferences, ProductionProfileSettingsDraft } from './production/types';
import { clearStoredStoreJoinIntent, peekStoreJoinIntent } from './production/storeJoinRoute';
import { summarizePortfolioGrowth } from './domain/acquisitionGrowthV2';
import { resolvePrivateNoteForAddV2 } from './domain/collectionDraftV2';
import { readDemoProfileSettingsV5 } from './domain/accountSettingsV5';
import { resolvePortfolioValuationV2 } from './domain/portfolioValuationV2';
import { resolveActiveNavPathV2 } from './domain/navigationV2';
import { resolveAccountBootstrapSeedsV2 } from './domain/accountBootstrapV2';
import { resolveViewerPathV4, viewerMutationDecisionV4 } from './domain/guestAccessV4';
import { normalizeCatalogQueryV5, selectCardGroupMatchV5 } from './domain/catalogSearchV5';
import {
  resolveCardmarketArtworkReferenceV10,
  resolveCatalogCardmarketReferenceV10,
} from './domain/cardmarketSearchReferenceV10';
import { useProductionCollectionV2, type ProductionCollectionRuntimeV2 } from './services/supabase/useProductionCollectionV2';
import { useProductionDirectMessagesV2, type ProductionDirectMessagesRuntimeV2 } from './services/supabase/useProductionDirectMessagesV2';
import type { ProductionDirectConversationV2 } from './services/supabase/directMessageRepositoryV2';
import type { PortfolioDailySnapshotV2 } from './services/supabase/collectionRepositoryV2';
import type { ProductionNotificationViewV5 } from './services/supabase/notificationRepositoryV5';
import {
  assetById,
  catalogAssets,
  currencyFor,
  formatMoney,
  initialAssets,
  initialCommunityMessages,
  initialConversations,
  initialTradePosts,
  marketDataMeta,
  notifications,
  recentActivity,
  stores,
  type AssetKind,
  type AcquisitionLot,
  type CommunityMessage,
  type Conversation,
  type DemoAsset,
  type Market,
  type Period,
  type Store,
  type TradePost,
} from './data/demo';

type ViewMode = 'grid' | 'table';

export interface AppRuntimeIdentity {
  userId: string;
  username: string;
  displayName: string | null;
  email: string;
  accountKind: 'player' | 'store';
  roles: string[];
  registeredStores?: Store[];
  profileSettings?: ProductionProfileSettingsDraft;
  notificationPreferences?: ProductionNotificationPreferences;
  notifications?: readonly ProductionNotificationViewV5[];
  notificationsLoading?: boolean;
  notificationsMutating?: boolean;
  notificationsError?: string | null;
  onRefreshNotifications?: () => void | Promise<void>;
  onMarkAllNotificationsRead?: () => Promise<boolean>;
  onUpdateProfileSettings?: (draft: ProductionProfileSettingsDraft) => void | Promise<void>;
  onUpdateNotificationPreferences?: (preferences: ProductionNotificationPreferences) => void | Promise<void>;
  onChangePassword?: (currentPassword: string, password: string) => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onSignOutEverywhere?: () => void | Promise<void>;
  storePortal?: ReactNode;
}

export interface AppGuestAccessV4 {
  registeredStores: Store[];
  storesLoading: boolean;
  storesError: string | null;
  storesRefresh(): Promise<void>;
  onRequestAuthentication: () => void;
}

interface AppProps {
  identity?: AppRuntimeIdentity;
  guest?: AppGuestAccessV4;
}

function marketSourceLabel(market: Market): string {
  return market === 'cardmarket' ? 'Cardmarket trend · EUR' : 'US market reference · USD';
}

function marketSourceDate(market: Market): string {
  const raw = market === 'cardmarket' ? marketDataMeta.cardmarket.createdAt : marketDataMeta.optcg.createdAt;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(raw));
}

function assetUsSourceLabel(asset: DemoAsset): string {
  return `${asset.usPriceSource ?? (asset.kind === 'card' ? 'OPTCG API market' : 'US market reference')} · USD`;
}

function assetUsSourceDate(asset: DemoAsset): string {
  const raw = asset.sourceUpdatedAt?.tcgcsv ?? asset.sourceUpdatedAt?.optcg ?? marketDataMeta.optcg.createdAt;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(raw));
}

function latestAcquisition(asset: DemoAsset): AcquisitionLot | undefined {
  return asset.acquisitionLots?.at(-1);
}

function directMessageTimeV2(createdAt: string): string {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return sameDay
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
}

function directMessageInitialsV2(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'CM';
}

function directConversationsToViewV2(
  conversations: readonly ProductionDirectConversationV2[],
): Conversation[] {
  return conversations.map((conversation) => ({
    id: conversation.id,
    user: conversation.peer.displayName,
    initials: directMessageInitialsV2(conversation.peer.displayName),
    community: conversation.communityName,
    online: false,
    unread: conversation.unreadCount,
    messages: conversation.messages.map((message) => ({
      id: message.id,
      user: message.own ? 'You' : conversation.peer.displayName,
      initials: message.own ? 'YO' : directMessageInitialsV2(conversation.peer.displayName),
      text: message.body,
      time: directMessageTimeV2(message.createdAt),
      own: message.own,
    })),
  }));
}

function notificationActionUrlV5(notification: { readonly type: string; readonly actionUrl?: string | null }): string | null {
  if (notification.actionUrl !== undefined) return notification.actionUrl;
  return notification.type === 'message' ? '/messages/lena' : null;
}

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' as const },
  { path: '/collection', label: 'Collection', icon: 'collection' as const },
  { path: '/collection/add', label: 'Add items', icon: 'plus' as const },
  { path: '/market-comparison', label: 'Market compare', icon: 'chart' as const },
  { path: '/stores', label: 'Stores', icon: 'store' as const },
  { path: '/communities', label: 'Communities', icon: 'users' as const },
  { path: '/messages', label: 'Messages', icon: 'message' as const },
];

const guestNavItems = [
  { path: '/cards', label: 'Cards', icon: 'cards' as const },
  { path: '/stores', label: 'Stores', icon: 'store' as const },
];

function safeAssets(): DemoAsset[] {
  try {
    const saved = localStorage.getItem('tcg-harbor-assets-source-backed-v5');
    if (!saved) return initialAssets;
    const latestById = new Map(catalogAssets.map((asset) => [asset.id, asset]));
    return (JSON.parse(saved) as DemoAsset[]).map((holding) => {
      const latest = latestById.get(holding.catalogId ?? holding.id);
      if (!latest) return holding;
      return {
        ...holding,
        ...latest,
        id: holding.id,
        catalogId: latest.id,
        quantity: holding.quantity,
        condition: holding.condition,
        purchasePrice: holding.purchasePrice,
        note: holding.note,
        addedAt: holding.addedAt,
        acquisitionLots: holding.acquisitionLots,
      };
    });
  } catch { return initialAssets; }
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (next: string) => {
    window.history.pushState({}, '', next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return { path, navigate };
}

export default function App({ identity, guest }: AppProps = {}) {
  const { path: requestedPath, navigate: navigateToPath } = usePath();
  const isGuest = Boolean(guest);
  const path = resolveViewerPathV4(requestedPath, isGuest ? 'guest' : 'authenticated');
  const navigate = (next: string) => navigateToPath(isGuest ? resolveViewerPathV4(next, 'guest') : next);

  useEffect(() => {
    if (!isGuest || requestedPath === path) return;
    window.history.replaceState({}, '', path);
  }, [isGuest, path, requestedPath]);

  const sanitizedJoinToken = path === '/join/store' ? peekStoreJoinIntent(window.sessionStorage)?.token ?? '' : '';
  const storeDirectory = guest?.registeredStores ?? identity?.registeredStores ?? stores;
  const [accountSeeds] = useState(() => resolveAccountBootstrapSeedsV2(isGuest ? { userId: 'guest-v4', accountKind: 'player' } : identity, {
    communityMessages: initialCommunityMessages,
    tradePosts: initialTradePosts,
    conversations: initialConversations,
    notifications,
    recentActivity,
  }));
  const [demoAuthenticated, setDemoAuthenticated] = useState(() => identity || isGuest ? false : localStorage.getItem('tcg-harbor-session') === 'signed-in');
  const [demoAssets, setDemoAssets] = useState<DemoAsset[]>(() => identity || isGuest ? [] : safeAssets());
  const productionCollection = useProductionCollectionV2(Boolean(identity), identity?.userId);
  const productionDirectMessages = useProductionDirectMessagesV2(Boolean(identity), identity?.userId);
  const assets = identity ? productionCollection.assets : isGuest ? [] : demoAssets;
  const [market, setMarket] = useState<Market>(() => identity?.profileSettings?.primaryMarket
    ?? (isGuest ? 'cardmarket' : readDemoProfileSettingsV5(localStorage, {
      username: 'player',
      primaryMarket: 'cardmarket',
      preferredCurrency: 'EUR',
      approximateCity: '',
      approximatePostcode: '',
    }).primaryMarket));
  const [period, setPeriod] = useState<Period>('1M');
  const [kind, setKind] = useState<AssetKind | 'all'>('all');
  const [joinedIds, setJoinedIds] = useState(() => new Set(isGuest ? [] : storeDirectory.filter((store) => store.joined).map((store) => store.id)));
  const [communityMessages, setCommunityMessages] = useState<Record<string, CommunityMessage[]>>(accountSeeds.communityMessages);
  const [tradePosts, setTradePosts] = useState<TradePost[]>(accountSeeds.tradePosts);
  const [demoConversations, setDemoConversations] = useState<Conversation[]>(accountSeeds.conversations);
  const productionConversations = useMemo(
    () => directConversationsToViewV2(productionDirectMessages.conversations),
    [productionDirectMessages.conversations],
  );
  const conversations = identity ? productionConversations : isGuest ? [] : demoConversations;
  const setConversations = identity || isGuest ? () => undefined : setDemoConversations;
  const [toast, setToast] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    if (!identity && !isGuest) localStorage.setItem('tcg-harbor-assets-source-backed-v5', JSON.stringify(demoAssets));
  }, [demoAssets, identity, isGuest]);
  useEffect(() => {
    if (identity?.profileSettings?.primaryMarket) setMarket(identity.profileSettings.primaryMarket);
  }, [identity?.profileSettings?.primaryMarket]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = (message: string) => setToast(message);
  const authenticated = Boolean(identity) || isGuest || demoAuthenticated;
  const profileName = identity?.displayName || identity?.username || 'Player';
  const profileInitials = profileName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'P';
  const unreadMessageCount = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);
  const displayedNotifications = identity ? identity.notifications ?? [] : accountSeeds.notifications;
  const unreadNotificationCount = displayedNotifications.filter((notification) => notification.unread).length;
  const isPlatformAdministrator = identity?.roles.includes('platform_administrator') ?? false;
  const isApprovedStoreAdministrator = identity?.roles.includes('store_administrator') ?? false;
  // Production store/approval navigation is owned by ProductionAccessGate.
  // The embedded route remains available only to the local demo or to a future
  // caller that deliberately supplies a production store portal node.
  const canOpenStorePortal = !isGuest && (!identity || Boolean(identity.storePortal));
  const accountLabel = isPlatformAdministrator ? 'Platform administrator' : isApprovedStoreAdministrator ? 'Player · Store operator' : identity?.accountKind === 'store' ? 'Player · Store applicant' : 'Player · Europe';
  const signOut = async () => {
    if (isGuest) {
      guest?.onRequestAuthentication();
      return;
    }
    if (identity) {
      await identity.onSignOut();
      return;
    }
    localStorage.setItem('tcg-harbor-session', 'signed-out');
    setDemoAuthenticated(false);
    navigate('/signin');
  };
  const signIn = () => {
    if (isGuest) {
      guest?.onRequestAuthentication();
      return;
    }
    localStorage.setItem('tcg-harbor-session', 'demo');
    setDemoAuthenticated(true);
    const pending = sessionStorage.getItem('tcg-harbor-pending-join');
    sessionStorage.removeItem('tcg-harbor-pending-join');
    navigate(pending || '/dashboard');
  };
  const markAllNotificationsRead = async () => {
    if (!identity?.onMarkAllNotificationsRead) {
      notify('All demo notifications marked as read');
      return;
    }
    try {
      const saved = await identity.onMarkAllNotificationsRead();
      if (saved) notify('All notifications marked as read');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Notifications could not be marked as read');
    }
  };

  if (!authenticated) {
    if (path.startsWith('/join/')) sessionStorage.setItem('tcg-harbor-pending-join', path);
    return <AuthPage onSignIn={signIn} />;
  }

  const visibleNavItems = isGuest ? guestNavItems : navItems;
  const activeNavPath = resolveActiveNavPathV2(path, visibleNavItems.map((item) => item.path), isGuest ? '/cards' : '/dashboard');
  const title = path === '/cards' ? ['Browse the card catalog', 'Explore every sourced printing and current market reference without an account']
    : path.startsWith('/collection/add') ? ['Add to collection', 'Search the catalog or add a sealed product']
    : path.startsWith('/collection') ? ['Your collection', 'Private by default · only you can see portfolio details']
    : path === '/market-comparison' ? ['Market comparison', 'Find the largest exact-printing price ratios across Cardmarket and TCGplayer']
    : path.startsWith('/stores/') ? ['Store profile', 'Discover the community behind your local game store']
    : path === '/stores' ? ['Find your local harbor', 'Stores, communities, and local trading — all in one place']
    : path.startsWith('/communities/') ? ['Community', 'A private space for verified local collectors']
    : path === '/communities' ? ['Your communities', 'Trade and connect where you play']
    : path.startsWith('/messages/') || path === '/messages' ? ['Private messages', 'Available only between collectors who share a community']
    : path === '/settings' ? ['Profile & settings', 'Control your market, privacy, and notifications']
    : path === '/store-admin' ? [isPlatformAdministrator ? 'Store approvals' : isApprovedStoreAdministrator ? 'Store administration' : 'Register your store', isPlatformAdministrator ? 'Review store applications and protect community access' : 'Manage store identity and community access after approval']
    : path === '/scan' ? ['Scan a store code', 'Join a community while you are physically at the store']
    : path.startsWith('/join/') ? ['Join community', 'Confirm the store you are visiting']
    : ['Portfolio overview', `Welcome back, ${profileName} — your collection moved today`];

  const page = path === '/cards'
    ? <AddItemsPage key={`cards:${identity?.userId ?? (isGuest ? 'guest-v4' : 'demo')}`} assets={assets} setAssets={setDemoAssets} productionCollection={identity ? productionCollection : undefined} market={market} navigate={navigate} notify={notify} browseOnly={isGuest} onRequestAuthentication={guest?.onRequestAuthentication} />
    : path.startsWith('/collection/add')
    ? <AddItemsPage key={`add-items:${identity?.userId ?? 'demo'}`} assets={assets} setAssets={setDemoAssets} productionCollection={identity ? productionCollection : undefined} market={market} navigate={navigate} notify={notify} />
    : path === '/collection'
      ? <CollectionPage key={`collection:${identity?.userId ?? 'demo'}`} assets={assets} setAssets={setDemoAssets} productionCollection={identity ? productionCollection : undefined} market={market} navigate={navigate} notify={notify} />
      : path === '/market-comparison'
        ? <MarketComparisonPage />
      : path === '/stores'
        ? <StoresPage stores={storeDirectory} joinedIds={joinedIds} navigate={navigate} browseOnly={isGuest} onRequestAuthentication={guest?.onRequestAuthentication} />
        : path.startsWith('/stores/')
          ? isGuest && guest?.storesLoading
            ? <div className="page" role="status" aria-live="polite"><EmptyState icon="refresh" title="Loading store" detail="Retrieving this approved store from the public directory…" /></div>
            : <StoreProfilePage stores={storeDirectory} storeId={path.split('/')[2]} joinedIds={joinedIds} navigate={navigate} browseOnly={isGuest} onRequestAuthentication={guest?.onRequestAuthentication} />
          : path === '/communities'
            ? <CommunitiesPage joinedIds={joinedIds} navigate={navigate} />
            : path.startsWith('/communities/')
              ? <CommunityPage communityId={path.split('/')[2]} joinedIds={joinedIds} assets={assets} messages={communityMessages} setMessages={setCommunityMessages} trades={tradePosts} setTrades={setTradePosts} market={market} navigate={navigate} notify={notify} />
              : path === '/messages' || path.startsWith('/messages/')
                ? <MessagesPage conversationId={path.split('/')[2]} conversations={conversations} setConversations={setConversations} productionMessages={identity ? productionDirectMessages : undefined} navigate={navigate} notify={notify} />
                : path === '/settings'
                  ? <SettingsPageV5 market={market} setMarket={setMarket} navigate={navigate} notify={notify} signOut={signOut} identity={identity} />
                  : path === '/store-admin'
                    ? canOpenStorePortal
                      ? identity?.storePortal ?? <StoreAdminPage notify={notify} />
                      : <StorePortalDenied navigate={navigate} />
                    : path === '/scan'
                      ? <WorkingScannerPage navigate={navigate} notify={notify} />
                      : path === '/join/store'
                        ? <JoinPage code={sanitizedJoinToken} joinedIds={joinedIds} setJoinedIds={setJoinedIds} navigate={navigate} notify={notify} />
                      : path.startsWith('/join/')
                        ? <JoinPage code={decodeURIComponent(path.split('/')[2] ?? '')} joinedIds={joinedIds} setJoinedIds={setJoinedIds} navigate={navigate} notify={notify} />
                        : <DashboardPage assets={assets} dailySnapshots={identity ? productionCollection.dailySnapshots : []} activity={accountSeeds.recentActivity} market={market} setMarket={setMarket} period={period} setPeriod={setPeriod} kind={kind} setKind={setKind} navigate={navigate} />;

  return <div className={`app-shell${isGuest ? ' guest-shell' : ''}`}>
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate(isGuest ? '/cards' : '/dashboard')} aria-label={isGuest ? 'TCG Harbor card catalog' : 'TCG Harbor dashboard'}><span className="brand-mark"><span /></span><span><strong>TCG Harbor</strong><small>Collector community</small></span></button>
      <nav aria-label="Primary navigation">{visibleNavItems.map((item) => <button key={item.path} className={activeNavPath === item.path ? 'active' : ''} aria-current={activeNavPath === item.path ? 'page' : undefined} onClick={() => navigate(item.path)}><Icon name={item.icon} /><span>{item.label}</span>{item.path === '/messages' && unreadMessageCount > 0 && <em>{unreadMessageCount}</em>}</button>)}</nav>
      <div className="sidebar-grow" />
      {isGuest ? <section className="guest-auth-card"><Icon name="lock"/><div><strong>Browsing as a guest</strong><small>Sign in to save cards or join a store community.</small></div><Button type="button" size="sm" onClick={guest?.onRequestAuthentication}>Sign in / Create account</Button></section> : <>
        {canOpenStorePortal && <button className={`side-utility ${path === '/store-admin' ? 'active' : ''}`} aria-current={path === '/store-admin' ? 'page' : undefined} onClick={() => navigate('/store-admin')}><Icon name="shield" /><span>{isPlatformAdministrator ? 'Store approvals' : isApprovedStoreAdministrator ? 'Store admin' : identity ? 'Register store' : 'Store admin'}</span></button>}
        <button className={`profile-card ${path === '/settings' ? 'active' : ''}`} aria-current={path === '/settings' ? 'page' : undefined} onClick={() => navigate('/settings')}><Avatar initials={profileInitials} size="md" /><span><strong>{profileName}</strong><small>{accountLabel}</small></span><Icon name="more" size={18} /></button>
      </>}
      <p className="unofficial">Unofficial collector/community {isGuest ? 'public preview' : identity ? 'platform' : 'demo'}<br />Not affiliated with any publisher or marketplace.</p>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div><p className="eyebrow mobile-only">TCG Harbor</p><h1>{title[0]}</h1><p>{title[1]}</p></div>
        <div className="top-actions">{isGuest ? <div className="guest-top-actions"><Chip tone="neutral">Guest · browse only</Chip><Button type="button" size="sm" onClick={guest?.onRequestAuthentication}>Sign in / Create account</Button></div> : <>{!identity && <DemoBadge compact />}<button className="icon-button notification-button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="Notifications"><Icon name="bell" />{unreadNotificationCount > 0 && <span>{unreadNotificationCount}</span>}</button><AccountMenuButton initials={profileInitials} active={path === '/settings'} onOpen={() => navigate('/settings')} /></>}</div>
      </header>
      <main id="main-content">
        {identity && (productionCollection.loading || productionCollection.error) && <div className={`collection-sync-banner ${productionCollection.error ? 'is-error' : ''}`} role={productionCollection.error ? 'alert' : 'status'}>
          <Icon name={productionCollection.error ? 'info' : 'refresh'} size={16}/>
          <span><strong>{productionCollection.error ? 'Collection sync needs attention' : 'Loading your private collection'}</strong><small>{productionCollection.error ?? 'Retrieving account-owned holdings and valuation history…'}</small></span>
          {productionCollection.error && <Button type="button" variant="ghost" size="sm" onClick={() => void productionCollection.refresh()}>Try again</Button>}
        </div>}
        {isGuest && path.startsWith('/stores') && (guest?.storesLoading || guest?.storesError) && <div className={`guest-access-banner ${guest.storesError ? 'is-error' : ''}`} role={guest.storesError ? 'alert' : 'status'}>
          <Icon name={guest.storesError ? 'info' : 'refresh'} size={16}/>
          <span><strong>{guest.storesError ? 'The public store directory is unavailable' : 'Loading approved stores'}</strong><small>{guest.storesError ?? 'Retrieving public store locations…'}</small></span>
          {guest.storesError && <Button type="button" variant="ghost" size="sm" onClick={() => void guest.storesRefresh()}>Try again</Button>}
        </div>}
        {page}
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Mobile navigation">{visibleNavItems.filter((item) => item.path !== '/collection/add').map((item) => <button key={item.path} className={activeNavPath === item.path ? 'active' : ''} aria-current={activeNavPath === item.path ? 'page' : undefined} onClick={() => navigate(item.path)}><Icon name={item.icon} size={20}/><span>{item.path === '/market-comparison' ? 'Markets' : item.label === 'Communities' ? 'Community' : item.label}</span>{item.path === '/messages' && unreadMessageCount > 0 && <em>{unreadMessageCount}</em>}</button>)}</nav>
    {!isGuest && notificationsOpen && <div className="notification-panel">
      <header><div><p className="eyebrow">Activity</p><h2>Notifications</h2></div><Button variant="ghost" size="icon" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><Icon name="close" /></Button></header>
      <div className="notification-list" aria-live="polite">
        {identity?.notificationsError && <div className="notification-empty"><Icon name="info" size={22}/><span><strong>Notifications need attention</strong><small>{identity.notificationsError}</small>{identity.onRefreshNotifications && <Button variant="ghost" size="sm" onClick={() => void identity.onRefreshNotifications?.()}>Try again</Button>}</span></div>}
        {identity?.notificationsLoading && displayedNotifications.length === 0
          ? <div className="notification-empty"><Icon name="refresh" size={22}/><span><strong>Loading notifications</strong><small>Retrieving account activity…</small></span></div>
          : displayedNotifications.length === 0 && !identity?.notificationsError
            ? <div className="notification-empty"><Icon name="bell" size={22}/><span><strong>No notifications yet</strong><small>Account activity will appear here.</small></span></div>
            : displayedNotifications.map((note) => <button key={note.id} className={note.unread ? 'unread' : ''} onClick={() => { const actionUrl = notificationActionUrlV5(note); setNotificationsOpen(false); if (actionUrl) navigate(actionUrl); }}><span className={`notification-icon ${note.type}`}><Icon name={note.type === 'message' ? 'message' : note.type === 'trade' ? 'trade' : note.type === 'community' ? 'users' : 'check'} /></span><span><strong>{note.title}</strong><small>{note.detail}</small><time>{note.time}</time></span></button>)}
      </div>
      {displayedNotifications.some((notification) => notification.unread) && <footer><Button variant="secondary" disabled={identity?.notificationsMutating} onClick={() => void markAllNotificationsRead()}><Icon name="check"/>{identity?.notificationsMutating ? 'Marking read…' : 'Mark all read'}</Button></footer>}
    </div>}
    {toast && <div className="toast" role="status"><span><Icon name="check" size={16} /></span>{toast}</div>}
  </div>;
}

function AuthPage({ onSignIn }: { onSignIn: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [error, setError] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email') || '');
    if (!z.string().email().safeParse(email).success) { setError('Enter a valid email address.'); return; }
    if (mode === 'reset') { setError('Reset link structure is ready. In demo mode, use the account below.'); return; }
    onSignIn();
  };
  return <main className="auth-page">
    <section className="auth-story">
      <div className="auth-brand"><span className="brand-mark"><span /></span><strong>TCG Harbor</strong></div>
      <div className="auth-copy"><DemoBadge /><p className="eyebrow">Your collection, in its element</p><h1>Know what you hold.<br /><em>Trade where you belong.</em></h1><p>Track your One Piece Card Game portfolio, discover local game stores, and trade within verified store communities.</p><div className="auth-proof"><span><Icon name="chart" /><strong>30 days</strong><small>price history</small></span><span><Icon name="store" /><strong>6 stores</strong><small>demo communities</small></span><span><Icon name="lock" /><strong>Private</strong><small>by default</small></span></div></div>
      <p className="auth-disclaimer">Unofficial collector/community preview. EU values use Cardmarket’s daily public feed; card metadata, art, and US references use OPTCG API and TCGCSV. Not affiliated with Bandai or any data provider.</p>
    </section>
    <section className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><div className="auth-mobile-brand"><span className="brand-mark"><span /></span><strong>TCG Harbor</strong></div><p className="eyebrow">Welcome aboard</p><h2>{mode === 'signin' ? 'Sign in to your harbor' : mode === 'signup' ? 'Create your collector profile' : 'Reset your password'}</h2><p>{mode === 'reset' ? 'We’ll send a secure reset link if an account exists.' : 'Your collection and portfolio value stay private.'}</p><label>Email address<input name="email" type="email" autoComplete="email" /></label>{mode !== 'reset' && <label>Password<input name="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} /></label>}{error && <div className="form-error"><Icon name="info" />{error}</div>}<Button type="submit" className="full-width">{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}<Icon name="chevron" /></Button><div className="auth-links">{mode !== 'signin' ? <button type="button" onClick={() => { setMode('signin'); setError(''); }}>Back to sign in</button> : <><button type="button" onClick={() => setMode('signup')}>Create account</button><button type="button" onClick={() => setMode('reset')}>Forgot password?</button></>}</div></form></section>
  </main>;
}

function DashboardPage({ assets, dailySnapshots, activity, market, setMarket, period, setPeriod, kind, setKind, navigate }: { assets: DemoAsset[]; dailySnapshots: PortfolioDailySnapshotV2[]; activity: typeof recentActivity; market: Market; setMarket: (market: Market) => void; period: Period; setPeriod: (period: Period) => void; kind: AssetKind | 'all'; setKind: (kind: AssetKind | 'all') => void; navigate: (path: string) => void }) {
  const [gainRank, setGainRank] = useState<'percentage' | 'absolute'>('percentage');
  const filtered = assets.filter((asset) => kind === 'all' || asset.kind === kind);
  const valuation = resolvePortfolioValuationV2(assets, dailySnapshots, market, kind);
  const current = valuation.currentKnownValue;
  const acquisitionValue = valuation.acquisitionKnownValue;
  const currentValueComplete = valuation.currentComplete;
  const growthComplete = valuation.growthComplete;
  const absolute = valuation.absoluteGrowth;
  const percent = valuation.percentageGrowth;
  const snapshotDate = valuation.acceptedSnapshotDate
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${valuation.acceptedSnapshotDate}T00:00:00Z`))
    : null;
  const valuationFreshnessLabel = snapshotDate
    ? `Account value stored ${snapshotDate}`
    : valuation.snapshotFallbackReason === 'stale_prices'
      ? `Fresh catalog values · stored daily value is older`
      : `Current source · ${marketSourceDate(market)}`;
  const cards = assets.filter((asset) => asset.kind === 'card');
  const sealed = assets.filter((asset) => asset.kind === 'sealed');
  const mostValuable = (list: DemoAsset[]) => [...list].filter((asset) => asset.quote[market] !== null).sort((a, b) => (b.quote[market] ?? 0) * b.quantity - (a.quote[market] ?? 0) * a.quantity).slice(0, 4);
  const gainers = [...filtered].filter((asset) => asset.quote[market] !== null && asset.change[market][period] !== null && (asset.change[market][period] ?? 0) > 0).sort((a, b) => {
    const ap = a.change[market][period] ?? 0, bp = b.change[market][period] ?? 0;
    const aa = (a.quote[market] ?? 0) * a.quantity - (a.quote[market] ?? 0) * a.quantity / (1 + ap / 100);
    const ba = (b.quote[market] ?? 0) * b.quantity - (b.quote[market] ?? 0) * b.quantity / (1 + bp / 100);
    return gainRank === 'percentage' ? bp - ap : ba - aa;
  }).slice(0, 4);
  const allBySet = Object.entries(filtered.reduce<Record<string, number>>((acc, asset) => {
    const quote = asset.quote[market];
    if (quote !== null && Number.isFinite(quote)) acc[asset.setCode] = (acc[asset.setCode] ?? 0) + quote * asset.quantity;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  const bySet = allBySet.slice(0, 5);
  const allocationTotal = allBySet.reduce((sum, [, value]) => sum + value, 0);
  const allocationPercentage = (value: number) => allocationTotal > 0 ? value / allocationTotal * 100 : 0;
  const allocationColors = ['#f0a36b', '#d5ab5f', '#8075d6', '#5b9cc7', '#567f71'];
  let allocationCursor = 0;
  const allocationSegments = bySet.map(([, value], index) => {
    const start = allocationCursor;
    allocationCursor += allocationPercentage(value);
    return `${allocationColors[index]} ${start.toFixed(2)}% ${allocationCursor.toFixed(2)}%`;
  });
  if (allocationCursor < 100) allocationSegments.push(`#dfddd7 ${allocationCursor.toFixed(2)}% 100%`);
  const allocationGradient = `conic-gradient(${allocationSegments.join(', ')})`;
  const totalQuantity = (list: DemoAsset[]) => list.reduce((sum, asset) => sum + asset.quantity, 0);

  return <div className="page dashboard-page">
    <section className="control-bar"><div className="control-group"><label>Market source</label><Segmented value={market} onChange={setMarket} label="Market source" options={[{ value: 'cardmarket', label: 'Cardmarket · EU' }, { value: 'tcgplayer', label: 'US market · USD' }]} /></div><div className="control-group"><label>Trend chart window</label><Segmented value={period} onChange={setPeriod} label="Rolling average period" options={[{ value: '1D', label: '1-day avg' }, { value: '1W', label: '7-day avg' }, { value: '1M', label: '30-day avg' }]} /></div><div className="control-group"><label>Holdings</label><Segmented value={kind} onChange={setKind} label="Asset type" options={[{ value: 'all', label: 'All' }, { value: 'card', label: 'Cards' }, { value: 'sealed', label: 'Sealed' }]} /></div><div className="currency-display"><span>Currency</span><strong>{currencyFor(market)}</strong></div></section>
    <section className="hero-grid">
      <article className="portfolio-hero"><div className="portfolio-heading"><div><p className="eyebrow">{currentValueComplete ? 'Current market value' : 'Known current market value'}</p><h2>{formatMoney(current, market)}</h2>{valuation.empty ? <div className="portfolio-change incomplete"><span><Icon name="plus"/>No holdings yet</span><small>Add your first card or sealed product to start portfolio growth tracking.</small></div> : absolute === null || percent === null ? <div className="portfolio-change incomplete"><span><Icon name="info"/>Growth unavailable</span><small>Current prices: {valuation.currentPricedQuantity} of {valuation.totalQuantity} copies · acquisition values: {valuation.acquisitionPricedQuantity} of {valuation.totalQuantity} copies.</small></div> : <div className={`portfolio-change ${absolute >= 0 ? 'positive' : 'negative'}`}><span><Icon name={absolute >= 0 ? 'arrow-up' : 'arrow-down'} />{absolute >= 0 ? '+' : ''}{formatMoney(absolute, market)}</span><strong>{percent >= 0 ? '+' : ''}{percent.toFixed(2)}%</strong><small>since each remaining copy was added</small></div>}</div><div className="price-freshness"><span className="live-pulse" />{valuationFreshnessLabel}<MarketDataBadge compact /></div></div><PriceChart assets={filtered} market={market} period={period} /><div className="chart-axis"><span>{period === '1D' ? '1-day average' : period === '1W' ? '7-day average' : '30-day average'}</span><span>Current trend</span></div></article>
      <aside className="portfolio-stats"><div className="section-label"><span>Collection at a glance</span><button onClick={() => navigate('/collection')}>View collection <Icon name="chevron" size={14}/></button></div><div className="stat-grid"><div><span className="stat-icon coral"><Icon name="cards" /></span><strong>{totalQuantity(cards)}</strong><small>Individual cards</small></div><div><span className="stat-icon gold"><Icon name="box" /></span><strong>{totalQuantity(sealed)}</strong><small>Sealed products</small></div><div><span className="stat-icon blue"><Icon name="collection" /></span><strong>{new Set(assets.map((asset) => asset.setCode)).size}</strong><small>Unique sets</small></div><div><span className="stat-icon violet"><Icon name="chart" /></span><strong>{assets.filter((asset) => asset.quote[market] !== null).length}</strong><small>Priced holdings</small></div></div><div className="cost-basis"><div><span>{growthComplete ? 'Market value when added' : 'Known value when added'}</span><strong>{formatMoney(acquisitionValue, market)}</strong></div><div><span>Growth since added</span><strong className={absolute === null ? '' : absolute >= 0 ? 'positive' : 'negative'}>{valuation.empty ? 'Not started' : absolute === null ? 'Incomplete pricing' : `${absolute >= 0 ? '+' : ''}${formatMoney(absolute, market)}`}</strong></div><p><Icon name="lock" size={14}/>{valuation.empty ? 'Add an item to begin private daily history' : snapshotDate ? 'Stored daily in your private account' : 'Using current holdings until the next matching daily valuation'}</p></div></aside>
    </section>
    <section className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">Portfolio leaders</p><h2>Most valuable holdings</h2></div><button className="text-button" onClick={() => navigate('/collection')}>Explore collection <Icon name="chevron" size={15}/></button></div><div className="valuable-grid"><HoldingRank title="Cards" icon="cards" assets={mostValuable(cards)} market={market}/><HoldingRank title="Sealed products" icon="box" assets={mostValuable(sealed)} market={market}/></div></section>
    <section className="dashboard-columns"><article className="panel gainers-panel"><div className="panel-header"><div><p className="eyebrow">Momentum</p><h2>Top gainers</h2></div><Segmented value={gainRank} onChange={setGainRank} label="Gainer ranking" options={[{ value: 'percentage', label: '%' }, { value: 'absolute', label: currencyFor(market) }]} /></div><div className="gainer-list">{gainers.map((asset, index) => {
        const pct = asset.change[market][period] ?? 0, quote = asset.quote[market] ?? 0, start = quote / (1 + pct / 100), gain = (quote - start) * asset.quantity;
        return <button key={asset.id}><span className="rank">0{index + 1}</span><CardArt asset={asset} size="xs"/><span className="gainer-name"><strong>{asset.name}</strong><small>{asset.number ?? asset.productType} · Qty {asset.quantity}</small></span><span className="mini-spark"><PriceChart assets={[asset]} market={market} period={period} compact /></span><span className="gainer-value"><strong>{formatMoney(quote, market)}</strong><small>{formatMoney(start, market)} start</small></span><span className="gainer-change"><Trend value={pct}/><small>+{formatMoney(gain, market)}</small></span></button>;
      })}</div><p className="history-note"><Icon name="info" size={15}/>Items without a valid historical snapshot are excluded, never treated as zero.</p></article>
      <article className="panel breakdown-panel"><div className="panel-header"><div><p className="eyebrow">Allocation</p><h2>{currentValueComplete ? 'Value by set' : 'Known value by set'}</h2></div><Chip tone="neutral">Top 5</Chip></div>{allocationTotal <= 0 ? <EmptyState icon="chart" title="No priced allocation yet" detail="Add a priced card or sealed product to see how value is distributed across sets." /> : <><div className="donut-wrap"><div className="donut" style={{ background: allocationGradient }}><span><strong>{allBySet.length}</strong><small>priced sets</small></span></div><div className="legend-list">{bySet.map(([set, value], index) => <div key={set}><i className={`legend-${index}`} /><span><strong>{set}</strong><small>{allocationPercentage(value).toFixed(1)}%</small></span><b>{formatMoney(value, market)}</b></div>)}</div></div><div className="concentration"><span>Largest concentration</span><strong>{bySet[0][0]} · {allocationPercentage(bySet[0][1]).toFixed(1)}%</strong><div><i style={{ width: `${allocationPercentage(bySet[0][1])}%` }} /></div></div></>}</article>
    </section>
    <section className="dashboard-section"><div className="section-heading"><div><p className="eyebrow">Logbook</p><h2>Recent activity</h2></div><Chip tone="blue"><Icon name="lock" size={13}/>Only visible to you</Chip></div>{activity.length === 0 ? <EmptyState icon="clock" title="No account activity yet" detail="Collection changes, community joins, and trades will appear here after you make them." /> : <div className="activity-row">{activity.map((item) => <div key={item.title}><span><Icon name={item.icon as Parameters<typeof Icon>[0]['name']} /></span><strong>{item.title}</strong><small>{item.detail}</small><time>{item.time}</time></div>)}</div>}</section>
  </div>;
}

function HoldingRank({ title, icon, assets, market }: { title: string; icon: Parameters<typeof Icon>[0]['name']; assets: DemoAsset[]; market: Market }) {
  return <article className="holding-rank"><header><span><Icon name={icon}/></span><h3>{title}</h3><small>By total holding value</small></header><div>{assets.map((asset, index) => <button key={asset.id}><span className="rank-number">{index + 1}</span><CardArt asset={asset} size="sm"/><span className="holding-name"><strong>{asset.name}</strong><small>{asset.setCode}{asset.number ? ` · ${asset.number}` : ''}</small><em>{asset.variant}</em></span><span className="holding-qty">×{asset.quantity}</span><span className="holding-price"><strong>{formatMoney((asset.quote[market] ?? 0) * asset.quantity, market)}</strong><small>{formatMoney(asset.quote[market], market)} each</small><em>{marketSourceLabel(market)} · {marketSourceDate(market)}</em></span></button>)}</div></article>;
}

function CollectionPage({ assets, setAssets, productionCollection, market, navigate, notify }: { assets: DemoAsset[]; setAssets: (assets: DemoAsset[]) => void; productionCollection?: ProductionCollectionRuntimeV2; market: Market; navigate: (path: string) => void; notify: (message: string) => void }) {
  const [tab, setTab] = useState<AssetKind>('card');
  const [view, setView] = useState<ViewMode>('grid');
  const [query, setQuery] = useState('');
  const [setFilter, setSetFilter] = useState('all');
  const [rarity, setRarity] = useState('all');
  const [sort, setSort] = useState('value-desc');
  const [selected, setSelected] = useState<DemoAsset | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [removeTarget, setRemoveTarget] = useState<DemoAsset | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const openAsset = (asset: DemoAsset) => {
    setSelected(asset);
    setNoteDraft(asset.note ?? '');
  };
  const visible = assets.filter((asset) => asset.kind === tab)
    .filter((asset) => !query || `${asset.name} ${asset.number} ${asset.set} ${asset.setCode}`.toLowerCase().includes(query.toLowerCase()))
    .filter((asset) => setFilter === 'all' || asset.setCode === setFilter)
    .filter((asset) => rarity === 'all' || asset.rarity === rarity)
    .sort((a, b) => sort === 'value-desc' ? ((b.quote[market] ?? -1) * b.quantity) - ((a.quote[market] ?? -1) * a.quantity)
      : sort === 'value-asc' ? ((a.quote[market] ?? Infinity) * a.quantity) - ((b.quote[market] ?? Infinity) * b.quantity)
      : sort === 'gain' ? (b.change[market]['1M'] ?? -999) - (a.change[market]['1M'] ?? -999)
      : sort === 'loss' ? (a.change[market]['1M'] ?? 999) - (b.change[market]['1M'] ?? 999)
      : sort === 'quantity' ? b.quantity - a.quantity : a.name.localeCompare(b.name));
  const uniqueSets = [...new Set(assets.filter((a) => a.kind === tab).map((a) => a.setCode))];
  const rarities = [...new Set(assets.filter((a) => a.kind === tab).map((a) => a.rarity))];
  const collectionValuation = summarizePortfolioGrowth(assets, market);
  const marketRegion = market === 'cardmarket' ? 'EU' : 'US';
  const collectionValueLabel = collectionValuation.totalQuantity === 0
    ? 'No holdings yet'
    : collectionValuation.currentComplete
      ? `Current ${marketRegion} reference · all ${collectionValuation.totalQuantity} copies priced`
      : `Known current ${marketRegion} reference · ${collectionValuation.currentPricedQuantity} of ${collectionValuation.totalQuantity} copies priced`;
  const updateQty = async (asset: DemoAsset, delta: number) => {
    const next = Math.max(1, asset.quantity + delta);
    const actualDelta = next - asset.quantity;
    if (actualDelta === 0) return;
    if (productionCollection) {
      try {
        const stillActive = await productionCollection.setQuantity(asset, next);
        if (!stillActive) return;
        setSelected(null);
        notify(actualDelta > 0 ? `Quantity updated to ${next} · acquisition value captured` : `Quantity updated to ${next}`);
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : 'Quantity could not be saved');
      }
      return;
    }
    const capturedAt = new Date().toISOString();
    const priorLots: AcquisitionLot[] = asset.acquisitionLots?.length ? asset.acquisitionLots : [{
      id: `legacy-${asset.id}`,
      addedAt: asset.addedAt,
      quantity: asset.quantity,
      quoteAtAdd: { ...asset.quote },
      sourceUpdatedAt: asset.sourceUpdatedAt,
    }];
    const acquisition: AcquisitionLot = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? `lot-${crypto.randomUUID()}` : `lot-${capturedAt}-${asset.id}`,
      addedAt: capturedAt,
      quantity: actualDelta,
      quoteAtAdd: { ...asset.quote },
      sourceUpdatedAt: asset.sourceUpdatedAt,
    };
    const updated: DemoAsset = {
      ...asset,
      quantity: next,
      acquisitionLots: actualDelta > 0 ? [...priorLots, acquisition] : priorLots,
    };
    setAssets(assets.map((item) => item.id === asset.id ? updated : item));
    setSelected(updated);
    notify(actualDelta > 0 ? `Quantity updated to ${next} · current value captured` : `Quantity updated to ${next}`);
  };
  const confirmRemoval = async () => {
    if (!removeTarget) return;
    if (productionCollection) {
      try {
        const stillActive = await productionCollection.remove(removeTarget);
        if (!stillActive) return;
        setRemoveTarget(null);
        notify('Item removed from your private collection');
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : 'Item could not be removed');
      }
      return;
    }
    setAssets(assets.filter((asset) => asset.id !== removeTarget.id));
    setRemoveTarget(null);
    notify('Item removed from your collection');
  };
  const saveChanges = async () => {
    if (!selected) return;
    const privateNote = noteDraft.trim() || undefined;
    if (productionCollection) {
      try {
        const stillActive = await productionCollection.updateNote(selected, privateNote);
        if (!stillActive) return;
        setSelected(null);
        notify('Private note saved to your account');
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : 'Item details could not be saved');
      }
      return;
    }
    const updated = { ...selected, note: privateNote };
    setAssets(assets.map((asset) => asset.id === selected.id ? updated : asset));
    setSelected(updated);
    notify('Item details saved');
  };
  return <div className="page collection-page">
    <section className="collection-summary"><div><span className="summary-icon"><Icon name="lock"/></span><span><strong>{assets.filter((asset) => asset.kind === 'card').reduce((sum, asset) => sum + asset.quantity, 0)} cards</strong><small>Your full collection is never public</small></span></div><div><strong>{formatMoney(collectionValuation.currentKnownValue, market)}</strong><small>{collectionValueLabel}</small></div><Button onClick={() => navigate('/collection/add')} icon="plus">Add items</Button></section>
    <div className="collection-tabs"><button className={tab === 'card' ? 'active' : ''} onClick={() => setTab('card')}><Icon name="cards"/>Cards <span>{assets.filter((asset) => asset.kind === 'card').length}</span></button><button className={tab === 'sealed' ? 'active' : ''} onClick={() => setTab('sealed')}><Icon name="box"/>Sealed products <span>{assets.filter((asset) => asset.kind === 'sealed').length}</span></button></div>
    <section className="collection-toolbar"><label className="search-field"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab === 'card' ? 'name, set or card number' : 'sealed products'}`} aria-label="Search collection" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close" size={15}/></button>}</label><Button variant="secondary" onClick={() => setFiltersOpen((open) => !open)} icon="filter">Filters{(setFilter !== 'all' || rarity !== 'all') && <span className="filter-count">{Number(setFilter !== 'all') + Number(rarity !== 'all')}</span>}</Button><label className="select-field"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="value-desc">Highest value</option><option value="value-asc">Lowest value</option><option value="gain">Largest gain</option><option value="loss">Largest loss</option><option value="name">Name</option><option value="quantity">Quantity</option></select></label><Segmented value={view} onChange={setView} label="Collection view" options={[{ value: 'grid', label: '', icon: 'grid' }, { value: 'table', label: '', icon: 'list' }]} /></section>
    {filtersOpen && <section className="filter-panel"><label>Set<select value={setFilter} onChange={(event) => setSetFilter(event.target.value)}><option value="all">All sets</option>{uniqueSets.map((set) => <option key={set}>{set}</option>)}</select></label><label>{tab === 'card' ? 'Rarity' : 'Product availability'}<select value={rarity} onChange={(event) => setRarity(event.target.value)}><option value="all">All</option>{rarities.map((value) => <option key={value}>{value}</option>)}</select></label><label>Condition<select><option>All conditions</option><option>Near Mint</option><option>Excellent</option></select></label><label>Language<select><option>All languages</option><option>English</option><option>French</option><option>Japanese</option></select></label><Button variant="ghost" onClick={() => { setSetFilter('all'); setRarity('all'); }}>Clear filters</Button></section>}
    <div className="result-meta"><span><strong>{visible.length}</strong> {tab === 'card' ? 'card entries' : 'sealed products'}</span><MarketDataBadge compact /></div>
    {visible.length === 0 ? <EmptyState icon="search" title="No matching holdings" detail="Try removing a filter or search for another card." action={<Button variant="secondary" onClick={() => { setQuery(''); setSetFilter('all'); setRarity('all'); }}>Clear search</Button>} /> : view === 'grid' ? <div className="asset-grid">{visible.map((asset) => <button className="asset-card" key={asset.id} onClick={() => openAsset(asset)}><CardArt asset={asset} size="lg"/><div className="asset-card-body"><div className="asset-labels"><Chip tone="neutral">{asset.setCode}</Chip>{asset.variant !== 'Standard' && <Chip tone="gold">{asset.variant}</Chip>}</div><h3>{asset.name}</h3><p>{asset.number ?? asset.productType} · {asset.rarity}</p><div className="asset-price"><span><strong>{formatMoney(asset.quote[market], market)}</strong><small>Unit reference</small></span><Trend value={asset.change[market]['1M']} /></div><footer><span>Qty <strong>{asset.quantity}</strong></span><span>Total <strong>{formatMoney(asset.quote[market] === null ? null : asset.quote[market] * asset.quantity, market)}</strong></span></footer>{asset.quote[market] === null && <div className="missing-price"><Icon name="info"/>Market price unavailable</div>}</div></button>)}</div>
      : <div className="asset-table-wrap"><table className="asset-table"><thead><tr><th>Item</th><th>Set / number</th><th>Details</th><th>Qty</th><th>Unit value</th><th>1M change</th><th>Total</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visible.map((asset) => <tr key={asset.id} onClick={() => openAsset(asset)}><td><span className="table-item"><CardArt asset={asset} size="xs"/><strong>{asset.name}</strong></span></td><td>{asset.setCode}<small>{asset.number ?? asset.productType}</small></td><td>{asset.variant}<small>{asset.condition} · {asset.language}</small></td><td>{asset.quantity}</td><td>{formatMoney(asset.quote[market], market)}</td><td><Trend value={asset.change[market]['1M']}/></td><td><strong>{formatMoney(asset.quote[market] === null ? null : asset.quote[market]! * asset.quantity, market)}</strong></td><td><Icon name="chevron"/></td></tr>)}</tbody></table></div>}
    <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ''} eyebrow="Private collection item" wide>{selected && <div className="asset-detail">
      <div className="detail-visual"><CardArt asset={selected} size="lg"/><div className="catalog-stamp"><Icon name="shield"/><span><strong>{selected.kind === 'sealed' ? (selected.imageSourceRelationship === 'contained-unit' ? 'Contents represented' : 'Product image verified') : 'Printing matched'}</strong><small>Cardmarket product {selected.cardmarketProductId ?? 'unavailable'} · {selected.number ?? selected.productType}</small></span></div></div>
      <div className="detail-content"><div className="asset-labels"><Chip tone="neutral">{selected.rarity}</Chip><Chip tone="gold">{selected.variant}</Chip><Chip tone="blue">{selected.language}</Chip></div><h3>{selected.set}</h3><p className="detail-number">{selected.number ?? selected.productType} · One Piece Card Game</p>
        {selected.kind === 'sealed' && selected.imageSourceRelationship === 'contained-unit' && <p className="reference-note"><Icon name="box"/>This is the real corresponding contained product, not a photo of the outer case.</p>}
        <div className="detail-prices"><div><span>Cardmarket trend · EUR</span><strong>{formatMoney(selected.quote.cardmarket, 'EUR')}</strong><small>Official daily guide · {marketSourceDate('cardmarket')}</small></div><div><span>{assetUsSourceLabel(selected)}</span><strong>{formatMoney(selected.quote.tcgplayer, 'USD')}</strong><small>Daily source snapshot · {assetUsSourceDate(selected)}</small></div></div><div className="detail-chart"><header><div><strong>Trend comparison</strong><small>Current trend vs 30-day rolling average</small></div><Trend value={selected.change[market]['1M']}/></header><PriceChart assets={[selected]} market={market} period="1M" /></div><dl className="detail-facts"><div><dt>Condition</dt><dd>{selected.condition}</dd></div><div><dt>First added</dt><dd>{new Date(selected.addedAt).toLocaleDateString()}</dd></div><div><dt>Purchase price</dt><dd>{selected.purchasePrice ? formatMoney(selected.purchasePrice, selected.purchaseCurrency ?? currencyFor(market)) : 'Not recorded'}</dd></div><div><dt>Portfolio contribution</dt><dd>{formatMoney(selected.quote[market] === null ? null : selected.quote[market] * selected.quantity, market)}</dd></div><div><dt>Acquisition captures</dt><dd>{selected.acquisitionLots?.length ?? 0}</dd></div><div><dt>Last captured value</dt><dd>{latestAcquisition(selected) ? `${formatMoney(latestAcquisition(selected)?.quoteAtAdd.cardmarket ?? null, 'EUR')} / ${formatMoney(latestAcquisition(selected)?.quoteAtAdd.tcgplayer ?? null, 'USD')}` : 'Awaiting first account capture'}</dd></div></dl><div className="private-note"><Icon name="lock"/><span><strong>Private note</strong><textarea aria-label="Private note" value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="Storage location, provenance, grading notes…" maxLength={300}/></span></div><div className="quantity-editor"><span><strong>Quantity</strong><small>{selected.catalogArchived ? 'Archived item · decrease or remove only' : 'Update copies held'}</small></span><div><Button variant="secondary" size="icon" disabled={productionCollection?.mutating} onClick={() => void updateQty(selected, -1)} aria-label="Decrease quantity">−</Button><strong>{selected.quantity}</strong><Button variant="secondary" size="icon" disabled={productionCollection?.mutating || selected.catalogArchived} onClick={() => void updateQty(selected, 1)} aria-label={selected.catalogArchived ? 'Archived items cannot be increased' : 'Increase quantity'}>+</Button></div></div><div className="modal-actions"><Button variant="danger" disabled={productionCollection?.mutating} onClick={() => { setSelected(null); setRemoveTarget(selected); }} icon="trash">Remove</Button><Button disabled={productionCollection?.mutating} onClick={() => void saveChanges()} icon="edit">Save changes</Button></div></div>
    </div>}</Modal>
    <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)} title="Remove from collection?" eyebrow="Confirmation required"><div className="confirmation"><span className="danger-icon"><Icon name="trash"/></span><p>This removes <strong>{removeTarget?.name}</strong> from the active collection. Its private acquisition and valuation history remains in your account audit trail.</p><div><Button variant="secondary" onClick={() => setRemoveTarget(null)}>Keep item</Button><Button variant="danger" disabled={productionCollection?.mutating} onClick={() => void confirmRemoval()}>Remove item</Button></div></div></Modal>
  </div>;
}

function AddItemsPage({ assets, setAssets, productionCollection, market, navigate, notify, browseOnly = false, onRequestAuthentication }: { assets: DemoAsset[]; setAssets: (assets: DemoAsset[]) => void; productionCollection?: ProductionCollectionRuntimeV2; market: Market; navigate: (path: string) => void; notify: (message: string) => void; browseOnly?: boolean; onRequestAuthentication?: () => void }) {
  const [tab, setTab] = useState<AssetKind>('card');
  const [query, setQuery] = useState('');
  const [catalogSet, setCatalogSet] = useState('all');
  const [selected, setSelected] = useState<DemoAsset | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState('Near Mint');
  const [purchase, setPurchase] = useState('');
  const [note, setNote] = useState('');
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [validation, setValidation] = useState('');
  const [resultLimit, setResultLimit] = useState(40);
  const [saving, setSaving] = useState(false);

  const cardGroups = useMemo(() => {
    const grouped = new Map<string, DemoAsset[]>();
    for (const asset of catalogAssets) {
      if (asset.kind !== 'card' || asset.catalogAliasOf) continue;
      const groupId = asset.rulesCardId ?? asset.number ?? asset.id;
      grouped.set(groupId, [...(grouped.get(groupId) ?? []), asset]);
    }
    return [...grouped.entries()].map(([id, arts]) => {
      const orderedArts = [...arts].sort((left, right) => {
        const leftBase = /standard|base art/i.test(left.variant) ? 0 : 1;
        const rightBase = /standard|base art/i.test(right.variant) ? 0 : 1;
        const leftLanguage = left.language === 'English' ? 0 : 1;
        const rightLanguage = right.language === 'English' ? 0 : 1;
        return leftBase - rightBase || leftLanguage - rightLanguage || left.setCode.localeCompare(right.setCode) || left.variant.localeCompare(right.variant);
      });
      const representative = orderedArts[0];
      return {
        id,
        arts: orderedArts,
        representative,
      };
    }).sort((left, right) => left.representative.name.localeCompare(right.representative.name) || left.id.localeCompare(right.id));
  }, []);

  const cardGroupIndex = useMemo(() => new Map(cardGroups.map((group) => [group.id, group.arts])), [cardGroups]);
  const catalogSets = useMemo(() => [...new Set(catalogAssets
    .filter((asset) => asset.kind === tab)
    .map((asset) => asset.setCode))]
    .sort((left, right) => left.localeCompare(right, 'en-US', { numeric: true })), [tab]);
  const normalizedQuery = normalizeCatalogQueryV5(query);
  const allResults = tab === 'card'
    ? cardGroups
      .map((group) => selectCardGroupMatchV5(group.arts, normalizedQuery, catalogSet))
      .filter((asset): asset is DemoAsset => asset !== null)
    : catalogAssets
      .filter((asset) => asset.kind === 'sealed')
      .filter((asset) => catalogSet === 'all' || asset.setCode === catalogSet)
      .filter((asset) => !normalizedQuery || `${asset.name} ${asset.set} ${asset.setCode} ${asset.productType ?? ''}`.toLocaleLowerCase('en-US').includes(normalizedQuery));
  const results = allResults.slice(0, resultLimit);
  const availableArts = selected?.kind === 'card'
    ? cardGroupIndex.get(selected.rulesCardId ?? selected.number ?? selected.id) ?? [selected]
    : [];
  const selectedCardmarketReference = selected
    ? resolveCardmarketArtworkReferenceV10(selected)
    : null;

  useEffect(() => { setResultLimit(40); }, [catalogSet, query, tab]);

  const reset = () => { setSelected(null); setQuery(''); setQuantity(1); setPurchase(''); setNote(''); setValidation(''); };
  const save = async (merge = false) => {
    if (browseOnly && viewerMutationDecisionV4('guest', 'save_collection') === 'requires_auth') {
      onRequestAuthentication?.();
      return;
    }
    if (!selected) { setValidation(`Select a ${tab === 'card' ? 'card' : 'sealed product'} first.`); return; }
    if (quantity < 1 || quantity > 999) { setValidation('Quantity must be between 1 and 999.'); return; }
    const existing = assets.find((asset) => (asset.catalogId ?? asset.id) === selected.id && asset.condition === condition && asset.language === selected.language);
    const privateNoteForSave = resolvePrivateNoteForAddV2(note, existing?.note);
    if (existing && !merge) { setDuplicateOpen(true); return; }
    if (productionCollection) {
      setSaving(true);
      setValidation('');
      try {
        const stillActive = await productionCollection.add({
          asset: selected,
          condition,
          quantity,
          privateNote: privateNoteForSave,
          purchaseUnitAmount: purchase ? Number(purchase) : undefined,
          purchaseCurrency: currencyFor(market),
        });
        if (!stillActive) return;
        notify(existing ? `${existing.name} quantity increased by ${quantity}` : `${selected.name} added to your private collection`);
        setDuplicateOpen(false);
        reset();
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'This item could not be saved to your account.';
        setValidation(message);
        notify(message);
      } finally {
        setSaving(false);
      }
      return;
    }
    const capturedAt = new Date().toISOString();
    const acquisition: AcquisitionLot = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? `lot-${crypto.randomUUID()}` : `lot-${capturedAt}-${assets.length}`,
      addedAt: capturedAt,
      quantity,
      quoteAtAdd: { ...selected.quote },
      sourceUpdatedAt: selected.sourceUpdatedAt,
    };
    if (existing) {
      const previousLots: AcquisitionLot[] = existing.acquisitionLots?.length ? existing.acquisitionLots : [{
        id: `legacy-${existing.id}`,
        addedAt: existing.addedAt,
        quantity: existing.quantity,
        quoteAtAdd: { ...existing.quote },
        sourceUpdatedAt: existing.sourceUpdatedAt,
      }];
      setAssets(assets.map((asset) => asset.id === existing.id ? {
        ...asset,
        catalogId: selected.id,
        quantity: asset.quantity + quantity,
        purchasePrice: purchase ? Number(purchase) : asset.purchasePrice,
        note: privateNoteForSave,
        quote: selected.quote,
        pricing: selected.pricing,
        sourceUpdatedAt: selected.sourceUpdatedAt,
        acquisitionLots: [...previousLots, acquisition],
      } : asset));
      notify(`${existing.name} quantity increased by ${quantity}`);
    } else {
      const idStem = `${selected.id}--${condition.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '-')}`;
      const holdingId = assets.some((asset) => asset.id === selected.id)
        ? (assets.some((asset) => asset.id === idStem) ? `${idStem}-${Date.now()}` : idStem)
        : selected.id;
      setAssets([...assets, {
        ...selected,
        id: holdingId,
        catalogId: selected.id,
        quantity,
        condition,
        language: selected.language,
        purchasePrice: purchase ? Number(purchase) : undefined,
        note: privateNoteForSave,
        addedAt: capturedAt,
        acquisitionLots: [acquisition],
      }]);
      notify(`${selected.name} added to your collection`);
    }
    setDuplicateOpen(false);
    reset();
  };
  const selectedCatalogDetails = selected ? <>
    <div className="selected-preview"><CardArt asset={selected} size="md"/><div><Chip tone="neutral">{selected.setCode}</Chip><h3>{selected.name}</h3><p>{selected.set}</p><small>{selected.number ?? selected.productType} · {selected.rarity}</small></div></div>
    {selected.kind === 'card' && <section className="art-picker" aria-labelledby="art-picker-title">
      <header><span><strong id="art-picker-title">Choose the exact art</strong><small>{availableArts.length} sourced {availableArts.length === 1 ? 'printing' : 'printings'} for {selected.rulesCardId ?? selected.number}</small></span><Chip tone="blue">{selected.language} printing</Chip></header>
      <div>{availableArts.map((art) => {
        const cardmarketReference = resolveCardmarketArtworkReferenceV10(art);
        const displayedReference = market === 'cardmarket'
          ? cardmarketReference.displayValue
          : formatMoney(art.quote.tcgplayer, 'USD');
        const displayedReferenceLabel = market === 'cardmarket'
          ? cardmarketReference.label
          : 'US market';
        return <button type="button" key={art.id} className={selected.id === art.id ? 'selected' : ''} aria-pressed={selected.id === art.id} title={market === 'cardmarket' ? cardmarketReference.detail : undefined} onClick={() => { setSelected(art); setValidation(''); }}><CardArt asset={art} size="xs"/><span><strong>{art.variant}</strong><small>{art.language} · {art.setCode}</small><em>{displayedReference} · {displayedReferenceLabel}</em></span>{selected.id === art.id && <i><Icon name="check"/></i>}</button>;
      })}</div>
    </section>}
    <div className="reference-pair"><div><span>Cardmarket trend · EUR</span><strong>{selectedCardmarketReference?.displayValue}</strong><small><span className="live-pulse"/>{selectedCardmarketReference?.label} · {marketSourceDate('cardmarket')}</small></div><div><span>{assetUsSourceLabel(selected)}</span><strong>{formatMoney(selected.quote.tcgplayer, 'USD')}</strong><small><span className="live-pulse"/>Daily source snapshot · {assetUsSourceDate(selected)}</small></div></div>
    <p className="reference-note"><Icon name="info"/>{selectedCardmarketReference?.detail} {selected?.kind === 'sealed' ? 'Cardmarket sealed trends are product-level and can combine listing languages.' : 'Source values are not adjusted by condition.'}</p>
    {selected?.kind === 'sealed' && selected.imageSourceRelationship === 'contained-unit' && <p className="reference-note"><Icon name="box"/>No verified photo exists for this exact outer case, so the catalog clearly shows the real corresponding contained product instead.</p>}
  </> : null;
  return <div className="page add-page">
    {!browseOnly && <section className="add-progress"><div className="active"><span>1</span><strong>Find item</strong></div><i /><div className={selected ? 'active' : ''}><span>2</span><strong>Add details</strong></div><i /><div><span>3</span><strong>Review</strong></div></section>}
    <div className="add-layout">
      <section className="add-catalog panel">
        <div className="panel-header"><div><p className="eyebrow">One Piece Card Game</p><h2>Search the complete catalog</h2></div><MarketDataBadge compact /></div>
        <Segmented value={tab} onChange={(value) => { setTab(value); setSelected(null); setQuery(''); setCatalogSet('all'); setCondition(value === 'sealed' ? 'Factory sealed' : 'Near Mint'); }} label="Catalog type" options={[{ value: 'card', label: 'Individual card', icon: 'cards' }, { value: 'sealed', label: 'Sealed product', icon: 'box' }]} />
        <div className="catalog-search-row"><label className="search-field catalog-search"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'card' ? 'Search card name, number, set code or art' : 'Search product, set or type'} aria-label="Search catalog" /></label><label className="select-field catalog-set-filter"><span>Set</span><select value={catalogSet} onChange={(event) => { setCatalogSet(event.target.value); setSelected(null); }}><option value="all">All current sets</option>{catalogSets.map((setCode) => <option key={setCode} value={setCode}>{setCode}</option>)}</select></label></div>
        <p className="catalog-hint">{tab === 'card' ? `${cardGroups.length.toLocaleString()} card numbers with every sourced art · try “Nami” or “OP01-016”` : `${allResults.length.toLocaleString()} released, source-backed sealed products · try “Booster Box”`}</p>
        <div className="catalog-results" aria-live="polite">
          {results.map((asset) => {
            const groupId = asset.rulesCardId ?? asset.number ?? asset.id;
            const groupArts = tab === 'card' ? cardGroupIndex.get(groupId) ?? [asset] : [asset];
            const artCount = groupArts.length;
            const cardmarketReference = resolveCatalogCardmarketReferenceV10(asset, groupArts);
            const isSelected = tab === 'card'
              ? selected?.kind === 'card' && (selected.rulesCardId ?? selected.number ?? selected.id) === groupId
              : selected?.id === asset.id;
            return <button type="button" key={asset.id} className={isSelected ? 'selected' : ''} onClick={() => { setSelected(asset); setCondition(asset.kind === 'sealed' ? 'Factory sealed' : 'Near Mint'); setValidation(''); }}>
              <CardArt asset={asset} size="sm"/>
              <span><strong>{asset.name}</strong><small>{asset.setCode} · {asset.number ?? asset.productType}</small><em>{tab === 'card' ? `${artCount} ${artCount === 1 ? 'art' : 'arts'} available` : `${asset.productType} · ${asset.language}`}</em></span>
              <span className="catalog-price" title={market === 'cardmarket' ? cardmarketReference.detail : undefined}><strong>{market === 'cardmarket' ? cardmarketReference.displayValue : formatMoney(asset.quote.tcgplayer, market)}</strong><small>{market === 'cardmarket' ? cardmarketReference.label : 'US market'}</small></span>
              <i>{isSelected ? <Icon name="check"/> : <Icon name="chevron"/>}</i>
            </button>;
          })}
          {results.length === 0 && <EmptyState icon={tab === 'card' ? 'cards' : 'box'} title="No catalog matches" detail="Try a card number, character, set code, or product type." />}
        </div>
        <footer className="catalog-pagination">
          <span>Showing {results.length.toLocaleString()} of {allResults.length.toLocaleString()}</span>
          {results.length < allResults.length && <Button type="button" variant="secondary" size="sm" onClick={() => setResultLimit((limit) => limit + 40)}>Load 40 more</Button>}
        </footer>
      </section>
      <section className="add-details panel">
        <div className="panel-header"><div><p className="eyebrow">{browseOnly ? 'Catalog details' : 'Collection details'}</p><h2>{selected ? selected.name : `Select a ${tab === 'card' ? 'card' : 'product'}`}</h2></div>{selected && <Chip tone="gold">{selected.variant}</Chip>}</div>
        {!selected ? <EmptyState icon={tab === 'card' ? 'cards' : 'box'} title="Choose a catalog entry" detail={browseOnly ? 'Select an item on the left to inspect its exact art, language, and current market references.' : 'Select an item on the left to choose its exact art and capture today’s market references.'} /> : browseOnly ? <div className="guest-card-details">
          {selectedCatalogDetails}
          <dl className="detail-facts"><div><dt>{selected.kind === 'card' ? 'Exact printing' : 'Product type'}</dt><dd>{selected.kind === 'card' ? selected.variant : selected.productType}</dd></div><div><dt>Language / region</dt><dd>{selected.language}{selected.region ? ` · ${selected.region}` : ''}</dd></div><div><dt>Set</dt><dd>{selected.setCode}</dd></div><div><dt>Card / product number</dt><dd>{selected.number ?? selected.productType}</dd></div></dl>
        </div> : <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
          {selectedCatalogDetails}
          <div className="form-grid">
            <label className="read-only-field">{selected.kind === 'card' ? 'Exact printing' : 'Product type'}<output>{selected.kind === 'card' ? selected.variant : selected.productType}</output></label>
            <label className="read-only-field">Language / region<output>{selected.language}{selected.region ? ` · ${selected.region}` : ''}</output><small>Fixed by source-backed product evidence</small></label>
            <label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value)}>{tab === 'card' ? <><option>Near Mint</option><option>Excellent</option><option>Good</option><option>Light Played</option></> : <option>Factory sealed</option>}</select></label>
            <label className="quantity-field">Quantity<div><Button type="button" variant="secondary" size="icon" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</Button><input type="number" min="1" max="999" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}/><Button type="button" variant="secondary" size="icon" onClick={() => setQuantity(quantity + 1)}>+</Button></div></label>
            <div className="auto-capture"><Icon name="shield"/><span><strong>Added automatically at save time</strong><small>The timestamp and every available current market reference are stored; unavailable providers remain explicitly unpriced.</small></span></div>
            <label>Purchase price per {tab === 'card' ? 'card' : 'unit'} <small>Optional · private</small><span className="money-input"><b>{currencyFor(market) === 'EUR' ? '€' : '$'}</b><input type="number" min="0" step="0.01" value={purchase} onChange={(event) => setPurchase(event.target.value)} placeholder="0.00" /></span></label>
          </div>
          <label>Private note <small>Optional</small><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Storage location, provenance, grading notes…" maxLength={300}/><span className="field-count">{note.length}/300</span></label>
          {validation && <div className="form-error"><Icon name="info"/>{validation}</div>}
          <div className="form-actions"><Button type="button" variant="ghost" onClick={reset} disabled={saving}>Clear</Button><Button type="submit" icon="plus" disabled={saving || productionCollection?.mutating}>{saving ? 'Saving…' : 'Add to collection'}</Button></div>
        </form>}
      </section>
    </div>
    {browseOnly ? <section className="guest-save-gate"><span><Icon name="lock"/></span><div><strong>Browse freely — sign in only when you want to save</strong><p>Guest browsing never creates a collection or stores card activity. An account is required to save a card and track its value over time.</p></div><Button type="button" onClick={onRequestAuthentication}>Sign in / Create account</Button></section> : <section className="privacy-banner"><span><Icon name="shield"/></span><div><strong>Private by design</strong><p>Purchase price, notes, and complete holdings are never exposed to store communities. Only cards you intentionally offer in a trade post become visible.</p></div><button onClick={() => navigate('/settings')}>Privacy settings <Icon name="chevron"/></button></section>}
    {!browseOnly && <Modal open={duplicateOpen} onClose={() => setDuplicateOpen(false)} title="You already own this item" eyebrow="Duplicate detected"><div className="duplicate-dialog">{selected && <div><CardArt asset={selected} size="sm"/><span><strong>{selected.name}</strong><small>{condition} · {selected.language}</small></span></div>}<p>An identical collection item already exists. Increasing its quantity will add a new timestamped market-value snapshot for these <strong>{quantity}</strong> copies.</p><div><Button variant="secondary" onClick={() => setDuplicateOpen(false)}>Review details</Button><Button disabled={saving || productionCollection?.mutating} onClick={() => void save(true)}>{saving ? 'Saving…' : 'Increase quantity'}</Button></div></div></Modal>}
  </div>;
}

function identityBadgeForStores(availableStores: Store[], browseOnly = false) {
  return browseOnly
    ? <Chip tone="positive"><Icon name="shield" size={13}/>Public approved directory</Chip>
    : availableStores.some((store) => store.source === 'registered')
    ? <Chip tone="positive"><Icon name="shield" size={13}/>Approved directory</Chip>
    : <DemoBadge compact />;
}

function StoresPage({ stores: availableStores, joinedIds, navigate, browseOnly = false, onRequestAuthentication }: { stores: Store[]; joinedIds: Set<string>; navigate: (path: string) => void; browseOnly?: boolean; onRequestAuthentication?: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Store | null>(null);
  const [mobileMode, setMobileMode] = useState<'list' | 'map'>('map');
  const visible = availableStores.filter((store) => !query || `${store.name} ${store.city} ${store.country} ${store.address}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="page stores-page">
    <section className="store-search panel"><label className="search-field"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search city, postcode, address, or store name" aria-label="Search stores" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><Icon name="close"/></button>}</label>{browseOnly ? <Button type="button" onClick={onRequestAuthentication} icon="lock">Sign in to join</Button> : <Button onClick={() => navigate('/scan')} icon="scan">Scan store QR</Button>}</section>
    <div className="mobile-map-toggle"><Segmented value={mobileMode} onChange={setMobileMode} label="Store result view" options={[{ value: 'list', label: 'List', icon: 'list' }, { value: 'map', label: 'Map', icon: 'map' }]} /></div>
    <section className="store-layout"><div className={`store-list ${mobileMode === 'map' ? 'mobile-hidden' : ''}`}><header><span><strong>{visible.length} registered stores</strong><small>Dresden · all approved locations</small></span>{identityBadgeForStores(availableStores, browseOnly)}</header>{visible.length === 0 ? <EmptyState icon="store" title="No stores found" detail="Try another store, city, postcode, or address." action={<Button variant="secondary" onClick={() => setQuery('')}>Clear search</Button>} /> : visible.map((store) => <article key={store.id} className={selected?.id === store.id ? 'selected' : ''} onMouseEnter={() => setSelected(store)}><button className="store-card-main" onClick={() => setSelected(store)}><StoreVisual store={store}/><span className="store-info"><span className="store-status"><Chip tone={browseOnly ? 'neutral' : joinedIds.has(store.id) ? 'positive' : 'neutral'}>{browseOnly ? 'Browse only' : joinedIds.has(store.id) ? 'Joined' : 'Visit to join'}</Chip></span><strong>{store.name}</strong><small>{store.address}</small><span className="store-open"><i />{store.hours}</span><span className="store-stats">{store.source === 'registered' ? <><em><Icon name="shield"/> Approved store</em><em><Icon name="lock"/> Community stats private</em></> : browseOnly ? <><em><Icon name="store"/> Public store profile</em><em><Icon name="lock"/> Community stats private</em></> : <><em><Icon name="users"/> {store.members} members</em><em><Icon name="trade"/> {store.trades} active trades</em></>}</span></span></button><footer><Button variant="ghost" size="sm" onClick={() => window.open(`https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}#map=17/${store.latitude}/${store.longitude}`, '_blank')} icon="locate">Directions</Button><Button variant="secondary" size="sm" onClick={() => navigate(`/stores/${store.id}`)}>View store <Icon name="chevron"/></Button></footer></article>)}</div><div className={`map-panel ${mobileMode === 'list' ? 'mobile-hidden' : ''}`}><StoreMap stores={visible} selectedStoreId={selected?.id ?? null} onSelectStore={(store) => setSelected(availableStores.find((candidate) => candidate.id === store.id) ?? null)} height="100%" ariaLabel="All approved TCG Harbor stores in Dresden" active={mobileMode === 'map'} /></div></section>
    <section className="store-footnote"><Icon name="lock"/><span><strong>Location without exposure</strong><small>Your search and approximate location stay private. We never publish exact collector locations.</small></span></section>
  </div>;
}

function StoreVisual({ store }: { store: Store }) {
  return <div className={`store-visual store-${store.accent}`}><span className="awning"/><div className="store-door"><i/></div><strong>{store.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</strong><small>{store.city}</small></div>;
}

function HarborMap({ visibleStores, selected, setSelected, navigate }: { visibleStores: Store[]; selected: Store | null; setSelected: (store: Store) => void; navigate: (path: string) => void }) {
  return <div className="harbor-map" role="application" aria-label="Interactive store map"><div className="map-land land-one"/><div className="map-land land-two"/><div className="map-road road-one"/><div className="map-road road-two"/><div className="map-watermark">HARBOR MAP</div>{visibleStores.map((store) => <button key={store.id} className={`map-pin ${selected?.id === store.id ? 'active' : ''}`} style={{ left: `${store.x}%`, top: `${store.y}%` }} onClick={() => setSelected(store)} aria-label={`${store.name}, ${store.city}`}><span><Icon name="store" size={17}/></span></button>)}{selected && <article className="map-popover"><StoreVisual store={selected}/><div><strong>{selected.name}</strong><small>{selected.city}</small><span><Icon name="users"/> {selected.members} collectors</span></div><button onClick={() => navigate(`/stores/${selected.id}`)} aria-label={`Open ${selected.name}`}><Icon name="chevron"/></button></article>}<div className="map-controls"><button aria-label="Zoom in">+</button><button aria-label="Zoom out">−</button><button aria-label="Center map"><Icon name="locate" size={16}/></button></div></div>;
}

function RegisteredStoreProfilePage({ store, navigate, browseOnly = false, onRequestAuthentication }: { store: Store; navigate: (path: string) => void; browseOnly?: boolean; onRequestAuthentication?: () => void }) {
  return <div className="page store-profile-page">
    <button className="back-link" onClick={() => navigate('/stores')}><Icon name="chevron"/>Back to stores</button>
    <section className={`store-hero store-${store.accent}`}>
      <div className="store-hero-art"><StoreVisual store={store}/></div>
      <div className="store-hero-copy"><div><Chip tone="positive"><Icon name="shield" size={13}/>Approved store</Chip><h2>{store.name}</h2><p>{store.address}</p></div><div className="store-hero-actions"><Button variant="secondary" onClick={() => window.open(`https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}#map=17/${store.latitude}/${store.longitude}`, '_blank')} icon="locate">Directions</Button>{browseOnly ? <Button type="button" onClick={onRequestAuthentication} icon="lock">Sign in to join</Button> : <Button onClick={() => navigate('/scan')} icon="scan">Scan at the store</Button>}</div></div>
    </section>
    <section className="store-profile-grid">
      <div className="store-profile-main">
        <article className="panel"><div className="panel-header"><div><p className="eyebrow">Verified location</p><h2>Local player community</h2></div><span className="community-seal"><Icon name="users"/></span></div><p className="lead-copy">{browseOnly ? 'This store passed the TCG Harbor review workflow. Guests can view its public location and opening information.' : 'This store passed the TCG Harbor review workflow. Visit the location and scan its current QR code to unlock its private channels, trade posts, and member directory.'}</p><div className="locked-preview"><span><Icon name="lock"/></span><div><strong>Community details stay private</strong><p>Member counts, messages, and trades are disclosed only to active store-community members.</p></div></div></article>
        {browseOnly ? <article className="panel guest-store-gate"><span><Icon name="lock" size={28}/></span><div><p className="eyebrow">Account required</p><h2>Sign in before joining a store</h2><p>Guest browsing never creates a membership. Sign in or create an account first, then visit the store to use its physical join flow.</p></div><Button type="button" onClick={onRequestAuthentication}>Sign in / Create account</Button></article> : <article className="panel qr-instructions"><span className="qr-placeholder"><Icon name="qr" size={42}/></span><div><p className="eyebrow">Join in person</p><h2>Scan the code at the counter</h2><ol><li><span>1</span>Visit {store.name}</li><li><span>2</span>Find the current TCG Harbor QR</li><li><span>3</span>Scan and confirm the local community</li></ol><p><Icon name="shield"/>The token is revocable and never contains credentials.</p></div><div><Button variant="secondary" onClick={() => navigate('/scan')} icon="camera">Open scanner</Button></div></article>}
      </div>
      <aside className="store-facts panel"><h3>Store information</h3><dl><div><dt><Icon name="map"/>Address</dt><dd>{store.address}</dd></div><div><dt><Icon name="clock"/>Opening hours</dt><dd>{store.hours}</dd></div>{(store.email || store.phone) && <div><dt><Icon name="message"/>Contact</dt><dd>{store.email && <a href={`mailto:${store.email}`}>{store.email}</a>}{store.phone && <a href={`tel:${store.phone}`}>{store.phone}</a>}</dd></div>}</dl><p className="demo-address"><Chip tone="positive"><Icon name="shield" size={13}/>Database-approved location</Chip></p></aside>
    </section>
  </div>;
}

function StoreProfilePage({ stores: availableStores, storeId, joinedIds, navigate, browseOnly = false, onRequestAuthentication }: { stores: Store[]; storeId: string; joinedIds: Set<string>; navigate: (path: string) => void; browseOnly?: boolean; onRequestAuthentication?: () => void }) {
  const store = availableStores.find((item) => item.id === storeId);
  if (!store) return <div className="page"><EmptyState icon="store" title="Store not found" detail="This store is unavailable or no longer approved." action={<Button onClick={() => navigate('/stores')}>Back to stores</Button>}/></div>;
  const joined = joinedIds.has(store.id);
  const registered = store.source === 'registered';
  if (browseOnly || registered) return <RegisteredStoreProfilePage store={store} navigate={navigate} browseOnly={browseOnly} onRequestAuthentication={onRequestAuthentication}/>;
  return <div className="page store-profile-page"><button className="back-link" onClick={() => navigate('/stores')}><Icon name="chevron"/>Back to stores</button><section className={`store-hero store-${store.accent}`}><div className="store-hero-art"><StoreVisual store={store}/></div><div className="store-hero-copy"><div><Chip tone={joined ? 'positive' : 'gold'}>{joined ? 'Community member' : 'Physical visit required to join'}</Chip><h2>{store.name}</h2><p>{store.address}</p></div><div className="store-hero-actions"><Button variant="secondary" onClick={() => window.open(`https://www.openstreetmap.org/search?query=${encodeURIComponent(store.address)}`, '_blank')} icon="locate">Directions</Button>{joined ? <Button onClick={() => navigate(`/communities/${store.id}`)} icon="users">Open community</Button> : <Button onClick={() => navigate(`/join/${store.code}`)} icon="scan">Simulate demo scan</Button>}</div></div></section><section className="store-profile-grid"><div className="store-profile-main"><article className="panel"><div className="panel-header"><div><p className="eyebrow">Local community</p><h2>Your table is waiting</h2></div><span className="community-seal"><Icon name="users"/></span></div><p className="lead-copy">A verified community for collectors who play and trade at {store.name}. Scan the physical QR displayed in store to unlock member-only chat, trades, and direct messaging.</p><div className="community-metrics"><div><strong>{store.members}</strong><small>Active members</small></div><div><strong>{store.trades}</strong><small>Open trade posts</small></div><div><strong>4.8</strong><small>Community health</small></div></div><div className="locked-preview"><span><Icon name={joined ? 'check' : 'lock'}/></span><div><strong>{joined ? 'You have verified access' : 'Private community content'}</strong><p>{joined ? 'Chat, trades, and the member directory are available.' : 'Messages and member details are visible only after an in-store QR scan.'}</p></div>{joined && <Button size="sm" onClick={() => navigate(`/communities/${store.id}`)}>Enter community</Button>}</div></article><article className="panel qr-instructions"><span className="qr-placeholder"><Icon name="qr" size={42}/></span><div><p className="eyebrow">Join in person</p><h2>Scan the code at the counter</h2><ol><li><span>1</span>Visit {store.name}</li><li><span>2</span>Find the TCG Harbor QR poster</li><li><span>3</span>Scan, confirm, and meet your local crew</li></ol><p><Icon name="shield"/>The code contains a revocable public join token — never credentials.</p></div><div><Button variant="secondary" onClick={() => navigate('/scan')} icon="camera">Open scanner</Button><button onClick={() => navigate(`/join/${store.code}`)}>Simulate demo scan</button></div></article></div><aside className="store-facts panel"><h3>Store information</h3><dl><div><dt><Icon name="map"/>Address</dt><dd>{store.address}</dd></div><div><dt><Icon name="clock"/>Opening hours</dt><dd><strong>Monday–Thursday</strong><span>12:00–21:00</span><strong>Friday–Saturday</strong><span>10:00–23:00</span><strong>Sunday</strong><span>11:00–18:00</span></dd></div><div><dt><Icon name="message"/>Contact</dt><dd><a href={`mailto:${store.email}`}>{store.email}</a><a href={`tel:${store.phone}`}>{store.phone}</a></dd></div></dl><p className="demo-address"><DemoBadge compact />Illustrative store used for this demo.</p></aside></section></div>;
}

function CommunitiesPage({ joinedIds, navigate }: { joinedIds: Set<string>; navigate: (path: string) => void }) {
  const joined = stores.filter((store) => joinedIds.has(store.id));
  return <div className="page communities-page"><section className="community-welcome"><div><span className="community-compass"><Icon name="users" size={28}/></span><div><p className="eyebrow">Verified local access</p><h2>Three stores. One collector identity.</h2><p>Every community is anchored to a physical local game store. Your membership travels with you; your private collection does not.</p></div></div><Button onClick={() => navigate('/scan')} icon="scan">Scan a store code</Button></section><div className="section-heading"><div><p className="eyebrow">Your local crews</p><h2>Joined communities</h2></div><span className="member-count"><Avatar initials="MD" size="sm"/>Member of {joined.length}</span></div>{joined.length === 0 ? <EmptyState icon="users" title="No communities yet" detail="Visit a participating store and scan its physical QR code to join." action={<Button onClick={() => navigate('/stores')}>Find stores</Button>}/> : <div className="community-grid">{joined.map((store, index) => {
    const chat = initialCommunityMessages[store.id]?.at(-1);
    const openTrades = initialTradePosts.filter((trade) => trade.communityId === store.id && trade.status === 'Open').length;
    return <article className={`community-card store-${store.accent}`} key={store.id}><div className="community-cover"><StoreVisual store={store}/><span className="verified"><Icon name="shield" size={15}/>Verified member</span></div><div className="community-card-body"><div><h3>{store.name}</h3><p><Icon name="map" size={14}/>{store.city}, {store.country}</p></div><div className="community-card-stats"><span><strong>{store.members}</strong><small>members</small></span><span><strong>{openTrades || store.trades}</strong><small>open trades</small></span><span><strong>{index === 0 ? '4' : index === 1 ? '1' : '2'}</strong><small>online now</small></span></div><div className="latest-message"><Avatar initials={chat?.initials ?? 'TH'} size="sm" tone={index}/><span><strong>{chat?.user ?? 'TCG Harbor'}</strong><small>{chat?.text ?? 'Community ready for your first message.'}</small></span><time>{chat?.time ?? 'Now'}</time></div><footer><Button variant="secondary" onClick={() => navigate(`/communities/${store.id}`)}>Open community <Icon name="chevron"/></Button></footer></div></article>;
  })}</div>}<section className="discover-community"><span><Icon name="store" size={25}/></span><div><strong>Collect somewhere new?</strong><p>Discover more local game stores and join by scanning their physical code.</p></div><Button variant="ghost" onClick={() => navigate('/stores')}>Explore stores <Icon name="chevron"/></Button></section></div>;
}

function CommunityPage({ communityId, joinedIds, assets, messages, setMessages, trades, setTrades, market, navigate, notify }: { communityId: string; joinedIds: Set<string>; assets: DemoAsset[]; messages: Record<string, CommunityMessage[]>; setMessages: (messages: Record<string, CommunityMessage[]>) => void; trades: TradePost[]; setTrades: (trades: TradePost[]) => void; market: Market; navigate: (path: string) => void; notify: (message: string) => void }) {
  const store = stores.find((item) => item.id === communityId) ?? stores[0];
  const [tab, setTab] = useState<'overview' | 'chat' | 'trades' | 'members'>('overview');
  const [chatText, setChatText] = useState('');
  const [tradeModal, setTradeModal] = useState(false);
  const [tradeQuery, setTradeQuery] = useState('');
  const [status, setStatus] = useState('Open');
  const [matchOnly, setMatchOnly] = useState(false);
  const [blockedUser, setBlockedUser] = useState('');
  const chat = messages[communityId] ?? [];
  const communityTrades = trades.filter((trade) => trade.communityId === communityId).filter((trade) => status === 'All' || trade.status === status).filter((trade) => {
    const offered = assetById(trade.offeredId, assets), wanted = trade.wantedIds.map((id) => assetById(id, assets));
    return !tradeQuery || `${offered.name} ${offered.number} ${wanted.map((a) => `${a.name} ${a.number}`).join(' ')}`.toLowerCase().includes(tradeQuery.toLowerCase());
  }).filter((trade) => !matchOnly || trade.wantedIds.some((id) => assets.some((asset) => asset.id === id)));
  if (!joinedIds.has(store.id)) return <div className="page"><EmptyState icon="lock" title="Members-only community" detail="Community messages, trades, and members require an active membership created by scanning the physical store QR code." action={<Button onClick={() => navigate(`/stores/${store.id}`)}>View store</Button>}/></div>;
  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    if (!chatText.trim()) return;
    const next: CommunityMessage = { id: `msg-${Date.now()}`, user: 'Mario', initials: 'MD', text: chatText.trim().slice(0, 500), time: 'Now', own: true };
    setMessages({ ...messages, [communityId]: [...chat, next] });
    setChatText('');
  };
  const members = [
    { user: 'LenaK', initials: 'LK', role: 'Community moderator', active: true, mutual: 'Dresden Card Dock' },
    { user: 'RikuBerlin', initials: 'RB', role: 'Collector', active: true, mutual: store.name },
    { user: 'NamiCollector', initials: 'NC', role: 'Collector', active: false, mutual: store.name },
    { user: 'SakuraDecks', initials: 'SD', role: 'Collector', active: true, mutual: store.name },
  ];
  return <div className="page community-page"><button className="back-link" onClick={() => navigate('/communities')}><Icon name="chevron"/>All communities</button><section className={`community-header store-${store.accent}`}><StoreVisual store={store}/><div><div><Chip tone="positive"><Icon name="shield" size={13}/>Verified member</Chip><span>{store.city}, {store.country}</span></div><h2>{store.name}</h2><p>{store.members} local collectors · {store.trades} active trade posts</p></div><span className="online-cluster"><Avatar initials="LK" size="sm"/><Avatar initials="RB" size="sm" tone={1}/><Avatar initials="SD" size="sm" tone={2}/><small>+1 online</small></span></section><nav className="community-tabs" aria-label="Community sections">{(['overview', 'chat', 'trades', 'members'] as const).map((value) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}><Icon name={value === 'overview' ? 'dashboard' : value === 'chat' ? 'message' : value === 'trades' ? 'trade' : 'users'}/>{value[0].toUpperCase() + value.slice(1)}{value === 'chat' && <span>4</span>}{value === 'trades' && <span>{trades.filter((trade) => trade.communityId === communityId && trade.status === 'Open').length}</span>}</button>)}</nav>
    {tab === 'overview' && <div className="community-overview"><section className="panel community-feed"><div className="panel-header"><div><p className="eyebrow">Community pulse</p><h2>What’s happening</h2></div><Button variant="ghost" size="sm" onClick={() => setTab('chat')}>Open chat <Icon name="chevron"/></Button></div><div className="feed-highlight"><span className="feed-date"><strong>FRI</strong><em>18</em></span><div><Chip tone="gold">Store event</Chip><h3>Friday locals · OP constructed</h3><p>Registration from 17:30 · first round at 18:30 · 6 seats remaining</p></div><Button variant="secondary" size="sm" onClick={() => notify('Event saved to your in-app activity')}>Save event</Button></div><div className="overview-chat">{chat.slice(-3).map((message) => <div key={message.id}><Avatar initials={message.initials} size="sm"/><span><strong>{message.user}</strong><p>{message.text}</p></span><time>{message.time}</time></div>)}</div></section><aside className="community-side"><article className="panel"><div className="panel-header"><div><p className="eyebrow">Trade board</p><h2>Fresh offers</h2></div><span className="pulse-label"><i/>Live</span></div>{trades.filter((trade) => trade.communityId === communityId).slice(0, 2).map((trade) => <button className="mini-trade" key={trade.id} onClick={() => setTab('trades')}><CardArt asset={assetById(trade.offeredId, assets)} size="sm"/><span><small>Offering</small><strong>{assetById(trade.offeredId, assets).name}</strong><em>for {assetById(trade.wantedIds[0], assets).name}</em></span><Icon name="chevron"/></button>)}<Button variant="secondary" className="full-width" onClick={() => setTradeModal(true)} icon="plus">Create trade post</Button></article><article className="panel community-guidelines"><span><Icon name="shield"/></span><div><strong>Trade safely, meet locally</strong><p>Inspect cards in person. Market references are context, never a fairness guarantee or sale price.</p></div></article></aside></div>}
    {tab === 'chat' && <section className="chat-layout"><div className="chat-panel panel"><header><div><span className="live-pulse"/><strong>Community chat</strong><small>{store.members} members · 4 online</small></div><Button variant="ghost" size="icon" aria-label="Chat options"><Icon name="more"/></Button></header><div className="chat-date"><span>Today</span></div><div className="chat-messages">{chat.length === 0 ? <EmptyState icon="message" title="Start the conversation" detail="Be the first verified member to say hello."/> : chat.filter((message) => message.user !== blockedUser).map((message, index) => <div className={`chat-message ${message.own ? 'own' : ''}`} key={message.id}>{!message.own && <Avatar initials={message.initials} size="sm" tone={index}/>}<div><span><strong>{message.user}</strong><time>{message.time}</time></span><p>{message.text}</p>{message.failed && <small className="failed"><Icon name="refresh"/>Failed to send · retry</small>}<div className="message-actions">{message.own ? <button onClick={() => { setMessages({ ...messages, [communityId]: chat.filter((item) => item.id !== message.id) }); notify('Your message was deleted'); }}>Delete</button> : <><button onClick={() => notify(`Message from ${message.user} reported for moderator review`)}>Report</button><button onClick={() => { setBlockedUser(message.user); notify(`${message.user} blocked`); }}>Block</button></>}</div></div></div>)}</div>{blockedUser && <div className="blocked-banner"><Icon name="lock"/>Messages from {blockedUser} are hidden.<button onClick={() => setBlockedUser('')}>Unblock</button></div>}<form className="message-composer" onSubmit={sendChat}><Avatar initials="MD" size="sm"/><label><span className="sr-only">Community message</span><textarea value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="Message the community…" maxLength={500} rows={1}/><small>{chatText.length}/500</small></label><Button size="icon" aria-label="Send message" disabled={!chatText.trim()}><Icon name="send"/></Button></form><p className="realtime-note"><span className="live-pulse"/>Realtime demo channel connected · basic rate limit: 12 messages/min</p></div><aside className="chat-context panel"><h3>In this community</h3><div className="online-members">{members.slice(0, 3).map((member, index) => <button key={member.user} onClick={() => navigate('/messages/lena')}><Avatar initials={member.initials} size="sm" tone={index}/><span><strong>{member.user}</strong><small>{member.role}</small></span><i className={member.active ? 'online' : ''}/></button>)}</div><div className="chat-rules"><Icon name="shield"/><span><strong>Keep the harbor welcoming</strong><small>No sales, harassment, or private collection requests.</small></span></div></aside></section>}
    {tab === 'trades' && <section className="trades-section"><div className="trade-toolbar"><label className="search-field"><Icon name="search"/><input value={tradeQuery} onChange={(event) => setTradeQuery(event.target.value)} placeholder="Search offering or wanted card" /></label><label className="select-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option>Open</option><option>Discussing</option><option>Completed</option><option>Closed</option><option>All</option></select></label><label className="match-toggle"><input type="checkbox" checked={matchOnly} onChange={(event) => setMatchOnly(event.target.checked)}/><span><Icon name="sparkle"/>Matches my collection</span></label><Button onClick={() => setTradeModal(true)} icon="plus">Create trade</Button></div><div className="trade-disclaimer"><Icon name="info"/><span><strong>Local card-for-card discovery only.</strong> Market references are read-only context — never sale prices or guarantees of fairness.</span></div>{communityTrades.length === 0 ? <EmptyState icon="trade" title="No matching trade posts" detail="Adjust the status or search filters, or create a new local offer." action={<Button onClick={() => setTradeModal(true)}>Create trade post</Button>}/> : <div className="trade-grid">{communityTrades.map((trade) => <TradeCard key={trade.id} trade={trade} assets={assets} market={market} onMessage={() => navigate('/messages/lena')} onStatus={(next) => { setTrades(trades.map((item) => item.id === trade.id ? { ...item, status: next } : item)); notify(`Trade marked ${next.toLowerCase()}`); }}/>)}</div>}</section>}
    {tab === 'members' && <section className="members-section"><div className="member-header"><div><p className="eyebrow">Verified locally</p><h2>{store.members} community members</h2><p>Only members who share this active store community can start a private conversation.</p></div><label className="search-field"><Icon name="search"/><input placeholder="Search members"/></label></div><div className="member-grid">{members.map((member, index) => <article key={member.user}><Avatar initials={member.initials} size="lg" tone={index}/><span><strong>{member.user}</strong><small>{member.role}</small><em><i className={member.active ? 'online' : ''}/>{member.active ? 'Online now' : 'Active this week'}</em></span><Button variant="secondary" size="sm" onClick={() => navigate('/messages/lena')} icon="message">Message</Button></article>)}</div><div className="member-privacy"><Icon name="lock"/><span><strong>Membership reveals no portfolio data.</strong><small>Only cards a collector deliberately includes in a trade post are visible here.</small></span></div></section>}
    <TradeCreateModal open={tradeModal} onClose={() => setTradeModal(false)} communityId={communityId} assets={assets} market={market} onCreate={(trade) => { setTrades([trade, ...trades]); setTradeModal(false); setTab('trades'); notify('Trade post published to the community'); }}/>
  </div>;
}

function TradeCard({ trade, assets, market, onMessage, onStatus }: { trade: TradePost; assets: DemoAsset[]; market: Market; onMessage: () => void; onStatus: (status: TradePost['status']) => void }) {
  const offered = assetById(trade.offeredId, assets);
  const wanted = trade.wantedIds.map((id) => assetById(id, assets));
  const current = offered.quote[market];
  const captured = market === 'cardmarket' ? trade.capturedEu : trade.capturedUs;
  return <article className="trade-card"><header><Avatar initials={trade.initials} size="sm"/><span><strong>{trade.author}</strong><small>{trade.createdAt} · Local meetup</small></span><Chip tone={trade.status === 'Open' ? 'positive' : trade.status === 'Discussing' ? 'gold' : 'neutral'}>{trade.status}</Chip></header><div className="trade-sides"><div><p className="eyebrow offering"><Icon name="arrow-up"/>Offering</p><div className="trade-asset"><CardArt asset={offered} size="md"/><span><strong>{offered.name}</strong><small>{offered.number} · {offered.setCode}</small><em>{trade.condition} · {trade.language} · Qty {trade.offeredQuantity}</em></span></div></div><span className="trade-arrow"><Icon name="trade"/></span><div><p className="eyebrow looking"><Icon name="search"/>Looking for</p>{wanted.map((asset) => <div className="wanted-asset" key={asset.id}><CardArt asset={asset} size="xs"/><span><strong>{asset.name}</strong><small>{asset.number} · {asset.condition}</small></span></div>)}</div></div><p className="trade-note">“{trade.note}”</p><div className="market-reference"><div><span>At post creation</span><strong>{formatMoney(captured, market)}</strong></div><Icon name="chevron"/><div><span>Current reference</span><strong>{formatMoney(current, market)}</strong></div><small>{marketSourceLabel(market)} · {marketSourceDate(market)} · historical snapshot not retained</small></div><p className="market-only"><Icon name="info"/>Market reference only — not a sale price or fairness assessment.</p><footer>{trade.author === 'Mario' ? <><Button variant="ghost" size="sm" onClick={() => onStatus('Closed')}>Close post</Button><Button variant="secondary" size="sm" onClick={() => onStatus('Completed')}>Mark complete</Button></> : <><span><Icon name="map"/>Meet at {trade.meetup}</span><Button variant="secondary" size="sm" onClick={onMessage} icon="message">Message {trade.author}</Button></>}</footer></article>;
}

function TradeCreateModal({ open, onClose, communityId, assets, market, onCreate }: { open: boolean; onClose: () => void; communityId: string; assets: DemoAsset[]; market: Market; onCreate: (trade: TradePost) => void }) {
  const [offeredId, setOfferedId] = useState(assets.find((asset) => asset.kind === 'card')?.id ?? '');
  const [wantedId, setWantedId] = useState(catalogAssets[4].id);
  const [condition, setCondition] = useState('Near Mint');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const offered = assetById(offeredId, assets), wanted = assetById(wantedId, catalogAssets);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    const forbidden = Object.keys(raw).some((key) => /price|amount|cost|cash|sale/i.test(key));
    if (forbidden) { setError('Trade posts cannot include a user-entered price.'); return; }
    if (offeredId === wantedId) { setError('Choose a different wanted card.'); return; }
    onCreate({ id: `trade-${Date.now()}`, communityId, author: 'Mario', initials: 'MD', offeredId, wantedIds: [wantedId], offeredQuantity: 1, condition, language: offered.language, note: note.trim() || 'Open to a local card-for-card discussion.', meetup: stores.find((store) => store.id === communityId)?.name ?? 'Local store', status: 'Open', createdAt: 'Now', capturedEu: offered.quote.cardmarket, capturedUs: offered.quote.tcgplayer });
  };
  return <Modal open={open} onClose={onClose} title="Create a local trade post" eyebrow="Card for card · no sales" wide><form className="trade-form" onSubmit={submit}><div className="trade-form-notice"><Icon name="shield"/><span><strong>No price entry, payments, or auctions.</strong><small>Only read-only market references appear after publication.</small></span></div><div className="trade-form-grid"><section><p className="eyebrow offering">You are offering</p><label>Your collection card<select value={offeredId} onChange={(event) => setOfferedId(event.target.value)}>{assets.filter((asset) => asset.kind === 'card').map((asset) => <option value={asset.id} key={asset.id}>{asset.name} · {asset.number}</option>)}</select></label><div className="form-asset-preview"><CardArt asset={offered} size="sm"/><span><strong>{offered.name}</strong><small>{offered.number} · Qty owned {offered.quantity}</small><em>{formatMoney(offered.quote[market], market)} read-only reference</em></span></div><div className="form-grid"><label>Quantity<input type="number" min="1" max={offered.quantity} defaultValue="1" /></label><label>Condition<select value={condition} onChange={(event) => setCondition(event.target.value)}><option>Near Mint</option><option>Excellent</option><option>Good</option></select></label><label className="read-only-field">Language<output>{offered.language}</output></label></div></section><span className="trade-form-arrow"><Icon name="trade"/></span><section><p className="eyebrow looking">You are looking for</p><label>Catalog card<select value={wantedId} onChange={(event) => setWantedId(event.target.value)}>{catalogAssets.filter((asset) => asset.kind === 'card').map((asset) => <option value={asset.id} key={asset.id}>{asset.name} · {asset.number}</option>)}</select></label><div className="form-asset-preview"><CardArt asset={wanted} size="sm"/><span><strong>{wanted.name}</strong><small>{wanted.number} · {wanted.setCode}</small><em>{formatMoney(wanted.quote[market], market)} read-only reference</em></span></div><div className="form-grid"><label>Desired condition<select><option>Near Mint</option><option>Excellent or better</option><option>Any</option></select></label><label className="read-only-field">Desired language<output>{wanted.language}</output></label></div></section></div><label>Trade note <small>No cash terms or sale prices</small><textarea value={note} onChange={(event) => setNote(event.target.value.replace(/€|\$|USD|EUR/gi, ''))} placeholder="Describe variants, meetup timing, or what you’re flexible on…" maxLength={300}/></label><label>Local meetup preference<select><option>{stores.find((store) => store.id === communityId)?.name}</option><option>Friday locals</option><option>Weekend afternoon</option></select></label>{error && <div className="form-error"><Icon name="info"/>{error}</div>}<div className="trade-form-reference"><span><Icon name="info"/></span><p>At publication, the app captures read-only EU and US market references with timestamps. Similar references do not imply an equal or fair trade.</p></div><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" icon="trade">Publish trade post</Button></div></form></Modal>;
}

function MessagesPage({ conversationId, conversations, setConversations, productionMessages, navigate, notify }: { conversationId?: string; conversations: Conversation[]; setConversations: (conversations: Conversation[]) => void; productionMessages?: ProductionDirectMessagesRuntimeV2; navigate: (path: string) => void; notify: (message: string) => void }) {
  const active = conversations.find((conversation) => conversation.id === conversationId) ?? conversations[0];
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [blocked, setBlocked] = useState(false);
  const visible = conversations.filter((conversation) => !query || conversation.user.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    if (conversationId && active?.unread) {
      if (productionMessages) void productionMessages.markRead(active.id).catch(() => undefined);
      else setConversations(conversations.map((conversation) => conversation.id === active.id ? { ...conversation, unread: 0 } : conversation));
    }
    // Deliberately keyed to selected conversation only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || blocked || !active) return;
    if (productionMessages) {
      const body = text.trim().slice(0, 1000);
      setText('');
      try {
        await productionMessages.send({ conversationId: active.id, body });
      } catch {
        setText(body);
        notify('The private message could not be sent. Check the inbox status and try again.');
      }
      return;
    }
    const message: CommunityMessage = { id: `dm-${Date.now()}`, user: 'Mario', initials: 'MD', text: text.trim().slice(0, 1000), time: 'Now', own: true };
    setConversations(conversations.map((conversation) => conversation.id === active.id ? { ...conversation, messages: [...conversation.messages, message] } : conversation));
    setText('');
  };
  if (!active) {
    const emptyTitle = productionMessages?.loading
      ? 'Loading your private inbox'
      : productionMessages?.error
        ? 'Inbox unavailable'
        : 'No conversations yet';
    const emptyDetail = productionMessages?.loading
      ? 'Checking for account-owned conversations…'
      : productionMessages?.error
        ? productionMessages.error
        : 'After you join a physical store community, open a member profile to start a private conversation.';
    return <div className="page messages-page"><section className="dm-privacy"><Icon name="lock"/><span><strong>Private account inbox</strong><small>Only account-owned conversations are shown. Store staff cannot read private messages.</small></span><Chip tone="positive"><Icon name="shield" size={13}/>Server protected</Chip></section><div className="messages-layout inbox-empty"><aside className="conversation-list panel"><header><div><p className="eyebrow">Inbox</p><h2>Conversations</h2></div><Button variant="ghost" size="icon" aria-label="Start conversation" onClick={() => notify('Join a store community to meet collectors you can message')}><Icon name="plus"/></Button></header><label className="search-field"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" disabled aria-label="Search conversations"/></label><div className="conversation-list-empty"><Icon name="message" size={20}/><span><strong>{productionMessages?.loading ? 'Loading inbox…' : productionMessages?.error ? 'Inbox needs attention' : 'Your inbox is empty'}</strong><small>{productionMessages?.error ?? 'No demo messages are added to real accounts.'}</small></span></div><footer><Icon name="shield"/><span><strong>Server-enforced access</strong><small>A shared active store membership is required.</small></span></footer></aside><section className="conversation panel conversation-empty"><EmptyState icon={productionMessages?.error ? 'info' : 'message'} title={emptyTitle} detail={emptyDetail} action={productionMessages?.error ? <Button onClick={() => void productionMessages.refresh()} icon="refresh">Try again</Button> : productionMessages?.loading ? undefined : <Button onClick={() => navigate('/stores')} icon="store">Find a store</Button>}/></section></div></div>;
  }
  return <div className="page messages-page"><section className="dm-privacy"><Icon name="lock"/><span><strong>Participant-only private access</strong><small>Only you and the other participant can access this conversation. Store staff cannot read messages.</small></span><Chip tone="positive"><Icon name="shield" size={13}/>Shared community verified</Chip></section><div className={`messages-layout ${conversationId ? 'conversation-open' : ''}`}><aside className="conversation-list panel"><header><div><p className="eyebrow">Inbox</p><h2>Conversations</h2></div><Button variant="ghost" size="icon" aria-label="Start conversation" onClick={() => notify('Open a community member profile to start a verified conversation')}><Icon name="plus"/></Button></header><label className="search-field"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" /></label><div>{visible.map((conversation, index) => { const last = conversation.messages.at(-1); return <button key={conversation.id} className={active.id === conversation.id && conversationId ? 'active' : ''} onClick={() => navigate(`/messages/${conversation.id}`)}><span className="avatar-presence"><Avatar initials={conversation.initials} tone={index}/><i className={conversation.online ? 'online' : ''}/></span><span><strong>{conversation.user}<small>{last?.time}</small></strong><em>{conversation.community}</em><p>{last?.own ? 'You: ' : ''}{last?.text}</p></span>{conversation.unread > 0 && <b>{conversation.unread}</b>}</button>; })}</div><footer><Icon name="shield"/><span><strong>Server-enforced access</strong><small>A shared active store membership is required.</small></span></footer></aside><section className="conversation panel"><header><button className="mobile-back" onClick={() => navigate('/messages')} aria-label="Back to conversations"><Icon name="chevron"/></button><span className="avatar-presence"><Avatar initials={active.initials}/><i className={active.online ? 'online' : ''}/></span><div><strong>{active.user}</strong><small>{productionMessages ? 'Activity status private' : active.online ? 'Online now' : 'Last active yesterday'} · via {active.community}</small></div><div className="conversation-actions"><Button variant="ghost" size="icon" aria-label="Report user" onClick={() => notify(`${active.user} reported for review`)}><Icon name="shield"/></Button><Button variant="ghost" size="icon" aria-label="Conversation options" onClick={() => setBlocked((value) => !value)}><Icon name="more"/></Button></div></header><div className="shared-context"><Icon name="users"/><span>You can message because you both belong to <strong>{active.community}</strong>.</span></div><div className="dm-messages"><div className="chat-date"><span>Today</span></div>{active.messages.map((message, index) => <div className={`chat-message ${message.own ? 'own' : ''}`} key={message.id}>{!message.own && <Avatar initials={message.initials} size="sm" tone={index}/>}<div><p>{message.text}</p><time>{message.time}{message.own && ' · Delivered'}</time></div></div>)}</div>{blocked ? <div className="blocked-composer"><Icon name="lock"/><span><strong>You blocked {active.user}</strong><small>They cannot message you and this composer is disabled.</small></span><Button variant="secondary" size="sm" onClick={() => setBlocked(false)}>Unblock</Button></div> : <form className="message-composer dm-composer" onSubmit={send}><label><span className="sr-only">Private message</span><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={`Message ${active.user}…`} rows={1} maxLength={1000}/><small>{text.length}/1000</small></label><Button size="icon" disabled={!text.trim() || productionMessages?.mutating} aria-label="Send private message"><Icon name="send"/></Button></form>}<p className="realtime-note"><span className="live-pulse"/>{productionMessages ? 'Private Supabase inbox · visible only to both participants' : 'Private realtime demo channel connected · visible only to both participants'}</p></section></div></div>;
}

function StorePortalDenied({ navigate }: { navigate: (path: string) => void }) {
  return <div className="page join-page"><section className="join-result panel"><span><Icon name="lock" size={34}/></span><p className="eyebrow">Player account</p><h2>Store tools require an approved store</h2><p>Your player features are ready. To operate a store community, create a store account or ask an approved store owner to add you through the protected administration workflow.</p><div><Button variant="secondary" onClick={() => navigate('/dashboard')}>Back to dashboard</Button></div></section></div>;
}

function StoreAdminPage({ notify }: { notify: (message: string) => void }) {
  const [code, setCode] = useState(stores[0].code);
  const [active, setActive] = useState(true);
  const [qrSvg, setQrSvg] = useState('');
  const [posterOpen, setPosterOpen] = useState(false);
  const joinUrl = `${window.location.origin}/join/${encodeURIComponent(code)}`;
  useEffect(() => {
    QRCode.toString(joinUrl, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, color: { dark: '#091827', light: '#fffaf1' }, width: 720 }).then(setQrSvg).catch(() => setQrSvg(''));
  }, [joinUrl]);
  const download = () => {
    const blob = new Blob([qrSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `tcg-harbor-${stores[0].id}-join.svg`; anchor.click(); URL.revokeObjectURL(url);
    notify('Print-quality SVG downloaded');
  };
  const regenerate = () => {
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    setCode(`HARBOR-BERLIN-${random}`); setActive(true); notify('Previous code revoked and a new code generated');
  };
  return <div className="page admin-page"><section className="admin-banner"><span><Icon name="shield"/></span><div><strong>Store administrator demo</strong><p>You can manage store identity and community access, but never collectors’ private portfolios or direct messages.</p></div><DemoBadge compact/></section><div className="admin-layout"><aside className="admin-side panel"><p className="eyebrow">Managing</p><StoreVisual store={stores[0]}/><h2>{stores[0].name}</h2><p>{stores[0].address}</p><Chip tone="positive"><span className="live-pulse"/>Verified demo store</Chip><nav><button><Icon name="store"/>Store profile</button><button className="active"><Icon name="qr"/>Join codes</button><button><Icon name="users"/>Community</button><button><Icon name="shield"/>Reports <span>3</span></button></nav></aside><div className="admin-main"><section className="panel qr-manager"><div className="panel-header"><div><p className="eyebrow">Physical access token</p><h2>Community join QR</h2></div><Chip tone={active ? 'positive' : 'negative'}>{active ? 'Active' : 'Deactivated'}</Chip></div><div className="qr-manager-content"><div className={`qr-render ${!active ? 'inactive' : ''}`} dangerouslySetInnerHTML={{ __html: qrSvg }}/><div className="qr-details"><label>Public join code<div className="copy-field"><input value={code} readOnly/><Button variant="secondary" size="sm" onClick={() => { navigator.clipboard?.writeText(code); notify('Join code copied'); }}>Copy</Button></div></label><label>Destination<div className="copy-field"><input value={joinUrl} readOnly/><Button variant="secondary" size="sm" onClick={() => { navigator.clipboard?.writeText(joinUrl); notify('Join link copied'); }}>Copy</Button></div></label><div className="token-safety"><Icon name="shield"/><span><strong>Revocable public token</strong><small>No credentials, user data, or store secrets are encoded.</small></span></div><dl><div><dt>Created</dt><dd>16 Jul 2026 · 10:42</dd></div><div><dt>Successful joins</dt><dd>128</dd></div><div><dt>Last scanned</dt><dd>Today · 09:18</dd></div></dl></div></div><footer><Button variant="secondary" onClick={() => setPosterOpen(true)} icon="store">Preview poster</Button><Button variant="secondary" onClick={download} icon="download" disabled={!qrSvg}>Download SVG</Button><Button variant={active ? 'danger' : 'primary'} onClick={() => { setActive(!active); notify(active ? 'Join code deactivated' : 'Join code reactivated'); }} icon={active ? 'lock' : 'check'}>{active ? 'Deactivate' : 'Reactivate'}</Button><Button onClick={regenerate} icon="refresh">Regenerate</Button></footer></section><section className="admin-stats"><article className="panel"><span className="stat-icon coral"><Icon name="users"/></span><strong>{stores[0].members}</strong><small>Active members</small><em>+18 this month</em></article><article className="panel"><span className="stat-icon gold"><Icon name="scan"/></span><strong>128</strong><small>Verified QR joins</small><em>40.3% conversion</em></article><article className="panel"><span className="stat-icon blue"><Icon name="trade"/></span><strong>{stores[0].trades}</strong><small>Open trade posts</small><em>7 created this week</em></article></section><section className="panel admin-boundaries"><div><Icon name="lock"/><span><strong>Administrator boundaries</strong><small>Designed into database policies, not just hidden in the interface.</small></span></div><ul><li><Icon name="check"/>Manage store profile and hours</li><li><Icon name="check"/>Issue and revoke QR join codes</li><li><Icon name="check"/>Moderate store community content</li><li className="denied"><Icon name="close"/>Read private direct messages</li><li className="denied"><Icon name="close"/>View collection values or cost basis</li></ul></section></div></div><Modal open={posterOpen} onClose={() => setPosterOpen(false)} title="Printable in-store poster" eyebrow="A4 preview" wide><div className="poster-preview"><div className="poster"><header><span className="brand-mark"><span/></span><strong>TCG Harbor</strong></header><p className="eyebrow">{stores[0].name}</p><h2>Meet your<br/><em>local crew.</em></h2><p>Scan while you’re in store to join our private collector community.</p><div className="poster-qr" dangerouslySetInnerHTML={{ __html: qrSvg }}/><strong className="poster-code">{code}</strong><div className="poster-benefits"><span><Icon name="message"/>Community chat</span><span><Icon name="trade"/>Local trades</span><span><Icon name="users"/>Verified members</span></div><small>Unofficial community demo · No sales or payments · Code is revocable</small></div><div className="poster-actions"><p><Icon name="info"/>Print at 100% scale on A4 or US Letter. The high-error-correction SVG remains scannable after normal print wear.</p><Button onClick={download} icon="download">Download print SVG</Button></div></div></Modal></div>;
}

function ScannerPage({ navigate, notify }: { navigate: (path: string) => void; notify: (message: string) => void }) {
  const [cameraState, setCameraState] = useState<'idle' | 'requesting' | 'active' | 'denied'>('idle');
  const [manual, setManual] = useState('');
  const [uploaded, setUploaded] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);
  const startCamera = async () => {
    setCameraState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCameraState('active');
      notify('Camera ready — align the store code inside the frame');
    } catch { setCameraState('denied'); }
  };
  const submitManual = (event: FormEvent) => { event.preventDefault(); const code = manual.trim().toUpperCase(); navigate(`/join/${encodeURIComponent(code)}`); };
  return <div className="page scanner-page"><button className="back-link" onClick={() => navigate('/stores')}><Icon name="chevron"/>Back to stores</button><div className="scanner-layout"><section className="scanner-card panel"><div className="panel-header"><div><p className="eyebrow">Physical verification</p><h2>Scan the store’s QR</h2></div><Chip tone="positive"><Icon name="shield" size={13}/>Secure join</Chip></div><div className={`camera-view camera-${cameraState}`}><video ref={videoRef} muted playsInline/><div className="scan-frame"><i/><i/><i/><i/></div>{cameraState === 'idle' && <div className="camera-placeholder"><span><Icon name="camera" size={34}/></span><strong>Camera access starts only when you ask</strong><p>We use the camera only to detect a store QR code. No image is stored.</p><Button onClick={startCamera} icon="camera">Enable camera</Button></div>}{cameraState === 'requesting' && <div className="camera-placeholder"><span className="spinner"/><strong>Waiting for camera permission…</strong></div>}{cameraState === 'denied' && <div className="camera-placeholder denied"><span><Icon name="camera" size={34}/></span><strong>Camera permission denied</strong><p>Allow camera access in browser settings, upload a QR image, or enter the code manually.</p><Button variant="secondary" onClick={startCamera} icon="refresh">Try again</Button></div>}{cameraState === 'active' && <div className="scan-status"><span className="live-pulse"/>Looking for a TCG Harbor code…</div>}</div><p className="scanner-safety"><Icon name="lock"/>Codes contain a public, revocable store token — never credentials.</p></section><aside className="scanner-fallbacks"><section className="panel"><span className="fallback-icon"><Icon name="upload"/></span><div><h3>Upload a QR image</h3><p>Choose a photo or screenshot of the in-store poster.</p></div><label className="upload-button"><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setUploaded(file.name); notify('Image loaded. Demo decoder found the Berlin store code.'); } }}/>{uploaded ? 'Image loaded' : 'Choose image'}</label>{uploaded && <div className="upload-result"><Icon name="check"/><span><strong>{uploaded}</strong><small>Demo code detected</small></span><Button size="sm" onClick={() => navigate(`/join/${stores[0].code}`)}>Continue</Button></div>}</section><section className="panel"><span className="fallback-icon"><Icon name="qr"/></span><div><h3>Enter code manually</h3><p>Accessible fallback for the code printed below the QR.</p></div><form onSubmit={submitManual}><label><span>Store code</span><input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="HARBOR-CITY-XXXX" required/></label><Button type="submit" variant="secondary">Validate code</Button></form></section><section className="demo-scan panel"><DemoBadge compact/><h3>Development convenience</h3><p>Seeded stores include simulation links for testing. Physical scanning remains the production path.</p><Button variant="ghost" onClick={() => navigate(`/join/${stores[0].code}`)} icon="sparkle">Simulate Berlin scan</Button></section></aside></div></div>;
}

function JoinPage({ code, joinedIds, setJoinedIds, navigate, notify }: { code: string; joinedIds: Set<string>; setJoinedIds: (ids: Set<string>) => void; navigate: (path: string) => void; notify: (message: string) => void }) {
  const store = stores.find((item) => item.code.toUpperCase() === code.toUpperCase());
  const already = store ? joinedIds.has(store.id) : false;
  const revoked = code.toUpperCase().includes('REVOKED') || code.toUpperCase().includes('EXPIRED');
  const clearIntent = () => clearStoredStoreJoinIntent(window.sessionStorage, window.localStorage);
  useEffect(() => {
    if (!store || revoked || already) clearIntent();
  }, [already, revoked, store]);
  const join = () => {
    if (!store || revoked || already) return;
    clearIntent();
    setJoinedIds(new Set([...joinedIds, store.id]));
    notify(`Welcome to ${store.name}`);
    navigate(`/communities/${store.id}`);
  };
  if (!store || revoked) return <div className="page join-page"><section className="join-result panel error"><span><Icon name="close" size={34}/></span><p className="eyebrow">Code not accepted</p><h2>{revoked ? 'This store code has expired' : 'We could not validate this code'}</h2><p>{revoked ? 'A store administrator revoked or regenerated this physical code.' : 'Check the printed code, scan again, or ask store staff for the current poster.'}</p><div><Button variant="secondary" onClick={() => { clearIntent(); navigate('/scan'); }}>Try another code</Button><Button onClick={() => { clearIntent(); navigate('/stores'); }}>Find a store</Button></div></section></div>;
  return <div className="page join-page"><section className={`join-identity store-${store.accent}`}><div className="join-brand"><span className="brand-mark"><span/></span><strong>TCG Harbor</strong></div><StoreVisual store={store}/><Chip tone="positive"><Icon name="shield" size={13}/>Valid store identity</Chip><h2>{store.name}</h2><p>{store.address}</p><div className="join-code"><span>Verified join token</span><strong>{code}</strong></div></section><section className="join-confirm panel">{already ? <><span className="join-success"><Icon name="check" size={30}/></span><p className="eyebrow">Already aboard</p><h2>You’re already a member</h2><p>Duplicate memberships are prevented. Your existing access remains active.</p><Button onClick={() => { clearIntent(); navigate(`/communities/${store.id}`); }} icon="users">Open community</Button></> : <><p className="eyebrow">Confirm membership</p><h2>Join the local collector crew?</h2><p>Membership unlocks private store chat, local trade posts, the member directory, and direct messaging with collectors you meet here.</p><ul><li><Icon name="message"/><span><strong>Community chat</strong><small>Realtime updates from verified local members</small></span></li><li><Icon name="trade"/><span><strong>Card-for-card trades</strong><small>No sales, prices, payments, or auctions</small></span></li><li><Icon name="lock"/><span><strong>Your collection stays private</strong><small>Only cards you deliberately offer become visible</small></span></li></ul><label className="join-checkbox"><input type="checkbox" defaultChecked/><span>I confirm I am physically visiting {store.name} and agree to the community guidelines.</span></label><Button className="full-width" onClick={join} icon="users">Join {store.name}</Button><button className="cancel-link" onClick={() => { clearIntent(); navigate(`/stores/${store.id}`); }}>Not now — view store profile</button></>}</section></div>;
}

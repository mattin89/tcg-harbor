import marketSnapshotRaw from './generated/onepiece-market-v8.json?raw';

export type Market = 'cardmarket' | 'tcgplayer';
export type Currency = 'EUR' | 'USD';
export type Period = '1D' | '1W' | '1M';
export type AssetKind = 'card' | 'sealed';

export interface AcquisitionLot {
  id: string;
  addedAt: string;
  quantity: number;
  quoteAtAdd: { cardmarket: number | null; tcgplayer: number | null };
  purchasePrice?: number;
  purchaseCurrency?: Currency;
  sourceUpdatedAt?: { cardmarket: string; optcg: string; tcgcsv?: string };
}

export interface MarketDataMeta {
  matchingPolicy: string;
  englishExpansionIds: Record<string, number>;
  englishStarterExpansionIds: Record<string, number>;
  englishReleaseManifest: {
    source: string;
    auditedAt: string;
    policy: string;
    futureProductsExcluded: Array<{
      abbreviation: string;
      releasedOn: string;
      memberSetCodes: string[];
    }>;
  };
  crossMarketCoverage: {
    exactMappingsByGroup: Record<string, number>;
    releasedGroupsWithoutExactStandardMappings: string[];
    ambiguityPolicy: string;
  };
  cardmarketCoverage: {
    exactMappingsByGroup: Record<string, number>;
    additionalExactMappingsByGroup: Record<string, number>;
    coverageByGroup: Record<string, {
      groupKind: 'booster' | 'starter-deck';
      expansionId: number;
      seededExactMappings: number;
      exactMappings: number;
      exactMappingsWithTrend: number;
      ambiguousCardPrintings: number;
      unavailableCardPrintings: number;
      ambiguousGroups: number;
    }>;
    starterExpansionEvidence: Record<string, {
      setCode: string;
      idExpansion: number;
      policy: string;
      evidenceProductIds: number[];
    }>;
    ambiguousStarterExpansionEvidence: Array<Record<string, unknown>>;
    mappingPolicy: string;
    ambiguityPolicy: string;
    ambiguousArtworkSamples: Array<Record<string, unknown>>;
    unavailableSamples: Array<Record<string, unknown>>;
  };
  catalogCounts: Record<string, number>;
  cardmarket: {
    source: string;
    catalog: string;
    nonSinglesCatalog: string;
    createdAt: string;
    priceField: string;
    currency: string;
  };
  tcgcsv: {
    source: string;
    createdAt: string;
    categoryId: number;
    promoGroupId: number;
    promoProducts: string;
    promoPrices: string;
    priceField: string;
    currency: string;
    role: string;
    mainSetGroups: Record<string, number>;
    marketGroups: Record<string, {
      groupId: number;
      name: string;
      tcgcsvPublishedOn: string;
      officialEnglishReleasedOn: string;
      memberSetCodes: string[];
      cardmarketExpansionId: number;
      exactMappings: number;
    }>;
  };
  optcg: {
    source: string;
    feeds: string[];
    createdAt: string;
    priceField: string;
    currency: string;
    role: string;
  };
  exchangeRate: {
    usdPerEur: number;
    observationDate: string;
    fetchedAt: string;
    seriesKey: string;
    source: string;
    direction: 'USD per EUR';
    role: string;
  };
}

interface MarketSnapshot {
  generatedAt: string;
  provenance: MarketDataMeta;
  initialAssetIds: string[];
  assets: DemoAsset[];
}

export interface DemoAsset {
  id: string;
  /** Production-only owner-scoped row identifier. */
  collectionItemId?: string;
  catalogId?: string;
  kind: AssetKind;
  name: string;
  set: string;
  setCode: string;
  number?: string;
  rarity: string;
  variant: string;
  productType?: string;
  language: string;
  condition: string;
  quantity: number;
  purchasePrice?: number;
  purchaseCurrency?: Currency;
  note?: string;
  addedAt: string;
  color: string;
  imageUrl?: string;
  imageState?: 'available' | 'unavailable';
  imageUnavailableReason?: string;
  rulesCardId?: string;
  printingId?: string;
  sourcePrintingId?: string;
  cardmarketProductId?: number;
  cardmarketExpansionId?: number;
  cardmarketPriceState?: 'available' | 'trend-unavailable' | 'ambiguous-artwork' | 'unmapped';
  cardmarketPriceReason?: string;
  cardmarketMappingEvidence?: string;
  cardmarketCandidateExpansionId?: number;
  cardmarketCandidates?: Array<{ productId: number; trend: number | null }>;
  cardmarketCandidatePriceRange?: {
    minimumTrend: number | null;
    maximumTrend: number | null;
    pricedCandidates: number;
    totalCandidates: number;
  };
  tcgplayerProductId?: number;
  tcgplayerGroupId?: number;
  tcgplayerMappingEvidence?: string;
  usPriceSource?: string;
  sourceUpdatedAt?: { cardmarket: string; optcg: string; tcgcsv?: string };
  pricing?: {
    cardmarket: { trend: number | null; low: number | null; average: number | null; average1Day: number | null; average7Days: number | null; average30Days: number | null };
    usMarket: { market: number | null; inventory: number | null };
  };
  quote: { cardmarket: number | null; tcgplayer: number | null };
  change: Record<Market, Record<Period, number | null>>;
  acquisitionLots?: AcquisitionLot[];
}

export interface Store {
  id: string;
  code: string;
  name: string;
  city: string;
  country: string;
  address: string;
  distance: string;
  members: number;
  trades: number;
  joined: boolean;
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  hours: string;
  phone: string;
  email: string;
  accent: string;
  source?: 'demo' | 'registered';
}

export interface CommunityMessage {
  id: string;
  user: string;
  initials: string;
  text: string;
  time: string;
  own?: boolean;
  failed?: boolean;
}

export interface TradePost {
  id: string;
  communityId: string;
  author: string;
  initials: string;
  offeredId: string;
  wantedIds: string[];
  offeredQuantity: number;
  condition: string;
  language: string;
  note: string;
  meetup: string;
  status: 'Open' | 'Discussing' | 'Completed' | 'Closed';
  createdAt: string;
  capturedEu: number | null;
  capturedUs: number | null;
}

export interface Conversation {
  id: string;
  user: string;
  initials: string;
  community: string;
  online: boolean;
  unread: number;
  messages: CommunityMessage[];
}

const marketSnapshot = JSON.parse(marketSnapshotRaw) as MarketSnapshot;
const sourceBackedCatalog = marketSnapshot.assets;
const representativeHoldingIds = new Set(marketSnapshot.initialAssetIds);

// The searchable catalog is complete, while the demo collection remains a small set
// of representative owned cards. Catalog growth must never silently create holdings.
export const catalogAssets: DemoAsset[] = sourceBackedCatalog;
export const initialAssets: DemoAsset[] = sourceBackedCatalog
  .filter((asset) => representativeHoldingIds.has(asset.id))
  .map((asset) => ({
    ...asset,
    catalogId: asset.id,
    quantity: 1,
    acquisitionLots: [{
      id: `initial-${asset.id}`,
      addedAt: asset.addedAt,
      quantity: 1,
      quoteAtAdd: { ...asset.quote },
      sourceUpdatedAt: asset.sourceUpdatedAt,
    }],
  }));

export const marketDataMeta = marketSnapshot.provenance;

export const stores: Store[] = [
  { id: 'berlin-dock', code: 'HARBOR-DRESDEN-7K2M', name: 'Dresden Card Dock', city: 'Dresden', country: 'Germany', address: 'Prager Straße, 01069 Dresden', distance: '0.7 km', members: 318, trades: 24, joined: true, x: 50, y: 42, latitude: 51.0455, longitude: 13.7352, hours: 'Today · 12:00–21:00', phone: '+49 351 555 0188', email: 'crew@dresdencarddock.demo', accent: 'coral' },
  { id: 'amsterdam-wharf', code: 'HARBOR-ELBE-4P9Q', name: 'Elbe Mana Wharf', city: 'Dresden', country: 'Germany', address: 'Alaunstraße, 01099 Dresden', distance: '2.0 km', members: 246, trades: 17, joined: true, x: 43, y: 38, latitude: 51.0668, longitude: 13.7531, hours: 'Today · 11:00–20:00', phone: '+49 351 555 0124', email: 'hello@elbemanawharf.demo', accent: 'gold' },
  { id: 'london-deckhouse', code: 'HARBOR-ALTSTADT-8J3R', name: 'Altstadt Deckhouse', city: 'Dresden', country: 'Germany', address: 'Wilsdruffer Straße, 01067 Dresden', distance: '0.5 km', members: 401, trades: 31, joined: true, x: 35, y: 44, latitude: 51.0504, longitude: 13.7384, hours: 'Today · 10:00–22:00', phone: '+49 351 555 0183', email: 'crew@altstadtdeckhouse.demo', accent: 'violet' },
  { id: 'ny-shuffle', code: 'HARBOR-NEUSTADT-2X5A', name: 'Neustadt Shuffle Club', city: 'Dresden', country: 'Germany', address: 'Königsbrücker Straße, 01099 Dresden', distance: '2.5 km', members: 529, trades: 42, joined: false, x: 78, y: 56, latitude: 51.0700, longitude: 13.7510, hours: 'Today · 11:00–23:00', phone: '+49 351 555 0140', email: 'ahoy@neustadtshuffle.demo', accent: 'azure' },
  { id: 'seattle-harbor', code: 'HARBOR-BLASEWITZ-6T1N', name: 'Blasewitz Harbor Games', city: 'Dresden', country: 'Germany', address: 'Schillerplatz, 01309 Dresden', distance: '5.0 km', members: 211, trades: 13, joined: false, x: 12, y: 50, latitude: 51.0521, longitude: 13.8074, hours: 'Today · 12:00–20:00', phone: '+49 351 555 0196', email: 'hello@blasewitzharbor.demo', accent: 'jade' },
  { id: 'la-topdeck', code: 'HARBOR-PIESCHEN-9V4C', name: 'Pieschen Topdeck', city: 'Dresden', country: 'Germany', address: 'Leipziger Straße, 01127 Dresden', distance: '3.3 km', members: 367, trades: 28, joined: false, x: 16, y: 69, latitude: 51.0802, longitude: 13.7193, hours: 'Today · 10:00–21:00', phone: '+49 351 555 0172', email: 'crew@pieschentopdeck.demo', accent: 'amber' },
];

export const initialCommunityMessages: Record<string, CommunityMessage[]> = {
  'berlin-dock': [
    { id: 'cm1', user: 'LenaK', initials: 'LK', text: 'Friday locals sign-up is open. Six seats left!', time: '09:42' },
    { id: 'cm2', user: 'RikuBerlin', initials: 'RB', text: 'I’ll bring my trade binder — mostly OP05 and OP06 parallels.', time: '10:07' },
    { id: 'cm3', user: 'Mario', initials: 'MD', text: 'Looking forward to it. I’ll be there around 18:30.', time: '10:13', own: true },
    { id: 'cm4', user: 'NamiCollector', initials: 'NC', text: 'Does anyone have a spare OP01 Nami?', time: '10:28' },
  ],
  'amsterdam-wharf': [
    { id: 'am1', user: 'Joris', initials: 'JV', text: 'Trade night has moved upstairs today.', time: 'Yesterday' },
    { id: 'am2', user: 'SakuraDecks', initials: 'SD', text: 'Thanks! I’m bringing three starter decks for new players.', time: 'Yesterday' },
  ],
  'london-deckhouse': [
    { id: 'ld1', user: 'Mira', initials: 'MR', text: 'Pairings for league night are posted at the counter.', time: '08:21' },
  ],
};

export const initialTradePosts: TradePost[] = [
  { id: 'trade-1', communityId: 'berlin-dock', author: 'LenaK', initials: 'LK', offeredId: 'card-2', wantedIds: ['card-5'], offeredQuantity: 1, condition: 'Near Mint', language: 'English', note: 'Pulled twice last weekend. Happy to inspect both cards in store.', meetup: 'Friday locals', status: 'Open', createdAt: '18 min ago', capturedEu: null, capturedUs: null },
  { id: 'trade-2', communityId: 'berlin-dock', author: 'RikuBerlin', initials: 'RB', offeredId: 'card-14', wantedIds: ['card-1', 'card-13'], offeredQuantity: 1, condition: 'Near Mint', language: 'English', note: 'Prefer a local meetup after league night. Market references are just context.', meetup: 'Dresden Card Dock', status: 'Discussing', createdAt: '2 h ago', capturedEu: null, capturedUs: null },
  { id: 'trade-3', communityId: 'amsterdam-wharf', author: 'Joris', initials: 'JV', offeredId: 'card-7', wantedIds: ['card-3'], offeredQuantity: 1, condition: 'Excellent', language: 'English', note: 'Completed smoothly at the Sunday meetup.', meetup: 'Elbe Mana Wharf', status: 'Completed', createdAt: '3 days ago', capturedEu: null, capturedUs: null },
  { id: 'trade-4', communityId: 'london-deckhouse', author: 'Mira', initials: 'MR', offeredId: 'card-26', wantedIds: ['card-16', 'card-20'], offeredQuantity: 2, condition: 'Near Mint', language: 'English', note: 'Looking for either card; no need for both.', meetup: 'Saturday afternoon', status: 'Open', createdAt: 'Yesterday', capturedEu: null, capturedUs: null },
  { id: 'trade-5', communityId: 'berlin-dock', author: 'Mario', initials: 'MD', offeredId: 'card-9', wantedIds: ['card-12'], offeredQuantity: 1, condition: 'Near Mint', language: 'English', note: 'Archived after changing decks.', meetup: 'Dresden Card Dock', status: 'Closed', createdAt: '1 week ago', capturedEu: null, capturedUs: null },
];

export const initialConversations: Conversation[] = [
  { id: 'lena', user: 'LenaK', initials: 'LK', community: 'Dresden Card Dock', online: true, unread: 2, messages: [
    { id: 'l1', user: 'LenaK', initials: 'LK', text: 'Hey! Saw that you own the Boa parallel I’m after.', time: '10:31' },
    { id: 'l2', user: 'Mario', initials: 'MD', text: 'I do — happy to bring it to Friday locals.', time: '10:34', own: true },
    { id: 'l3', user: 'LenaK', initials: 'LK', text: 'Perfect. I’ll bring the Zoro so we can inspect both.', time: '10:36' },
  ] },
  { id: 'joris', user: 'Joris', initials: 'JV', community: 'Elbe Mana Wharf', online: false, unread: 0, messages: [
    { id: 'j1', user: 'Joris', initials: 'JV', text: 'Thanks again for the smooth meetup!', time: 'Mon' },
    { id: 'j2', user: 'Mario', initials: 'MD', text: 'Likewise — enjoy the deck!', time: 'Mon', own: true },
  ] },
  { id: 'mira', user: 'Mira', initials: 'MR', community: 'The Deckhouse', online: true, unread: 0, messages: [
    { id: 'm1', user: 'Mira', initials: 'MR', text: 'Will you be at the Altstadt meetup next month?', time: 'Tue' },
  ] },
];

export const notifications = [
  { id: 'n1', type: 'message', title: 'New message from LenaK', detail: 'Perfect. I’ll bring the Zoro…', time: '2 min', unread: true },
  { id: 'n2', type: 'trade', title: 'A trade matches your collection', detail: 'Mira is looking for Vinsmoke Reiju.', time: '1 h', unread: true },
  { id: 'n3', type: 'community', title: 'Community joined', detail: 'Welcome to The Deckhouse community.', time: '2 days', unread: false },
  { id: 'n4', type: 'status', title: 'Trade marked completed', detail: 'Your Elbe Mana Wharf trade is now complete.', time: '3 days', unread: false },
];

export const recentActivity = [
  { icon: 'plus', title: 'Added Shanks', detail: 'OP01-120 · Standard English release', time: '12 min ago' },
  { icon: 'users', title: 'Joined Altstadt Deckhouse', detail: 'Store community · Dresden', time: '2 days ago' },
  { icon: 'trade', title: 'Trade post completed', detail: 'with Joris at Elbe Mana Wharf', time: '3 days ago' },
  { icon: 'cards', title: 'Updated card quantity', detail: 'Yamato · OP01-121', time: '5 days ago' },
];

export function currencyFor(market: Market): Currency {
  return market === 'cardmarket' ? 'EUR' : 'USD';
}

export function formatMoney(value: number | null, marketOrCurrency: Market | Currency): string {
  if (value === null) return 'Unavailable';
  const currency = marketOrCurrency === 'cardmarket' ? 'EUR' : marketOrCurrency === 'tcgplayer' ? 'USD' : marketOrCurrency;
  return new Intl.NumberFormat(currency === 'EUR' ? 'de-DE' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export function assetById(id: string, assets: DemoAsset[] = initialAssets): DemoAsset {
  return assets.find((asset) => asset.id === id) ?? catalogAssets[0];
}

export function portfolioSeries(assets: DemoAsset[], market: Market, period: Period, kind: AssetKind | 'all') {
  const filtered = assets.filter((asset) => kind === 'all' || asset.kind === kind);
  const current = filtered.reduce((sum, asset) => sum + (asset.quote[market] ?? 0) * asset.quantity, 0);
  const weightedChange = filtered.reduce((sum, asset) => {
    const quote = asset.quote[market];
    const change = asset.change[market][period];
    return quote === null || change === null ? sum : sum + quote * asset.quantity * change;
  }, 0) / Math.max(1, current);
  const start = current / (1 + weightedChange / 100);
  const duration = period === '1D' ? 24 * 3600000 : period === '1W' ? 7 * 86400000 : 30 * 86400000;
  // Cardmarket supplies rolling averages rather than transaction history. Return only
  // the two real comparison endpoints; never invent intermediate chart points.
  return [
    { at: new Date(Date.now() - duration), value: start, start, change: 0, pct: 0 },
    { at: new Date(), value: current, start, change: current - start, pct: start ? ((current - start) / start) * 100 : 0 },
  ];
}

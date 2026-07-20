export type ISODateTime = string;
export type ISODate = string;

export type UserId = string;
export type GameId = string;
export type CardSetId = string;
export type CardId = string;
export type CardVariantId = string;
export type SealedProductId = string;
export type CatalogItemId = CardVariantId | SealedProductId;
export type CollectionItemId = string;
export type StoreId = string;
export type CommunityId = string;
export type CommunityMembershipId = string;
export type CommunityMessageId = string;
export type TradePostId = string;
export type ConversationId = string;
export type DirectMessageId = string;

export type Currency = 'EUR' | 'USD';
export type MarketProvider = 'cardmarket' | 'tcgplayer';
export type MarketRegion = 'EU' | 'US';
export type AssetType = 'card' | 'sealed';
export type LanguageCode = 'EN' | 'JP' | 'FR' | 'IT' | 'ES' | 'CN' | 'KR';
export type CardCondition = 'mint' | 'near_mint' | 'excellent' | 'good' | 'light_played' | 'played' | 'poor';
export type SealedCondition = 'factory_sealed' | 'sealed_damaged' | 'open_box';
export type ProductType =
  | 'booster_box'
  | 'booster_pack'
  | 'starter_deck'
  | 'special_collection'
  | 'gift_collection'
  | 'promotional_product'
  | 'tournament_product'
  | 'case'
  | 'other';

export interface Money {
  readonly amount: number;
  readonly currency: Currency;
}

export interface Game {
  readonly id: GameId;
  readonly slug: string;
  readonly name: string;
  readonly enabled: boolean;
}

export interface CardSet {
  readonly id: CardSetId;
  readonly gameId: GameId;
  readonly name: string;
  readonly code: string;
  readonly releaseDate?: ISODate;
}

export interface ExternalProviderIdentifiers {
  readonly cardmarket?: string;
  readonly tcgplayer?: string;
  readonly [provider: string]: string | undefined;
}

export interface Card {
  readonly id: CardId;
  readonly gameId: GameId;
  readonly setId: CardSetId;
  readonly cardNumber: string;
  readonly name: string;
  readonly rarity: string;
  readonly cardType: string;
  readonly colors: readonly string[];
  readonly releaseDate?: ISODate;
}

export interface CardVariant {
  readonly id: CardVariantId;
  readonly cardId: CardId;
  readonly gameId: GameId;
  readonly setId: CardSetId;
  readonly variant: string;
  readonly language: LanguageCode;
  readonly imageUrl?: string;
  readonly externalIds: ExternalProviderIdentifiers;
}

export interface SealedProduct {
  readonly id: SealedProductId;
  readonly gameId: GameId;
  readonly setId?: CardSetId;
  readonly name: string;
  readonly productType: ProductType;
  readonly languageOrRegion: LanguageCode;
  readonly imageUrl?: string;
  readonly releaseDate?: ISODate;
  readonly externalIds: ExternalProviderIdentifiers;
}

export type CatalogItem =
  | { readonly assetType: 'card'; readonly item: CardVariant }
  | { readonly assetType: 'sealed'; readonly item: SealedProduct };

export interface PriceDataFreshness {
  readonly state: 'fresh' | 'stale' | 'unavailable' | 'demo';
  readonly staleAfter?: ISODateTime;
  readonly isDemo: boolean;
}

export interface PriceQuote {
  readonly id: string;
  readonly catalogItemId: CatalogItemId;
  readonly provider: MarketProvider;
  readonly providerProductId: string;
  readonly region: MarketRegion;
  readonly currency: Currency;
  readonly normalizedMarketValue: number | null;
  readonly low?: number;
  readonly average?: number;
  readonly trend?: number;
  readonly condition: CardCondition | SealedCondition;
  readonly language: LanguageCode;
  readonly variant?: string;
  readonly fetchedAt: ISODateTime;
  readonly freshness: PriceDataFreshness;
  /** Kept server-side; consumers should not assume a provider-specific shape. */
  readonly rawProviderMetadata: Readonly<Record<string, unknown>>;
}

export interface PriceSnapshot {
  readonly id: string;
  readonly catalogItemId: CatalogItemId;
  readonly provider: MarketProvider;
  readonly currency: Currency;
  readonly unitMarketValue: number;
  readonly capturedAt: ISODateTime;
}

export type QuantityChangeReason = 'added' | 'increased' | 'decreased' | 'removed' | 'correction';

export interface QuantityEvent {
  readonly id: string;
  readonly collectionItemId: CollectionItemId;
  readonly delta: number;
  readonly quantityAfter: number;
  readonly occurredAt: ISODateTime;
  readonly reason: QuantityChangeReason;
}

/** A provider-native market value captured when inventory enters the collection. */
export interface AcquisitionMarketReference {
  readonly catalogItemId: CatalogItemId;
  readonly provider: MarketProvider;
  readonly currency: Currency;
  readonly value: number | null;
  readonly capturedAt: ISODateTime;
}

/** An immutable record of one automatic collection addition. */
export interface AcquisitionLot {
  readonly id: string;
  readonly collectionItemId: CollectionItemId;
  readonly addedAt: ISODateTime;
  readonly quantity: number;
  readonly marketReferences: readonly AcquisitionMarketReference[];
}

interface CollectionItemBase {
  readonly id: CollectionItemId;
  readonly ownerId: UserId;
  readonly quantity: number;
  readonly acquiredAt: ISODate;
  readonly acquisitionLots: readonly AcquisitionLot[];
  readonly purchasePricePerUnit?: Money;
  readonly privateNote?: string;
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

export interface CardCollectionItem extends CollectionItemBase {
  readonly assetType: 'card';
  readonly cardVariantId: CardVariantId;
  readonly condition: CardCondition;
  readonly language: LanguageCode;
}

export interface SealedCollectionItem extends CollectionItemBase {
  readonly assetType: 'sealed';
  readonly sealedProductId: SealedProductId;
  readonly condition: SealedCondition;
  readonly languageOrRegion: LanguageCode;
}

export type CollectionItem = CardCollectionItem | SealedCollectionItem;

export interface PortfolioHolding {
  readonly collectionItemId: CollectionItemId;
  readonly catalogItemId: CatalogItemId;
  readonly assetType: AssetType;
  readonly currentQuantity: number;
  readonly createdAt: ISODateTime;
  readonly quantityEvents: readonly QuantityEvent[];
}

export interface Store {
  readonly id: StoreId;
  readonly name: string;
  readonly address: string;
  readonly approximateLatitude: number;
  readonly approximateLongitude: number;
  readonly communityId: CommunityId;
}

export interface StoreJoinCode {
  readonly id: string;
  readonly publicCode: string;
  readonly storeId: StoreId;
  readonly communityId: CommunityId;
  readonly active: boolean;
  readonly expiresAt?: ISODateTime;
  readonly maxUses?: number;
  readonly useCount: number;
  readonly createdAt: ISODateTime;
  readonly revokedAt?: ISODateTime;
}

export type CommunityMembershipStatus = 'active' | 'suspended' | 'left';

export interface CommunityMembership {
  readonly id: CommunityMembershipId;
  readonly communityId: CommunityId;
  readonly userId: UserId;
  readonly status: CommunityMembershipStatus;
  readonly role: 'member' | 'moderator' | 'store_admin';
  readonly joinedAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

export interface CommunityMessage {
  readonly id: CommunityMessageId;
  readonly communityId: CommunityId;
  readonly authorId: UserId;
  readonly body: string;
  readonly sentAt: ISODateTime;
  readonly deletedAt?: ISODateTime;
}

export interface UserBlock {
  readonly blockerId: UserId;
  readonly blockedId: UserId;
  readonly createdAt: ISODateTime;
}

export type TradeStatus = 'open' | 'discussing' | 'completed' | 'closed';

export interface MarketReference {
  readonly catalogItemId: CatalogItemId;
  readonly provider: MarketProvider;
  readonly currency: Currency;
  readonly value: number | null;
  readonly capturedAt: ISODateTime;
  readonly readOnly: true;
  readonly notice: 'Market reference only — not a sale price';
}

export interface TradePostOfferedItem {
  readonly catalogItemId: CatalogItemId;
  readonly quantity: number;
  readonly condition: CardCondition;
  readonly language: LanguageCode;
}

export interface TradePostWantedItem {
  readonly catalogItemId: CatalogItemId;
  readonly desiredQuantity?: number;
  readonly desiredCondition?: CardCondition;
  readonly desiredLanguage?: LanguageCode;
}

export interface TradePost {
  readonly id: TradePostId;
  readonly communityId: CommunityId;
  readonly authorId: UserId;
  readonly offeredItems: readonly TradePostOfferedItem[];
  readonly wantedItems: readonly TradePostWantedItem[];
  readonly notes?: string;
  readonly meetupPreference?: string;
  readonly status: TradeStatus;
  readonly marketReferencesAtCreation: readonly MarketReference[];
  readonly createdAt: ISODateTime;
  readonly updatedAt: ISODateTime;
}

export interface DirectConversation {
  readonly id: ConversationId;
  readonly participantIds: readonly [UserId, UserId];
  readonly sharedCommunityId: CommunityId;
  readonly createdAt: ISODateTime;
  readonly hiddenBy: readonly UserId[];
}

export interface DirectMessage {
  readonly id: DirectMessageId;
  readonly conversationId: ConversationId;
  readonly senderId: UserId;
  readonly body: string;
  readonly sentAt: ISODateTime;
  readonly deletedAt?: ISODateTime;
}

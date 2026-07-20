import { DomainError } from './errors';
import type {
  CardCondition,
  CatalogItemId,
  CollectionItem,
  LanguageCode,
  SealedCondition,
  UserId,
} from './types';

/** Collection, portfolio, notes, and cost basis are owner-only by default. */
export function canViewPrivateCollection(viewerId: UserId, ownerId: UserId): boolean {
  return Boolean(viewerId) && viewerId === ownerId;
}

export function privateCollectionForViewer(
  viewerId: UserId,
  ownerId: UserId,
  items: readonly CollectionItem[],
): readonly CollectionItem[] {
  if (!canViewPrivateCollection(viewerId, ownerId)) {
    throw new DomainError('NOT_AUTHORIZED', 'Collections and portfolio values are private to their owner.');
  }
  return items.filter((item) => item.ownerId === ownerId);
}

/** The sole collection projection permitted in community trade content. */
export interface PublicTradeHoldingDisclosure {
  readonly assetType: 'card' | 'sealed';
  readonly catalogItemId: CatalogItemId;
  readonly quantity: number;
  readonly condition: CardCondition | SealedCondition;
  readonly language: LanguageCode;
}

export function toPublicTradeHoldingDisclosure(
  item: CollectionItem,
  offeredQuantity: number,
): PublicTradeHoldingDisclosure {
  if (!Number.isInteger(offeredQuantity) || offeredQuantity <= 0 || offeredQuantity > item.quantity) {
    throw new DomainError('INVALID_INPUT', 'Offered quantity must be available in the collection.');
  }
  if (item.assetType === 'card') {
    return Object.freeze({
      assetType: 'card',
      catalogItemId: item.cardVariantId,
      quantity: offeredQuantity,
      condition: item.condition,
      language: item.language,
    });
  }
  return Object.freeze({
    assetType: 'sealed',
    catalogItemId: item.sealedProductId,
    quantity: offeredQuantity,
    condition: item.condition,
    language: item.languageOrRegion,
  });
}

export const PRIVATE_COLLECTION_FIELDS = Object.freeze([
  'ownerId',
  'privateNote',
  'purchasePricePerUnit',
  'acquiredAt',
  'createdAt',
  'updatedAt',
] as const);

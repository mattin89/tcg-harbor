import { DomainError } from './errors';
import { assertNativeProviderCurrency } from './pricing';
import type {
  AcquisitionLot,
  AcquisitionMarketReference,
  CardCollectionItem,
  CardCondition,
  CardVariantId,
  CatalogItemId,
  CollectionItem,
  CollectionItemId,
  Currency,
  ISODateTime,
  LanguageCode,
  MarketProvider,
  Money,
  SealedCollectionItem,
  SealedCondition,
  SealedProductId,
  UserId,
} from './types';

interface CollectionAddBase {
  readonly ownerId: UserId;
  readonly quantity: number;
  readonly purchasePricePerUnit?: Money;
  readonly privateNote?: string;
}

export interface AddCardInput extends CollectionAddBase {
  readonly assetType: 'card';
  readonly cardVariantId: CardVariantId;
  readonly condition: CardCondition;
  readonly language: LanguageCode;
}

export interface AddSealedInput extends CollectionAddBase {
  readonly assetType: 'sealed';
  readonly sealedProductId: SealedProductId;
  readonly condition: SealedCondition;
  readonly languageOrRegion: LanguageCode;
}

export type CollectionAddInput = AddCardInput | AddSealedInput;
export type DuplicatePolicy = 'require_confirmation' | 'merge';

interface CollectionResultBase {
  readonly items: readonly CollectionItem[];
}

export interface CollectionAddedResult extends CollectionResultBase {
  readonly status: 'added';
  readonly item: CollectionItem;
}

export interface DuplicateConfirmationResult extends CollectionResultBase {
  readonly status: 'duplicate_confirmation_required';
  readonly existingItem: CollectionItem;
  readonly proposedQuantity: number;
}

export interface CollectionMergedResult extends CollectionResultBase {
  readonly status: 'merged';
  readonly item: CollectionItem;
  readonly quantityAdded: number;
}

export type AddCollectionItemResult =
  | CollectionAddedResult
  | DuplicateConfirmationResult
  | CollectionMergedResult;

export interface AddCollectionItemOptions {
  readonly newItemId: CollectionItemId;
  readonly newAcquisitionLotId: string;
  readonly now: ISODateTime;
  readonly onDuplicate?: DuplicatePolicy;
  /** Trusted provider data only; timestamps and catalog IDs are derived by this operation. */
  readonly marketReferencesAtAdd?: readonly TrustedAcquisitionMarketReferenceInput[];
}

export interface TrustedAcquisitionMarketReferenceInput {
  readonly provider: MarketProvider;
  readonly currency: Currency;
  readonly value: number | null;
}

function assertQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new DomainError('INVALID_INPUT', 'Collection quantity must be a positive integer.');
  }
}

function assertDate(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new DomainError('INVALID_INPUT', `${label} must be a valid date.`);
}

function assertMoney(money: Money | undefined): void {
  if (!money) return;
  if (!Number.isFinite(money.amount) || money.amount < 0) {
    throw new DomainError('INVALID_INPUT', 'Purchase price must be a finite non-negative amount.');
  }
}

function catalogItemId(input: CollectionAddInput): CatalogItemId {
  return input.assetType === 'card' ? input.cardVariantId : input.sealedProductId;
}

function automaticCollectionDate(now: ISODateTime): string {
  return new Date(now).toISOString().slice(0, 10);
}

function createAcquisitionLot(
  input: CollectionAddInput,
  collectionItemId: CollectionItemId,
  options: AddCollectionItemOptions,
): AcquisitionLot {
  const seenProviders = new Set<MarketProvider>();
  const references = (options.marketReferencesAtAdd ?? []).map((reference) => {
    if (seenProviders.has(reference.provider)) {
      throw new DomainError('INVALID_INPUT', `Only one ${reference.provider} market reference is allowed per acquisition lot.`);
    }
    seenProviders.add(reference.provider);
    assertNativeProviderCurrency(reference.provider, reference.currency);
    if (reference.value != null && (!Number.isFinite(reference.value) || reference.value < 0)) {
      throw new DomainError('INVALID_INPUT', 'Acquisition market values must be null or finite non-negative numbers.');
    }
    const captured: AcquisitionMarketReference = Object.freeze({
      catalogItemId: catalogItemId(input),
      provider: reference.provider,
      currency: reference.currency,
      value: reference.value,
      capturedAt: options.now,
    });
    return captured;
  });
  return Object.freeze({
    id: options.newAcquisitionLotId,
    collectionItemId,
    addedAt: options.now,
    quantity: input.quantity,
    marketReferences: Object.freeze(references),
  });
}

export function collectionItemIdentity(item: CollectionItem | CollectionAddInput): string {
  if (item.assetType === 'card') {
    return ['card', item.ownerId, item.cardVariantId, item.condition, item.language].join('|');
  }
  return ['sealed', item.ownerId, item.sealedProductId, item.condition, item.languageOrRegion].join('|');
}

export function findDuplicateCollectionItem(
  items: readonly CollectionItem[],
  input: CollectionAddInput,
): CollectionItem | null {
  const identity = collectionItemIdentity(input);
  return items.find((item) => collectionItemIdentity(item) === identity) ?? null;
}

function weightedPurchasePrice(
  existing: Money | undefined,
  existingQuantity: number,
  added: Money | undefined,
  addedQuantity: number,
): Money | undefined {
  // A partial cost basis would be misleading, so mixed known/unknown lots become unknown.
  if (!existing || !added) return undefined;
  if (existing.currency !== added.currency) {
    throw new DomainError('CURRENCY_MISMATCH', 'Duplicate lots with different cost-basis currencies cannot be merged.');
  }
  const amount =
    (existing.amount * existingQuantity + added.amount * addedQuantity) /
    (existingQuantity + addedQuantity);
  return Object.freeze({ amount, currency: existing.currency as Currency });
}

function createItem(input: CollectionAddInput, options: AddCollectionItemOptions): CollectionItem {
  const acquisitionLot = createAcquisitionLot(input, options.newItemId, options);
  const base = {
    id: options.newItemId,
    ownerId: input.ownerId,
    quantity: input.quantity,
    acquiredAt: automaticCollectionDate(options.now),
    acquisitionLots: Object.freeze([acquisitionLot]),
    purchasePricePerUnit: input.purchasePricePerUnit
      ? Object.freeze({ ...input.purchasePricePerUnit })
      : undefined,
    privateNote: input.privateNote,
    createdAt: options.now,
    updatedAt: options.now,
  } as const;

  if (input.assetType === 'card') {
    const item: CardCollectionItem = Object.freeze({
      ...base,
      assetType: 'card',
      cardVariantId: input.cardVariantId,
      condition: input.condition,
      language: input.language,
    });
    return item;
  }
  const item: SealedCollectionItem = Object.freeze({
    ...base,
    assetType: 'sealed',
    sealedProductId: input.sealedProductId,
    condition: input.condition,
    languageOrRegion: input.languageOrRegion,
  });
  return item;
}

function mergeItem(
  existing: CollectionItem,
  input: CollectionAddInput,
  options: AddCollectionItemOptions,
): CollectionItem {
  const purchasePricePerUnit = weightedPurchasePrice(
    existing.purchasePricePerUnit,
    existing.quantity,
    input.purchasePricePerUnit,
    input.quantity,
  );
  return Object.freeze({
    ...existing,
    quantity: existing.quantity + input.quantity,
    acquisitionLots: Object.freeze([
      ...existing.acquisitionLots,
      createAcquisitionLot(input, existing.id, options),
    ]),
    purchasePricePerUnit,
    updatedAt: options.now,
  });
}

/**
 * Adds without mutation. Exact duplicates require explicit merge confirmation by default,
 * preventing a double click/import from silently inflating quantity.
 */
export function addCollectionItem(
  items: readonly CollectionItem[],
  input: CollectionAddInput,
  options: AddCollectionItemOptions,
): AddCollectionItemResult {
  assertQuantity(input.quantity);
  assertDate(options.now, 'now');
  assertMoney(input.purchasePricePerUnit);
  if ('acquiredAt' in input) {
    throw new DomainError('UNKNOWN_FIELD', 'acquiredAt is automatic and cannot be supplied by collection input.');
  }
  if (!input.ownerId || !options.newItemId || !options.newAcquisitionLotId) {
    throw new DomainError('INVALID_INPUT', 'ownerId, newItemId, and newAcquisitionLotId are required.');
  }

  const duplicate = findDuplicateCollectionItem(items, input);
  if (!duplicate) {
    const item = createItem(input, options);
    return Object.freeze({ status: 'added', item, items: Object.freeze([...items, item]) });
  }

  if ((options.onDuplicate ?? 'require_confirmation') !== 'merge') {
    return Object.freeze({
      status: 'duplicate_confirmation_required',
      existingItem: duplicate,
      proposedQuantity: duplicate.quantity + input.quantity,
      items,
    });
  }

  const item = mergeItem(duplicate, input, options);
  const mergedItems = items.map((candidate) => candidate.id === duplicate.id ? item : candidate);
  return Object.freeze({
    status: 'merged',
    item,
    quantityAdded: input.quantity,
    items: Object.freeze(mergedItems),
  });
}

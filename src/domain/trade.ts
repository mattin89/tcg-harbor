import { assertCommunityAccess } from './community';
import { DomainError } from './errors';
import { assertNativeProviderCurrency } from './pricing';
import type {
  CardCondition,
  CatalogItemId,
  CommunityId,
  CommunityMembership,
  Currency,
  ISODateTime,
  LanguageCode,
  MarketProvider,
  MarketReference,
  TradePost,
  TradePostId,
  TradePostOfferedItem,
  TradePostWantedItem,
  UserId,
} from './types';

export interface TradePostDraftInput {
  readonly communityId: CommunityId;
  readonly offeredItems: readonly TradePostOfferedItem[];
  readonly wantedItems: readonly TradePostWantedItem[];
  readonly notes?: string;
  readonly meetupPreference?: string;
}

const CONDITIONS: ReadonlySet<string> = new Set([
  'mint',
  'near_mint',
  'excellent',
  'good',
  'light_played',
  'played',
  'poor',
]);
const LANGUAGES: ReadonlySet<string> = new Set(['EN', 'JP', 'FR', 'IT', 'ES', 'CN', 'KR']);
const TOP_LEVEL_FIELDS = new Set(['communityId', 'offeredItems', 'wantedItems', 'notes', 'meetupPreference']);
const OFFERED_FIELDS = new Set(['catalogItemId', 'quantity', 'condition', 'language']);
const WANTED_FIELDS = new Set([
  'catalogItemId',
  'desiredQuantity',
  'desiredCondition',
  'desiredLanguage',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedKey(key: string): string {
  return key.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
}

function isPriceLikeKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    normalized === 'amount' ||
    normalized === 'money' ||
    normalized === 'cash' ||
    normalized === 'eur' ||
    normalized === 'usd' ||
    normalized.endsWith('value') ||
    normalized.includes('price') ||
    normalized.includes('cost') ||
    normalized.includes('currency') ||
    normalized.includes('valuation') ||
    normalized.includes('marketvalue') ||
    normalized.includes('marketreference') ||
    normalized.includes('cardmarket') ||
    normalized.includes('tcgplayer') ||
    normalized.includes('saleamount') ||
    normalized.includes('askingamount') ||
    normalized.includes('payment')
  );
}

/** Rejects forbidden fields at any nesting depth before normal validation. */
export function assertNoUserEnteredPriceFields(value: unknown): void {
  const visited = new WeakSet<object>();
  const inspect = (candidate: unknown, path: string): void => {
    if (typeof candidate !== 'object' || candidate === null) return;
    if (visited.has(candidate)) return;
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((entry, index) => inspect(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, entry] of Object.entries(candidate)) {
      if (isPriceLikeKey(key)) {
        throw new DomainError(
          'PRICE_FIELD_FORBIDDEN',
          `User-entered price-like field "${path ? `${path}.` : ''}${key}" is forbidden in trade posts.`,
        );
      }
      inspect(entry, path ? `${path}.${key}` : key);
    }
  };
  inspect(value, '');
}

function assertOnlyFields(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new DomainError('UNKNOWN_FIELD', `Unknown trade-post field: ${path}${unknown}.`);
}

function requiredString(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DomainError('INVALID_INPUT', `${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new DomainError('INVALID_INPUT', `${label} is too long.`);
  }
  return normalized;
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value == null || value === '') return undefined;
  return requiredString(value, label, maxLength);
}

function optionalPositiveQuantity(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new DomainError('INVALID_INPUT', `${label} must be a positive integer.`);
  }
  return value as number;
}

function parseOfferedItem(value: unknown, index: number): TradePostOfferedItem {
  if (!isRecord(value)) throw new DomainError('INVALID_INPUT', `offeredItems[${index}] must be an object.`);
  assertOnlyFields(value, OFFERED_FIELDS, `offeredItems[${index}].`);
  const quantity = optionalPositiveQuantity(value.quantity, `offeredItems[${index}].quantity`);
  if (quantity == null) throw new DomainError('INVALID_INPUT', 'Offered quantity is required.');
  const condition = requiredString(value.condition, `offeredItems[${index}].condition`) as CardCondition;
  const language = requiredString(value.language, `offeredItems[${index}].language`) as LanguageCode;
  if (!CONDITIONS.has(condition)) throw new DomainError('INVALID_INPUT', 'Offered condition is invalid.');
  if (!LANGUAGES.has(language)) throw new DomainError('INVALID_INPUT', 'Offered language is invalid.');
  return Object.freeze({
    catalogItemId: requiredString(value.catalogItemId, `offeredItems[${index}].catalogItemId`) as CatalogItemId,
    quantity,
    condition,
    language,
  });
}

function parseWantedItem(value: unknown, index: number): TradePostWantedItem {
  if (!isRecord(value)) throw new DomainError('INVALID_INPUT', `wantedItems[${index}] must be an object.`);
  assertOnlyFields(value, WANTED_FIELDS, `wantedItems[${index}].`);
  const desiredCondition = optionalString(
    value.desiredCondition,
    `wantedItems[${index}].desiredCondition`,
    40,
  ) as CardCondition | undefined;
  const desiredLanguage = optionalString(
    value.desiredLanguage,
    `wantedItems[${index}].desiredLanguage`,
    8,
  ) as LanguageCode | undefined;
  if (desiredCondition && !CONDITIONS.has(desiredCondition)) {
    throw new DomainError('INVALID_INPUT', 'Desired condition is invalid.');
  }
  if (desiredLanguage && !LANGUAGES.has(desiredLanguage)) {
    throw new DomainError('INVALID_INPUT', 'Desired language is invalid.');
  }
  return Object.freeze({
    catalogItemId: requiredString(value.catalogItemId, `wantedItems[${index}].catalogItemId`) as CatalogItemId,
    desiredQuantity: optionalPositiveQuantity(
      value.desiredQuantity,
      `wantedItems[${index}].desiredQuantity`,
    ),
    desiredCondition,
    desiredLanguage,
  });
}

/** API-boundary parser. Price fields are rejected even if nested under otherwise unknown data. */
export function parseTradePostDraft(value: unknown): TradePostDraftInput {
  assertNoUserEnteredPriceFields(value);
  if (!isRecord(value)) throw new DomainError('INVALID_INPUT', 'Trade post must be an object.');
  assertOnlyFields(value, TOP_LEVEL_FIELDS, '');
  if (!Array.isArray(value.offeredItems) || value.offeredItems.length === 0) {
    throw new DomainError('INVALID_INPUT', 'At least one offered item is required.');
  }
  if (!Array.isArray(value.wantedItems) || value.wantedItems.length === 0) {
    throw new DomainError('INVALID_INPUT', 'At least one wanted item is required.');
  }
  if (value.offeredItems.length > 20 || value.wantedItems.length > 20) {
    throw new DomainError('INVALID_INPUT', 'A trade post supports at most 20 offered and wanted items.');
  }
  return Object.freeze({
    communityId: requiredString(value.communityId, 'communityId') as CommunityId,
    offeredItems: Object.freeze(value.offeredItems.map(parseOfferedItem)),
    wantedItems: Object.freeze(value.wantedItems.map(parseWantedItem)),
    notes: optionalString(value.notes, 'notes', 1_000),
    meetupPreference: optionalString(value.meetupPreference, 'meetupPreference', 200),
  });
}

export type MarketReferenceInput = Omit<MarketReference, 'readOnly' | 'notice'>;

export function makeReadOnlyMarketReference(input: MarketReferenceInput): MarketReference {
  assertNativeProviderCurrency(input.provider, input.currency);
  if (input.value != null && (!Number.isFinite(input.value) || input.value < 0)) {
    throw new DomainError('INVALID_INPUT', 'Market reference value must be null or a non-negative number.');
  }
  if (!Number.isFinite(Date.parse(input.capturedAt))) {
    throw new DomainError('INVALID_INPUT', 'Market reference timestamp is invalid.');
  }
  return Object.freeze({
    ...input,
    readOnly: true,
    notice: 'Market reference only — not a sale price',
  });
}

export interface CreateTradePostOptions {
  readonly id: TradePostId;
  readonly authorId: UserId;
  readonly now: ISODateTime;
  readonly memberships: readonly CommunityMembership[];
  /** Trusted server/provider data only; never spread user input into this field. */
  readonly marketReferencesAtCreation?: readonly MarketReferenceInput[];
}

export function createTradePost(value: unknown, options: CreateTradePostOptions): TradePost {
  const draft = parseTradePostDraft(value);
  assertCommunityAccess(options.memberships, options.authorId, draft.communityId);
  if (!Number.isFinite(Date.parse(options.now))) throw new DomainError('INVALID_INPUT', 'now is invalid.');
  const referencedItems = new Set([
    ...draft.offeredItems.map((item) => item.catalogItemId),
    ...draft.wantedItems.map((item) => item.catalogItemId),
  ]);
  const references = (options.marketReferencesAtCreation ?? [])
    .filter((reference) => referencedItems.has(reference.catalogItemId))
    .map(makeReadOnlyMarketReference);
  return Object.freeze({
    id: options.id,
    communityId: draft.communityId,
    authorId: options.authorId,
    offeredItems: draft.offeredItems,
    wantedItems: draft.wantedItems,
    notes: draft.notes,
    meetupPreference: draft.meetupPreference,
    status: 'open',
    marketReferencesAtCreation: Object.freeze(references),
    createdAt: options.now,
    updatedAt: options.now,
  });
}

export interface TradePostMarketView {
  readonly post: TradePost;
  readonly referencesAtCreation: readonly MarketReference[];
  readonly currentReferences: readonly MarketReference[];
  readonly fairnessNotice: 'Market references do not guarantee an equal or fair trade.';
}

export function withCurrentMarketReferences(
  post: TradePost,
  trustedCurrentReferences: readonly MarketReferenceInput[],
): TradePostMarketView {
  const referencedItems = new Set([
    ...post.offeredItems.map((item) => item.catalogItemId),
    ...post.wantedItems.map((item) => item.catalogItemId),
  ]);
  const current = trustedCurrentReferences
    .filter((reference) => referencedItems.has(reference.catalogItemId))
    .map(makeReadOnlyMarketReference);
  return Object.freeze({
    post,
    referencesAtCreation: post.marketReferencesAtCreation,
    currentReferences: Object.freeze(current),
    fairnessNotice: 'Market references do not guarantee an equal or fair trade.',
  });
}

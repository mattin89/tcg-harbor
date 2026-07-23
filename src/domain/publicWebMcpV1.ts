import {
  cardMatchesCatalogQueryV5,
  normalizeCatalogQueryV5,
} from './catalogSearchV5';
import type { DemoAsset, Store } from '../data/demo';

interface ModelContextToolV1 {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown): Promise<unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
}

export interface ModelContextV1 {
  registerTool(
    tool: ModelContextToolV1,
    options?: { signal?: AbortSignal },
  ): Promise<unknown> | unknown;
}

interface WebMcpEnvironmentV1 {
  document?: { modelContext?: ModelContextV1 };
  navigator?: { modelContext?: ModelContextV1 };
}

export interface PublicCardSearchInputV1 {
  query?: unknown;
  setCode?: unknown;
  language?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export interface PublicStoreSearchInputV1 {
  query?: unknown;
  limit?: unknown;
  offset?: unknown;
}

const MAX_QUERY_LENGTH_V1 = 120;
const MAX_RESULT_LIMIT_V1 = 20;
const CARD_TOOL_INPUT_KEYS_V1 = new Set(['query', 'setCode', 'language', 'limit', 'offset']);
const STORE_TOOL_INPUT_KEYS_V1 = new Set(['query', 'limit', 'offset']);
const CARD_LANGUAGES_V1 = new Set(['English', 'French', 'Japanese']);

function boundedStringV1(value: unknown, maximumLength = MAX_QUERY_LENGTH_V1): string {
  return typeof value === 'string' ? value.trim().slice(0, maximumLength) : '';
}

function boundedLimitV1(value: unknown, fallback = 10): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_RESULT_LIMIT_V1, Math.max(1, Math.trunc(parsed)));
}

function boundedOffsetV1(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function inputRecordV1(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Tool input must be a JSON object.');
  }
  return input as Record<string, unknown>;
}

function assertOnlyKeysV1(input: Record<string, unknown>, allowed: ReadonlySet<string>) {
  const unexpected = Object.keys(input).find((key) => !allowed.has(key));
  if (unexpected) throw new TypeError(`Unexpected tool input field: ${unexpected}.`);
}

function assertOptionalStringV1(
  input: Record<string, unknown>,
  field: string,
  maximumLength: number,
) {
  const value = input[field];
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new TypeError(`${field} must be a string no longer than ${maximumLength} characters.`);
  }
}

function assertOptionalIntegerV1(
  input: Record<string, unknown>,
  field: string,
  minimum: number,
  maximum?: number,
) {
  const value = input[field];
  if (value === undefined) return;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < minimum
    || (maximum !== undefined && value > maximum)
  ) {
    throw new TypeError(
      `${field} must be an integer from ${minimum}${maximum === undefined ? '' : ` to ${maximum}`}.`,
    );
  }
}

function validatedCardToolInputV1(input: unknown): PublicCardSearchInputV1 {
  const record = inputRecordV1(input);
  assertOnlyKeysV1(record, CARD_TOOL_INPUT_KEYS_V1);
  assertOptionalStringV1(record, 'query', MAX_QUERY_LENGTH_V1);
  if (typeof record.query !== 'string') {
    throw new TypeError('query is required and must be a string.');
  }
  assertOptionalStringV1(record, 'setCode', 24);
  assertOptionalStringV1(record, 'language', 24);
  if (record.language !== undefined && !CARD_LANGUAGES_V1.has(record.language as string)) {
    throw new TypeError('language must be English, French, or Japanese.');
  }
  assertOptionalIntegerV1(record, 'limit', 1, MAX_RESULT_LIMIT_V1);
  assertOptionalIntegerV1(record, 'offset', 0);
  return record;
}

function validatedStoreToolInputV1(input: unknown): PublicStoreSearchInputV1 {
  const record = inputRecordV1(input);
  assertOnlyKeysV1(record, STORE_TOOL_INPUT_KEYS_V1);
  assertOptionalStringV1(record, 'query', MAX_QUERY_LENGTH_V1);
  assertOptionalIntegerV1(record, 'limit', 1, MAX_RESULT_LIMIT_V1);
  assertOptionalIntegerV1(record, 'offset', 0);
  return record;
}

function absolutePublicUrlV1(value: string | undefined, origin: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, origin);
    const isLoopbackHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    return url.protocol === 'https:' || isLoopbackHttp ? url.href : null;
  } catch {
    return null;
  }
}

function cardRelevanceV1(card: DemoAsset, normalizedQuery: string): number {
  if (!normalizedQuery) return 4;
  const name = normalizeCatalogQueryV5(card.name);
  const number = normalizeCatalogQueryV5(card.number ?? '');
  if (number === normalizedQuery) return 0;
  if (name === normalizedQuery) return 1;
  if (name.startsWith(normalizedQuery)) return 2;
  if (name.includes(normalizedQuery)) return 3;
  return 4;
}

export function searchPublicCardsV1(
  assets: readonly DemoAsset[],
  input: PublicCardSearchInputV1,
  origin: string,
) {
  const query = boundedStringV1(input.query);
  const normalizedQuery = normalizeCatalogQueryV5(query);
  const setCode = boundedStringV1(input.setCode, 24).toLocaleUpperCase('en-US');
  const language = boundedStringV1(input.language, 24).toLocaleLowerCase('en-US');
  const limit = boundedLimitV1(input.limit);
  const offset = boundedOffsetV1(input.offset);

  const matches = assets
    .filter((asset) => asset.kind === 'card' && !asset.catalogAliasOf)
    .filter((asset) => !normalizedQuery || cardMatchesCatalogQueryV5(asset, normalizedQuery))
    .filter((asset) => !setCode || asset.setCode.toLocaleUpperCase('en-US') === setCode)
    .filter((asset) => !language || asset.language.toLocaleLowerCase('en-US') === language)
    .sort((left, right) => cardRelevanceV1(left, normalizedQuery) - cardRelevanceV1(right, normalizedQuery)
      || left.setCode.localeCompare(right.setCode)
      || (left.number ?? '').localeCompare(right.number ?? '')
      || left.variant.localeCompare(right.variant));
  const total = matches.length;
  const results = matches
    .slice(offset, offset + limit)
    .map((asset) => ({
      catalogId: asset.id,
      name: asset.name,
      cardNumber: asset.number ?? null,
      setCode: asset.setCode,
      setName: asset.set,
      art: asset.variant,
      language: asset.language,
      prices: {
        cardmarketTrendEur: asset.quote.cardmarket,
        cardmarketLowestOfferEur: asset.pricing?.cardmarket.low ?? null,
        tcgplayerMarketUsd: asset.quote.tcgplayer,
      },
      imageUrl: absolutePublicUrlV1(
        asset.imageState === 'unavailable' ? undefined : asset.imageUrl,
        origin,
      ),
      sourceUpdatedAt: asset.sourceUpdatedAt ?? null,
    }));

  return {
    query,
    filters: {
      setCode: setCode || null,
      language: language || null,
    },
    total,
    offset,
    count: results.length,
    hasMore: offset + results.length < total,
    nextOffset: offset + results.length < total ? offset + results.length : null,
    results,
    notice: 'Prices are sourced market references, not live offers or guarantees of trade value.',
  };
}

export function listApprovedStoresV1(
  stores: readonly Store[],
  input: PublicStoreSearchInputV1,
  origin: string,
) {
  const query = boundedStringV1(input.query);
  const normalizedQuery = query.toLocaleLowerCase('en-US');
  const limit = boundedLimitV1(input.limit);
  const offset = boundedOffsetV1(input.offset);
  const matches = stores
    .filter((store) => store.source === 'registered')
    .filter((store) => !normalizedQuery || [
      store.name,
      store.city,
      store.address,
      store.country,
    ].join(' ').toLocaleLowerCase('en-US').includes(normalizedQuery))
    .sort((left, right) => left.name.localeCompare(right.name));
  const total = matches.length;
  const results = matches
    .slice(offset, offset + limit)
    .map((store) => ({
      storeId: store.id,
      name: store.name,
      city: store.city,
      country: store.country,
      address: store.address,
      hours: store.hours,
      publicProfileUrl: `${origin}/stores/${encodeURIComponent(store.id)}`,
      mapUrl: `https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}#map=17/${store.latitude}/${store.longitude}`,
    }));

  return {
    query,
    total,
    offset,
    count: results.length,
    hasMore: offset + results.length < total,
    nextOffset: offset + results.length < total ? offset + results.length : null,
    results,
    notice: 'Only approved public store records are returned. Community membership and messages remain private.',
  };
}

export function resolveModelContextV1(
  environment: WebMcpEnvironmentV1 = globalThis as unknown as WebMcpEnvironmentV1,
): ModelContextV1 | null {
  return environment.document?.modelContext
    ?? environment.navigator?.modelContext
    ?? null;
}

export async function registerPublicWebMcpV1({
  assets,
  getStores,
  origin,
  signal,
  environment,
}: {
  assets: readonly DemoAsset[];
  getStores(): readonly Store[];
  origin: string;
  signal: AbortSignal;
  environment?: WebMcpEnvironmentV1;
}): Promise<boolean> {
  const modelContext = resolveModelContextV1(environment);
  if (!modelContext || signal.aborted) return false;

  const tools: ModelContextToolV1[] = [
    {
      name: 'search_one_piece_cards',
      title: 'Search One Piece cards',
      description: 'Search TCG Harbor public One Piece Card Game printings and alternative arts by card name, printed number, set code, or art label. Returns public market references and printing-specific images only; it never reads or changes a collection.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            maxLength: MAX_QUERY_LENGTH_V1,
            description: 'Card name, printed number, set code, or art label.',
          },
          setCode: {
            type: 'string',
            maxLength: 24,
            description: 'Optional exact set code such as OP11, EB02, PRB02, or ST30.',
          },
          language: {
            type: 'string',
            enum: ['English', 'French', 'Japanese'],
            description: 'Optional exact printing language.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_RESULT_LIMIT_V1,
            default: 10,
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Zero-based result offset for pagination.',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async (input) => searchPublicCardsV1(
        assets,
        validatedCardToolInputV1(input),
        origin,
      ),
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
    },
    {
      name: 'list_approved_stores',
      title: 'Find approved stores',
      description: 'Search the approved public TCG Harbor physical-store directory by name, city, postcode, or address. Returns public location details only; it never joins a community or reads membership or message data.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            maxLength: MAX_QUERY_LENGTH_V1,
            description: 'Optional store name, city, postcode, or address.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_RESULT_LIMIT_V1,
            default: 10,
          },
          offset: {
            type: 'integer',
            minimum: 0,
            default: 0,
            description: 'Zero-based result offset for pagination.',
          },
        },
        additionalProperties: false,
      },
      execute: async (input) => listApprovedStoresV1(
        getStores(),
        validatedStoreToolInputV1(input),
        origin,
      ),
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
    },
  ];

  const registrations = await Promise.allSettled(
    tools.map(async (tool) => modelContext.registerTool(tool, { signal })),
  );
  return registrations.every((registration) => registration.status === 'fulfilled');
}

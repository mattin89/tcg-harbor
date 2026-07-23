import { describe, expect, it } from 'vitest';
import {
  listApprovedStoresV1,
  registerPublicWebMcpV1,
  resolveModelContextV1,
  searchPublicCardsV1,
  type ModelContextV1,
} from '../domain/publicWebMcpV1';
import {
  catalogAssets,
  stores,
  type Store,
} from '../data/demo';

const origin = 'https://tcg-harbor.onrender.com';

describe('public WebMCP v1', () => {
  it('uses the same catalog matching behavior as the visible card search', () => {
    const response = searchPublicCardsV1(catalogAssets, {
      query: 'P-041',
      limit: 20,
    }, origin);

    expect(response.count).toBeGreaterThan(0);
    expect(response.results.every((card) => [
      card.name,
      card.cardNumber ?? '',
      card.setCode,
      card.art,
    ].join(' ').toLocaleLowerCase('en-US').includes('p-041'))).toBe(true);
    expect(response.results.every((card) => card.imageUrl?.startsWith('https://') ?? true)).toBe(true);
    expect(response.results.every((card) => !('quantity' in card))).toBe(true);
  });

  it('applies exact set and language filters and caps result volume', () => {
    const response = searchPublicCardsV1(catalogAssets, {
      query: 'Luffy',
      setCode: 'OP11',
      language: 'English',
      limit: 500,
    }, origin);

    expect(response.results.length).toBeLessThanOrEqual(20);
    expect(response.results.every((card) => card.setCode === 'OP11')).toBe(true);
    expect(response.results.every((card) => card.language === 'English')).toBe(true);
    expect(response.total).toBeGreaterThanOrEqual(response.count);
    expect(response.hasMore).toBe(response.total > response.count);
    expect(response.nextOffset).toBe(response.hasMore ? response.count : null);
  });

  it('paginates every matching printing without silently reporting a truncated total', () => {
    const first = searchPublicCardsV1(catalogAssets, {
      query: 'Luffy',
      limit: 5,
    }, origin);
    const second = searchPublicCardsV1(catalogAssets, {
      query: 'Luffy',
      limit: 5,
      offset: first.nextOffset,
    }, origin);

    expect(first.total).toBeGreaterThan(first.count);
    expect(first.count).toBe(5);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(5);
    expect(second.offset).toBe(5);
    expect(second.total).toBe(first.total);
    expect(second.results.map((card) => card.catalogId))
      .not.toEqual(first.results.map((card) => card.catalogId));
  });

  it('returns only records explicitly marked as registered public stores', () => {
    const registered: Store = {
      ...stores[0],
      id: 'registered-dresden',
      name: 'Registered Dresden Store',
      source: 'registered',
    };
    const response = listApprovedStoresV1(
      [stores[0], registered],
      { query: 'Dresden', limit: 20 },
      origin,
    );

    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toMatchObject({
      storeId: registered.id,
      name: registered.name,
      publicProfileUrl: `${origin}/stores/${registered.id}`,
    });
    expect(response.results[0]).not.toHaveProperty('members');
    expect(response.results[0]).not.toHaveProperty('trades');
    expect(response).toMatchObject({
      total: 1,
      count: 1,
      hasMore: false,
      nextOffset: null,
    });
  });

  it('rejects non-web image URL schemes from public tool results', () => {
    const [sample] = catalogAssets.filter((asset) => asset.kind === 'card');
    const response = searchPublicCardsV1(
      [{ ...sample, imageUrl: 'javascript:alert(1)' }],
      { query: sample.number },
      origin,
    );

    expect(response.results).toHaveLength(1);
    expect(response.results[0].imageUrl).toBeNull();
  });

  it('registers two read-only tools with current and legacy model-context surfaces', async () => {
    type RegisteredTool = Parameters<ModelContextV1['registerTool']>[0];
    const registered: RegisteredTool[] = [];
    const context: ModelContextV1 = {
      registerTool(tool) {
        registered.push(tool);
      },
    };
    const controller = new AbortController();

    expect(resolveModelContextV1({ document: { modelContext: context } })).toBe(context);
    expect(resolveModelContextV1({ navigator: { modelContext: context } })).toBe(context);
    expect(resolveModelContextV1({})).toBeNull();
    await expect(registerPublicWebMcpV1({
      assets: catalogAssets,
      getStores: () => [{ ...stores[0], source: 'registered' }],
      origin,
      signal: controller.signal,
      environment: { document: { modelContext: context } },
    })).resolves.toBe(true);

    expect(registered.map((tool) => tool.name)).toEqual([
      'search_one_piece_cards',
      'list_approved_stores',
    ]);
    expect(registered.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
    expect(registered.every((tool) => tool.annotations.untrustedContentHint)).toBe(true);
    await expect(registered[1].execute({ query: 'Dresden' })).resolves.toMatchObject({
      count: 1,
    });
    await expect(registered[0].execute({ query: 'Luffy', limit: 500 }))
      .rejects.toThrow(/limit/);
    await expect(registered[0].execute({ limit: 5 }))
      .rejects.toThrow(/query/);
    await expect(registered[1].execute({ query: 'Dresden', privateMembers: true }))
      .rejects.toThrow(/Unexpected/);
  });
});

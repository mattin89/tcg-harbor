import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_GAMES,
  ALL_GAME_SLUGS,
  getGameDefinition,
  getPublicGames,
  getInternalGames,
  isGamePublic,
  type GameSlug,
} from '../domain/games';
import {
  GAME_CATALOG_SUMMARIES,
  loadGameCatalogAssets,
} from '../data/multigameCatalogs';
import { catalogAssets } from '../data/demo';

describe('Multi-TCG Game Registry & Public Isolation', () => {
  it('registers all 8 supported games with consistent metadata', () => {
    expect(ALL_GAME_SLUGS).toHaveLength(8);
    expect(ALL_GAME_SLUGS).toEqual([
      'one-piece',
      'pokemon',
      'magic',
      'yugioh',
      'flesh-and-blood',
      'gundam',
      'cyberpunk',
      'riftbound',
    ]);

    for (const slug of ALL_GAME_SLUGS) {
      const def = SUPPORTED_GAMES[slug];
      expect(def).toBeDefined();
      expect(def.name).toBeTruthy();
      expect(def.publisher).toBeTruthy();
      expect(def.cardmarketGameId).toBeGreaterThan(0);
      expect(def.tcgplayerCategoryId).toBeGreaterThan(0);
      expect(def.languages.length).toBeGreaterThanOrEqual(2);
      expect(def.productTypes.length).toBeGreaterThan(0);
    }
  });

  it('strictly isolates public views to One Piece and keeps other TCGs internal', () => {
    // Only One Piece is online / public
    expect(isGamePublic('one-piece')).toBe(true);
    expect(SUPPORTED_GAMES['one-piece'].status).toBe('online');

    const publicGames = getPublicGames();
    expect(publicGames).toHaveLength(1);
    expect(publicGames[0].slug).toBe('one-piece');

    // All other 7 games must remain internal / private
    const internalSlugs: GameSlug[] = [
      'pokemon',
      'magic',
      'yugioh',
      'flesh-and-blood',
      'gundam',
      'cyberpunk',
      'riftbound',
    ];

    for (const slug of internalSlugs) {
      expect(isGamePublic(slug)).toBe(false);
      expect(SUPPORTED_GAMES[slug].status).toBe('internal');
      expect(SUPPORTED_GAMES[slug].isPublic).toBe(false);
    }

    const internalGames = getInternalGames();
    expect(internalGames).toHaveLength(7);
  });

  it('preserves clean fallback for unknown game slugs', () => {
    // @ts-expect-error Testing invalid slug fallback
    const fallback = getGameDefinition('invalid-game-slug');
    expect(fallback.slug).toBe('one-piece');
    expect(fallback.isPublic).toBe(true);
  });

  it('guarantees that public catalogAssets contains only One Piece cards and products', () => {
    for (const asset of catalogAssets) {
      // Must not belong to any other game
      if (asset.game) {
        expect(asset.game).toBe('one-piece');
      }
      // Set codes or names must not mention other game titles as games
      expect(asset.name).not.toMatch(/^Pokémon\s/i);
      expect(asset.name).not.toMatch(/^Magic:\sThe\sGathering/i);
    }
  });
});

describe('Multi-TCG Catalogs & Staging Inventories', () => {
  it('contains pre-computed summaries for all 8 games', () => {
    for (const slug of ALL_GAME_SLUGS) {
      const summary = GAME_CATALOG_SUMMARIES[slug];
      expect(summary).toBeDefined();
      expect(summary.totalAssets).toBeGreaterThan(0);
      expect(summary.sealedCount).toBeGreaterThan(0);
      expect(summary.languages.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('loads valid DemoAsset inventories for all internal games', async () => {
    const internalSlugs: GameSlug[] = [
      'pokemon',
      'magic',
      'yugioh',
      'flesh-and-blood',
      'gundam',
      'cyberpunk',
      'riftbound',
    ];

    for (const slug of internalSlugs) {
      const assets = await loadGameCatalogAssets(slug);
      expect(assets.length).toBeGreaterThan(0);

      // Verify that assets adhere to DemoAsset contract
      const sample = assets[0];
      expect(sample.id).toBeTruthy();
      expect(['card', 'sealed']).toContain(sample.kind);
      expect(sample.name).toBeTruthy();
      expect(sample.set).toBeTruthy();
      expect(sample.quantity).toBe(1);
      expect(sample.quote).toBeDefined();
      expect(sample.change).toBeDefined();
      expect(sample.color).toBeTruthy();

      // Check sealed products exist in the catalog
      const sealedItems = assets.filter((a) => a.kind === 'sealed');
      expect(sealedItems.length).toBeGreaterThan(0);
      for (const sealed of sealedItems.slice(0, 10)) {
        expect(sealed.productType).toBeTruthy();
      }

      // Check cards exist in the catalog
      const cardItems = assets.filter((a) => a.kind === 'card');
      expect(cardItems.length).toBeGreaterThan(0);

      // Verify languages present in catalog
      const languages = new Set(assets.map((a) => a.language));
      expect(languages.size).toBeGreaterThanOrEqual(1);
      expect(languages.has('English')).toBe(true);
    }
  });

  it('loads Pokémon inventory with both Cardmarket EUR and TCGPlayer USD quotes', async () => {
    const assets = await loadGameCatalogAssets('pokemon');
    expect(assets.length).toBeGreaterThanOrEqual(5000);

    const pricedCardmarket = assets.filter((a) => a.quote.cardmarket !== null && a.quote.cardmarket > 0);
    const pricedTcgplayer = assets.filter((a) => a.quote.tcgplayer !== null && a.quote.tcgplayer > 0);

    expect(pricedCardmarket.length).toBeGreaterThan(100);
    expect(pricedTcgplayer.length).toBeGreaterThan(100);
  });

  it('loads Magic inventory with diverse sealed product types and languages', async () => {
    const assets = await loadGameCatalogAssets('magic');
    expect(assets.length).toBeGreaterThanOrEqual(5000);

    const productTypes = new Set(assets.filter((a) => a.kind === 'sealed').map((a) => a.productType));
    expect(productTypes.has('Booster Box')).toBe(true);
    expect(productTypes.has('Booster Pack')).toBe(true);

    const languages = new Set(assets.map((a) => a.language));
    expect(languages.size).toBeGreaterThanOrEqual(3);
  });

  it('loads Gundam Card Game inventory with complete Bandai starter decks and booster sets', async () => {
    const assets = await loadGameCatalogAssets('gundam');
    expect(assets.length).toBeGreaterThanOrEqual(2000);

    const starterDecks = assets.filter((a) => a.name.toLowerCase().includes('starter deck'));
    expect(starterDecks.length).toBeGreaterThan(0);
  });
});

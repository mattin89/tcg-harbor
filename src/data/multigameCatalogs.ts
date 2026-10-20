import { catalogAssets, type DemoAsset } from './demo';
import { SUPPORTED_GAMES, type GameSlug } from '../domain/games';

export interface GameCatalogSummary {
  gameSlug: GameSlug;
  name: string;
  publisher: string;
  isPublic: boolean;
  status: 'online' | 'internal' | 'preview';
  cardCount: number;
  sealedCount: number;
  totalAssets: number;
  languages: string[];
}

/**
 * Pre-computed catalog summaries for fast navigation and UI status display
 * without needing to parse multi-megabyte JSON payloads on initial render.
 */
export const GAME_CATALOG_SUMMARIES: Record<GameSlug, GameCatalogSummary> = {
  'one-piece': {
    gameSlug: 'one-piece',
    name: 'One Piece Card Game',
    publisher: 'Bandai',
    isPublic: true,
    status: 'online',
    cardCount: catalogAssets.filter((a) => a.kind === 'card').length,
    sealedCount: catalogAssets.filter((a) => a.kind === 'sealed').length,
    totalAssets: catalogAssets.length,
    languages: ['English', 'Japanese', 'Chinese', 'Korean', 'French'],
  },
  pokemon: {
    gameSlug: 'pokemon',
    name: 'Pokémon TCG',
    publisher: 'The Pokémon Company',
    isPublic: false,
    status: 'internal',
    cardCount: 1190,
    sealedCount: 5245,
    totalAssets: 6435,
    languages: ['English', 'Chinese', 'Korean', 'Japanese', 'German', 'French'],
  },
  magic: {
    gameSlug: 'magic',
    name: 'Magic: The Gathering',
    publisher: 'Wizards of the Coast',
    isPublic: false,
    status: 'internal',
    cardCount: 389,
    sealedCount: 5222,
    totalAssets: 5611,
    languages: ['English', 'German', 'Japanese', 'Italian', 'Chinese', 'French', 'Spanish'],
  },
  yugioh: {
    gameSlug: 'yugioh',
    name: 'Yu-Gi-Oh! TCG',
    publisher: 'Konami',
    isPublic: false,
    status: 'internal',
    cardCount: 659,
    sealedCount: 2430,
    totalAssets: 3089,
    languages: ['English', 'Japanese', 'Korean', 'German', 'French'],
  },
  'flesh-and-blood': {
    gameSlug: 'flesh-and-blood',
    name: 'Flesh and Blood',
    publisher: 'Legend Story Studios',
    isPublic: false,
    status: 'internal',
    cardCount: 5360,
    sealedCount: 243,
    totalAssets: 5603,
    languages: ['English', 'German', 'French', 'Spanish', 'Italian'],
  },
  gundam: {
    gameSlug: 'gundam',
    name: 'Gundam Card Game',
    publisher: 'Bandai',
    isPublic: false,
    status: 'internal',
    cardCount: 2144,
    sealedCount: 216,
    totalAssets: 2360,
    languages: ['English', 'Japanese'],
  },
  cyberpunk: {
    gameSlug: 'cyberpunk',
    name: 'Cyberpunk TCG',
    publisher: 'CD PROJEKT RED / TCG Publisher',
    isPublic: false,
    status: 'internal',
    cardCount: 448,
    sealedCount: 50,
    totalAssets: 498,
    languages: ['English', 'German'],
  },
  riftbound: {
    gameSlug: 'riftbound',
    name: 'Riftbound: League of Legends TCG',
    publisher: 'Riot Games',
    isPublic: false,
    status: 'internal',
    cardCount: 1743,
    sealedCount: 212,
    totalAssets: 1955,
    languages: ['English', 'Chinese', 'French', 'German'],
  },
};

// In-memory cache for dynamically loaded catalogs to avoid re-parsing
const catalogCache = new Map<GameSlug, DemoAsset[]>();
catalogCache.set('one-piece', catalogAssets);

/**
 * Loads the catalog assets for a given game.
 * Uses dynamic import chunks to keep initial bundle weight optimal.
 */
export async function loadGameCatalogAssets(gameSlug: GameSlug): Promise<DemoAsset[]> {
  if (catalogCache.has(gameSlug)) {
    return catalogCache.get(gameSlug)!;
  }

  let assets: DemoAsset[];
  switch (gameSlug) {
    case 'pokemon':
      assets = (await import('./generated/catalogs/pokemon.json')).default as unknown as DemoAsset[];
      break;
    case 'magic':
      assets = (await import('./generated/catalogs/magic.json')).default as unknown as DemoAsset[];
      break;
    case 'yugioh':
      assets = (await import('./generated/catalogs/yugioh.json')).default as unknown as DemoAsset[];
      break;
    case 'flesh-and-blood':
      assets = (await import('./generated/catalogs/flesh-and-blood.json')).default as unknown as DemoAsset[];
      break;
    case 'gundam':
      assets = (await import('./generated/catalogs/gundam.json')).default as unknown as DemoAsset[];
      break;
    case 'cyberpunk':
      assets = (await import('./generated/catalogs/cyberpunk.json')).default as unknown as DemoAsset[];
      break;
    case 'riftbound':
      assets = (await import('./generated/catalogs/riftbound.json')).default as unknown as DemoAsset[];
      break;
    case 'one-piece':
    default:
      assets = catalogAssets;
      break;
  }

  catalogCache.set(gameSlug, assets);
  return assets;
}

/**
 * Synchronous accessor for already loaded or live catalogs.
 * Defaults safely to One Piece if not yet loaded into memory.
 */
export function getLoadedGameCatalogAssets(gameSlug: GameSlug): DemoAsset[] {
  return catalogCache.get(gameSlug) ?? catalogAssets;
}

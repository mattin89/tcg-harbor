/**
 * Multi-TCG Domain Registry and Game Metadata
 *
 * Defines all supported trading card games, provider category IDs,
 * public/internal visibility states, and multi-language capabilities.
 *
 * Visibility Policy:
 * - Only games with `isPublic: true` and `status: 'online'` are exposed to end users,
 *   public card search, and live user collections.
 * - Internal games (`status: 'internal'`, `isPublic: false`) are accessible only
 *   within administrative catalog diagnostics and staging inventory tools.
 */

export type GameSlug =
  | 'one-piece'
  | 'pokemon'
  | 'magic'
  | 'yugioh'
  | 'flesh-and-blood'
  | 'gundam'
  | 'cyberpunk'
  | 'riftbound';

export type GameStatus = 'online' | 'internal' | 'preview';

export interface GameDefinition {
  slug: GameSlug;
  name: string;
  publisher: string;
  cardmarketGameId: number;
  cardmarketSlug: string;
  tcgplayerCategoryId: number;
  status: GameStatus;
  isPublic: boolean;
  releaseYear: number;
  description: string;
  languages: string[];
  productTypes: string[];
  color: string;
  badge: string;
}

export const SUPPORTED_GAMES: Record<GameSlug, GameDefinition> = {
  'one-piece': {
    slug: 'one-piece',
    name: 'One Piece Card Game',
    publisher: 'Bandai',
    cardmarketGameId: 18,
    cardmarketSlug: 'OnePiece',
    tcgplayerCategoryId: 68,
    status: 'online',
    isPublic: true,
    releaseYear: 2022,
    description: 'Bandai nautical battle card game based on Eiichiro Oda\'s manga.',
    languages: ['English', 'Japanese', 'Chinese', 'Korean', 'French'],
    productTypes: ['Booster Box', 'Booster Pack', 'Case', 'Starter Deck', 'Promo Product', 'Double Pack', 'Gift Box'],
    color: 'rose',
    badge: 'Live',
  },
  pokemon: {
    slug: 'pokemon',
    name: 'Pokémon TCG',
    publisher: 'The Pokémon Company',
    cardmarketGameId: 6,
    cardmarketSlug: 'Pokemon',
    tcgplayerCategoryId: 3,
    status: 'internal',
    isPublic: false,
    releaseYear: 1996,
    description: 'Monster collecting and battle card game by Nintendo, Creatures, and Game Freak.',
    languages: ['English', 'Japanese', 'German', 'French', 'Spanish', 'Italian', 'Chinese', 'Korean'],
    productTypes: ['Booster Box', 'Booster Pack', 'Elite Trainer Box', 'Case', 'Theme Deck', 'Blister Pack', 'Promo Product', 'Tin'],
    color: 'amber',
    badge: 'Internal · Not Public',
  },
  magic: {
    slug: 'magic',
    name: 'Magic: The Gathering',
    publisher: 'Wizards of the Coast',
    cardmarketGameId: 1,
    cardmarketSlug: 'Magic',
    tcgplayerCategoryId: 1,
    status: 'internal',
    isPublic: false,
    releaseYear: 1993,
    description: 'The original tactical trading card game designed by Richard Garfield.',
    languages: ['English', 'Japanese', 'German', 'French', 'Spanish', 'Italian', 'Chinese', 'Portuguese'],
    productTypes: ['Booster Box', 'Collector Booster Box', 'Play Booster Box', 'Bundle', 'Commander Deck', 'Pre-Release Kit', 'Case'],
    color: 'violet',
    badge: 'Internal · Not Public',
  },
  yugioh: {
    slug: 'yugioh',
    name: 'Yu-Gi-Oh! TCG',
    publisher: 'Konami',
    cardmarketGameId: 3,
    cardmarketSlug: 'YuGiOh',
    tcgplayerCategoryId: 2,
    status: 'internal',
    isPublic: false,
    releaseYear: 1999,
    description: 'Dueling monsters, spells, and traps created by Kazuki Takahashi.',
    languages: ['English', 'Japanese', 'German', 'French', 'Spanish', 'Italian', 'Korean', 'Chinese'],
    productTypes: ['Booster Box', 'Booster Pack', 'Structure Deck', 'Starter Deck', 'Tin', 'Case', 'Special Edition'],
    color: 'gold',
    badge: 'Internal · Not Public',
  },
  'flesh-and-blood': {
    slug: 'flesh-and-blood',
    name: 'Flesh and Blood',
    publisher: 'Legend Story Studios',
    cardmarketGameId: 16,
    cardmarketSlug: 'FleshAndBlood',
    tcgplayerCategoryId: 62,
    status: 'internal',
    isPublic: false,
    releaseYear: 2019,
    description: 'Hero-centric physical card game crafted in Auckland, New Zealand.',
    languages: ['English', 'German', 'French', 'Spanish', 'Italian', 'Japanese'],
    productTypes: ['Booster Box', 'Booster Pack', 'Blitz Deck', 'Armory Deck', 'Case', 'Pre-Release Kit'],
    color: 'coral',
    badge: 'Internal · Not Public',
  },
  gundam: {
    slug: 'gundam',
    name: 'Gundam Card Game',
    publisher: 'Bandai',
    cardmarketGameId: 24,
    cardmarketSlug: 'Gundam',
    tcgplayerCategoryId: 86,
    status: 'internal',
    isPublic: false,
    releaseYear: 2025,
    description: 'Bandai competitive mobile suit tactical card game.',
    languages: ['English', 'Japanese', 'Chinese'],
    productTypes: ['Booster Box', 'Booster Pack', 'Starter Deck', 'Deck Build Box', 'Case'],
    color: 'azure',
    badge: 'Internal · Not Public',
  },
  cyberpunk: {
    slug: 'cyberpunk',
    name: 'Cyberpunk TCG',
    publisher: 'CD PROJEKT RED / TCG Publisher',
    cardmarketGameId: 23,
    cardmarketSlug: 'Cyberpunk',
    tcgplayerCategoryId: 92,
    status: 'internal',
    isPublic: false,
    releaseYear: 2025,
    description: 'High-tech dystopian street battles set in Night City.',
    languages: ['English', 'German', 'French', 'Japanese'],
    productTypes: ['Booster Box', 'Booster Pack', 'Starter Deck', 'Box Topper', 'Case'],
    color: 'emerald',
    badge: 'Internal · Not Public',
  },
  riftbound: {
    slug: 'riftbound',
    name: 'Riftbound: League of Legends TCG',
    publisher: 'Riot Games',
    cardmarketGameId: 22,
    cardmarketSlug: 'Riftbound',
    tcgplayerCategoryId: 89,
    status: 'internal',
    isPublic: false,
    releaseYear: 2025,
    description: 'Runeterra champion deckbuilding card game by Riot Games.',
    languages: ['English', 'German', 'French', 'Spanish', 'Japanese', 'Korean'],
    productTypes: ['Booster Display', 'Booster Pack', 'Bundle', 'Starter Deck', 'Case'],
    color: 'cyan',
    badge: 'Internal · Not Public',
  },
};

export const ALL_GAME_SLUGS: GameSlug[] = [
  'one-piece',
  'pokemon',
  'magic',
  'yugioh',
  'flesh-and-blood',
  'gundam',
  'cyberpunk',
  'riftbound',
];

export function getGameDefinition(slug: GameSlug): GameDefinition {
  return SUPPORTED_GAMES[slug] ?? SUPPORTED_GAMES['one-piece'];
}

export function getPublicGames(): GameDefinition[] {
  return Object.values(SUPPORTED_GAMES).filter((game) => game.isPublic);
}

export function getInternalGames(): GameDefinition[] {
  return Object.values(SUPPORTED_GAMES).filter((game) => !game.isPublic);
}

export function isGamePublic(slug: GameSlug): boolean {
  return SUPPORTED_GAMES[slug]?.isPublic ?? false;
}

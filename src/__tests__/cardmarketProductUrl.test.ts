import { describe, it, expect } from 'vitest';
import { cardmarketProductUrl } from '../App';
import type { DemoAsset } from '../data/demo';

function createMockAsset(overrides: Partial<DemoAsset> = {}): DemoAsset {
  return {
    id: 'test-asset-1',
    kind: 'card',
    name: 'Monkey.D.Luffy (022)',
    set: 'The Time of Battle',
    setCode: 'OP16',
    number: 'OP16-022',
    rarity: 'Leader',
    variant: 'Alternate art · P1',
    language: 'English',
    condition: 'Near Mint',
    color: 'red',
    quantity: 1,
    addedAt: '2026-07-30T00:00:00Z',
    imageUrl: 'https://example.com/art.jpg',
    quote: { cardmarket: 40.97, tcgplayer: 73.48 },
    change: {
      cardmarket: { '1D': null, '1W': null, '1M': null },
      tcgplayer: { '1D': null, '1W': null, '1M': null },
    },
    ...overrides,
  };
}

describe('cardmarketProductUrl generalized logic', () => {
  it('generates the exact slug URL for OP16-022 Alternate Art P1', () => {
    const asset = createMockAsset({
      name: 'Monkey.D.Luffy (022)',
      setCode: 'OP16',
      number: 'OP16-022',
      variant: 'Alternate art · P1',
      cardmarketArtworkReference: {
        productId: 890624,
        expansionId: 6457,
        trend: 40.97,
        matchPolicy: 'cardmarket-image-correlation-v2-complete-candidates',
        productImageUrl: 'https://product-images.s3.cardmarket.com/1621/OP16/890624/890624.jpg',
        evidence: 'Verified',
      } as any,
    });

    const url = cardmarketProductUrl(asset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/The-Time-of-Battle\/Monkey-D-Luffy-OP16-022-V2$/);
  });

  it('generates the exact slug URL for OP16-022 Standard (without -V1)', () => {
    const asset = createMockAsset({
      name: 'Monkey.D.Luffy (022)',
      setCode: 'OP16',
      number: 'OP16-022',
      variant: 'Standard',
    });

    const url = cardmarketProductUrl(asset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/The-Time-of-Battle\/Monkey-D-Luffy-OP16-022$/);
  });

  it('generates slug URL for OP01-001 Alternate Art P1', () => {
    const asset = createMockAsset({
      name: 'Roronoa Zoro (001)',
      setCode: 'OP01',
      number: 'OP01-001',
      variant: 'Alternate art · P1',
    });

    const url = cardmarketProductUrl(asset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/Romance-Dawn\/Roronoa-Zoro-OP01-001-V2$/);
  });

  it('generates slug URL for P2 Manga rare (V3)', () => {
    const asset = createMockAsset({
      name: 'Portgas.D.Ace (013)',
      setCode: 'OP02',
      number: 'OP02-013',
      variant: 'Manga rare · P2',
    });

    const url = cardmarketProductUrl(asset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/Paramount-War\/Portgas-D-Ace-OP02-013-V3$/);
  });

  it('resolves canonical Cardmarket URL for inventory cards mapped in canonical dictionary', () => {
    const izoAsset = createMockAsset({
      name: 'Izo',
      setCode: 'EB01',
      number: 'EB01-002',
      cardmarketProductId: 767955,
    });
    const url = cardmarketProductUrl(izoAsset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/Memorial-Collection\/Izo-EB01-002$/);

    const luffyAsset = createMockAsset({
      name: 'Monkey.D.Luffy',
      setCode: 'STP',
      number: 'P-041',
      cardmarketProductId: 748120,
    });
    const luffyUrl = cardmarketProductUrl(luffyAsset);
    expect(luffyUrl).toMatch(/\/OnePiece\/Products\/Singles\/Special-Tournaments-Promos\/MonkeyDLuffy-P-041-V4$/);
  });

  it('falls back to search for unmapped cardmarketProductId on unnumbered products', () => {
    const unmappedAsset = createMockAsset({
      kind: 'sealed',
      name: 'Special Tournament Prize Pack',
      cardmarketProductId: 999999999,
      number: undefined,
    });
    const url = cardmarketProductUrl(unmappedAsset);
    expect(url).toContain('/OnePiece/Products/Search?idProduct=999999999');
  });

  it('resolves product 732763 (Boa Hancock OP01-078) to Kingdoms of Intrigue', () => {
    const boaAsset = createMockAsset({
      name: 'Boa Hancock',
      setCode: 'OP04',
      number: 'OP01-078',
      variant: 'Special art · P2',
      cardmarketProductId: 732763,
    });
    const url = cardmarketProductUrl(boaAsset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/Kingdoms-of-Intrigue\/Boa-Hancock-OP01-078$/);
  });

  it('resolves product 890624 (Monkey D Luffy OP16-022) to OP16 V2', () => {
    const luffyAsset = createMockAsset({
      name: 'Monkey.D.Luffy (022)',
      setCode: 'OP16',
      number: 'OP16-022',
      variant: 'Alternate art · P1',
      cardmarketProductId: 890624,
    });
    const url = cardmarketProductUrl(luffyAsset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/OP16\/MonkeyDLuffy-OP16-022-V2$/);
  });

  it('resolves product 890623 (Monkey D Luffy OP16-022 Standard) to OP16 V1', () => {
    const luffyAsset = createMockAsset({
      name: 'Monkey.D.Luffy (022)',
      setCode: 'OP16',
      number: 'OP16-022',
      variant: 'Standard',
      cardmarketProductId: 890623,
    });
    const url = cardmarketProductUrl(luffyAsset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/OP16\/MonkeyDLuffy-OP16-022-V1$/);
  });

  it('falls back to search for sealed booster boxes', () => {
    const sealedAsset = createMockAsset({
      kind: 'sealed',
      name: 'The Time of Battle Booster Box',
      productType: 'Booster Box',
      setCode: 'OP16',
      number: undefined,
    });

    const url = cardmarketProductUrl(sealedAsset);
    expect(url).toContain('/OnePiece/Products/Search?searchString=The%20Time%20of%20Battle%20Booster%20Box');
  });

  it('resolves verified canonical URL for EB01-050 (...I Want to Live!!)', () => {
    const asset = createMockAsset({
      name: '...I Want to Live!!',
      setCode: 'EB01',
      number: 'EB01-050',
      cardmarketProductId: 768017,
      variant: 'Standard',
    });
    const url = cardmarketProductUrl(asset);
    expect(url).toBe('https://www.cardmarket.com/en/OnePiece/Products/Singles/Memorial-Collection/I-Want-to-Live-EB01-050');
  });

  it('resolves verified canonical URL for OP06-096 (...Nothing...at All!!!)', () => {
    const asset = createMockAsset({
      name: '...Nothing...at All!!!',
      setCode: 'OP06',
      number: 'OP06-096',
      cardmarketProductId: 760599,
      variant: 'Standard',
    });
    const url = cardmarketProductUrl(asset);
    expect(url).toBe('https://www.cardmarket.com/en/OnePiece/Products/Singles/Wings-of-the-Captain/Nothingat-All-OP06-096');
  });

  it('resolves verified canonical URL for OP16-077 ("Buddha" Sengoku)', () => {
    const asset = createMockAsset({
      name: '"Buddha" Sengoku',
      setCode: 'OP16',
      number: 'OP16-077',
      cardmarketProductId: 890771,
      variant: 'Standard',
    });
    const url = cardmarketProductUrl(asset);
    expect(url).toBe('https://www.cardmarket.com/en/OnePiece/Products/Singles/OP16/Buddha-Sengoku-OP16-077');
  });

  it('correctly constructs URLs across card types without canonical override', () => {
    // Leader (ST01)
    const leader = createMockAsset({
      name: 'Monkey.D.Luffy',
      setCode: 'ST01',
      number: 'ST01-001',
      variant: 'Standard',
      cardmarketProductId: undefined,
    });
    expect(cardmarketProductUrl(leader)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Starter-Deck-Straw-Hat-Crew/Monkey-D-Luffy-ST01-001'
    );

    // Event (OP01)
    const event = createMockAsset({
      name: 'Gum-Gum Fire-Fist Pistol Red Hawk',
      setCode: 'OP01',
      number: 'OP01-026',
      variant: 'Standard',
      cardmarketProductId: undefined,
    });
    expect(cardmarketProductUrl(event)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Romance-Dawn/Gum-Gum-Fire-Fist-Pistol-Red-Hawk-OP01-026'
    );

    // Stage (EB01)
    const stage = createMockAsset({
      name: 'Mini Merry',
      setCode: 'EB01',
      number: 'EB01-011',
      variant: 'Standard',
      cardmarketProductId: undefined,
    });
    expect(cardmarketProductUrl(stage)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Memorial-Collection/Mini-Merry-EB01-011'
    );
  });

  it('resolves verified canonical URLs for sealed products across all categories', () => {
    // 1. Boosters
    const booster = createMockAsset({
      kind: 'sealed',
      name: '- ST15-ST20 Release Event Pack -',
      productType: 'Booster',
      cardmarketProductId: 794695,
    });
    expect(cardmarketProductUrl(booster)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Boosters/ST15-ST20-Release-Event-Pack'
    );

    // 2. Booster Boxes
    const box = createMockAsset({
      kind: 'sealed',
      name: '500 Years into the Future Booster Box',
      productType: 'Booster box',
      cardmarketProductId: 750069,
    });
    expect(cardmarketProductUrl(box)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Booster-Boxes/500-Years-into-the-Future-Booster-Box'
    );

    // 3. Preconstructed Decks
    const deck = createMockAsset({
      kind: 'sealed',
      name: 'Starter Deck: Edward.Newgate',
      productType: 'Preconstructed deck',
      cardmarketProductId: 767014,
    });
    expect(cardmarketProductUrl(deck)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Preconstructed-Decks/Starter-Deck-EdwardNewgate'
    );

    // 4. Promo Products
    const promo = createMockAsset({
      kind: 'sealed',
      name: '1st Anniversary Set (English Version)',
      productType: 'Promo Product',
      cardmarketProductId: 753286,
    });
    expect(cardmarketProductUrl(promo)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/1st-Anniversary-Set-English-Version'
    );
  });

  it('correctly routes multilingual cards to their language-specific expansions and filter parameters', () => {
    // 1. Chinese Adio (OP03-002) routes to Pillars-of-Strength-Japanese with ?language=6
    const chineseAdio = createMockAsset({
      name: 'Adio',
      setCode: 'OP03-CN',
      number: 'OP03-002',
      variant: 'Standard',
      language: 'Chinese',
    });
    expect(cardmarketProductUrl(chineseAdio)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Pillars-of-Strength-Japanese/Adio-OP03-002?language=6'
    );

    // 2. Japanese Adio (OP03-002) routes to Pillars-of-Strength-Japanese with ?language=7
    const japaneseAdio = createMockAsset({
      name: 'Adio',
      setCode: 'OP03-JP',
      number: 'OP03-002',
      variant: 'Standard',
      language: 'Japanese',
    });
    expect(cardmarketProductUrl(japaneseAdio)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Pillars-of-Strength-Japanese/Adio-OP03-002?language=7'
    );

    // 3. Korean Adio (OP03-002) routes to Pillars-of-Strength-Japanese with ?language=10
    const koreanAdio = createMockAsset({
      name: 'Adio',
      setCode: 'OP03-KR',
      number: 'OP03-002',
      variant: 'Standard',
      language: 'Korean',
    });
    expect(cardmarketProductUrl(koreanAdio)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Pillars-of-Strength-Japanese/Adio-OP03-002?language=10'
    );

    // 4. English Adio (OP03-002) routes to English Pillars-of-Strength without language query
    const englishAdio = createMockAsset({
      name: 'Adio',
      setCode: 'OP03',
      number: 'OP03-002',
      variant: 'Standard',
      language: 'English',
    });
    expect(cardmarketProductUrl(englishAdio)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Pillars-of-Strength/Adio-OP03-002'
    );

    // 5. French Uta (OP06-001) routes to European Wings-of-the-Captain with ?language=2
    const frenchUta = createMockAsset({
      name: 'Uta',
      setCode: 'OP06-FR',
      number: 'OP06-001',
      variant: 'Standard',
      language: 'French',
    });
    expect(cardmarketProductUrl(frenchUta)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Wings-of-the-Captain/Uta-OP06-001?language=2'
    );
  });
});



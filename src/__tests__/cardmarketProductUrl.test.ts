import { describe, it, expect } from 'vitest';
import { cardmarketProductUrl, cleanCardmarketSealedSlug } from '../App';
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
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/OP16\/MonkeyDLuffy-OP16-022-V2$/);
  });

  it('generates the exact slug URL for OP16-022 Standard (without -V1)', () => {
    const asset = createMockAsset({
      name: 'Monkey.D.Luffy (022)',
      setCode: 'OP16',
      number: 'OP16-022',
      variant: 'Standard',
    });

    const url = cardmarketProductUrl(asset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/OP16\/MonkeyDLuffy-OP16-022$/);
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
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/Paramount-War\/PortgasDAce-OP02-013-V3$/);
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

  it('resolves verified canonical URL for Japanese EB01-050 (...I Want to Live!!)', () => {
    const asset = createMockAsset({
      name: '...I Want to Live!!',
      setCode: 'EB01-JP',
      number: 'EB01-050',
      language: 'Japanese',
      cardmarketProductId: 754216,
      variant: 'Standard',
    });
    const url = cardmarketProductUrl(asset);
    expect(url).toBe('https://www.cardmarket.com/en/OnePiece/Products/Singles/Memorial-Collection-Japanese/I-Want-to-Live-EB01-050?language=7');
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
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Starter-Deck-Straw-Hat-Crew/MonkeyDLuffy-ST01-001'
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

  it('correctly resolves Chinese sealed products to verified canonical URLs without language parameters', () => {
    // Chinese New Year Red Envelope - Boa Hancock
    const boaEnvelope = createMockAsset({
      kind: 'sealed',
      name: 'Chinese New Year Red Envelope - Boa Hancock',
      productType: 'Promo Product',
      language: 'Chinese',
      cardmarketProductId: 808783,
    });
    expect(cardmarketProductUrl(boaEnvelope)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Chinese-New-Year-Red-Envelope-Boa-Hancock'
    );

    // Chinese New Year Red Envelope - Monkey.D.Luffy (verifies hyphenated Monkey-D-Luffy, NOT MonkeyDLuffy)
    const luffyEnvelope = createMockAsset({
      kind: 'sealed',
      name: 'Chinese New Year Red Envelope - Monkey.D.Luffy',
      productType: 'Promo Product',
      language: 'Chinese',
      cardmarketProductId: 808782,
    });
    expect(cardmarketProductUrl(luffyEnvelope)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Chinese-New-Year-Red-Envelope-Monkey-D-Luffy'
    );
    expect(cardmarketProductUrl(luffyEnvelope)).not.toContain('MonkeyDLuffy');

    // Chinese New Year Red Envelope - Sanji
    const sanjiEnvelope = createMockAsset({
      kind: 'sealed',
      name: 'Chinese New Year Red Envelope - Sanji',
      productType: 'Promo Product',
      language: 'Chinese',
      cardmarketProductId: 871507,
    });
    expect(cardmarketProductUrl(sanjiEnvelope)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Chinese-New-Year-Red-Envelope-Sanji'
    );

    // Chinese New Year Red Envelope - Roronoa Zoro
    const zoroEnvelope = createMockAsset({
      kind: 'sealed',
      name: 'Chinese New Year Red Envelope - Roronoa Zoro',
      productType: 'Promo Product',
      language: 'Chinese',
      cardmarketProductId: 765985,
    });
    expect(cardmarketProductUrl(zoroEnvelope)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Chinese-New-Year-Red-Envelope-Roronoa-Zoro'
    );

    // Chinese Anniversary Nami Gift Box
    const namiBox = createMockAsset({
      kind: 'sealed',
      name: 'Chinese Anniversary Nami Gift Box',
      productType: 'Promo Product',
      language: 'Chinese',
      cardmarketProductId: 773682,
    });
    expect(cardmarketProductUrl(namiBox)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Chinese-Anniversary-Nami-Gift-Box'
    );

    // Romance Dawn Booster box (Chinese)
    const romanceBox = createMockAsset({
      kind: 'sealed',
      name: 'Romance Dawn Booster box (Chinese)',
      productType: 'Booster box',
      language: 'Chinese',
      cardmarketProductId: 693905,
    });
    expect(cardmarketProductUrl(romanceBox)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Booster-Boxes/Romance-Dawn-Booster-Box-Non-English'
    );

    // Unmapped sealed product should fallback to search without language parameter
    const unmappedSealed = createMockAsset({
      kind: 'sealed',
      name: 'Sample Promo Pack',
      productType: 'Promo product',
      language: 'Chinese',
      number: undefined,
    });
    expect(cardmarketProductUrl(unmappedSealed)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Search?searchString=Sample%20Promo%20Pack'
    );
  });

  it('correctly handles Monkey.D.Luffy in cleanCardmarketSealedSlug for promo products vs starter decks', () => {
    // Promo product keeps hyphens for character names on Cardmarket
    expect(cleanCardmarketSealedSlug('Chinese New Year Red Envelope - Monkey.D.Luffy')).toBe(
      'Chinese-New-Year-Red-Envelope-Monkey-D-Luffy'
    );
    expect(cleanCardmarketSealedSlug('Tin Pack Set Vol.1 (Monkey D. Luffy)')).toBe(
      'Tin-Pack-Set-Vol-1-Monkey-D-Luffy'
    );

    // Starter Decks collapse character names without hyphens per Cardmarket convention
    expect(cleanCardmarketSealedSlug('Starter Deck: Monkey.D.Luffy')).toBe(
      'Starter-Deck-MonkeyDLuffy'
    );
    expect(cleanCardmarketSealedSlug('Starter Deck: Edward.Newgate')).toBe(
      'Starter-Deck-EdwardNewgate'
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

    // 6. Chinese Robson (OP08-013) routes to Two-Legends-Non-English with ?language=6
    const chineseRobson = createMockAsset({
      name: 'Robson',
      setCode: 'OP08-CN',
      number: 'OP08-013',
      variant: 'Standard',
      language: 'Chinese',
    });
    expect(cardmarketProductUrl(chineseRobson)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Two-Legends-Non-English/Robson-OP08-013?language=6'
    );

    // 7. Starter Deck Edward.Newgate (ST15-001) in English and Japanese
    const englishNewgate = createMockAsset({
      name: 'Edward.Newgate',
      setCode: 'ST15',
      number: 'ST15-001',
      variant: 'Standard',
      language: 'English',
    });
    expect(cardmarketProductUrl(englishNewgate)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Starter-Deck-EdwardNewgate/EdwardNewgate-ST15-001'
    );

    const japaneseNewgate = createMockAsset({
      name: 'Edward.Newgate',
      setCode: 'ST15-JP',
      number: 'ST15-001',
      variant: 'Standard',
      language: 'Japanese',
    });
    expect(cardmarketProductUrl(japaneseNewgate)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Starter-Deck-EdwardNewgate-Non-English/EdwardNewgate-ST15-001?language=7'
    );

    // 8. Unmapped expansion falls back cleanly to universal Cards endpoint
    const unmappedExpansion = createMockAsset({
      name: 'Custom Pirate',
      setCode: 'UNKNOWN99',
      number: 'UNK-001',
      variant: 'Standard',
      language: 'English',
    });
    expect(cardmarketProductUrl(unmappedExpansion)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Cards/Custom-Pirate-UNK-001'
    );
  });

  it('correctly formats character aliases and Version 1 suffixes (e.g. OP16-056 Mr.3 Galdino V1)', () => {
    // 1. Mr.3(Galdino) OP16-056 Version 1
    const mr3V1 = createMockAsset({
      name: 'Mr.3(Galdino) (056)',
      setCode: 'OP16',
      number: 'OP16-056',
      variant: 'Version 1',
    });
    expect(cardmarketProductUrl(mr3V1)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/OP16/Mr3Galdino-OP16-056-V1'
    );

    // 2. Mr.3(Galdino) OP16-056 Standard with candidateCount > 1
    const mr3StandardMulti = createMockAsset({
      name: 'Mr.3(Galdino)',
      setCode: 'OP16',
      number: 'OP16-056',
      variant: 'Standard',
      cardmarketArtworkReference: { candidateCount: 2 } as any,
    });
    expect(cardmarketProductUrl(mr3StandardMulti)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/OP16/Mr3Galdino-OP16-056-V1'
    );

    // 3. Mr.3(Galdino) OP16-056 Canonical lookup for 890742
    const mr3Canon = createMockAsset({
      name: 'Mr.3(Galdino) (056)',
      setCode: 'OP16',
      number: 'OP16-056',
      variant: 'Standard',
      cardmarketProductId: 890742,
    });
    expect(cardmarketProductUrl(mr3Canon)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/OP16/Mr3Galdino-OP16-056-V1'
    );

    // 4. Mr.3(Galdino) Alternate Art P1 -> V2
    const mr3V2 = createMockAsset({
      name: 'Mr.3(Galdino) (056)',
      setCode: 'OP16',
      number: 'OP16-056',
      variant: 'Alternate art · P1',
    });
    expect(cardmarketProductUrl(mr3V2)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/OP16/Mr3Galdino-OP16-056-V2'
    );

    // 5. Mr.2.Bon.Kurei(Bentham) OP16-055 Version 1
    const mr2V1 = createMockAsset({
      name: 'Mr.2.Bon.Kurei(Bentham) (055)',
      setCode: 'OP16',
      number: 'OP16-055',
      variant: 'V1',
    });
    expect(cardmarketProductUrl(mr2V1)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/OP16/Mr2BonKureiBentham-OP16-055-V1'
    );

    // 6. Mr.1(Daz.Bonez) OP04-068
    const mr1 = createMockAsset({
      name: 'Mr.1(Daz.Bonez) (068)',
      setCode: 'OP04',
      number: 'OP04-068',
      variant: 'Standard',
    });
    expect(cardmarketProductUrl(mr1)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Kingdoms-of-Intrigue/Mr1DazBonez-OP04-068'
    );

    // 7. Miss.Valentine(Mikita) OP04-067
    const missValentine = createMockAsset({
      name: 'Miss.Valentine(Mikita) (067)',
      setCode: 'OP04',
      number: 'OP04-067',
      variant: 'Standard',
    });
    expect(cardmarketProductUrl(missValentine)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Kingdoms-of-Intrigue/MissValentineMikita-OP04-067'
    );

    // 8. Miss Doublefinger(Zala) OP04-065
    const missDoublefinger = createMockAsset({
      name: 'Miss Doublefinger(Zala) (065)',
      setCode: 'OP04',
      number: 'OP04-065',
      variant: 'Standard',
    });
    expect(cardmarketProductUrl(missDoublefinger)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Kingdoms-of-Intrigue/MissDoublefingerZala-OP04-065'
    );
  });

  it('routes Queen (ST04-005) Treasure Cup and other tournament promos to Special-Tournaments-Promos', () => {
    // Queen (ST04-005) Treasure Cup promo #719319
    const queenPromo = createMockAsset({
      name: 'Queen',
      set: 'One Piece Promotion Cards',
      setCode: 'ST04',
      number: 'ST04-005',
      variant: 'Promotional art · Treasure Cup · TCGplayer #515354',
      cardmarketProductId: 719319,
      cardmarketExpansionId: 5262,
    });
    expect(cardmarketProductUrl(queenPromo)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/Queen-ST04-005'
    );

    // Laboon (EB01-048) Treasure Cup 2025 #821355
    const laboonPromo = createMockAsset({
      name: 'Laboon (048)',
      set: 'One Piece Promotion Cards',
      setCode: 'EB01',
      number: 'EB01-048',
      variant: 'Promotional art · Treasure Cup 2025 · TCGplayer #629758',
      cardmarketProductId: 821355,
      cardmarketExpansionId: 5262,
    });
    expect(cardmarketProductUrl(laboonPromo)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/Laboon-EB01-048-V1'
    );

    // Gecko Moria (ST03-004) Champion promo via cardmarketExpansionId 5262 fallback
    const moriaPromo = createMockAsset({
      name: 'Gecko Moria',
      set: 'One Piece Promotion Cards',
      setCode: 'ST03',
      number: 'ST03-004',
      variant: 'Champion promo · TCGplayer #503022',
      cardmarketExpansionId: 5262,
    });
    expect(cardmarketProductUrl(moriaPromo)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/Gecko-Moria-ST03-004'
    );

    // Franky (OP01-021) CS 2023 Celebration Pack via cardmarketExpansionId 5262 fallback
    const frankyPromo = createMockAsset({
      name: 'Franky',
      set: 'One Piece Promotion Cards',
      setCode: 'OP01',
      number: 'OP01-021',
      variant: 'Promotional art · CS 2023 Celebration Pack · TCGplayer #525306',
      cardmarketExpansionId: 5262,
    });
    expect(cardmarketProductUrl(frankyPromo)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/Franky-OP01-021'
    );
  });

  it('correctly maps and resolves distinct canonical Cardmarket links for all Monkey.D.Luffy P-001 variants', () => {
    // 1. Champion promo (ID 717506) -> Special Tournaments Promos V1
    const p001Champion = createMockAsset({
      name: 'Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]',
      number: 'P-001',
      setCode: 'P',
      cardmarketProductId: 717506,
      cardmarketExpansionId: 5262,
      variant: 'Champion promo · TCGplayer #503023',
    });
    expect(cardmarketProductUrl(p001Champion)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/MonkeyDLuffy-P-001-V1'
    );

    // 2. Offline Regional Participant (ID 766636) -> Special Tournaments Promos V2
    const p001Participant = createMockAsset({
      name: 'Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]',
      number: 'P-001',
      setCode: 'P',
      cardmarketProductId: 766636,
      cardmarketExpansionId: 5262,
      variant: 'Promotional art · Participant · TCGplayer #544770',
    });
    expect(cardmarketProductUrl(p001Participant)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/MonkeyDLuffy-P-001-V2'
    );

    // 3. Finalist promo (ID 766637) -> Special Tournaments Promos V3
    const p001Finalist = createMockAsset({
      name: 'Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]',
      number: 'P-001',
      setCode: 'P',
      cardmarketProductId: 766637,
      cardmarketExpansionId: 5262,
      variant: 'Finalist promo · TCGplayer #544771',
    });
    expect(cardmarketProductUrl(p001Finalist)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/MonkeyDLuffy-P-001-V3'
    );

    // 4. Regional Winner promo (ID 766638) -> Special Tournaments Promos V4
    const p001Winner = createMockAsset({
      name: 'Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]',
      number: 'P-001',
      setCode: 'P',
      cardmarketProductId: 766638,
      cardmarketExpansionId: 5262,
      variant: 'Winner promo · TCGplayer #544772',
    });
    expect(cardmarketProductUrl(p001Winner)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/MonkeyDLuffy-P-001-V4'
    );

    // 5. Alternate art (ID 698916) -> Unnumbered-Promos
    const p001AltArt = createMockAsset({
      name: 'Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]',
      number: 'P-001',
      setCode: 'P',
      cardmarketProductId: 698916,
      cardmarketExpansionId: 5267,
      variant: 'Alternate art · TCGplayer #509752',
    });
    expect(cardmarketProductUrl(p001AltArt)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Unnumbered-Promos/MonkeyDLuffy-P-001'
    );

    // 6. Gift Collection 2023 (ID 740388) -> Promos V4
    const p001Gift = createMockAsset({
      name: 'Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]',
      number: 'P-001',
      setCode: 'P',
      cardmarketProductId: 740388,
      cardmarketExpansionId: 5230,
      variant: 'Promotional art · Gift Collection 2023 · TCGplayer #523785',
    });
    expect(cardmarketProductUrl(p001Gift)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Promos/MonkeyDLuffy-P-001-V4'
    );

    // 7. Bandai Fest 23-24 Edition (ID 786107) -> Promos V5
    const p001BandaiFest = createMockAsset({
      name: 'Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]',
      number: 'P-001',
      setCode: 'P',
      cardmarketProductId: 786107,
      cardmarketExpansionId: 5230,
      variant: 'Promotional art · Premium Card Collection -BANDAI CARD GAMES Fest. 23-24 Edition- · TCGplayer #564250',
    });
    expect(cardmarketProductUrl(p001BandaiFest)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Promos/MonkeyDLuffy-P-001-V5'
    );

    // 8. Promotion Pack 2022 (ID 690375) -> Promos V1
    const p001PromoPack = createMockAsset({
      name: 'Monkey.D.Luffy (001) (Offline Regional 2024 Vol. 2) [Winner]',
      number: 'P-001',
      setCode: 'P',
      cardmarketProductId: 690375,
      cardmarketExpansionId: 5230,
      variant: 'Promotional art · Promotion Pack 2022 · TCGplayer #450299',
    });
    expect(cardmarketProductUrl(p001PromoPack)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Promos/MonkeyDLuffy-P-001-V1'
    );
  });

  it('maps Baby 5 and Tournament promo variants to their exact canonical Cardmarket URLs', () => {
    // 1. Baby 5 Winner Pack 2026 -> Winner-Cards/Baby-5-OP12-112-V1
    const babyWinner = createMockAsset({
      id: 'card-tcgplayer-668189',
      name: 'Baby 5 (112)',
      number: 'OP12-112',
      setCode: 'OP12',
      cardmarketProductId: 870121,
      variant: 'Winner promo · TCGplayer #668189',
    });
    expect(cardmarketProductUrl(babyWinner)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Winner-Cards/Baby-5-OP12-112-V1'
    );

    // 2. Baby 5 Tournament Pack 2026 -> Unnumbered-Promos/Baby-5-OP12-112-V1
    const babyTournament = createMockAsset({
      id: 'card-tcgplayer-668168',
      name: 'Baby 5 (112)',
      number: 'OP12-112',
      setCode: 'OP12',
      cardmarketProductId: 870120,
      variant: 'Promotional art · Tournament Pack 2026 Vol. 1 · TCGplayer #668168',
    });
    expect(cardmarketProductUrl(babyTournament)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Unnumbered-Promos/Baby-5-OP12-112-V1'
    );

    // 3. Baby 5 CS 26-27 Celebration Pack -> Special-Tournaments-Promos/Baby-5-OP12-112-V1
    const babyCS = createMockAsset({
      id: 'card-tcgplayer-710237',
      name: 'Baby 5 (112)',
      number: 'OP12-112',
      setCode: 'OP12',
      cardmarketProductId: 904370,
      variant: 'Promotional art · CS 26-27 Celebration Pack · TCGplayer #710237',
    });
    expect(cardmarketProductUrl(babyCS)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/Baby-5-OP12-112-V1'
    );

    // 4. Portgas.D.Ace CS 2023 Finalist -> Special-Tournaments-Promos/PortgasDAce-P-028-V1
    const aceFinalist = createMockAsset({
      id: 'card-tcgplayer-539553',
      name: 'Portgas.D.Ace (CS 2023 Event Pack Finalist Ver.)',
      number: 'P-028',
      setCode: 'P',
      cardmarketProductId: 752016,
    });
    expect(cardmarketProductUrl(aceFinalist)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/PortgasDAce-P-028-V1'
    );

    // 5. Raizo CS 2023 Finalist -> Special-Tournaments-Promos/Raizo-OP01-052-V1
    const raizoFinalist = createMockAsset({
      id: 'card-tcgplayer-539552',
      name: 'Raizo (CS 2023 Event Pack Finalist Ver.)',
      number: 'OP01-052',
      setCode: 'OP01',
      cardmarketProductId: 752011,
    });
    expect(cardmarketProductUrl(raizoFinalist)).toBe(
      'https://www.cardmarket.com/en/OnePiece/Products/Singles/Special-Tournaments-Promos/Raizo-OP01-052-V1'
    );
  });
});




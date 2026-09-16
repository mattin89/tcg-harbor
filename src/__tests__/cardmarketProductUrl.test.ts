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
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/OP16\/MonkeyDLuffy-OP16-022-V2$/);
  });

  it('generates the exact slug URL for OP16-022 Standard (V1)', () => {
    const asset = createMockAsset({
      name: 'Monkey.D.Luffy (022)',
      setCode: 'OP16',
      number: 'OP16-022',
      variant: 'Standard',
    });

    const url = cardmarketProductUrl(asset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/OP16\/MonkeyDLuffy-OP16-022-V1$/);
  });

  it('generates slug URL for OP01-001 Alternate Art P1', () => {
    const asset = createMockAsset({
      name: 'Roronoa Zoro (001)',
      setCode: 'OP01',
      number: 'OP01-001',
      variant: 'Alternate art · P1',
    });

    const url = cardmarketProductUrl(asset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/OP01\/RoronoaZoro-OP01-001-V2$/);
  });

  it('generates slug URL for P2 Manga rare (V3)', () => {
    const asset = createMockAsset({
      name: 'Portgas.D.Ace (013)',
      setCode: 'OP02',
      number: 'OP02-013',
      variant: 'Manga rare · P2',
    });

    const url = cardmarketProductUrl(asset);
    expect(url).toMatch(/\/OnePiece\/Products\/Singles\/OP02\/PortgasDAce-OP02-013-V3$/);
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

  it('falls back to search for DON!! cards', () => {
    const donAsset = createMockAsset({
      kind: 'card',
      name: 'DON!! Card (Shanks)',
      number: 'DON!!',
      setCode: 'DON',
    });

    const url = cardmarketProductUrl(donAsset);
    expect(url).toContain('/OnePiece/Products/Search?searchString=DON!!');
  });
});

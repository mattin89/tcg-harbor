import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import sealedProductPlaceholder from '../assets/sealed-product-placeholder-v1.png';
import { CardArt } from '../components/ui';
import type { DemoAsset } from '../data/demo';

const emptyChanges = {
  cardmarket: { '1D': null, '1W': null, '1M': null },
  tcgplayer: { '1D': null, '1W': null, '1M': null },
} as const;

function makeAsset(overrides: Partial<DemoAsset> = {}): DemoAsset {
  return {
    id: 'sealed-placeholder-test',
    kind: 'sealed',
    name: 'Example Booster Box',
    set: 'Example Set',
    setCode: 'EX01',
    rarity: 'Sealed',
    variant: 'Standard',
    productType: 'Booster box',
    language: 'English',
    condition: 'Factory sealed',
    quantity: 1,
    addedAt: '2026-07-21T00:00:00.000Z',
    color: 'azure',
    imageState: 'unavailable',
    imageUnavailableReason: 'No trusted official product image URL is available.',
    quote: { cardmarket: null, tcgplayer: null },
    change: emptyChanges,
    ...overrides,
  };
}

describe('sealed product artwork placeholder', () => {
  it('renders a bundled, clearly identified placeholder when sealed artwork is unavailable', () => {
    const markup = renderToStaticMarkup(<CardArt asset={makeAsset()} size="sm" />);

    expect(markup).toContain('is-sealed-placeholder');
    expect(markup).toContain(`src="${sealedProductPlaceholder}"`);
    expect(markup).toContain('Placeholder image');
    expect(markup).toContain('official product artwork unavailable');
  });

  it('keeps a real source image authoritative when one is present', () => {
    const sourceImage = 'https://images.example.test/official-product.jpg';
    const markup = renderToStaticMarkup(<CardArt asset={makeAsset({ imageUrl: sourceImage, imageState: 'available', imageUnavailableReason: undefined })} />);

    expect(markup).toContain(`src="${sourceImage}"`);
    expect(markup).not.toContain('is-sealed-placeholder');
    expect(markup).not.toContain('Placeholder image');
  });
});

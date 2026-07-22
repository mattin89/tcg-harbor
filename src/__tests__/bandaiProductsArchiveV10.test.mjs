import { describe, expect, it } from 'vitest';
import { parseBandaiProductsPageV10 } from '../../scripts/lib/bandai-products-archive-v10.mjs';

function row(category, title, datetime, label, href) {
  return `<li class="linkListColBox" data-cat="${category}">
    <a href="${href}" class="linkListColItem">
      <h4 class="linkListColTitle">${title}</h4>
      <time class="newsDate" datetime="${datetime}">${label}</time>
    </a>
  </li>`;
}

describe('Bandai products archive v10', () => {
  it('parses OTHER rows as first-party sealed release evidence', () => {
    const [product] = parseBandaiProductsPageV10(row(
      'other',
      'Premium Card Collection -Best Selection Vol.6-',
      '2026-08-01',
      'August 2026',
      '/products/other/cardcollection_bestselection_vol6.php',
    ), 1);

    expect(product).toMatchObject({
      category: 'other',
      title: 'Premium Card Collection -Best Selection Vol.6-',
      releasedOn: '2026-08-01',
      releasePrecision: 'month',
      productUrl: '/products/other/cardcollection_bestselection_vol6.php',
      page: 1,
    });
  });

  it('keeps coded booster/deck parsing and day precision intact', () => {
    const products = parseBandaiProductsPageV10([
      row('boosters', 'BOOSTER PACK -WINGS OF THE CAPTAIN- [OP-06]', '2024-03-15', 'March 15, 2024', '/products/boosters/op06.php'),
      row('decks', 'STARTER DECK -Uta- [ST-11]', '2024-02-02', 'February 2, 2024', '/products/decks/st11.php'),
    ].join(''), 4);

    expect(products.map(({ category, officialCode, releasePrecision }) => ({
      category,
      officialCode,
      releasePrecision,
    }))).toEqual([
      { category: 'boosters', officialCode: 'OP-06', releasePrecision: 'day' },
      { category: 'decks', officialCode: 'ST-11', releasePrecision: 'day' },
    ]);
  });
});

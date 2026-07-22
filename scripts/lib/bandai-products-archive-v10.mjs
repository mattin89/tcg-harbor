import { officialProductCodeFromTitle } from './catalog-ingestion-plan.mjs';

function decodeHtmlText(value) {
  const namedEntities = new Map([
    ['amp', '&'], ['apos', "'"], ['gt', '>'], ['lt', '<'], ['nbsp', ' '], ['quot', '"'],
  ]);
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities.get(name.toLowerCase()) ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBandaiProductsPageV10(html, page) {
  const products = [];
  const blocks = String(html).matchAll(
    /<li class="linkListColBox" data-cat="(boosters|decks|other)">([\s\S]*?)<\/li>/gi,
  );
  for (const blockMatch of blocks) {
    const category = blockMatch[1].toLowerCase();
    const block = blockMatch[2];
    const title = decodeHtmlText(
      block.match(/<h4 class="linkListColTitle">([\s\S]*?)<\/h4>/i)?.[1],
    );
    const dateMatch = block.match(
      /<time class="newsDate" datetime="([^"]+)">([\s\S]*?)<\/time>/i,
    );
    const productUrl = block.match(/<a href="([^"]+)"[^>]*class="linkListColItem"/i)?.[1]
      ?? null;
    if (!title || !dateMatch) {
      throw new Error(`Bandai ${category} markup on products page ${page} is missing a title or release date.`);
    }
    const releaseLabel = decodeHtmlText(dateMatch[2]);
    const releasePrecision = /^[A-Za-z]+ \d{1,2}, \d{4}$/.test(releaseLabel) ? 'day' : 'month';
    const officialCode = officialProductCodeFromTitle(title);
    const releasedOn = dateMatch[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releasedOn)
      || Number.isNaN(Date.parse(`${releasedOn}T00:00:00Z`))) {
      throw new Error(`Bandai product ${officialCode ?? title} has an invalid release date: ${releasedOn}.`);
    }
    products.push({
      category,
      officialCode,
      title,
      releasedOn,
      releaseLabel,
      releasePrecision,
      productUrl,
      page,
    });
  }
  return products;
}

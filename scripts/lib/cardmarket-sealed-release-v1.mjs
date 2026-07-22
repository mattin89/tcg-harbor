const CATEGORY_PATHS_V1 = new Map([
  [1622, 'Boosters'],
  [1624, 'Booster-Boxes'],
  [1625, 'Preconstructed-Decks'],
  [1628, 'Promo-Products'],
]);

function requiredPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return number;
}

function decodeHtmlText(value) {
  const namedEntities = new Map([
    ['amp', '&'], ['apos', "'"], ['gt', '>'], ['lt', '<'], ['nbsp', ' '], ['quot', '"'],
  ]);
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities.get(name.toLowerCase()) ?? match);
}

function normalizedPageText(value) {
  return decodeHtmlText(value)
    .replace(/<[^>]+>/g, ' ')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cardmarketProductSlugV1(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('Cardmarket product name cannot produce an empty slug.');
  return slug;
}

export function cardmarketProductPageUrlV1(product) {
  requiredPositiveInteger(product?.idProduct, 'Cardmarket product ID');
  const categoryPath = CATEGORY_PATHS_V1.get(Number(product?.idCategory));
  if (!categoryPath) {
    throw new Error(`Unsupported Cardmarket sealed category ${product?.idCategory}.`);
  }
  return `https://www.cardmarket.com/en/OnePiece/Products/${categoryPath}/${cardmarketProductSlugV1(product.name)}`;
}

export function isCanonicalCardmarketSealedProductV1(product, productType) {
  const name = String(product?.name ?? '').normalize('NFKC').trim();
  if (!name) return false;

  if (productType === 'Booster') {
    // A set's ordinary pack or sleeved pack. Release-event, winner, bonus,
    // campaign, dash, and other ancillary packs require their own page audit.
    return /\b(?:sleeved\s+)?booster(?:\s+pack)?$/i.test(name);
  }
  if (productType === 'Booster box') {
    return /\b(?:booster\s+(?:box|display)|sleeved\s+booster\s+pack\s+case)\b/i.test(name);
  }
  if (productType === 'Preconstructed deck') {
    return /^\s*(?:super\s+pre[-\s]?release\s+)?(?:starter|ultimate|ultra)\s+deck\b/i.test(name)
      && !/\b(?:demo\s+deck|deck\s+set|deck\s+pack|bonus\s+pack)\b/i.test(name);
  }
  return false;
}

export function assertCardmarketProductPageV1(html, productName) {
  const source = String(html ?? '');
  const expectedName = normalizedPageText(productName);
  const headingMatch = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const heading = normalizedPageText(headingMatch?.[1] ?? '');
  const identifiesCardmarket = /(?:cardmarket|\/en\/OnePiece\/Products\/)/i.test(source);

  if (!expectedName || !identifiesCardmarket || heading !== expectedName) {
    throw new Error(
      `Cardmarket product-page identity check failed for ${expectedName || 'an unnamed product'}.`,
    );
  }

  return { heading };
}

export function parseCardmarketPresaleReleaseV1(html) {
  const normalized = String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ');
  const match = normalized.match(
    /This is a presale item and will not be shipped before\s+(\d{2})\.(\d{2})\.(\d{4})/i,
  );
  if (!match) return null;
  const [, day, month, year] = match;
  const releasedOn = `${year}-${month}-${day}`;
  const parsed = Date.parse(`${releasedOn}T00:00:00.000Z`);
  const date = new Date(parsed);
  if (
    Number.isNaN(parsed)
    || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Cardmarket presale notice contains an invalid release date: ${day}.${month}.${year}.`);
  }
  return releasedOn;
}

export function cardmarketPresaleMarkerPresentV1(html) {
  return /\bpre[\s-]?sale\b/i.test(normalizedPageText(html));
}

export function cardmarketProductPageReleaseAuditV1(html, productName, cutoff) {
  assertCardmarketProductPageV1(html, productName);
  const releasedOn = parseCardmarketPresaleReleaseV1(html);
  const presaleMarkerPresent = cardmarketPresaleMarkerPresentV1(html);
  if (releasedOn) {
    return {
      releasedOn,
      releasePrecision: 'day',
      presaleMarkerPresent,
      state: cardmarketReleaseStateAtV1(releasedOn, cutoff),
      policy: 'Explicit Cardmarket presale notice',
    };
  }
  return {
    releasedOn: null,
    releasePrecision: null,
    presaleMarkerPresent,
    state: 'unknown',
    policy: presaleMarkerPresent
      ? 'An unparsed presale marker remains on the exact page; explicit review is required'
      : 'No presale marker or explicit date; first-party release evidence or explicit review is required',
  };
}

export function cardmarketReleaseStateAtV1(releasedOn, cutoff) {
  if (releasedOn == null) return 'unknown';
  const releaseTime = Date.parse(`${releasedOn}T00:00:00.000Z`);
  const cutoffTime = new Date(cutoff).valueOf();
  if (Number.isNaN(releaseTime) || Number.isNaN(cutoffTime)) {
    throw new Error('Cardmarket release-state comparison requires valid dates.');
  }
  return cutoffTime >= releaseTime ? 'released' : 'future';
}

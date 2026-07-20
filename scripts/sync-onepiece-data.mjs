import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// v7 preserves the v6 snapshot while extending exact cross-market coverage to
// every released English main, Extra Booster, and Premium Booster group that
// the source catalogs can prove unambiguously.
const OUTPUT = resolve(ROOT, 'src/data/generated/onepiece-market-v7.json');
const CARDMARKET_PRODUCTS = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json';
const CARDMARKET_NONSINGLES = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_18.json';
const CARDMARKET_PRICES = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json';
const TCGCSV_UPDATED_AT = 'https://tcgcsv.com/last-updated.txt';
const TCGCSV_CATEGORY_ID = 68;
const TCGCSV_GROUPS = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/groups`;
// Match the whole source abbreviation. Event, anniversary, pre-release,
// starter, promo, and Japanese groups therefore cannot enter by substring.
const TCGCSV_MARKET_GROUP_ABBREVIATION = /^(?:OP\d{2}|EB-\d{2}|PRB-\d{2}|OP\d{2}-EB\d{2})$/;
const MINIMUM_RELEASED_ENGLISH_MAIN_SET = 16;
const BANDAI_ENGLISH_PRODUCTS = 'https://en.onepiece-cardgame.com/products/?tags=boosters';
// TCGCSV's publishedOn is a group-publication timestamp, not a retail-release
// guarantee. Gate exact source abbreviations with audited Bandai English retail
// dates so a presale group (notably OP17) cannot appear early.
const ENGLISH_MARKET_RELEASES = new Map([
  ['OP01', { releasedOn: '2022-12-02', memberSetCodes: ['OP01'] }],
  ['OP02', { releasedOn: '2023-03-10', memberSetCodes: ['OP02'] }],
  ['OP03', { releasedOn: '2023-06-30', memberSetCodes: ['OP03'] }],
  ['OP04', { releasedOn: '2023-09-22', memberSetCodes: ['OP04'] }],
  ['OP05', { releasedOn: '2023-12-08', memberSetCodes: ['OP05'] }],
  ['OP06', { releasedOn: '2024-03-15', memberSetCodes: ['OP06'] }],
  ['EB-01', { releasedOn: '2024-05-03', memberSetCodes: ['EB01'] }],
  ['OP07', { releasedOn: '2024-06-28', memberSetCodes: ['OP07'] }],
  ['OP08', { releasedOn: '2024-09-13', memberSetCodes: ['OP08'] }],
  ['PRB-01', { releasedOn: '2024-11-08', memberSetCodes: ['PRB01'] }],
  ['OP09', { releasedOn: '2024-12-13', memberSetCodes: ['OP09'] }],
  ['OP10', { releasedOn: '2025-03-21', memberSetCodes: ['OP10'] }],
  ['EB-02', { releasedOn: '2025-05-09', memberSetCodes: ['EB02'] }],
  ['OP11', { releasedOn: '2025-06-06', memberSetCodes: ['OP11'] }],
  ['OP12', { releasedOn: '2025-08-22', memberSetCodes: ['OP12'] }],
  ['PRB-02', { releasedOn: '2025-10-03', memberSetCodes: ['PRB02'] }],
  ['OP13', { releasedOn: '2025-11-07', memberSetCodes: ['OP13'] }],
  ['OP14', { releasedOn: '2026-01-16', memberSetCodes: ['OP14', 'EB04'] }],
  ['EB-03', { releasedOn: '2026-02-20', memberSetCodes: ['EB03'] }],
  ['OP15-EB04', { releasedOn: '2026-04-03', memberSetCodes: ['OP15', 'EB04'] }],
  ['OP16', { releasedOn: '2026-06-12', memberSetCodes: ['OP16'] }],
  ['OP17', { releasedOn: '2026-08-28', memberSetCodes: ['OP17'] }],
  ['EB-05', { releasedOn: '2026-10-30', memberSetCodes: ['EB05'] }],
]);
const TCGCSV_PROMO_GROUP_ID = 17675;
const TCGCSV_PROMO_PRODUCTS = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${TCGCSV_PROMO_GROUP_ID}/products`;
const TCGCSV_PROMO_PRICES = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${TCGCSV_PROMO_GROUP_ID}/prices`;
const ECB_USD_PER_EUR = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata&detail=dataonly';
const ECB_SERIES_KEY = 'EXR.D.USD.EUR.SP00.A';
const TCGCSV_STARTER_SOURCES = [
  {
    groupId: 23489,
    productId: 548415,
    number: 'ST14-004',
    name: 'Jinbe',
  },
  {
    groupId: 24678,
    productId: 695447,
    number: 'ST30-017',
    name: 'And You Get Yourself in Big Trouble!! (Parallel)',
  },
];
const TCGCSV_STARTER_GROUP_IDS = [...new Set(TCGCSV_STARTER_SOURCES.map((source) => source.groupId))];
const BROKEN_TCGPLAYER_IMAGE_PRODUCT_IDS = new Set([599735, 599737, 599739]);
// These promo products and the two starter products were individually checked
// against TCGplayer's documented 1000px derivative on 2026-07-16. Other
// products retain TCGCSV's source-provided 200px URL rather than assuming that
// an unverified derivative exists.
const VERIFIED_HIGH_RES_TCGPLAYER_PRODUCT_IDS = new Set([
  450300, 450304, 455814, 455820, 455823, 455824, 457025, 457029, 457033, 483104,
  483185, 485262, 485263, 485268, 485269, 497000, 497406, 499432, 503244, 509462,
  509463, 509465, 515356, 515361, 518696, 518698, 518699, 519816, 520773, 525310,
  525332, 525676, 532108, 536170, 537445, 537446, 539174, 539199, 539200, 539203,
  544614, 544620, 544771, 544778, 546672, 546713, 548434, 552051, 561185, 565271,
  566952, 566953, 577143, 579984, 579985, 579987, 580042, 580050, 580056, 583735,
  583766, 583768, 588168, 588172, 607975, 607978, 607979, 610801, 617587, 617592,
  617593, 619195, 619202, 619205, 619217, 619591, 620828, 622594, 623068, 623071,
  626672, 626673, 630420, 635472, 636541, 636543, 636546, 641199, 641223, 641239,
  643883, 646720, 646725, 646729, 646738, 647759, 648086, 648089, 648103, 649246,
  649620, 649625, 649634, 649676, 649683, 655965, 655967, 657117, 661690, 668168,
  668177, 668186, 668187, 668188, 668189, 668193, 683972, 684302, 686458, 690674,
  690675, 693122, 548415, 695447,
]);
const OPTCG_FEEDS = [
  { kind: 'set', url: 'https://optcgapi.com/api/allSetCards/' },
  { kind: 'starter', url: 'https://optcgapi.com/api/allSTCards/' },
  { kind: 'promo', url: 'https://optcgapi.com/api/allPromos/' },
  { kind: 'don', url: 'https://optcgapi.com/api/allDonCards/' },
];

// The representative demo holdings intentionally remain the original 40-card
// OP01-OP07 sample. They are independent from the now-complete market coverage.
const INITIAL_SET_CODES = Array.from({ length: 7 }, (_, index) => `OP${String(index + 1).padStart(2, '0')}`);
const GRADIENTS = ['coral', 'gold', 'violet', 'azure', 'jade', 'rose', 'indigo', 'amber'];
const RARITIES = {
  C: 'Common',
  UC: 'Uncommon',
  R: 'Rare',
  SR: 'Super Rare',
  SEC: 'Secret Rare',
  L: 'Leader',
  DON: 'DON!!',
  'DON!!': 'DON!!',
};
const SEALED_CATEGORIES = new Map([
  ['One Piece Booster', { productType: 'Booster', setCode: 'BOOSTER' }],
  ['One Piece Booster Boxes', { productType: 'Booster box', setCode: 'BOX' }],
  ['One Piece Preconstructed Decks', { productType: 'Preconstructed deck', setCode: 'DECK' }],
  ['One Piece Promo Products', { productType: 'Promo product', setCode: 'PROMO' }],
]);
const NON_ENGLISH_SEALED = /(?:non[-\s]?english|japanese|asia\s+region|german|french|italian|spanish|portuguese|korean|chinese)/i;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function fetchSource(url) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'TCG-Harbor-data-sync/3.1' },
      });
      if (!response.ok) throw new Error(`${response.status} while fetching ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(300 * attempt);
    }
  }
  throw lastError;
}

async function fetchJson(url) {
  return (await fetchSource(url)).json();
}

async function fetchText(url) {
  return (await fetchSource(url)).text();
}

function parseEcbUsdPerEur(csvText) {
  const [headerLine, ...dataLines] = String(csvText).trim().split(/\r?\n/);
  const headers = headerLine.replace(/^\uFEFF/, '').split(',');
  const values = dataLines.filter(Boolean).at(-1)?.split(',') ?? [];
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  const usdPerEur = Number(row.OBS_VALUE);
  if (row.KEY !== ECB_SERIES_KEY || !/^\d{4}-\d{2}-\d{2}$/.test(row.TIME_PERIOD ?? '') || !Number.isFinite(usdPerEur) || usdPerEur <= 0) {
    throw new Error('ECB EUR/USD response did not contain one valid USD-per-EUR observation.');
  }
  return {
    usdPerEur,
    observationDate: row.TIME_PERIOD,
    fetchedAt: new Date().toISOString(),
    seriesKey: ECB_SERIES_KEY,
    source: ECB_USD_PER_EUR,
  };
}

function assertArray(value, source) {
  if (!Array.isArray(value)) throw new Error(`Expected an array from ${source}.`);
  return value;
}

function tcgcsvResults(payload, source) {
  return assertArray(payload?.results, source);
}

function groupBy(items, keyFor) {
  return items.reduce((groups, item) => {
    const key = keyFor(item);
    if (!key) return groups;
    const bucket = groups.get(key) ?? [];
    bucket.push(item);
    groups.set(key, bucket);
    return groups;
  }, new Map());
}

function printedNumber(productName) {
  return productName.match(/\(([A-Z]{2,5}\d{2}-\d{3})\)\s*$/)?.[1] ?? null;
}

function setCodeFromNumber(number) {
  return number.split('-')[0];
}

function normalizeSetCode(value, fallback = 'PROMO') {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!normalized) return fallback;
  if (/^(?:OP|ST|EB|PRB)-\d{1,2}$/.test(normalized)) return normalized.replace('-', '');
  return normalized;
}

function tcgcsvGroupAbbreviation(group) {
  return String(group?.abbreviation ?? '').trim().toUpperCase();
}

function primarySetCodeForGroup(group) {
  const abbreviation = tcgcsvGroupAbbreviation(group);
  const match = abbreviation.match(/^(OP\d{2}|EB-\d{2}|PRB-\d{2})/);
  return match ? normalizeSetCode(match[1]) : null;
}

function mainSetOrdinalForGroup(group) {
  const match = primarySetCodeForGroup(group)?.match(/^OP(\d{2})$/);
  return match ? Number(match[1]) : null;
}

function isReleasedEnglishMarketGroup(group, cutoff = new Date()) {
  const abbreviation = tcgcsvGroupAbbreviation(group);
  const release = ENGLISH_MARKET_RELEASES.get(abbreviation);
  const releasedOn = Date.parse(`${release?.releasedOn ?? ''}T00:00:00Z`);
  return Number(group?.categoryId) === TCGCSV_CATEGORY_ID
    && TCGCSV_MARKET_GROUP_ABBREVIATION.test(abbreviation)
    && release != null
    && Number.isFinite(releasedOn)
    && releasedOn <= cutoff.valueOf();
}

function selectReleasedEnglishMarketGroups(groups, cutoff = new Date()) {
  const releasedManifestEntries = [...ENGLISH_MARKET_RELEASES.entries()]
    .filter(([, release]) => Date.parse(`${release.releasedOn}T00:00:00Z`) <= cutoff.valueOf());
  const selected = releasedManifestEntries.map(([abbreviation]) => {
    const matches = groups.filter((group) =>
      tcgcsvGroupAbbreviation(group) === abbreviation && Number(group.categoryId) === TCGCSV_CATEGORY_ID,
    );
    if (matches.length !== 1) {
      throw new Error(`Expected one TCGCSV group for released English product ${abbreviation}, found ${matches.length}.`);
    }
    if (!isReleasedEnglishMarketGroup(matches[0], cutoff)) {
      throw new Error(`TCGCSV group ${abbreviation} failed the exact released-English group policy.`);
    }
    return matches[0];
  }).sort((left, right) => {
    const leftRelease = ENGLISH_MARKET_RELEASES.get(tcgcsvGroupAbbreviation(left)).releasedOn;
    const rightRelease = ENGLISH_MARKET_RELEASES.get(tcgcsvGroupAbbreviation(right)).releasedOn;
    return leftRelease.localeCompare(rightRelease) || Number(left.groupId) - Number(right.groupId);
  });
  const abbreviations = selected.map(tcgcsvGroupAbbreviation);
  if (new Set(abbreviations).size !== abbreviations.length) {
    throw new Error('TCGCSV returned duplicate released market-group abbreviations.');
  }

  const mainOrdinals = selected
    .map(mainSetOrdinalForGroup)
    .filter((ordinal) => ordinal != null)
    .sort((left, right) => left - right);
  const latestMainOrdinal = mainOrdinals.at(-1) ?? 0;
  const expectedMainOrdinals = Array.from({ length: latestMainOrdinal }, (_, index) => index + 1);
  if (latestMainOrdinal < MINIMUM_RELEASED_ENGLISH_MAIN_SET
    || mainOrdinals.length !== expectedMainOrdinals.length
    || mainOrdinals.some((ordinal, index) => ordinal !== expectedMainOrdinals[index])) {
    throw new Error(`Released English main-set groups are incomplete: ${mainOrdinals.join(', ') || 'none'}.`);
  }
  for (const requiredSpecial of ['EB-01', 'EB-02', 'EB-03', 'PRB-01', 'PRB-02']) {
    if (!abbreviations.includes(requiredSpecial)) {
      throw new Error(`Released English special group ${requiredSpecial} is missing from TCGCSV.`);
    }
  }
  return selected;
}

function cardmarketLotSetCode(productName) {
  return String(productName ?? '').match(/\(((?:OP|EB|PRB)\d{2})\)\s*$/i)?.[1]?.toUpperCase() ?? null;
}

function normalizedReleaseTitle(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/^Extra Booster:\s*/i, '')
    .replace(/^Premium Booster\s*-?\s*/i, '')
    .replace(/\s+(?:sleeved\s+)?booster(?:\s+(?:pack\s+case|box(?:\s+case)?))?(?:\s*\([^)]*\))?\s*$/i, '')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

function cardmarketExpansionEvidenceForGroup(group, nonSingles) {
  const evidenceCode = primarySetCodeForGroup(group);
  const exactLotEvidence = nonSingles.filter((product) =>
    product.categoryName === 'One Piece Lots'
    && cardmarketLotSetCode(product.name) === evidenceCode,
  );
  const lotExpansionIds = [...new Set(exactLotEvidence.map((product) => Number(product.idExpansion)))];
  if (lotExpansionIds.length === 1) {
    return {
      idExpansion: lotExpansionIds[0],
      policy: `Exact Cardmarket lot suffix (${evidenceCode})`,
      evidenceProductIds: exactLotEvidence.map((product) => Number(product.idProduct)),
    };
  }
  if (lotExpansionIds.length > 1) {
    throw new Error(`Cardmarket lot evidence for ${evidenceCode} spans expansions ${lotExpansionIds.join(', ')}.`);
  }

  // PRB releases currently have no coded Cardmarket lot records. In that case,
  // require both English booster and booster-box records whose packaging-free
  // title exactly equals the TCGCSV group title and whose expansion ID agrees.
  const expectedTitle = normalizedReleaseTitle(group.name);
  const exactSealedEvidence = nonSingles.filter((product) =>
    (product.categoryName === 'One Piece Booster' || product.categoryName === 'One Piece Booster Boxes')
    && !NON_ENGLISH_SEALED.test(String(product.name ?? ''))
    && normalizedReleaseTitle(product.name) === expectedTitle,
  );
  const sealedExpansionIds = [...new Set(exactSealedEvidence.map((product) => Number(product.idExpansion)))];
  const sealedCategories = new Set(exactSealedEvidence.map((product) => product.categoryName));
  if (sealedExpansionIds.length !== 1
    || !sealedCategories.has('One Piece Booster')
    || !sealedCategories.has('One Piece Booster Boxes')) {
    throw new Error(`No unique English Cardmarket expansion evidence for ${tcgcsvGroupAbbreviation(group)} (${group.name}).`);
  }
  return {
    idExpansion: sealedExpansionIds[0],
    policy: 'Exact packaging-free English booster and booster-box title',
    evidenceProductIds: exactSealedEvidence.map((product) => Number(product.idProduct)),
  };
}

function percentAgainst(current, comparison) {
  if (current == null || comparison == null || comparison === 0) return null;
  return Number((((current - comparison) / comparison) * 100).toFixed(2));
}

function round(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Number(numeric.toFixed(2)) : null;
}

function hash(value, length = 20) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function colorFor(stableId) {
  return GRADIENTS[Number.parseInt(hash(stableId, 8), 16) % GRADIENTS.length];
}

function canonicalImageUrl(value) {
  try {
    const url = new URL(String(value));
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return '';
  }
}

function isTrustedCardImage(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'optcgapi.com';
  } catch {
    return false;
  }
}

function trustedCardImage(card) {
  const imageUrl = canonicalImageUrl(card.card_image);
  return imageUrl && isTrustedCardImage(imageUrl) ? imageUrl : null;
}

function isTrustedTcgplayerImage(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'tcgplayer-cdn.tcgplayer.com';
  } catch {
    return false;
  }
}

function tcgcsvExtendedValue(product, name) {
  const entry = assertArray(product.extendedData ?? [], `TCGCSV product ${product.productId} extendedData`)
    .find((candidate) => candidate?.name === name);
  return entry?.value == null ? null : String(entry.value).trim();
}

function tcgcsvCardNumber(product) {
  const number = tcgcsvExtendedValue(product, 'Number');
  return number ? number.toUpperCase() : null;
}

function tcgcsvImageUrl(product) {
  const productId = Number(product.productId);
  if (BROKEN_TCGPLAYER_IMAGE_PRODUCT_IDS.has(productId)) return null;
  const sourceUrl = canonicalImageUrl(product.imageUrl);
  if (!sourceUrl || !isTrustedTcgplayerImage(sourceUrl)) return null;
  if (!VERIFIED_HIGH_RES_TCGPLAYER_PRODUCT_IDS.has(productId)) return sourceUrl;
  return sourceUrl.replace(/_200w\.jpg$/i, '_in_1000x1000.jpg');
}

function tcgcsvLanguage(productName) {
  return /\bJapanese(?:\s+Version)?\b.*\bAnniversary\b/i.test(String(productName))
    ? 'Japanese'
    : 'English';
}

function isBaseTcgcsvSetProduct(product) {
  // Main-set parallel products retain the same printed card number but add a
  // variant qualifier to the product title. Only the unqualified base product
  // is comparable to the conservative Cardmarket base-art mapping.
  const name = String(product.name ?? '');
  const qualifier = '(?:parallel|alternate art|manga|special|sp|tr|pre-release|winner|champion|judge|reprint|dash pack|full art|jolly roger foil|pirate foil|textured foil)';
  return !new RegExp(`\\(${qualifier}(?:[^)]*)\\)`, 'i').test(name)
    && !new RegExp(`(?:\\s[-–—·]\\s*)${qualifier}\\s*$`, 'i').test(name);
}

function uniquePriceIndex(prices) {
  const grouped = groupBy(prices, (price) => String(price.productId ?? ''));
  return new Map([...grouped].map(([productId, rows]) => [Number(productId), rows]));
}

function tcgcsvPriceRows(priceIndex, productId) {
  return priceIndex.get(Number(productId)) ?? [];
}

function exactTcgcsvPrice(priceIndex, productId) {
  const rows = tcgcsvPriceRows(priceIndex, productId);
  // A product can expose separate Foil and Normal values. The app currently
  // stores one headline quote per art, so retain both exact rows below and do
  // not manufacture a blended/default value.
  return rows.length === 1 ? rows[0] : null;
}

function sourceRank(kind) {
  return { set: 0, starter: 1, promo: 2, don: 3 }[kind] ?? 9;
}

function recordRichness(card) {
  return [
    card.card_set_id,
    card.card_image_id,
    card.card_name,
    card.set_name,
    card.set_id,
    card.card_text,
    card.market_price,
    card.inventory_price,
  ].filter((value) => value != null && value !== '').length;
}

function preferRecord(left, right) {
  const leftDate = Date.parse(left.date_scraped ?? '') || 0;
  const rightDate = Date.parse(right.date_scraped ?? '') || 0;
  if (leftDate !== rightDate) return rightDate > leftDate ? right : left;
  const leftScore = recordRichness(left) - sourceRank(left.__source);
  const rightScore = recordRichness(right) - sourceRank(right.__source);
  return rightScore > leftScore ? right : left;
}

function printingIdentity(card) {
  return [
    card.__source,
    card.set_id,
    card.set_name,
    card.card_set_id,
    card.card_image_id,
    card.card_name,
    card.optcg_don_name,
    trustedCardImage(card) ?? card.card_image ?? 'image-unavailable',
  ].map((value) => String(value ?? '')).join('|');
}

function duplicatePrintingKey(card) {
  return [
    card.set_id,
    card.set_name,
    card.card_set_id,
    card.card_image_id,
    card.card_name,
    card.optcg_don_name,
    trustedCardImage(card) ?? card.card_image ?? 'image-unavailable',
  ].map((value) => String(value ?? '')).join('|');
}

function dedupePrintings(records) {
  const byPrinting = new Map();
  for (const record of records) {
    const imageUrl = trustedCardImage(record);
    const normalized = { ...record, card_image: imageUrl };
    const key = duplicatePrintingKey(normalized);
    const existing = byPrinting.get(key);
    byPrinting.set(key, existing ? preferRecord(existing, normalized) : normalized);
  }
  return [...byPrinting.values()];
}

function regularRulesCardId(card) {
  const value = String(card.card_set_id ?? '').trim().toUpperCase();
  return value || null;
}

function donRulesCardId(card) {
  return 'DON!!';
}

function rulesCardId(card) {
  return card.__source === 'don' ? donRulesCardId(card) : regularRulesCardId(card);
}

function isExactOptcgBaseCandidateForGroup(card, source) {
  const number = regularRulesCardId(card);
  if (!number || card.__source !== 'set') return false;
  const sourceSetCode = normalizeSetCode(card.set_id, '');
  return card.card_image_id === number
    && source.memberSetCodes.includes(setCodeFromNumber(number))
    && (sourceSetCode === source.primarySetCode || sourceSetCode.startsWith(`${source.primarySetCode}-`));
}

function canonicalNames(cards) {
  const names = new Map();
  for (const [number, variants] of groupBy(cards.filter((card) => card.__source !== 'don'), regularRulesCardId)) {
    const ranked = [...variants].sort((left, right) => {
      const leftBase = left.card_image_id === number ? 0 : 1;
      const rightBase = right.card_image_id === number ? 0 : 1;
      if (leftBase !== rightBase) return leftBase - rightBase;
      const sourceDifference = sourceRank(left.__source) - sourceRank(right.__source);
      if (sourceDifference !== 0) return sourceDifference;
      return String(left.card_name ?? '').length - String(right.card_name ?? '').length;
    });
    const name = String(ranked[0]?.card_name ?? number).trim();
    names.set(number, name || number);
  }
  return names;
}

function suffixDetails(card) {
  const number = regularRulesCardId(card);
  if (!number) return null;
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(card.card_image_id ?? '').match(new RegExp(`^${escaped}_(pr|p|r)(\\d+)$`, 'i'));
  return match ? { kind: match[1].toLowerCase(), index: Number(match[2]), code: `${match[1].toUpperCase()}${match[2]}` } : null;
}

function promotionalDescriptor(card, canonicalName) {
  const sourceName = String(card.card_name ?? '').trim();
  if (!sourceName || sourceName === canonicalName) return null;
  const descriptors = [...sourceName.matchAll(/\(([^()]+)\)|\[([^\[\]]+)\]/g)]
    .map((match) => String(match[1] ?? match[2]).trim())
    .filter((value) => value && !/^(?:\d{3}|parallel|alternate art|reprint|manga|sp)$/i.test(value));
  return descriptors.at(-1) ?? null;
}

function variantLabel(card, canonicalName) {
  if (card.__source === 'don') return 'DON!! design';

  const suffix = suffixDetails(card);
  const name = String(card.card_name ?? '').toLowerCase();
  let label;

  if (suffix?.kind === 'pr' || card.__source === 'promo') {
    const descriptor = promotionalDescriptor(card, canonicalName);
    label = descriptor ? `Promotional art · ${descriptor}` : 'Promotional art';
  } else if (card.card_image_id === regularRulesCardId(card)) {
    // Printing identity is stronger evidence than words inside a card's real
    // title (for example "Special Muggy Ball"). An exact base image ID is the
    // standard printing even when the rules-card name contains "special".
    label = 'Standard';
  } else if (name.includes('manga')) {
    label = suffix?.kind === 'r' ? 'Manga reprint' : 'Manga rare';
  } else if (name.includes('box topper')) {
    label = 'Box topper';
  } else if (name.includes('winner')) {
    label = 'Winner promo';
  } else if (name.includes('finalist')) {
    label = 'Finalist promo';
  } else if (/\(sp\)|\bspecial\b/i.test(card.card_name ?? '')) {
    label = 'Special art';
  } else if (suffix?.kind === 'r' || name.includes('reprint')) {
    label = 'Reprint';
  } else if (suffix?.kind === 'p' || name.includes('parallel') || name.includes('alternate art')) {
    label = 'Alternate art';
  } else {
    label = 'Alternate printing';
  }

  return suffix ? `${label} · ${suffix.code}` : label;
}

function tcgcsvPromoVariantLabel(product, canonicalName) {
  const sourceName = String(product.name ?? '').trim();
  const lower = sourceName.toLowerCase();
  let label;
  if (lower.includes('manga')) label = 'Manga art';
  else if (lower.includes('alternate art')) label = 'Alternate art';
  else if (lower.includes('winner')) label = 'Winner promo';
  else if (lower.includes('finalist')) label = 'Finalist promo';
  else if (lower.includes('champion')) label = 'Champion promo';
  else if (lower.includes('participation')) label = 'Participation promo';
  else {
    const descriptor = promotionalDescriptor({ card_name: sourceName }, canonicalName);
    label = descriptor ? `Promotional art · ${descriptor}` : 'Promotional printing';
  }
  return `${label} · TCGplayer #${product.productId}`;
}

function promoFallbackName(product) {
  const number = tcgcsvCardNumber(product);
  const escapedNumber = number?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(product.name ?? number ?? 'Unknown card')
    .replace(escapedNumber ? new RegExp(`\\s*-\\s*${escapedNumber}(?=\\s|\\(|$)`, 'i') : /$^/, '')
    .replace(/\s+(?:\([^()]+\)|\[[^\[\]]+\])+\s*$/g, '')
    .trim();
}

function pricingDetails(price) {
  return {
    trend: round(price?.trend),
    low: round(price?.low),
    average: round(price?.avg),
    average1Day: round(price?.avg1),
    average7Days: round(price?.avg7),
    average30Days: round(price?.avg30),
  };
}

function tcgcsvPricingDetails(price, priceRows = []) {
  const details = {
    market: round(price?.marketPrice),
    low: round(price?.lowPrice),
    mid: round(price?.midPrice),
    high: round(price?.highPrice),
    directLow: round(price?.directLowPrice),
    subtype: price?.subTypeName ?? null,
    inventory: null,
    source: 'TCGCSV / TCGplayer product price',
  };
  if (priceRows.length > 1) {
    details.variants = priceRows.map((row) => ({
      subtype: row.subTypeName ?? null,
      market: round(row.marketPrice),
      low: round(row.lowPrice),
      mid: round(row.midPrice),
      high: round(row.highPrice),
      directLow: round(row.directLowPrice),
    }));
  }
  return details;
}

function emptyChanges() {
  return { '1D': null, '1W': null, '1M': null };
}

function setCodeForCard(card, number) {
  if (card.__source === 'don') return 'DON';
  if (card.__source === 'promo' && (!card.set_id || card.set_id === 'P')) return 'PROMO';
  return normalizeSetCode(card.set_id, setCodeFromNumber(number));
}

function setNameForCard(card) {
  if (card.__source === 'don') return 'DON!! Cards';
  return String(card.set_name ?? (card.__source === 'promo' ? 'One Piece Promotion Cards' : 'One Piece Card Game')).trim();
}

function printingId(card) {
  const sourceId = String(card.card_image_id ?? card.card_set_id ?? card.card_name ?? 'printing').trim();
  return `${sourceId}:${hash(printingIdentity(card), 10)}`;
}

function cardStableId(card) {
  const imageUrl = trustedCardImage(card);
  const identity = imageUrl ? `image:${imageUrl}` : `printing:${printingIdentity(card)}`;
  return `card-optcg-${hash(identity, 20)}`;
}

function promoStableId(product) {
  return `card-tcgplayer-${Number(product.productId)}`;
}

function sealedSetCode(product, category) {
  const match = product.name.match(/\b(OP|ST|EB|PRB)[-\s]?(\d{1,2})\b/i);
  return match ? `${match[1].toUpperCase()}${match[2].padStart(2, '0')}` : category.setCode;
}

async function fetchTcgcsvBundle() {
  const updatedText = await fetchText(TCGCSV_UPDATED_AT);
  await delay(110);
  const groupsPayload = await fetchJson(TCGCSV_GROUPS);
  await delay(110);
  const groups = tcgcsvResults(groupsPayload, TCGCSV_GROUPS);
  const marketGroups = selectReleasedEnglishMarketGroups(groups);
  const promoGroup = groups.find((group) => tcgcsvGroupAbbreviation(group) === 'OP-PR');
  if (!promoGroup || Number(promoGroup.groupId) !== TCGCSV_PROMO_GROUP_ID) {
    throw new Error('TCGCSV promotion-group identity changed; refusing to fetch an unverified group.');
  }
  const promoProducts = await fetchJson(TCGCSV_PROMO_PRODUCTS);
  await delay(110);
  const promoPrices = await fetchJson(TCGCSV_PROMO_PRICES);
  await delay(110);

  const starterPayloads = [];
  for (const groupId of TCGCSV_STARTER_GROUP_IDS) {
    starterPayloads.push(await fetchJson(`https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${groupId}/products`));
    await delay(110);
    starterPayloads.push(await fetchJson(`https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${groupId}/prices`));
    await delay(110);
  }

  const marketGroupSources = [];
  for (const group of marketGroups) {
    const groupId = Number(group.groupId);
    const productsUrl = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${groupId}/products`;
    const pricesUrl = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${groupId}/prices`;
    const products = await fetchJson(productsUrl);
    await delay(110);
    const prices = await fetchJson(pricesUrl);
    await delay(110);
    marketGroupSources.push({ group, groupId, productsUrl, pricesUrl, products, prices });
  }
  return { updatedText, groups, marketGroupSources, promoProducts, promoPrices, starterPayloads };
}

const [marketSources, tcgcsvBundle, feedResponses, ecbCsv] = await Promise.all([
  Promise.all([
    fetchJson(CARDMARKET_PRODUCTS),
    fetchJson(CARDMARKET_NONSINGLES),
    fetchJson(CARDMARKET_PRICES),
  ]),
  fetchTcgcsvBundle(),
  Promise.all(OPTCG_FEEDS.map((feed) => fetchJson(feed.url))),
  fetchText(ECB_USD_PER_EUR),
]);

const [productCatalog, nonSinglesCatalog, priceGuide] = marketSources;
const {
  updatedText: tcgcsvUpdatedText,
  groups: tcgcsvGroups,
  promoProducts: tcgcsvPromoPayload,
  promoPrices: tcgcsvPromoPricePayload,
  starterPayloads: tcgcsvStarterPayloads,
  marketGroupSources: tcgcsvMarketGroupSources,
} = tcgcsvBundle;
const parsedTcgcsvDate = new Date(tcgcsvUpdatedText.trim());
if (Number.isNaN(parsedTcgcsvDate.valueOf())) {
  throw new Error(`Invalid TCGCSV snapshot timestamp: ${tcgcsvUpdatedText.trim()}`);
}
const tcgcsvCreatedAt = parsedTcgcsvDate.toISOString();
const tcgcsvPromoProducts = tcgcsvResults(tcgcsvPromoPayload, TCGCSV_PROMO_PRODUCTS);
const numberedTcgcsvPromoProducts = tcgcsvPromoProducts.filter((product) => tcgcsvCardNumber(product));
const tcgcsvPromoPrices = tcgcsvResults(tcgcsvPromoPricePayload, TCGCSV_PROMO_PRICES);
const tcgcsvPromoPriceIndex = uniquePriceIndex(tcgcsvPromoPrices);
const exchangeRate = parseEcbUsdPerEur(ecbCsv);

const tcgcsvMarketSources = tcgcsvMarketGroupSources.map((source) => ({
  ...source,
  abbreviation: tcgcsvGroupAbbreviation(source.group),
  primarySetCode: primarySetCodeForGroup(source.group),
  releasedOn: ENGLISH_MARKET_RELEASES.get(tcgcsvGroupAbbreviation(source.group)).releasedOn,
  memberSetCodes: ENGLISH_MARKET_RELEASES.get(tcgcsvGroupAbbreviation(source.group)).memberSetCodes,
  products: tcgcsvResults(source.products, source.productsUrl),
  priceIndex: uniquePriceIndex(tcgcsvResults(source.prices, source.pricesUrl)),
}));

const starterProductsByGroup = new Map();
const starterPricesByGroup = new Map();
for (const [index, groupId] of TCGCSV_STARTER_GROUP_IDS.entries()) {
  const productsUrl = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${groupId}/products`;
  const pricesUrl = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${groupId}/prices`;
  starterProductsByGroup.set(groupId, tcgcsvResults(tcgcsvStarterPayloads[index * 2], productsUrl));
  starterPricesByGroup.set(groupId, uniquePriceIndex(tcgcsvResults(tcgcsvStarterPayloads[(index * 2) + 1], pricesUrl)));
}

const rawCards = feedResponses.flatMap((response, index) =>
  assertArray(response, OPTCG_FEEDS[index].url).map((card) => ({ ...card, __source: OPTCG_FEEDS[index].kind })),
);
const rawPromoCards = rawCards.filter((card) => card.__source === 'promo');
const rawCoreCards = rawCards.filter((card) => card.__source !== 'promo');
const trustedImageRecords = rawCards.filter((card) => trustedCardImage(card));
const uniqueOptcgCards = dedupePrintings(rawCards);
const uniqueCoreCards = dedupePrintings(rawCoreCards);
const nameByRulesCard = canonicalNames(uniqueOptcgCards);
const optcgPromoByNumber = groupBy(rawPromoCards, regularRulesCardId);
const optcgRulesByNumber = groupBy(rawCards.filter((card) => card.__source !== 'don'), regularRulesCardId);
const cardmarketPricesByProduct = new Map(priceGuide.priceGuides.map((price) => [price.idProduct, price]));
const productsByNumber = groupBy(productCatalog.products, (product) => printedNumber(product.name));

const tcgcsvPromoProductIds = numberedTcgcsvPromoProducts.map((product) => Number(product.productId));
if (tcgcsvPromoProductIds.some((productId) => !Number.isInteger(productId) || productId <= 0)) {
  throw new Error('A numbered TCGCSV promo product is missing a stable positive productId.');
}
if (new Set(tcgcsvPromoProductIds).size !== tcgcsvPromoProductIds.length) {
  throw new Error('Duplicate TCGCSV promo productId detected.');
}
const starterEnrichments = new Map();
for (const source of TCGCSV_STARTER_SOURCES) {
  const product = starterProductsByGroup.get(source.groupId)?.find((candidate) => Number(candidate.productId) === source.productId);
  if (!product || tcgcsvCardNumber(product) !== source.number || product.name !== source.name) {
    throw new Error(`TCGCSV starter identity mismatch for product ${source.productId}.`);
  }
  const imageUrl = tcgcsvImageUrl(product);
  if (!imageUrl) throw new Error(`Verified starter product ${source.productId} lost its image URL.`);
  const price = exactTcgcsvPrice(starterPricesByGroup.get(source.groupId), source.productId);
  if (!price) throw new Error(`Verified starter product ${source.productId} lost its unambiguous price row.`);
  starterEnrichments.set(`${source.number}|${source.name}`, { ...source, product, price, imageUrl });
}

const cardmarketExpansionEvidenceByGroup = new Map(tcgcsvMarketSources.map((source) => [
  source.groupId,
  cardmarketExpansionEvidenceForGroup(source.group, nonSinglesCatalog.products),
]));
const englishExpansionIds = Object.fromEntries(tcgcsvMarketSources.map((source) => [
  source.abbreviation,
  cardmarketExpansionEvidenceByGroup.get(source.groupId).idExpansion,
]));

for (const source of tcgcsvMarketSources) {
  if (!source.products.some((product) => tcgcsvCardNumber(product) && product.presaleInfo?.isPresale !== true)) {
    throw new Error(`Released TCGCSV group ${source.abbreviation} has no non-presale numbered products.`);
  }
}

// A comparison row exists only when all three catalogs agree without price- or
// title-based guessing: one exact OPTCG standard printing in the release, one
// unqualified Cardmarket product in the English expansion proven above, and
// one unqualified TCGplayer product in the exact released group.
const baseCardmarketMatches = new Map();
const baseTcgplayerMatches = new Map();
const exactMappingsByGroup = new Map(tcgcsvMarketSources.map((source) => [source.abbreviation, 0]));
const ambiguousCardmarketBaseMappings = [];
const cardmarketBasePricesUnavailable = [];
const ambiguousBaseTcgplayerNumbers = [];
const optcgBaseCandidatesMissingOrAmbiguous = [];
for (const source of tcgcsvMarketSources) {
  const expansion = cardmarketExpansionEvidenceByGroup.get(source.groupId);
  const tcgplayerProductsByNumber = groupBy(
    source.products.filter((product) => tcgcsvCardNumber(product) && isBaseTcgcsvSetProduct(product)),
    tcgcsvCardNumber,
  );
  for (const [number, tcgplayerCandidates] of tcgplayerProductsByNumber) {
    const optcgCandidates = uniqueCoreCards.filter((card) =>
      regularRulesCardId(card) === number && isExactOptcgBaseCandidateForGroup(card, source),
    );
    if (optcgCandidates.length !== 1) {
      optcgBaseCandidatesMissingOrAmbiguous.push({
        abbreviation: source.abbreviation,
        number,
        candidatePrintingIds: optcgCandidates.map((card) => card.card_image_id),
      });
      continue;
    }
    if (tcgplayerCandidates.length !== 1) {
      ambiguousBaseTcgplayerNumbers.push({
        abbreviation: source.abbreviation,
        number,
        candidateProductIds: tcgplayerCandidates.map((product) => Number(product.productId)),
      });
      continue;
    }

    const cardmarketProducts = (productsByNumber.get(number) ?? [])
      .filter((product) => Number(product.idExpansion) === expansion.idExpansion);
    if (cardmarketProducts.length !== 1) {
      ambiguousCardmarketBaseMappings.push({
        abbreviation: source.abbreviation,
        number,
        candidateProductIds: cardmarketProducts.map((product) => Number(product.idProduct)),
      });
      continue;
    }
    const cardmarketProduct = cardmarketProducts[0];
    const cardmarketPrice = cardmarketPricesByProduct.get(cardmarketProduct.idProduct);
    if (cardmarketPrice?.trend == null) {
      cardmarketBasePricesUnavailable.push({
        abbreviation: source.abbreviation,
        number,
        productId: Number(cardmarketProduct.idProduct),
      });
      continue;
    }

    const card = optcgCandidates[0];
    const product = tcgplayerCandidates[0];
    const priceRows = tcgcsvPriceRows(source.priceIndex, product.productId);
    const price = exactTcgcsvPrice(source.priceIndex, product.productId);
    const identity = printingIdentity(card);
    if (baseCardmarketMatches.has(identity) || baseTcgplayerMatches.has(identity)) {
      throw new Error(`Cross-market printing mapped twice: ${source.abbreviation} ${number}.`);
    }
    baseCardmarketMatches.set(identity, {
      card,
      number,
      source,
      product: cardmarketProduct,
      price: cardmarketPrice,
    });
    baseTcgplayerMatches.set(identity, {
      product,
      price,
      priceRows,
      groupId: source.groupId,
      abbreviation: source.abbreviation,
    });
    exactMappingsByGroup.set(source.abbreviation, exactMappingsByGroup.get(source.abbreviation) + 1);
  }
}
if (baseCardmarketMatches.size !== baseTcgplayerMatches.size) {
  throw new Error('Cross-market provider mappings lost one-to-one cardinality.');
}
for (const [identity, match] of baseCardmarketMatches) {
  if (identity !== printingIdentity(match.card)
    || !match.source.memberSetCodes.includes(setCodeFromNumber(match.number))
    || !baseTcgplayerMatches.has(identity)) {
    throw new Error(`Cross-market membership invariant failed for ${match.source.abbreviation} ${match.number}.`);
  }
}

const generatedAt = new Date().toISOString();
const coreCardAssets = uniqueCoreCards.map((card) => {
  const number = rulesCardId(card);
  const canonicalName = card.__source === 'don'
    ? String(card.optcg_don_name ?? card.card_name ?? 'DON!! Card').trim()
    : nameByRulesCard.get(number) ?? String(card.card_name ?? number).trim();
  const exactPrintingIdentity = printingIdentity(card);
  const cardmarketMatch = baseCardmarketMatches.get(exactPrintingIdentity) ?? null;
  const cardmarketPrice = cardmarketMatch?.price ?? null;
  const baseTcgplayerMatch = baseTcgplayerMatches.get(exactPrintingIdentity) ?? null;
  const starterEnrichment = card.__source === 'starter'
    ? starterEnrichments.get(`${number}|${card.card_name}`) ?? null
    : null;
  const imageUrl = trustedCardImage(card) ?? starterEnrichment?.imageUrl ?? null;
  const tcgplayerPrice = baseTcgplayerMatch?.price ?? starterEnrichment?.price ?? null;
  const stableId = cardStableId(card);
  const optcgDate = String(card.date_scraped ?? generatedAt);

  return {
    id: stableId,
    kind: 'card',
    name: canonicalName,
    set: setNameForCard(card),
    setCode: setCodeForCard(card, number),
    number,
    rulesCardId: number,
    printingId: printingId(card),
    sourcePrintingId: card.card_image_id ?? null,
    cardmarketProductId: cardmarketMatch?.product.idProduct ?? null,
    cardmarketExpansionId: cardmarketMatch?.product.idExpansion ?? null,
    tcgplayerProductId: baseTcgplayerMatch?.product.productId ?? starterEnrichment?.product.productId ?? null,
    ...(baseTcgplayerMatch ? {
      tcgplayerGroupId: baseTcgplayerMatch.groupId,
      tcgplayerGroupAbbreviation: baseTcgplayerMatch.abbreviation,
      tcgplayerMappingEvidence: 'Exact released English booster group + printed number + unique unqualified base product',
    } : {}),
    rarity: RARITIES[card.rarity] ?? card.rarity ?? 'Unknown',
    variant: variantLabel(card, canonicalName),
    language: 'English',
    condition: 'Near Mint',
    quantity: 1,
    addedAt: generatedAt,
    color: colorFor(stableId),
    ...(imageUrl ? { imageUrl } : {}),
    imageState: imageUrl ? 'available' : 'unavailable',
    ...(imageUrl ? {} : { imageUnavailableReason: 'The OPTCG source record does not provide an artwork URL.' }),
    usPriceSource: baseTcgplayerMatch || starterEnrichment ? 'TCGplayer via TCGCSV' : 'OPTCG API',
    quote: {
      cardmarket: round(cardmarketPrice?.trend),
      tcgplayer: baseTcgplayerMatch || starterEnrichment ? round(tcgplayerPrice?.marketPrice) : round(card.market_price),
    },
    change: {
      cardmarket: cardmarketPrice ? {
        '1D': percentAgainst(cardmarketPrice.trend, cardmarketPrice.avg1),
        '1W': percentAgainst(cardmarketPrice.trend, cardmarketPrice.avg7),
        '1M': percentAgainst(cardmarketPrice.trend, cardmarketPrice.avg30),
      } : emptyChanges(),
      tcgplayer: emptyChanges(),
    },
    pricing: {
      cardmarket: pricingDetails(cardmarketPrice),
      usMarket: baseTcgplayerMatch
        ? tcgcsvPricingDetails(tcgplayerPrice, baseTcgplayerMatch.priceRows)
        : starterEnrichment ? tcgcsvPricingDetails(tcgplayerPrice) : {
        market: round(card.market_price),
        inventory: round(card.inventory_price),
        source: 'OPTCG API',
      },
    },
    sourceUpdatedAt: {
      cardmarket: priceGuide.createdAt,
      optcg: optcgDate,
      ...(baseTcgplayerMatch || starterEnrichment ? { tcgcsv: tcgcsvCreatedAt } : {}),
    },
  };
});

function bestOptcgRecord(records) {
  return records.reduce((best, record) => (best ? preferRecord(best, record) : record), null);
}

const promoAssets = numberedTcgcsvPromoProducts.map((product) => {
  const number = tcgcsvCardNumber(product);
  const promoCandidates = optcgPromoByNumber.get(number) ?? [];
  const exactNameCandidates = promoCandidates.filter((card) => card.card_name === product.name);
  const metadata = bestOptcgRecord(exactNameCandidates)
    ?? bestOptcgRecord(promoCandidates)
    ?? bestOptcgRecord(optcgRulesByNumber.get(number) ?? []);
  const rulesMetadataMatch = exactNameCandidates.length > 0
    ? 'OPTCG promo number + exact title'
    : promoCandidates.length > 0
      ? 'OPTCG promo number'
      : metadata
        ? 'OPTCG rules number'
        : 'TCGCSV extended fields only';
  const canonicalName = nameByRulesCard.get(number) ?? promoFallbackName(product) ?? number;
  const stableId = promoStableId(product);
  const imageUrl = tcgcsvImageUrl(product);
  const priceRows = tcgcsvPriceRows(tcgcsvPromoPriceIndex, product.productId);
  const price = exactTcgcsvPrice(tcgcsvPromoPriceIndex, product.productId);
  const rarity = tcgcsvExtendedValue(product, 'Rarity') ?? metadata?.rarity ?? 'Unknown';
  const language = tcgcsvLanguage(product.name);
  const optcgDate = String(metadata?.date_scraped ?? generatedAt);

  return {
    id: stableId,
    kind: 'card',
    name: canonicalName,
    productName: product.name,
    set: 'One Piece Promotion Cards',
    setCode: normalizeSetCode(metadata?.set_id, setCodeFromNumber(number)),
    number,
    rulesCardId: number,
    printingId: `tcgplayer:${product.productId}`,
    sourcePrintingId: `tcgplayer:${product.productId}`,
    tcgplayerProductId: Number(product.productId),
    cardmarketProductId: null,
    cardmarketExpansionId: null,
    rarity: RARITIES[rarity] ?? rarity,
    variant: tcgcsvPromoVariantLabel(product, canonicalName),
    language,
    languageEvidence: language === 'Japanese'
      ? 'Explicit Japanese Anniversary/Version product title'
      : 'TCGplayer English-market product record',
    condition: 'Near Mint',
    quantity: 1,
    addedAt: generatedAt,
    color: colorFor(stableId),
    ...(imageUrl ? { imageUrl } : {}),
    imageState: imageUrl ? 'available' : 'unavailable',
    ...(imageUrl ? {} : {
      imageUnavailableReason: BROKEN_TCGPLAYER_IMAGE_PRODUCT_IDS.has(Number(product.productId))
        ? 'The source catalog URL was verified to return HTTP 403, and no exact source-backed replacement was found.'
        : 'TCGCSV does not provide a trusted artwork URL for this exact product.',
    }),
    rulesMetadataMatch,
    usPriceSource: 'TCGplayer via TCGCSV',
    tcgplayerPriceState: priceRows.length > 1
      ? 'multiple-subtypes'
      : price?.marketPrice != null
        ? 'available'
        : price
          ? 'market-unavailable'
          : 'unavailable',
    quote: {
      cardmarket: null,
      tcgplayer: round(price?.marketPrice),
    },
    change: {
      cardmarket: emptyChanges(),
      tcgplayer: emptyChanges(),
    },
    pricing: {
      cardmarket: pricingDetails(null),
      usMarket: tcgcsvPricingDetails(price, priceRows),
    },
    sourceUpdatedAt: {
      cardmarket: priceGuide.createdAt,
      optcg: optcgDate,
      tcgcsv: tcgcsvCreatedAt,
    },
  };
});

const cardAssets = [...coreCardAssets, ...promoAssets];

const sealedAssets = nonSinglesCatalog.products
  .filter((product) => SEALED_CATEGORIES.has(product.categoryName))
  .filter((product) => !NON_ENGLISH_SEALED.test(product.name))
  .map((product) => ({ product, price: cardmarketPricesByProduct.get(product.idProduct) }))
  .filter(({ price }) => price?.trend != null)
  .map(({ product, price }) => {
    const category = SEALED_CATEGORIES.get(product.categoryName);
    const stableId = `sealed-cardmarket-${product.idProduct}`;
    return {
      id: stableId,
      kind: 'sealed',
      name: product.name,
      set: product.categoryName.replace(/^One Piece\s+/, ''),
      setCode: sealedSetCode(product, category),
      rarity: 'Sealed',
      variant: 'English release',
      productType: category.productType,
      language: 'English',
      condition: 'Factory sealed',
      quantity: 1,
      addedAt: generatedAt,
      color: colorFor(stableId),
      cardmarketProductId: product.idProduct,
      cardmarketExpansionId: product.idExpansion,
      quote: {
        cardmarket: round(price.trend),
        tcgplayer: null,
      },
      change: {
        cardmarket: {
          '1D': percentAgainst(price.trend, price.avg1),
          '1W': percentAgainst(price.trend, price.avg7),
          '1M': percentAgainst(price.trend, price.avg30),
        },
        tcgplayer: emptyChanges(),
      },
      pricing: {
        cardmarket: pricingDetails(price),
        usMarket: { market: null, inventory: null },
      },
      sourceUpdatedAt: {
        cardmarket: priceGuide.createdAt,
        // Sealed products have no OPTCG quote; this is the local snapshot time
        // retained for compatibility with the shared acquisition-source shape.
        optcg: generatedAt,
      },
    };
  });

cardAssets.sort((left, right) =>
  left.setCode.localeCompare(right.setCode)
  || left.number.localeCompare(right.number)
  || left.variant.localeCompare(right.variant)
  || left.id.localeCompare(right.id),
);
sealedAssets.sort((left, right) =>
  left.productType.localeCompare(right.productType)
  || left.name.localeCompare(right.name)
  || left.id.localeCompare(right.id),
);

const initialBaseMatches = INITIAL_SET_CODES.flatMap((code, setIndex) => {
  const wanted = setIndex < 5 ? 6 : 5;
  return [...baseCardmarketMatches.values()]
    .filter((match) => setCodeFromNumber(match.number) === code)
    .sort((left, right) => right.price.trend - left.price.trend)
    .slice(0, wanted);
});
const initialAssetIds = initialBaseMatches.map((match) => cardStableId(match.card));

if (initialAssetIds.length !== 40 || new Set(initialAssetIds).size !== 40) {
  throw new Error(`Expected 40 unique representative base holdings, found ${initialAssetIds.length}.`);
}
const emittedIds = new Set([...cardAssets, ...sealedAssets].map((asset) => asset.id));
if (initialAssetIds.some((id) => !emittedIds.has(id))) {
  throw new Error('A representative holding is missing from the emitted full catalog.');
}
if (emittedIds.size !== cardAssets.length + sealedAssets.length) {
  throw new Error('Stable catalog ID collision detected. Refusing to emit ambiguous assets.');
}
if (coreCardAssets.length !== uniqueCoreCards.length) {
  throw new Error('A set, starter, or DON!! printing was lost while building assets.');
}
if (promoAssets.length !== numberedTcgcsvPromoProducts.length) {
  throw new Error('A numbered TCGCSV promo product was lost while building assets.');
}
if (promoAssets.some((asset) => asset.language !== 'English' && asset.language !== 'Japanese')) {
  throw new Error('Unsupported promo language emitted.');
}
if ([...cardAssets, ...sealedAssets].some((asset) => asset.language === 'German')) {
  throw new Error('German must never be emitted without a source-backed product.');
}
const brokenPromoAssets = promoAssets.filter((asset) => BROKEN_TCGPLAYER_IMAGE_PRODUCT_IDS.has(asset.tcgplayerProductId));
if (brokenPromoAssets.length !== BROKEN_TCGPLAYER_IMAGE_PRODUCT_IDS.size || brokenPromoAssets.some((asset) => asset.imageState !== 'unavailable')) {
  throw new Error('The three verified-broken Welcome Pack images must remain explicitly unavailable.');
}
for (const source of TCGCSV_STARTER_SOURCES) {
  const asset = coreCardAssets.find((candidate) => candidate.tcgplayerProductId === source.productId);
  if (!asset || asset.number !== source.number || asset.imageState !== 'available') {
    throw new Error(`Exact starter enrichment ${source.productId} was not emitted correctly.`);
  }
}

const optcgDates = uniqueOptcgCards
  .map((card) => card.date_scraped)
  .filter(Boolean)
  .sort();
const promoAssetsWithImages = promoAssets.filter((asset) => asset.imageState === 'available');
const promoAssetsWithPrices = promoAssets.filter((asset) => asset.quote.tcgplayer != null);
const promoAssetsWithMultiplePriceSubtypes = promoAssets.filter((asset) => asset.tcgplayerPriceState === 'multiple-subtypes');
const promoAssetsWithPriceRowsButNoMarket = promoAssets.filter((asset) => asset.tcgplayerPriceState === 'market-unavailable');
const promoAssetsWithoutPriceRows = promoAssets.filter((asset) => asset.tcgplayerPriceState === 'unavailable');
const promoAssetsWithOptcgRules = promoAssets.filter((asset) => asset.rulesMetadataMatch !== 'TCGCSV extended fields only');
const japanesePromoAssets = promoAssets.filter((asset) => asset.language === 'Japanese');
const exactCrossMarketAssets = coreCardAssets.filter((asset) =>
  asset.cardmarketProductId != null
  && asset.tcgplayerProductId != null
  && asset.usPriceSource === 'TCGplayer via TCGCSV'
  && asset.quote.cardmarket != null
  && asset.quote.tcgplayer != null,
);
const releasedNonPremiumGroups = tcgcsvMarketSources.filter((source) => !source.abbreviation.startsWith('PRB-'));
const groupsWithoutExactMappings = tcgcsvMarketSources
  .filter((source) => exactMappingsByGroup.get(source.abbreviation) === 0)
  .map((source) => source.abbreviation);
const requiredGroupsWithoutExactMappings = releasedNonPremiumGroups
  .filter((source) => exactMappingsByGroup.get(source.abbreviation) === 0)
  .map((source) => source.abbreviation);
if (requiredGroupsWithoutExactMappings.length > 0) {
  throw new Error(`Released main/Extra Booster groups lost all exact mappings: ${requiredGroupsWithoutExactMappings.join(', ')}.`);
}
if (baseTcgplayerMatches.size < 800 || exactCrossMarketAssets.length < 750) {
  throw new Error(`Exact cross-market coverage unexpectedly fell to ${baseTcgplayerMatches.size} mappings / ${exactCrossMarketAssets.length} priced cards.`);
}
const output = {
  generatedAt,
  provenance: {
    matchingPolicy: 'OPTCG remains printing truth for sets, starter decks, and DON!! cards. Numbered TCGCSV/TCGplayer products are printing truth for promotional cards and join to OPTCG by printed card number only for rules metadata. Cross-market comparisons cover every Bandai-confirmed released English OP, EB, and PRB booster group available in TCGCSV. A row requires one exact OPTCG standard printing in that release, one unique unqualified Cardmarket product in an English expansion proven by exact lot-code or English sealed-title evidence, and one unique unqualified TCGplayer product in the exact group. Combined OP14-EB04 and OP15-EB04 releases explicitly accept both member card-number families. PRB reprints without exact cross-provider art identity remain excluded. Promo identity, artwork, and USD price stay bound to the same TCGplayer productId; ambiguous rows are never guessed. Explicit Japanese Anniversary/Version products are Japanese, other TCGplayer English-market products are English, and German is never invented.',
    englishExpansionIds,
    englishExpansionEvidence: tcgcsvMarketSources.map((source) => ({
      tcgcsvAbbreviation: source.abbreviation,
      tcgcsvGroupId: source.groupId,
      officialEnglishReleasedOn: source.releasedOn,
      memberSetCodes: source.memberSetCodes,
      cardmarketExpansionId: cardmarketExpansionEvidenceByGroup.get(source.groupId).idExpansion,
      policy: cardmarketExpansionEvidenceByGroup.get(source.groupId).policy,
      evidenceProductIds: cardmarketExpansionEvidenceByGroup.get(source.groupId).evidenceProductIds,
    })),
    englishReleaseManifest: {
      source: BANDAI_ENGLISH_PRODUCTS,
      auditedAt: '2026-07-19',
      policy: 'Exact TCGCSV abbreviation must exist in this Bandai English retail-date manifest and its retail date must be on or before generation time.',
      futureProductsExcluded: [...ENGLISH_MARKET_RELEASES.entries()]
        .filter(([, release]) => Date.parse(`${release.releasedOn}T00:00:00Z`) > Date.parse(generatedAt))
        .map(([abbreviation, release]) => ({ abbreviation, ...release })),
    },
    crossMarketCoverage: {
      exactMappingsByGroup: Object.fromEntries(exactMappingsByGroup),
      releasedGroupsWithoutExactStandardMappings: groupsWithoutExactMappings,
      ambiguityPolicy: 'Missing or multiple candidates are excluded; market price is never used to choose a product identity.',
      ambiguousCardmarketSamples: ambiguousCardmarketBaseMappings.slice(0, 25),
      unavailableCardmarketPriceSamples: cardmarketBasePricesUnavailable.slice(0, 25),
      ambiguousTcgplayerSamples: ambiguousBaseTcgplayerNumbers.slice(0, 25),
      missingOrAmbiguousOptcgSamples: optcgBaseCandidatesMissingOrAmbiguous.slice(0, 25),
    },
    catalogCounts: {
      rawOptcgRecords: rawCards.length,
      rawOptcgPromoRecords: rawPromoCards.length,
      rawOptcgCoreRecords: rawCoreCards.length,
      sourceRecordsWithoutTrustedImage: rawCards.length - trustedImageRecords.length,
      deduplicatedOptcgPrintingRecords: rawCards.length - uniqueOptcgCards.length,
      optcgCorePrintings: coreCardAssets.length,
      tcgcsvPromoProducts: tcgcsvPromoProducts.length,
      tcgcsvNumberedPromoProducts: numberedTcgcsvPromoProducts.length,
      tcgcsvNonNumberedPromoProductsExcluded: tcgcsvPromoProducts.length - numberedTcgcsvPromoProducts.length,
      tcgcsvNumberedPromoRulesCards: new Set(numberedTcgcsvPromoProducts.map(tcgcsvCardNumber)).size,
      tcgcsvPromoPrintingsWithOptcgRules: promoAssetsWithOptcgRules.length,
      tcgcsvPromoPrintingsWithoutOptcgRules: promoAssets.length - promoAssetsWithOptcgRules.length,
      tcgcsvPromoPrintingsWithPrices: promoAssetsWithPrices.length,
      tcgcsvPromoPrintingsWithoutHeadlinePrice: promoAssets.length - promoAssetsWithPrices.length,
      tcgcsvPromoPrintingsWithMultiplePriceSubtypes: promoAssetsWithMultiplePriceSubtypes.length,
      tcgcsvPromoPrintingsWithPriceRowsButNoMarket: promoAssetsWithPriceRowsButNoMarket.length,
      tcgcsvPromoPrintingsWithoutPriceRows: promoAssetsWithoutPriceRows.length,
      tcgcsvPromoPrintingsWithImages: promoAssetsWithImages.length,
      tcgcsvPromoPrintingsWithoutImages: promoAssets.length - promoAssetsWithImages.length,
      tcgcsvPromoVerifiedHighResolutionImages: promoAssetsWithImages.filter((asset) => /_in_1000x1000\.jpg$/i.test(asset.imageUrl)).length,
      englishPromoPrintings: promoAssets.length - japanesePromoAssets.length,
      japanesePromoPrintings: japanesePromoAssets.length,
      cardPrintings: cardAssets.length,
      cardPrintingsWithImages: cardAssets.filter((asset) => asset.imageState === 'available').length,
      cardPrintingsWithoutImages: cardAssets.filter((asset) => asset.imageState === 'unavailable').length,
      cardmarketMappedBaseArts: cardAssets.filter((asset) => asset.cardmarketProductId != null).length,
      tcgplayerMappedBaseArts: baseTcgplayerMatches.size,
      exactCrossMarketComparablePrices: exactCrossMarketAssets.length,
      tcgcsvCategoryGroups: tcgcsvGroups.length,
      releasedEnglishMarketGroups: tcgcsvMarketSources.length,
      releasedEnglishMainGroups: tcgcsvMarketSources.filter((source) => mainSetOrdinalForGroup(source.group) != null).length,
      releasedEnglishSpecialGroups: tcgcsvMarketSources.filter((source) => mainSetOrdinalForGroup(source.group) == null).length,
      releasedGroupsWithoutExactStandardMappings: groupsWithoutExactMappings.length,
      ambiguousCardmarketBaseMappingsExcluded: ambiguousCardmarketBaseMappings.length,
      exactCardmarketProductsWithoutTrendExcluded: cardmarketBasePricesUnavailable.length,
      ambiguousTcgplayerBaseMappingsExcluded: ambiguousBaseTcgplayerNumbers.length,
      missingOrAmbiguousOptcgBaseCandidatesExcluded: optcgBaseCandidatesMissingOrAmbiguous.length,
      englishSealedProducts: sealedAssets.length,
      totalAssets: cardAssets.length + sealedAssets.length,
      representativeInitialHoldings: initialAssetIds.length,
    },
    cardmarket: {
      source: CARDMARKET_PRICES,
      catalog: CARDMARKET_PRODUCTS,
      nonSinglesCatalog: CARDMARKET_NONSINGLES,
      createdAt: priceGuide.createdAt,
      priceField: 'trend',
      currency: 'EUR',
      expansionEvidencePolicy: 'Exact Cardmarket lot suffix for OP/EB releases; exact packaging-free English booster plus booster-box title for PRB releases. Multiple expansion IDs fail the sync.',
      sealedCategories: [...SEALED_CATEGORIES.keys()],
      sealedExclusions: ['Lots', 'Non-English', 'Japanese', 'Asia Region'],
    },
    tcgcsv: {
      source: 'https://tcgcsv.com/docs',
      lastUpdated: TCGCSV_UPDATED_AT,
      groups: TCGCSV_GROUPS,
      createdAt: tcgcsvCreatedAt,
      categoryId: TCGCSV_CATEGORY_ID,
      promoGroupId: TCGCSV_PROMO_GROUP_ID,
      promoProducts: TCGCSV_PROMO_PRODUCTS,
      promoPrices: TCGCSV_PROMO_PRICES,
      starterGroups: TCGCSV_STARTER_GROUP_IDS,
      mainSetGroups: Object.fromEntries(tcgcsvMarketSources.map((source) => [source.abbreviation, source.groupId])),
      marketGroups: Object.fromEntries(tcgcsvMarketSources.map((source) => [source.abbreviation, {
        groupId: source.groupId,
        name: source.group.name,
        tcgcsvPublishedOn: source.group.publishedOn,
        officialEnglishReleasedOn: source.releasedOn,
        memberSetCodes: source.memberSetCodes,
        cardmarketExpansionId: cardmarketExpansionEvidenceByGroup.get(source.groupId).idExpansion,
        exactMappings: exactMappingsByGroup.get(source.abbreviation),
      }])),
      priceField: 'marketPrice',
      currency: 'USD',
      role: 'Direct TCGplayer product identity and product-specific USD price for every exactly mapped released English OP/EB/PRB standard printing and promotional printing; exact enrichment for two missing starter images',
      imagePolicy: 'Use the source imageUrl. Upgrade only the audited productId allowlist to TCGplayer’s documented _in_1000x1000 derivative. Keep verified HTTP 403 products explicitly unavailable.',
      usagePolicy: 'Backend snapshot sync with a custom User-Agent; no browser-side polling.',
      verifiedBrokenImageProductIds: [...BROKEN_TCGPLAYER_IMAGE_PRODUCT_IDS],
    },
    optcg: {
      source: 'https://optcgapi.com/documentation',
      feeds: OPTCG_FEEDS.map((feed) => feed.url),
      createdAt: optcgDates.at(-1) ?? generatedAt,
      priceField: 'market_price',
      currency: 'USD',
      role: 'Set, starter-deck, and DON!! printing truth; promotional rules metadata joined by card number; US market reference for non-promo printings',
    },
    exchangeRate: {
      ...exchangeRate,
      direction: 'USD per EUR',
      role: 'Currency normalization for derived TCGplayer USD / Cardmarket EUR ratios',
    },
  },
  initialAssetIds,
  assets: [...cardAssets, ...sealedAssets],
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${cardAssets.length} card printings (${output.provenance.catalogCounts.cardPrintingsWithImages} with images, ${output.provenance.catalogCounts.cardPrintingsWithoutImages} explicitly unavailable) and ${sealedAssets.length} English sealed products to ${OUTPUT}`);
console.log(`TCGCSV promo printings: ${promoAssets.length} (${promoAssetsWithPrices.length} headline market prices, ${promoAssetsWithMultiplePriceSubtypes.length} multi-subtype price sets, ${promoAssetsWithoutPriceRows.length} without price rows, ${japanesePromoAssets.length} explicitly Japanese)`);
console.log(`Representative initial holdings: ${initialAssetIds.length}`);
console.log(`Cardmarket-mapped base arts: ${output.provenance.catalogCounts.cardmarketMappedBaseArts}`);
console.log(`Released English market groups: ${tcgcsvMarketSources.length} (${tcgcsvMarketSources.map((source) => source.abbreviation).join(', ')})`);
console.log(`Exact cross-market mappings: ${baseTcgplayerMatches.size} (${exactCrossMarketAssets.length} with both market prices; ${ambiguousCardmarketBaseMappings.length} Cardmarket and ${ambiguousBaseTcgplayerNumbers.length} TCGplayer ambiguities excluded; ${cardmarketBasePricesUnavailable.length} exact Cardmarket products lacked trend prices)`);
if (groupsWithoutExactMappings.length > 0) console.log(`Released groups with no exact standard mapping: ${groupsWithoutExactMappings.join(', ')}`);
console.log(`Cardmarket snapshot: ${priceGuide.createdAt}`);
console.log(`TCGCSV snapshot: ${tcgcsvCreatedAt}`);
console.log(`OPTCG snapshot: ${output.provenance.optcg.createdAt}`);
console.log(`ECB USD per EUR: ${exchangeRate.usdPerEur} (${exchangeRate.observationDate})`);

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import {
  activeManagedRowsMissingFromPlan,
  activeCatalogRemovalApprovalIds,
  assertManagedCatalogContinuity,
  assertSnapshotCanAdvanceProviders,
  catalogSetCodeIsReleased,
  officialMemberSetCodesFromLabel,
  officialProductCodeFromTitle,
  officialSetCodeReleaseState,
  pricingConditionForAsset,
  productLevelMappingMetadata,
  providerMappingCanReuseActiveIdentity,
  providerMappingVersionSeed,
} from './lib/catalog-ingestion-plan.mjs';
import {
  assertCardmarketMappingContinuity,
  matchCardmarketReleaseProducts,
} from './lib/cardmarket-mapping-v8.mjs';
import {
  CARDMARKET_REGULAR_ART_POLICY_V1,
  artworkCorrelationV1,
  cardmarketProductImageUrlsV1,
  chooseRegularArtImageMatchV1,
  fingerprintArtworkImageV1,
  hasCompleteArtworkCandidateSetV2,
  mapWithConcurrencyV1,
} from './lib/cardmarket-regular-art-v1.mjs';
import {
  CARDMARKET_SEALED_IMAGE_POLICY_V1,
  cardmarketSealedImageUrlsV1,
  immutableSealedImagePathV1,
  normalizeSealedProductImageV1,
  sealedImageCacheSourceMatchesV1,
} from './lib/cardmarket-sealed-images-v1.mjs';
import {
  chooseTcgplayerArtworkImageMatchV1,
  compareTcgplayerArtworkDiscoveryPriorityV1,
  hasCompleteTcgplayerArtworkCandidateSetV1,
  reusableTcgplayerArtworkReferenceV1,
  tcgplayerArtworkRefreshScheduledV1,
  TCGPLAYER_ARTWORK_MAPPING_POLICY_V1,
} from './lib/tcgplayer-artwork-mapping-v1.mjs';
import {
  cardmarketPromoPrintedNumberV1,
  cardmarketPromoProductImageUrlsV1,
  choosePromoCrossMarketImageMatchesV1,
  hasCompletePromoArtworkCandidateMatrixV1,
  PROMO_CROSS_MARKET_MAPPING_POLICY_V1,
  validateCardmarketPromoExpansionRegistryV1,
} from './lib/promo-cross-market-mapping-v1.mjs';
import {
  cardmarketProductPageReleaseAuditV1,
  cardmarketProductPageUrlV1,
  isCanonicalCardmarketSealedProductV1,
} from './lib/cardmarket-sealed-release-v1.mjs';
import {
  fetchJsonWithRetryV8,
  fetchSequentiallyWithPauseV8,
  fetchTextWithRetryV8,
} from './lib/resilient-fetch-v8.mjs';
import {
  previousBandaiReleaseContinuityV2,
  retryReleaseManifestValidationV2,
} from './lib/bandai-release-continuity-v2.mjs';
import { parseBandaiProductsPageV10 } from './lib/bandai-products-archive-v10.mjs';
import {
  buildReleasedSealedSetCodeByExpansionV1,
  normalizedDeckProductTitleV1,
  resolveSealedSetCodeV1,
} from './lib/sealed-set-classification-v1.mjs';
import {
  assertOptcgCacheCoversReleasedSetsV1,
  buildOptcgSourceCacheV1,
  loadOptcgFeedsWithCacheV1,
  OPTCG_FEEDS_V1,
  serializeOptcgSourceCacheV1,
} from './lib/optcg-source-cache-v1.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// v10 promotes independently image-verified Cardmarket artwork identities into
// exact collection mappings and mirrors verified sealed imagery locally because
// Cardmarket intentionally blocks browser hotlinks.
// Candidate price/order is never used as artwork identity.
const PREVIOUS_OUTPUT = resolve(ROOT, 'src/data/generated/onepiece-market-v9.json');
const OUTPUT = resolve(ROOT, 'src/data/generated/onepiece-market-v10.json');
const OPTCG_CACHE = resolve(ROOT, 'scripts/data/optcg-source-cache-v1.json');
const CARDMARKET_PROMO_EXPANSION_REGISTRY = resolve(
  ROOT,
  'scripts/data/cardmarket-promo-expansions-v1.json',
);
const SEALED_IMAGE_PUBLIC_ROOT = resolve(ROOT, 'public/catalog/sealed/v1');
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
const BANDAI_ENGLISH_PRODUCTS = 'https://en.onepiece-cardgame.com/products/';
const BANDAI_PRODUCTS_MAX_PAGES = 40;
// ST-05 uses Bandai's older standalone deck page and can disappear from the
// paginated archive markup even though its official product page remains live.
// Keep that exact first-party release evidence as a continuity record so a
// transient archive omission can never retire user-held cards.
const OFFICIAL_RELEASE_CONTINUITY = [{
  category: 'decks',
  officialCode: 'ST-05',
  title: 'STARTER DECK ONE PIECE FILM edition [ST-05]',
  releasedOn: '2023-02-03',
  releaseLabel: 'February 3, 2023',
  releasePrecision: 'day',
  productUrl: 'https://en.onepiece-cardgame.com/products/decks/st05.php',
  page: 0,
  continuityEvidence: 'Official Bandai standalone product page',
}];
const REQUIRED_RELEASED_SPECIAL_GROUPS = ['EB-01', 'EB-02', 'EB-03', 'PRB-01', 'PRB-02'];
// Bandai calls the January 2026 product OP14-EB04, while TCGCSV identifies the
// exact English market group as OP14. Keep the one audited alias explicit; all
// other current/future codes are derived without a hand-maintained release list.
const OFFICIAL_TO_TCGCSV_GROUP_OVERRIDES = new Map([['OP14-EB04', 'OP14']]);
const TCGCSV_PROMO_GROUP_ID = 17675;
const TCGCSV_PROMO_PRODUCTS = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${TCGCSV_PROMO_GROUP_ID}/products`;
const TCGCSV_PROMO_PRICES = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${TCGCSV_PROMO_GROUP_ID}/prices`;
const ECB_USD_PER_EUR = 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata&detail=dataonly';
const ECB_SERIES_KEY = 'EXR.D.USD.EUR.SP00.A';
const ECB_TRANSIENT_FALLBACK_MAX_AGE_MS_V10 = 7 * 24 * 60 * 60_000;
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
// Exact fallback artwork is allowlisted only where the public product record
// proves the printed card/product identity and the image endpoint is stable.
const EXACT_TCGPLAYER_IMAGE_OVERRIDES = new Map([
  [599735, 'https://storage.googleapis.com/images.pricecharting.com/sm3klbepvctxi6zj/1600.jpg'],
  [599737, 'https://storage.googleapis.com/images.pricecharting.com/xzrhxe6jku55h5f5/1600.jpg'],
  [599739, 'https://storage.googleapis.com/images.pricecharting.com/gz5twp7csl4nfy7i/1600.jpg'],
]);
const EXACT_OPTCG_IMAGE_OVERRIDES = new Map([
  ['don_169', 'https://tcgplayer-cdn.tcgplayer.com/product/655121_in_1000x1000.jpg'],
  ['don_181', 'https://tcgplayer-cdn.tcgplayer.com/product/677567_in_1000x1000.jpg'],
  ['don_132', 'https://storage.googleapis.com/images.pricecharting.com/correbdfe4st6ypotkzb/1600.jpg'],
  ['don_185', 'https://tcgplayer-cdn.tcgplayer.com/product/698314_in_1000x1000.jpg'],
]);
const REVIEWED_CARDMARKET_ARTWORK_MAPPINGS_V10 = new Map([
  ['ST30-015_p1', {
    reviewId: 'ST30-015_p1:891045',
    setCode: 'ST30',
    number: 'ST30-015',
    productId: 891045,
    candidateProductIds: [891044, 891045],
    sourceImageDigest: '452de00828561987c376e6437b485e2e6cdeeefdbe10b6986518524ec16d29d6',
    productImageDigest: '1f8cee42bbd3978245634a81831dcfcfb02124afd507c2b21dd67646d5d4d9db',
    minimumCorrelation: 0.99,
    evidence: 'The complete two-art ST30-015 matrix is mutual unique-best. The alternate art has 0.998232 correlation and was reviewed on 2026-07-23.',
  }],
  ['ST30-015', {
    reviewId: 'ST30-015:891044',
    setCode: 'ST30',
    number: 'ST30-015',
    productId: 891044,
    candidateProductIds: [891044, 891045],
    sourceImageDigest: '98f2dd6317dc2acff78e5ee04b01b5841b9cd39dc6f4d76ea6cc32ac221077b4',
    productImageDigest: '3996fa8add4cf21042eb1b857d49fc1ca12a61d2aa66d6df6c9af37debd0f286',
    minimumCorrelation: 0.99,
    evidence: 'The complete two-art ST30-015 matrix is mutual unique-best. The standard art has 0.998214 correlation and was reviewed on 2026-07-23.',
  }],
  ['ST30-016_p1', {
    reviewId: 'ST30-016_p1:891047',
    setCode: 'ST30',
    number: 'ST30-016',
    productId: 891047,
    candidateProductIds: [891046, 891047],
    sourceImageDigest: 'afa72e60ec26143ebbe6c91261a5796c6c9653882740d03fd49270a0a5f524c2',
    productImageDigest: '9752372af71fcf195d17404866a955bc62cb38c1ea88538af7516c973247566e',
    minimumCorrelation: 0.99,
    evidence: 'The complete two-art ST30-016 matrix is mutual unique-best. The alternate art has 0.998061 correlation and was reviewed on 2026-07-23.',
  }],
  ['ST30-016', {
    reviewId: 'ST30-016:891046',
    setCode: 'ST30',
    number: 'ST30-016',
    productId: 891046,
    candidateProductIds: [891046, 891047],
    sourceImageDigest: '9d8a8e77c2dd537817c083c30781935c6cd2d3fcb5939e0396e055e947e5e366',
    productImageDigest: '4bea59e762dfe6a8b74b4aa12d174fd97164056033f60aea00385d5a11a6a0e2',
    minimumCorrelation: 0.99,
    evidence: 'The complete two-art ST30-016 matrix is mutual unique-best. The standard art has 0.998101 correlation and was reviewed on 2026-07-23.',
  }],
  ['ST30-017_p1', {
    reviewId: 'ST30-017_p1:891049',
    setCode: 'ST30',
    number: 'ST30-017',
    productId: 891049,
    candidateProductIds: [891048, 891049],
    sourceImageDigest: 'be09a10c3c8bb3f93b2fb7518fd73a9762bfa3716127ef7893971e1991669218',
    productImageDigest: '587e1ae9a7072edc0c21da1a9f8d676629687094f7cfdc33e879522599573656',
    minimumCorrelation: 0.99,
    evidence: 'The complete two-art ST30-017 matrix is mutual unique-best. The alternate art has 0.991428 correlation and was reviewed on 2026-07-23.',
  }],
  ['ST30-017', {
    reviewId: 'ST30-017:891048',
    setCode: 'ST30',
    number: 'ST30-017',
    productId: 891048,
    candidateProductIds: [891048, 891049],
    sourceImageDigest: 'abb6919822280a967d19c28ca9257842089f699ff66e57e4df82654d0f0bb765',
    productImageDigest: 'c6d0e3bedc9d78404e094038c7ab02ee970b0dcfbfe7a9d60f46bd06082db1bf',
    minimumCorrelation: 0.99,
    evidence: 'The complete two-art ST30-017 matrix is mutual unique-best. The standard art has 0.998309 correlation and was reviewed on 2026-07-23.',
  }],
]);
if ([...REVIEWED_CARDMARKET_ARTWORK_MAPPINGS_V10].some(([sourcePrintingId, mapping]) => (
  mapping.reviewId !== `${sourcePrintingId}:${mapping.productId}`
  || !/^ST\d{2}$/.test(mapping.setCode)
  || !/^(?:P|OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})-\d{3}$/.test(mapping.number)
  || !Number.isInteger(mapping.productId)
  || mapping.productId <= 0
  || mapping.candidateProductIds.length < 2
  || new Set(mapping.candidateProductIds).size !== mapping.candidateProductIds.length
  || !mapping.candidateProductIds.includes(mapping.productId)
  || !/^[a-f0-9]{64}$/.test(mapping.sourceImageDigest)
  || !/^[a-f0-9]{64}$/.test(mapping.productImageDigest)
  || mapping.minimumCorrelation < 0.9
  || mapping.minimumCorrelation > 1
  || !mapping.evidence
))) {
  throw new Error('A reviewed Cardmarket exact-art mapping is invalid.');
}
// Cardmarket omits ST20 from the two English Charlotte Katakuri product names,
// while Bandai's official title is "Yellow Charlotte Katakuri [ST-20]". These
// stable public product IDs were reviewed as the ST20 deck and deck pack; an
// ID-scoped override avoids a broad color/title heuristic that would collide
// with ST34 Purple Charlotte Katakuri.
const EXACT_CARDMARKET_DECK_SET_CODE_OVERRIDES = new Map([
  [767026, 'ST20'],
  [824426, 'ST20'],
]);
// These Cardmarket presale rows entered a prior snapshot without an explicit
// ST code in their titles. They are now matched to Bandai's future ST31-ST36
// products and are the only reviewed removals allowed by the continuity gate.
const APPROVED_CATALOG_REMOVALS = new Map([
  ['sealed-cardmarket-897426', { reason: 'Unreleased ST31 presale leaked through generic DECK fallback', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897428', { reason: 'Unreleased ST32 presale leaked through generic DECK fallback', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897430', { reason: 'Unreleased ST33 presale leaked through generic DECK fallback', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897432', { reason: 'Unreleased ST34 presale leaked through generic DECK fallback', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897434', { reason: 'Unreleased ST35 presale leaked through generic DECK fallback', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897435', { reason: 'Unreleased ST36 presale leaked through generic DECK fallback', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897417', { reason: 'Cardmarket confirms Illustration Box Vol.7 is a presale until 2026-07-31', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897418', { reason: 'Cardmarket confirms Illustration Box Vol.8 is a presale until 2026-07-31', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897461', { reason: 'Bandai and its UK distributor place Official Playmat Limited Edition Vol.5 at 2026-07-31', expiresAt: '2026-07-31T00:00:00.000Z' }],
  ['sealed-cardmarket-869915', { reason: 'Cardmarket confirms the 3rd English Anniversary Set is a presale until 2026-08-28', expiresAt: '2026-08-28T00:00:00.000Z' }],
  ['sealed-cardmarket-897457', { reason: 'Cardmarket confirms Best Selection Vol.6 is a presale until 2026-08-28', expiresAt: '2026-08-28T00:00:00.000Z' }],
  ['sealed-cardmarket-875688', { reason: 'Unreleased Double Pack Set Vol.12 presale currently exposes Cardmarket placeholder art; re-enters automatically on its 2026-08-28 release date', expiresAt: '2026-08-28T00:00:00.000Z' }],
  ['sealed-cardmarket-897446', { reason: 'Cardmarket confirms the Vol.6 Yamato playmat set is a presale until 2026-12-31', expiresAt: '2026-12-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897455', { reason: 'Cardmarket confirms Best Selection Vol.7 is a presale until 2026-12-31', expiresAt: '2026-12-31T00:00:00.000Z' }],
  ['sealed-cardmarket-897464', { reason: 'Cardmarket confirms the 29th Anniversary Edition is a presale until 2026-12-31', expiresAt: '2026-12-31T00:00:00.000Z' }],
  ['sealed-cardmarket-766870', { reason: 'Empty Devil Fruits packaging is not a sealed card-game product', permanent: true }],
  ['sealed-cardmarket-837880', { reason: 'Empty Devil Fruits packaging is not a sealed card-game product', permanent: true }],
  ['sealed-cardmarket-875170', { reason: 'Empty Tin Pack packaging is not a sealed card-game product', permanent: true }],
  ['sealed-cardmarket-875172', { reason: 'Empty Tin Pack packaging is not a sealed card-game product', permanent: true }],
  ['sealed-cardmarket-875173', { reason: 'Empty Tin Pack packaging is not a sealed card-game product', permanent: true }],
]);
// Exact Cardmarket product identity is append-only by default. Any exceptional
// correction must be reviewed against the artwork, scoped to one stable asset,
// and expire. Keep empty unless a documented upstream correction is proven.
const APPROVED_CARDMARKET_MAPPING_CHANGES = new Map([]);
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
const OPTCG_FEEDS = OPTCG_FEEDS_V1;

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
const UNSUPPORTED_EMPTY_PACKAGING_SEALED_V10 = /(?:^\s*empty\b|\bempty\s+(?:box|display|tin|packaging)\b)/i;
const EXACT_SEALED_LANGUAGE_OVERRIDES_V10 = new Map([
  [695312, { language: 'Japanese', reason: 'The exact Film RED Movie Tutorial Deck packaging and included cards are Japanese.' }],
  [837881, { language: 'French', reason: 'French title and Français packaging; English counterpart 828447 is cataloged separately.' }],
  [837882, { language: 'French', reason: 'French title and Français packaging; English counterpart 828446 is cataloged separately.' }],
  [845917, { language: 'Japanese', reason: 'The July Exchange Meeting 2025 Theme Pack is a Japanese event product with Japanese cards.' }],
  [869914, { language: 'Japanese', reason: 'The ONE PIECE BASE SHOP Limited Card Collection Vol.1 is a Japanese-only physical product.' }],
  [896426, { language: 'Japanese', reason: 'Bandai lists Sound Loader Vol.3 only in its Japanese catalog and the enclosed promo card is Japanese.' }],
  [896427, { language: 'Japanese', reason: 'Sound Loader Vol.4 has Japanese packaging and enclosed Japanese promo cards; no English release is cataloged.' }],
]);
const EXACT_SEALED_REGION_OVERRIDES_V10 = new Map([
  ...[821595, 821596, 821598, 821599, 821600, 821601].map((productId) => [productId, {
    region: 'Asia excluding Japan',
    variant: 'Asia-exclusive English release',
    evidenceUrl: 'https://asia-en.onepiece-cardgame.com/products/other/ts01.php',
  }]),
  ...[848354, 848355, 848356, 848357, 848358, 848359].map((productId) => [productId, {
    region: 'Asia excluding Japan',
    variant: 'Asia-exclusive English release',
    evidenceUrl: 'https://asia-en.onepiece-cardgame.com/products/other/ts02.php',
  }]),
  ...[894157, 894158, 894159, 894160, 894161, 894162].map((productId) => [productId, {
    region: 'Asia excluding Japan',
    variant: 'Asia-exclusive English release',
    evidenceUrl: 'https://asia-en.onepiece-cardgame.com/products/other/ts03.php',
  }]),
  [695312, {
    region: 'Japan',
    variant: 'Japanese release',
    evidenceUrl: 'https://www.onepiece-cardgame.com/',
  }],
  [845917, {
    region: 'Japan',
    variant: 'Japanese event release',
    evidenceUrl: 'https://www.onepiece-cardgame.com/events/2025/officialevents/flagship-battle_03/',
  }],
  [869914, {
    region: 'Japan',
    variant: 'Japanese limited release',
    evidenceUrl: 'https://www.onepiece-cardgame.com/products/other/cardcollection-baseshop001.php',
  }],
  [896426, {
    region: 'Japan',
    variant: 'Japanese Sound Loader release',
    evidenceUrl: 'https://www.onepiece-cardgame.com/products/other/soundloader002.php',
  }],
  [896427, {
    region: 'Japan',
    variant: 'Japanese Sound Loader release',
    evidenceUrl: 'https://www.onepiece-cardgame.com/',
  }],
]);
const EXACT_SEALED_IMAGE_OVERRIDES_V10 = new Map([
  [750070, {
    sourceUrl: 'https://en.onepiece-cardgame.com/images/products/boosters/op07/img_thumbnail.png',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/boosters/op07.php',
    sourceName: 'Bandai official English product page',
  }],
  [752999, {
    sourceUrl: 'https://en.onepiece-cardgame.com/images/products/other/dp03/img_thumbnail.png',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/other/dp03.php',
    sourceName: 'Bandai official English product page',
  }],
  [753000, {
    sourceUrl: 'https://en.onepiece-cardgame.com/images/products/other/dp04/img_thumbnail.png',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/other/dp04.php',
    sourceName: 'Bandai official English product page',
  }],
  [761165, {
    sourceUrl: 'https://en.onepiece-cardgame.com/images/products/other/cardcollection_bcgfest23-24/mv_01.jpg',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/other/cardcollection_bcgfest23-24.php',
      sourceName: 'Bandai official product page',
  }],
  [809495, {
    sourceUrl: 'https://en.onepiece-cardgame.com/images/products/boosters/eb02/img_thumbnail.png',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/boosters/eb02.php',
    sourceName: 'Bandai official English product page',
  }],
  [830649, {
    sourceUrl: 'https://en.onepiece-cardgame.com/images/products/boosters/op12/img_thumbnail.png',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/boosters/op12.php',
    sourceName: 'Bandai official English product page',
  }],
  [840412, {
    sourceUrl: 'https://en.onepiece-cardgame.com/renewal/images/products/boosters/prb02/img_item01.webp',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/boosters/prb02.php',
    sourceName: 'Bandai official English product page',
  }],
  [840415, {
    sourceUrl: 'https://en.onepiece-cardgame.com/renewal/images/products/boosters/prb02/img_item02.webp',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/boosters/prb02.php',
    sourceName: 'Bandai official English product page',
  }],
  [840414, {
    sourceUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/628453_200w.jpg',
    evidenceUrl: 'https://tcgcsv.com/tcgplayer/68/24305/products',
    sourceName: 'TCGplayer exact English booster-box case via TCGCSV',
  }],
  [850405, {
    sourceUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/650645_200w.jpg',
    evidenceUrl: 'https://tcgcsv.com/tcgplayer/68/24302/products',
    sourceName: 'TCGplayer exact English sleeved booster via TCGCSV',
  }],
  [855015, {
    sourceUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/657211_200w.jpg',
    evidenceUrl: 'https://tcgcsv.com/tcgplayer/68/24305/products',
    sourceName: 'TCGplayer exact English sleeved booster via TCGCSV',
  }],
  [863581, {
    sourceProductId: 804897,
    sourceUrl: 'https://product-images.s3.cardmarket.com/1622/804897/804897.jpg',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Booster-Boxes/Emperors-in-the-New-World-Sleeved-Booster-Pack-Case-24x-Packs',
    sourceName: 'Cardmarket corresponding contained sleeved-booster image',
    relationship: 'contained-unit',
  }],
  [863582, {
    sourceProductId: 826291,
    sourceUrl: 'https://product-images.s3.cardmarket.com/1622/826291/826291.jpg',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Booster-Boxes/Royal-Blood-Sleeved-Booster-Pack-Case-24x-Packs',
    sourceName: 'Cardmarket corresponding contained sleeved-booster image',
    relationship: 'contained-unit',
  }],
  [863583, {
    sourceProductId: 850404,
    sourceUrl: 'https://product-images.s3.cardmarket.com/1622/850404/850404.jpg',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Booster-Boxes/A-Fist-of-Divine-Speed-Sleeved-Booster-Pack-Case-24x-Packs',
    sourceName: 'Cardmarket corresponding contained sleeved-booster image',
    relationship: 'contained-unit',
  }],
  [863584, {
    sourceProductId: 850405,
    sourceUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/650645_200w.jpg',
    evidenceUrl: 'https://tcgcsv.com/tcgplayer/68/24302/products',
    sourceName: 'TCGplayer corresponding contained English sleeved-booster image via TCGCSV',
    relationship: 'contained-unit',
  }],
  [863585, {
    sourceProductId: 865139,
    sourceUrl: 'https://product-images.s3.cardmarket.com/1622/865139/865139.jpg',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Booster-Boxes/Carrying-on-his-Will-Sleeved-Booster-Pack-Case-24x-Packs',
    sourceName: 'Cardmarket corresponding contained sleeved-booster image',
    relationship: 'contained-unit',
  }],
  [874420, {
    sourceProductId: 874408,
    sourceUrl: 'https://product-images.s3.cardmarket.com/1622/874408/874408.jpg',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Booster-Boxes/The-Azures-Sea-Seven-Sleeved-Booster-Pack-Case-24x-Packs',
    sourceName: 'Cardmarket corresponding contained sleeved-booster image',
    relationship: 'contained-unit',
  }],
  [863588, {
    sourceProductId: 855015,
    sourceUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/657211_200w.jpg',
    evidenceUrl: 'https://tcgcsv.com/tcgplayer/68/24305/products',
    sourceName: 'TCGplayer corresponding contained English sleeved-booster image via TCGCSV',
    relationship: 'contained-unit',
  }],
]);
const EXACT_SEALED_RELEASE_GATES_V10 = new Map([
  [897417, {
    releasedOn: '2026-07-31',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Illustration-Box-Vol7',
    reason: 'Cardmarket identifies this product as a presale.',
  }],
  [897418, {
    releasedOn: '2026-07-31',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Illustration-Box-Vol8',
    reason: 'Cardmarket identifies this product as a presale.',
  }],
  [897461, {
    releasedOn: '2026-07-31',
    evidenceUrl: 'https://en.onepiece-cardgame.com/products/other/playmat010.php',
    reason: 'Bandai lists delivery in July 2026 and its UK distributor gives 2026-07-31 as the release date.',
  }],
  [869915, {
    releasedOn: '2026-08-28',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/One-Piece-Card-Game-3rd-English-Anniversary-Set-English-Version',
    reason: 'Cardmarket identifies this product as a presale.',
  }],
  [875688, {
    releasedOn: '2026-08-28',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Double-Pack-Set-Vol12',
    reason: 'Cardmarket identifies this product as a presale and currently serves a generic placeholder image.',
  }],
  [897457, {
    releasedOn: '2026-08-28',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Premium-Card-Collection-Best-Selection-Vol6',
    reason: 'Cardmarket identifies this product as a presale.',
  }],
  [897446, {
    releasedOn: '2026-12-31',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Official-Limited-Edition-Vol6-Playmat-Yamato-Leader-Card',
    reason: 'Cardmarket identifies this product as a presale.',
  }],
  [897455, {
    releasedOn: '2026-12-31',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Premium-Card-Collection-Best-Selection-Vol7',
    reason: 'Cardmarket identifies this product as a presale.',
  }],
  [897464, {
    releasedOn: '2026-12-31',
    evidenceUrl: 'https://www.cardmarket.com/en/OnePiece/Products/Promo-Products/Premium-Card-Collection-29th-Anniversary-Edition',
    reason: 'Cardmarket identifies this product as a presale.',
  }],
]);

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

const SOURCE_FETCH_OPTIONS = {
  headers: { 'user-agent': 'TCG-Harbor-data-sync/4.0' },
  maxAttempts: 5,
  attemptTimeoutMs: 30_000,
  overallTimeoutMs: 150_000,
  baseDelayMs: 1_000,
  maxDelayMs: 15_000,
  maxRetryAfterMs: 30_000,
  jitterRatio: 0.2,
  onRetry: ({ url, attempt, maxAttempts, delayMs, reason }) => {
    console.warn(`Source request ${attempt}/${maxAttempts} failed for ${url}: ${reason}; retrying in ${delayMs}ms.`);
  },
};

function sourceFetchOptions(url) {
  if (new URL(url).hostname === 'optcgapi.com') {
    // Four feeds run sequentially below. At 150 seconds per feed, their total
    // worst-case request budget remains at ten minutes, leaving ample room
    // inside the workflow's 25-minute job limit for validation and publishing.
    return SOURCE_FETCH_OPTIONS;
  }
  return {
    ...SOURCE_FETCH_OPTIONS,
    attemptTimeoutMs: 45_000,
    overallTimeoutMs: 210_000,
  };
}

async function fetchJson(url) {
  return fetchJsonWithRetryV8(url, sourceFetchOptions(url));
}

async function fetchText(url) {
  return fetchTextWithRetryV8(url, sourceFetchOptions(url));
}

const ARTWORK_IMAGE_HOSTS_V9 = new Set([
  'product-images.s3.cardmarket.com',
  'optcgapi.com',
  'en.onepiece-cardgame.com',
  'tcgplayer-cdn.tcgplayer.com',
]);
const ARTWORK_IMAGE_TIMEOUT_MS_V9 = 6_000;
const OFFICIAL_ARTWORK_IMAGE_TIMEOUT_MS_V10 = 30_000;
const ARTWORK_IMAGE_MAX_ATTEMPTS_V10 = 3;
const ARTWORK_DISCOVERY_BUDGET_MS_V9 = 8 * 60_000;
const TCGPLAYER_ARTWORK_DISCOVERY_BUDGET_MS_V1 = 6 * 60_000;
const PROMO_CROSS_MARKET_DISCOVERY_BUDGET_MS_V1 = 3 * 60_000;
const ARTWORK_EVIDENCE_MAX_AGE_MS_V10 = 14 * 24 * 60 * 60_000;
const ARTWORK_EVIDENCE_TRANSIENT_GRACE_MS_V10 = 21 * 24 * 60 * 60_000;
const SEALED_IMAGE_DISCOVERY_BUDGET_MS_V10 = 5 * 60_000;
const SEALED_IMAGE_MAX_AGE_MS_V10 = 14 * 24 * 60 * 60_000;
const SEALED_IMAGE_TRANSIENT_GRACE_MS_V10 = 21 * 24 * 60 * 60_000;
const IMAGE_REFRESH_BUCKETS_V10 = 7;

function dailyRefreshBucketV10(observedAt) {
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) throw new Error(`Invalid refresh observation time ${observedAt}.`);
  return Math.floor(time / (24 * 60 * 60_000)) % IMAGE_REFRESH_BUCKETS_V10;
}

function sourceRefreshScheduledV10(sourceId, observedAt) {
  const numericId = Number(sourceId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return true;
  return numericId % IMAGE_REFRESH_BUCKETS_V10 === dailyRefreshBucketV10(observedAt);
}

function artworkImageErrorV10(message, transient = false) {
  const error = new Error(message);
  error.transient = transient;
  return error;
}

function artworkImageErrorIsTransientV10(error) {
  return error?.transient === true
    || error?.name === 'AbortError'
    || error instanceof TypeError;
}

async function fetchArtworkImageBytesOnceV10(parsed) {
  const controller = new AbortController();
  const imageTimeoutMs = parsed.hostname === 'en.onepiece-cardgame.com'
    ? OFFICIAL_ARTWORK_IMAGE_TIMEOUT_MS_V10
    : ARTWORK_IMAGE_TIMEOUT_MS_V9;
  const timeout = setTimeout(() => controller.abort(), imageTimeoutMs);
  try {
    const response = await fetch(parsed, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; TCG-Harbor-data-sync/5.0)',
        referer: parsed.hostname === 'product-images.s3.cardmarket.com'
          ? 'https://www.cardmarket.com/'
          : parsed.hostname === 'en.onepiece-cardgame.com'
            ? 'https://en.onepiece-cardgame.com/'
            : parsed.hostname === 'tcgplayer-cdn.tcgplayer.com'
              ? 'https://www.tcgplayer.com/'
              : 'https://optcgapi.com/',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw artworkImageErrorV10(
        `Artwork image returned HTTP ${response.status}.`,
        response.status === 408
          || response.status === 425
          || response.status === 429
          || response.status >= 500,
      );
    }
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== 'https:' || !ARTWORK_IMAGE_HOSTS_V9.has(finalUrl.hostname)) {
      throw new Error(`Artwork image redirected to an untrusted host: ${finalUrl.hostname}.`);
    }
    const declaredBytes = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredBytes)
      && declaredBytes > CARDMARKET_REGULAR_ART_POLICY_V1.maximumImageBytes) {
      throw new Error('Artwork image exceeds the declared safe size limit.');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > CARDMARKET_REGULAR_ART_POLICY_V1.maximumImageBytes) {
      throw new Error('Artwork image exceeds the safe size limit.');
    }
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchArtworkImageBytesV9(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ARTWORK_IMAGE_HOSTS_V9.has(parsed.hostname)) {
    throw new Error(`Artwork image host is not allowlisted: ${parsed.hostname}.`);
  }

  let lastError = null;
  for (let attempt = 1; attempt <= ARTWORK_IMAGE_MAX_ATTEMPTS_V10; attempt += 1) {
    try {
      return await fetchArtworkImageBytesOnceV10(parsed);
    } catch (error) {
      lastError = error;
      if (!artworkImageErrorIsTransientV10(error) || attempt === ARTWORK_IMAGE_MAX_ATTEMPTS_V10) {
        throw error;
      }
      const delayMs = 500 * (2 ** (attempt - 1));
      console.warn(`Transient artwork request ${attempt}/${ARTWORK_IMAGE_MAX_ATTEMPTS_V10} failed for ${url}: ${error instanceof Error ? error.message : String(error)}; retrying in ${delayMs}ms.`);
      await delay(delayMs);
    }
  }
  throw lastError ?? new Error(`Artwork image request failed for ${url}.`);
}

const artworkFingerprintPromisesV9 = new Map();
const normalizedSealedSourcePromisesV10 = new Map();

function artworkFingerprintFromUrlV9(url) {
  if (!artworkFingerprintPromisesV9.has(url)) {
    artworkFingerprintPromisesV9.set(url, fetchArtworkImageBytesV9(url)
      .then((bytes) => fingerprintArtworkImageV1(bytes)));
  }
  return artworkFingerprintPromisesV9.get(url);
}

function normalizedSealedSourceFromUrlV10(url) {
  if (!normalizedSealedSourcePromisesV10.has(url)) {
    normalizedSealedSourcePromisesV10.set(
      url,
      fetchArtworkImageBytesV9(url).then((bytes) => normalizeSealedProductImageV1(bytes)),
    );
  }
  return normalizedSealedSourcePromisesV10.get(url);
}

async function cardmarketProductFingerprintV9(groupCode, productId) {
  const errors = [];
  for (const url of cardmarketProductImageUrlsV1(groupCode, productId)) {
    try {
      return { url, fingerprint: await artworkFingerprintFromUrlV9(url) };
    } catch (error) {
      errors.push({ url, error });
    }
  }
  throw artworkImageErrorV10(
    `No Cardmarket artwork image could be fetched for ${groupCode} ${productId}: ${errors.map(({ url, error }) => `${url} (${error instanceof Error ? error.message : String(error)})`).join('; ') || 'no candidate URLs'}.`,
    errors.some(({ error }) => artworkImageErrorIsTransientV10(error)),
  );
}

async function cardmarketPromoProductFingerprintV1(imageFolder, productId) {
  const errors = [];
  for (const url of cardmarketPromoProductImageUrlsV1(imageFolder, productId)) {
    try {
      return { url, fingerprint: await artworkFingerprintFromUrlV9(url) };
    } catch (error) {
      errors.push({ url, error });
    }
  }
  throw artworkImageErrorV10(
    `No Cardmarket promotional artwork image could be fetched for ${imageFolder} ${productId}: ${errors.map(({ url, error }) => `${url} (${error instanceof Error ? error.message : String(error)})`).join('; ') || 'no candidate URLs'}.`,
    errors.some(({ error }) => artworkImageErrorIsTransientV10(error)),
  );
}

function sealedImageFilePathV10(imageUrl) {
  if (!/^\/catalog\/sealed\/v1\/\d+-[a-f0-9]{12}\.webp$/i.test(String(imageUrl ?? ''))) {
    return null;
  }
  const filePath = resolve(ROOT, 'public', imageUrl.slice(1));
  return dirname(filePath) === SEALED_IMAGE_PUBLIC_ROOT ? filePath : null;
}

function sealedImageSourceProductIdV10(productId) {
  return Number(EXACT_SEALED_IMAGE_OVERRIDES_V10.get(Number(productId))?.sourceProductId ?? productId);
}

function sealedImageSourceExpectationV10(productId) {
  const normalizedProductId = Number(productId);
  const override = EXACT_SEALED_IMAGE_OVERRIDES_V10.get(normalizedProductId) ?? null;
  return {
    sourceProductId: Number(override?.sourceProductId ?? normalizedProductId),
    relationship: override?.relationship ?? 'exact-product',
    ...(override ? {
      sourceUrl: override.sourceUrl,
      evidenceUrl: override.evidenceUrl,
      sourceName: override.sourceName,
    } : {}),
  };
}

async function existingSealedImageV10(previousAsset, productId, observedAt, options = {}) {
  const filePath = sealedImageFilePathV10(previousAsset?.imageUrl);
  const expectedDigest = String(previousAsset?.imageOutputDigest ?? '').toLowerCase();
  const sourceExpectation = sealedImageSourceExpectationV10(productId);
  const cacheAgeMs = Date.parse(observedAt) - Date.parse(previousAsset?.imageObservedAt ?? '');
  if (
    previousAsset?.imageState !== 'available'
    || !sealedImageCacheSourceMatchesV1(previousAsset, sourceExpectation)
    || !/^[a-f0-9]{64}$/.test(expectedDigest)
    || !Number.isFinite(cacheAgeMs)
    || cacheAgeMs < 0
    || cacheAgeMs > (options.maxAgeMs ?? SEALED_IMAGE_MAX_AGE_MS_V10)
    || (!options.allowScheduledRefresh
      && sourceRefreshScheduledV10(sourceExpectation.sourceProductId, observedAt))
    || !filePath
  ) return null;

  try {
    const bytes = await readFile(filePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const metadata = await sharp(bytes, { failOn: 'error' }).metadata();
    if (
      digest !== expectedDigest
      || metadata.format !== 'webp'
      || !metadata.width
      || !metadata.height
    ) return null;
    return {
      imageUrl: previousAsset.imageUrl,
      imageState: 'available',
      imageSourceProductId: sourceExpectation.sourceProductId,
      imageSourceRelationship: sourceExpectation.relationship,
      imageSourceUrl: previousAsset.imageSourceUrl,
      imageEvidenceUrl: previousAsset.imageEvidenceUrl,
      imageSourceName: previousAsset.imageSourceName,
      imageSourceDigest: previousAsset.imageSourceDigest,
      imageOutputDigest: digest,
      imageObservedAt: previousAsset.imageObservedAt,
      imageSourceWidth: previousAsset.imageSourceWidth,
      imageSourceHeight: previousAsset.imageSourceHeight,
      imageWidth: metadata.width,
      imageHeight: metadata.height,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function cacheSealedImageBytesV10(productId, normalized) {
  const imageUrl = immutableSealedImagePathV1(productId, normalized.outputDigest);
  const filePath = sealedImageFilePathV10(imageUrl);
  if (!filePath) throw new Error(`Unsafe sealed image output path for ${productId}.`);
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, normalized.outputBytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(filePath);
    const digest = createHash('sha256').update(existing).digest('hex');
    if (digest !== normalized.outputDigest) {
      throw new Error(`Immutable sealed image collision for Cardmarket product ${productId}.`);
    }
  }
  return imageUrl;
}

async function deferredSealedImageV10(previousAsset, productId, observedAt, reason) {
  const deferred = await existingSealedImageV10(previousAsset, productId, observedAt, {
    allowScheduledRefresh: true,
    maxAgeMs: SEALED_IMAGE_TRANSIENT_GRACE_MS_V10,
  });
  if (!deferred) return null;
  return {
    ...deferred,
    reused: true,
    imageRefreshDeferred: true,
    imageRefreshDeferredReason: reason,
  };
}

async function acquireSealedImageV10(product, previousAsset, observedAt) {
  const productId = Number(product.idProduct);
  const existing = await existingSealedImageV10(previousAsset, productId, observedAt);
  if (existing) return { ...existing, reused: true };

  const override = EXACT_SEALED_IMAGE_OVERRIDES_V10.get(productId) ?? null;
  const candidates = override
    ? [{
      url: override.sourceUrl,
      evidenceUrl: override.evidenceUrl,
      sourceName: override.sourceName,
      sourceProductId: Number(override.sourceProductId ?? productId),
      relationship: override.relationship ?? 'exact-product',
    }]
    : cardmarketSealedImageUrlsV1(product.idCategory, productId).map((url) => ({
      url,
      evidenceUrl: CARDMARKET_NONSINGLES,
      sourceName: 'Cardmarket official product image CDN',
      sourceProductId: productId,
      relationship: 'exact-product',
    }));
  const candidateErrors = [];
  for (const candidate of candidates) {
    try {
      const normalized = await normalizedSealedSourceFromUrlV10(candidate.url);
      const imageUrl = await cacheSealedImageBytesV10(productId, normalized);
      return {
        imageUrl,
        imageState: 'available',
        imageSourceProductId: candidate.sourceProductId,
        imageSourceRelationship: candidate.relationship,
        imageSourceUrl: candidate.url,
        imageEvidenceUrl: candidate.evidenceUrl,
        imageSourceName: candidate.sourceName,
        imageSourceDigest: normalized.sourceDigest,
        imageOutputDigest: normalized.outputDigest,
        imageObservedAt: observedAt,
        imageSourceWidth: normalized.sourceWidth,
        imageSourceHeight: normalized.sourceHeight,
        imageWidth: normalized.outputWidth,
        imageHeight: normalized.outputHeight,
        reused: false,
      };
    } catch (error) {
      candidateErrors.push({ url: candidate.url, error });
    }
  }
  const lastError = artworkImageErrorV10(
    candidateErrors.map(({ url, error }) => `${url} (${error instanceof Error ? error.message : String(error)})`).join('; ')
      || `No sealed image candidate URL for Cardmarket product ${productId}.`,
    candidateErrors.some(({ error }) => artworkImageErrorIsTransientV10(error)),
  );
  if (artworkImageErrorIsTransientV10(lastError)) {
    const deferred = await deferredSealedImageV10(
      previousAsset,
      productId,
      observedAt,
      lastError instanceof Error ? lastError.message : String(lastError),
    );
    if (deferred) {
      return deferred;
    }
  }
  throw new Error(
    `No real, provenance-tracked image could be verified for sealed Cardmarket product ${productId}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function fetchOptcgFeeds() {
  return fetchSequentiallyWithPauseV8(
    OPTCG_FEEDS,
    (feed) => fetchJson(feed.url),
    { pauseMs: 300, sleep: delay },
  );
}

async function fetchBandaiEnglishProducts(previousContinuity = []) {
  const firstPageHtml = await fetchText(`${BANDAI_ENGLISH_PRODUCTS}?page=1`);
  const pageCount = Number(firstPageHtml.match(/<span class="pageMax">\s*(\d+)\s*<\/span>/i)?.[1]);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > BANDAI_PRODUCTS_MAX_PAGES) {
    throw new Error(`Bandai products archive returned an unsafe page count: ${pageCount || 'missing'}.`);
  }

  const products = parseBandaiProductsPageV10(firstPageHtml, 1);
  for (let page = 2; page <= pageCount; page += 1) {
    await delay(110);
    products.push(...parseBandaiProductsPageV10(
      await fetchText(`${BANDAI_ENGLISH_PRODUCTS}?page=${page}`),
      page,
    ));
  }

  const archivedCodes = new Set(products
    .filter((product) => product.category === 'boosters' || product.category === 'decks')
    .map((product) => product.officialCode)
    .filter(Boolean));
  for (const continuityProduct of [...OFFICIAL_RELEASE_CONTINUITY, ...previousContinuity]) {
    if (!archivedCodes.has(continuityProduct.officialCode)) {
      products.push(continuityProduct);
      archivedCodes.add(continuityProduct.officialCode);
    }
  }

  const codedProducts = products.filter((product) =>
    (product.category === 'boosters' || product.category === 'decks')
    && product.officialCode);
  if (codedProducts.length < 20) {
    throw new Error(`Bandai products archive returned only ${codedProducts.length} coded booster products.`);
  }
  const codes = codedProducts.map((product) => product.officialCode);
  if (new Set(codes).size !== codes.length) {
    const duplicateCodes = [...new Set(codes.filter((code, index) => codes.indexOf(code) !== index))];
    throw new Error(`Bandai products archive returned duplicate coded products: ${duplicateCodes.join(', ')}.`);
  }
  return { pageCount, fetchedAt: new Date().toISOString(), products };
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

async function loadEcbUsdPerEurV10(previousSnapshot) {
  try {
    return {
      ...parseEcbUsdPerEur(await fetchText(ECB_USD_PER_EUR)),
      retrievalMode: 'live',
      fallbackUsedAt: null,
      liveFetchError: null,
    };
  } catch (error) {
    const previous = previousSnapshot?.provenance?.exchangeRate ?? null;
    const previousFetchedAt = Date.parse(previous?.fetchedAt ?? '');
    const ageMs = Date.now() - previousFetchedAt;
    const validPrevious = previous?.seriesKey === ECB_SERIES_KEY
      && previous?.source === ECB_USD_PER_EUR
      && Number.isFinite(Number(previous?.usdPerEur))
      && Number(previous.usdPerEur) > 0
      && /^\d{4}-\d{2}-\d{2}$/.test(String(previous?.observationDate ?? ''))
      && Number.isFinite(previousFetchedAt)
      && ageMs >= 0
      && ageMs <= ECB_TRANSIENT_FALLBACK_MAX_AGE_MS_V10;
    if (error?.transient !== true || !validPrevious) throw error;
    const fallbackUsedAt = new Date().toISOString();
    console.warn(`::warning title=Verified ECB fallback::The ECB endpoint remained unavailable after bounded retries. Reusing the verified ${previous.observationDate} USD-per-EUR observation fetched at ${previous.fetchedAt}; the seven-day hard limit still applies.`);
    return {
      usdPerEur: Number(previous.usdPerEur),
      observationDate: previous.observationDate,
      fetchedAt: previous.fetchedAt,
      seriesKey: ECB_SERIES_KEY,
      source: ECB_USD_PER_EUR,
      retrievalMode: 'verified-snapshot-fallback',
      fallbackUsedAt,
      liveFetchError: {
        name: error.name,
        message: error.message,
        lastFailureKind: error.lastFailureKind ?? null,
        attempts: error.attempts ?? null,
      },
    };
  }
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
  return productName.match(/\(((?:P|OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})-\d{3})\)\s*$/)?.[1] ?? null;
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

function tcgcsvAbbreviationForOfficialCode(officialCode) {
  const override = OFFICIAL_TO_TCGCSV_GROUP_OVERRIDES.get(officialCode);
  if (override) return override;
  return /^OP-\d{2}$/.test(officialCode) ? officialCode.replace('-', '') : officialCode;
}

function officialMemberSetCodes(officialCode) {
  return officialMemberSetCodesFromLabel(officialCode);
}

function officialProductAvailableAt(product, cutoff = new Date()) {
  const [year, month, day] = product.releasedOn.split('-').map(Number);
  // Month-only announcements use the first of the month in Bandai's datetime
  // attribute. Treat them as available only after that month, unless Bandai
  // publishes a day-level date, so a future product cannot leak into the app.
  const availableAt = product.releasePrecision === 'day'
    ? Date.UTC(year, month - 1, day)
    : Date.UTC(year, month, 1);
  return availableAt <= cutoff.valueOf();
}

function releaseMetadataForOfficialProduct(product) {
  const abbreviation = tcgcsvAbbreviationForOfficialCode(product.officialCode);
  return {
    abbreviation,
    category: product.category,
    officialCode: product.officialCode,
    releasedOn: product.releasedOn,
    releaseLabel: product.releaseLabel,
    releasePrecision: product.releasePrecision,
    memberSetCodes: officialMemberSetCodes(product.officialCode),
    title: product.title,
    productUrl: product.productUrl,
    continuityEvidence: product.continuityEvidence ?? null,
  };
}

function selectReleasedEnglishMarketGroups(groups, bandaiCatalog, cutoff = new Date()) {
  const releasedManifestEntries = bandaiCatalog.products
    .filter((product) => product.category === 'boosters')
    .filter((product) => product.officialCode)
    .filter((product) => TCGCSV_MARKET_GROUP_ABBREVIATION.test(
      tcgcsvAbbreviationForOfficialCode(product.officialCode),
    ))
    .filter((product) => officialProductAvailableAt(product, cutoff))
    .map(releaseMetadataForOfficialProduct);

  const selected = releasedManifestEntries.map((release) => {
    const { abbreviation } = release;
    const matches = groups.filter((group) =>
      tcgcsvGroupAbbreviation(group) === abbreviation && Number(group.categoryId) === TCGCSV_CATEGORY_ID,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Official Bandai product ${release.officialCode} is released, but expected one TCGCSV group ${abbreviation}; found ${matches.length}.`,
      );
    }
    return { group: matches[0], release };
  }).sort((left, right) => {
    return left.release.releasedOn.localeCompare(right.release.releasedOn)
      || Number(left.group.groupId) - Number(right.group.groupId);
  });
  const abbreviations = selected.map(({ release }) => release.abbreviation);
  if (new Set(abbreviations).size !== abbreviations.length) {
    throw new Error('Bandai products mapped to duplicate released TCGCSV market-group abbreviations.');
  }

  const mainOrdinals = selected
    .map(({ group }) => mainSetOrdinalForGroup(group))
    .filter((ordinal) => ordinal != null)
    .sort((left, right) => left - right);
  const latestMainOrdinal = mainOrdinals.at(-1) ?? 0;
  const expectedMainOrdinals = Array.from({ length: latestMainOrdinal }, (_, index) => index + 1);
  if (latestMainOrdinal < MINIMUM_RELEASED_ENGLISH_MAIN_SET
    || mainOrdinals.length !== expectedMainOrdinals.length
    || mainOrdinals.some((ordinal, index) => ordinal !== expectedMainOrdinals[index])) {
    throw new Error(`Released English main-set groups are incomplete: ${mainOrdinals.join(', ') || 'none'}.`);
  }
  for (const requiredSpecial of REQUIRED_RELEASED_SPECIAL_GROUPS) {
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

function normalizedSealedProductTitleV10(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\benglish\s*(?:version|ver\.?|edition)?\b/gi, '')
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

function stableUuid(namespace, value) {
  const bytes = createHash('sha256').update(`${namespace}:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  const exactOverride = EXACT_TCGPLAYER_IMAGE_OVERRIDES.get(productId);
  if (exactOverride) return exactOverride;
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
  // OPTCG sometimes appends a printing suffix to card_set_id for starter-deck
  // reprints. It is artwork identity, not part of the printed rules number.
  // Preserve card_image_id/printing identity elsewhere and normalize only the
  // terminal source suffix so every art stays in the correct picker group.
  return value.replace(/_(?:PR|P|R)\d+$/, '') || null;
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

function isOptcgReleasePrintingForGroup(card, source) {
  const number = regularRulesCardId(card);
  if (!number || card.__source !== 'set') return false;
  const sourceSetCode = normalizeSetCode(card.set_id, '');
  // Reprints and special arts can carry a printed number from an older set, so
  // release membership is proven by the OPTCG source set rather than by the
  // number prefix. This intentionally does not infer base/parallel identity.
  return sourceSetCode === source.primarySetCode
    || sourceSetCode.startsWith(`${source.primarySetCode}-`);
}

function isOptcgStarterPrintingForSet(card, setCode) {
  if (card.__source !== 'starter' || !regularRulesCardId(card)) return false;
  return setCodeForCard(card, regularRulesCardId(card)) === setCode;
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

function normalizedDeckProductTitle(value) {
  return normalizedDeckProductTitleV1(value);
}

function officialDeckSetCodeIndex(products) {
  const index = new Map();
  for (const product of products.filter((candidate) => candidate.category === 'decks' && /^ST-?\d{2}$/.test(candidate.officialCode ?? ''))) {
    const normalizedTitle = normalizedDeckProductTitle(product.title);
    const setCode = normalizeSetCode(product.officialCode);
    if (!normalizedTitle) continue;
    if (index.has(normalizedTitle) && index.get(normalizedTitle) !== setCode) {
      throw new Error(`Official Bandai deck title maps to multiple set codes: ${product.title}.`);
    }
    index.set(normalizedTitle, setCode);
  }
  return index;
}

function sealedSetCode(
  product,
  category,
  officialDeckSetCodesByTitle = new Map(),
  releasedSetCodeByExpansionId = new Map(),
) {
  return resolveSealedSetCodeV1({
    product,
    category,
    exactSetCodeOverrides: EXACT_CARDMARKET_DECK_SET_CODE_OVERRIDES,
    officialDeckSetCodesByTitle,
    releasedSetCodeByExpansionId,
  });
}

function cardmarketStarterEvidenceSetCode(product, officialDeckSetCodesByTitle) {
  const name = String(product.name ?? '');
  if (/\bdeck set\b/i.test(name) || /^\s*demo deck\b/i.test(name)) return null;
  const exactOverride = EXACT_CARDMARKET_DECK_SET_CODE_OVERRIDES.get(Number(product.idProduct));
  if (exactOverride) return exactOverride;
  const exactOfficialTitle = officialDeckSetCodesByTitle.get(normalizedDeckProductTitle(name));
  if (/^ST\d{2}$/.test(exactOfficialTitle ?? '')) return exactOfficialTitle;
  const explicitCodes = [...name.matchAll(/\bST[-\s]?(\d{1,2})\b/gi)]
    .map((match) => `ST${match[1].padStart(2, '0')}`);
  const uniqueExplicitCodes = [...new Set(explicitCodes)];
  return /(?:starter|ultimate)\s+deck/i.test(name) && uniqueExplicitCodes.length === 1
    ? uniqueExplicitCodes[0]
    : null;
}

function cardmarketStarterExpansionEvidence(
  nonSingles,
  officialDeckSetCodesByTitle,
  releasedSetCodes,
) {
  const rowsBySetCode = groupBy(
    nonSingles.filter((product) =>
      product.categoryName === 'One Piece Preconstructed Decks'
      && !NON_ENGLISH_SEALED.test(String(product.name ?? '')),
    ),
    (product) => cardmarketStarterEvidenceSetCode(product, officialDeckSetCodesByTitle),
  );
  const exact = new Map();
  const ambiguous = [];
  for (const [setCode, products] of rowsBySetCode) {
    if (!/^ST\d{2}$/.test(setCode) || !releasedSetCodes.has(setCode)) continue;
    const expansionIds = [...new Set(products.map((product) => Number(product.idExpansion)))]
      .filter((idExpansion) => Number.isInteger(idExpansion) && idExpansion > 0);
    if (expansionIds.length !== 1) {
      ambiguous.push({
        setCode,
        expansionIds,
        evidenceProductIds: products.map((product) => Number(product.idProduct)),
        reason: `English Cardmarket preconstructed-deck evidence spans ${expansionIds.length} expansions.`,
      });
      continue;
    }
    exact.set(setCode, {
      setCode,
      idExpansion: expansionIds[0],
      policy: 'Unique Cardmarket expansion across English preconstructed-deck rows matched to the official Bandai ST code',
      evidenceProductIds: products.map((product) => Number(product.idProduct)),
    });
  }
  return { exact, ambiguous };
}

async function fetchReleasedEnglishMarketManifest(previousSnapshot) {
  const previousReleaseContinuity = previousBandaiReleaseContinuityV2(previousSnapshot);
  return retryReleaseManifestValidationV2(async () => {
    const [groupsPayload, bandaiCatalog] = await Promise.all([
      fetchJson(TCGCSV_GROUPS),
      fetchBandaiEnglishProducts(previousReleaseContinuity),
    ]);
    const groups = tcgcsvResults(groupsPayload, TCGCSV_GROUPS);
    const marketGroups = selectReleasedEnglishMarketGroups(groups, bandaiCatalog);
    return { groups, bandaiCatalog, marketGroups };
  }, {
    maxAttempts: 3,
    baseDelayMs: 2_000,
    sleep: delay,
    onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
      console.warn(`Release manifest validation ${attempt}/${maxAttempts} failed: ${error.message}; refetching Bandai and TCGCSV manifests in ${delayMs}ms.`);
    },
  });
}

async function fetchTcgcsvBundle(previousSnapshot) {
  const [updatedText, releaseManifest] = await Promise.all([
    fetchText(TCGCSV_UPDATED_AT),
    fetchReleasedEnglishMarketManifest(previousSnapshot),
  ]);
  const { groups, bandaiCatalog, marketGroups } = releaseManifest;
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
  for (const { group, release } of marketGroups) {
    const groupId = Number(group.groupId);
    const productsUrl = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${groupId}/products`;
    const pricesUrl = `https://tcgcsv.com/tcgplayer/${TCGCSV_CATEGORY_ID}/${groupId}/prices`;
    const products = await fetchJson(productsUrl);
    await delay(110);
    const prices = await fetchJson(pricesUrl);
    await delay(110);
    marketGroupSources.push({ group, release, groupId, productsUrl, pricesUrl, products, prices });
  }
  return {
    updatedText,
    groups,
    bandaiCatalog,
    marketGroupSources,
    promoProducts,
    promoPrices,
    starterPayloads,
  };
}

if (process.argv.includes('--ingest-existing')) {
  const snapshot = JSON.parse(await readFile(OUTPUT, 'utf8'));
  const manifest = snapshot?.provenance?.englishReleaseManifest;
  if (!Array.isArray(manifest?.officialProducts) || manifest.officialProducts.length === 0) {
    throw new Error('The existing snapshot has no official Bandai release metadata; run the full sync first.');
  }
  await ingestSnapshotToSupabase(snapshot, { products: manifest.officialProducts }, { required: true });
  process.exit(0);
}

let baselineSnapshotV9 = null;
try {
  baselineSnapshotV9 = JSON.parse(await readFile(PREVIOUS_OUTPUT, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

let previousSnapshot = null;
try {
  previousSnapshot = JSON.parse(await readFile(OUTPUT, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  previousSnapshot = baselineSnapshotV9;
}

const cardmarketPromoExpansionRegistryV1 = validateCardmarketPromoExpansionRegistryV1(
  JSON.parse(await readFile(CARDMARKET_PROMO_EXPANSION_REGISTRY, 'utf8')),
);
const cardmarketPromoExpansionByIdV1 = new Map(
  cardmarketPromoExpansionRegistryV1.expansions.map((entry) => [entry.idExpansion, entry]),
);
const reviewedPromoArtworkMappingByReviewIdV1 = new Map(
  cardmarketPromoExpansionRegistryV1.reviewedArtworkMappings.map(
    (entry) => [entry.reviewId, entry],
  ),
);

const [marketSources, tcgcsvBundle, optcgFeedResult, exchangeRate] = await Promise.all([
  Promise.all([
    fetchJson(CARDMARKET_PRODUCTS),
    fetchJson(CARDMARKET_NONSINGLES),
    fetchJson(CARDMARKET_PRICES),
  ]),
  fetchTcgcsvBundle(previousSnapshot),
  loadOptcgFeedsWithCacheV1({
    fetchLive: fetchOptcgFeeds,
    readCache: () => readFile(OPTCG_CACHE, 'utf8'),
  }),
  loadEcbUsdPerEurV10(previousSnapshot),
]);

const feedResponses = optcgFeedResult.responses;
if (optcgFeedResult.retrievalMode === 'integrity-checked-cache-fallback') {
  console.warn(
    `::warning title=Integrity-checked OPTCG cache fallback::The live OPTCG catalog was unreachable after bounded retries. Using the SHA-256 integrity-checked cache fetched at ${optcgFeedResult.cacheFetchedAt}; every other source retains its own explicit live-or-bounded-fallback provenance.`,
  );
}

const [productCatalog, nonSinglesCatalog, priceGuide] = marketSources;
const {
  updatedText: tcgcsvUpdatedText,
  groups: tcgcsvGroups,
  bandaiCatalog,
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
const tcgcsvMarketSources = tcgcsvMarketGroupSources.map((source) => ({
  ...source,
  abbreviation: source.release.abbreviation,
  primarySetCode: primarySetCodeForGroup(source.group),
  releasedOn: source.release.releasedOn,
  memberSetCodes: source.release.memberSetCodes,
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
const officialReleaseCutoff = new Date(bandaiCatalog.fetchedAt);
const releasedOfficialCardSetCodes = new Set(bandaiCatalog.products
  .filter((product) => (product.category === 'boosters' || product.category === 'decks')
    && product.officialCode
    && officialProductAvailableAt(product, officialReleaseCutoff))
  .flatMap((product) => officialMemberSetCodes(product.officialCode)));
const futureOfficialCardSetCodes = new Set(bandaiCatalog.products
  .filter((product) => (product.category === 'boosters' || product.category === 'decks')
    && product.officialCode
    && !officialProductAvailableAt(product, officialReleaseCutoff))
  .flatMap((product) => officialMemberSetCodes(product.officialCode)));
if (optcgFeedResult.retrievalMode === 'integrity-checked-cache-fallback') {
  assertOptcgCacheCoversReleasedSetsV1(
    optcgFeedResult.cacheDocument,
    [...releasedOfficialCardSetCodes],
  );
}
const isReleasedOfficialCoreCard = (card) => {
  if (card.__source === 'don') return true;
  const number = rulesCardId(card);
  const setCode = setCodeForCard(card, number);
  return catalogSetCodeIsReleased(setCode, releasedOfficialCardSetCodes);
};
const releasedRawCoreCards = rawCoreCards.filter(isReleasedOfficialCoreCard);
const unreleasedRawCoreCards = rawCoreCards.filter((card) => !isReleasedOfficialCoreCard(card));
const futureRawCoreCardsExcluded = unreleasedRawCoreCards.filter((card) => {
  const number = rulesCardId(card);
  return catalogSetCodeIsReleased(setCodeForCard(card, number), futureOfficialCardSetCodes);
});
const unknownManifestRawCoreCards = unreleasedRawCoreCards.filter((card) => {
  const number = rulesCardId(card);
  return !catalogSetCodeIsReleased(setCodeForCard(card, number), futureOfficialCardSetCodes);
});
if (unknownManifestRawCoreCards.length > 0) {
  const samples = unknownManifestRawCoreCards.slice(0, 10).map((card) => ({
    number: rulesCardId(card),
    setCode: setCodeForCard(card, rulesCardId(card)),
  }));
  throw new Error(`OPTCG returned ${unknownManifestRawCoreCards.length} recognized core records missing from both released and future official manifests: ${JSON.stringify(samples)}.`);
}
const uniqueCoreCards = dedupePrintings(releasedRawCoreCards);
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
const officialDeckSetCodesByTitle = officialDeckSetCodeIndex(bandaiCatalog.products);
const starterExpansionEvidence = cardmarketStarterExpansionEvidence(
  nonSinglesCatalog.products,
  officialDeckSetCodesByTitle,
  releasedOfficialCardSetCodes,
);
const englishStarterExpansionIds = Object.fromEntries(
  [...starterExpansionEvidence.exact].map(([setCode, evidence]) => [setCode, evidence.idExpansion]),
);
const requiredCompleteLatestStarterArtworkSetCodeV10 = Object.keys(
  englishStarterExpansionIds,
)
  .filter((setCode) => /^ST\d{2}$/.test(setCode))
  .sort((left, right) => Number(right.slice(2)) - Number(left.slice(2)))[0] ?? null;
const releasedSealedSetCodeByExpansionIdV1 = buildReleasedSealedSetCodeByExpansionV1([
  ...Object.entries(englishExpansionIds),
  ...Object.entries(englishStarterExpansionIds),
]);

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
      mappingEvidence: 'Exact released English booster group + printed number + unique Cardmarket product, paired with the independently verified standard OPTCG printing',
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

// Cardmarket's public catalog omits artwork-version labels. Preserve the
// cross-market base mappings above, then extend coverage only where one unused
// OPTCG printing and one unused Cardmarket product remain for the same proven
// English release + printed number. Multiple candidates stay explicitly
// ambiguous; idProduct order and price never identify V.1/V.2.
const cardmarketMatches = new Map(baseCardmarketMatches);
const usedCardmarketProductIds = new Set(
  [...baseCardmarketMatches.values()].map((match) => Number(match.product.idProduct)),
);
const additionalCardmarketMatches = [];
const cardmarketAmbiguities = new Map();
const cardmarketUnavailable = new Map();
const cardmarketCoverageByGroup = new Map();

function addCardmarketMappingResult(result, context) {
  for (const match of result.exact) {
    const productId = Number(match.product.idProduct);
    if (cardmarketMatches.has(match.identity) || usedCardmarketProductIds.has(productId)) {
      throw new Error(`Cardmarket v8 attempted to reuse a printing or product in ${context.groupCode} ${match.number}.`);
    }
    const verified = {
      ...match,
      source: context.source ?? null,
      groupKind: context.groupKind,
      mappingEvidence: `${match.mappingEvidence}; ${context.releaseEvidence}`,
    };
    cardmarketMatches.set(match.identity, verified);
    usedCardmarketProductIds.add(productId);
    additionalCardmarketMatches.push(verified);
  }
  for (const ambiguity of result.ambiguous) {
    if (cardmarketMatches.has(ambiguity.identity) || cardmarketAmbiguities.has(ambiguity.identity)) {
      throw new Error(`Cardmarket v8 emitted conflicting ambiguity for ${context.groupCode} ${ambiguity.number}.`);
    }
    cardmarketAmbiguities.set(ambiguity.identity, {
      ...ambiguity,
      groupKind: context.groupKind,
      releaseEvidence: context.releaseEvidence,
    });
  }
  for (const unavailable of result.unavailable) {
    if (cardmarketMatches.has(unavailable.identity)
      || cardmarketAmbiguities.has(unavailable.identity)
      || cardmarketUnavailable.has(unavailable.identity)) {
      throw new Error(`Cardmarket v8 emitted conflicting unavailable state for ${context.groupCode} ${unavailable.number}.`);
    }
    cardmarketUnavailable.set(unavailable.identity, {
      ...unavailable,
      groupKind: context.groupKind,
      releaseEvidence: context.releaseEvidence,
    });
  }
}

for (const source of tcgcsvMarketSources) {
  const expansion = cardmarketExpansionEvidenceByGroup.get(source.groupId);
  const cards = uniqueCoreCards.filter((card) => isOptcgReleasePrintingForGroup(card, source));
  const products = productCatalog.products.filter(
    (product) => Number(product.idExpansion) === expansion.idExpansion,
  );
  const seededExactMappings = cards.filter((card) => cardmarketMatches.has(printingIdentity(card))).length;
  const result = matchCardmarketReleaseProducts({
    groupCode: source.abbreviation,
    expansionId: expansion.idExpansion,
    cards,
    products,
    priceByProduct: cardmarketPricesByProduct,
    seededMatches: cardmarketMatches,
    usedProductIds: usedCardmarketProductIds,
    cardIdentity: printingIdentity,
    cardNumber: regularRulesCardId,
    productNumber: (product) => printedNumber(product.name),
  });
  addCardmarketMappingResult(result, {
    groupCode: source.abbreviation,
    groupKind: 'booster',
    source,
    releaseEvidence: cardmarketExpansionEvidenceByGroup.get(source.groupId).policy,
  });
  cardmarketCoverageByGroup.set(source.abbreviation, {
    groupKind: 'booster',
    expansionId: expansion.idExpansion,
    seededExactMappings,
    ...result.stats,
  });
}

for (const [setCode, evidence] of starterExpansionEvidence.exact) {
  const cards = uniqueCoreCards.filter((card) => isOptcgStarterPrintingForSet(card, setCode));
  const products = productCatalog.products.filter(
    (product) => Number(product.idExpansion) === evidence.idExpansion,
  );
  const result = matchCardmarketReleaseProducts({
    groupCode: setCode,
    expansionId: evidence.idExpansion,
    cards,
    products,
    priceByProduct: cardmarketPricesByProduct,
    seededMatches: cardmarketMatches,
    usedProductIds: usedCardmarketProductIds,
    cardIdentity: printingIdentity,
    cardNumber: regularRulesCardId,
    productNumber: (product) => printedNumber(product.name),
  });
  addCardmarketMappingResult(result, {
    groupCode: setCode,
    groupKind: 'starter-deck',
    releaseEvidence: evidence.policy,
  });
  cardmarketCoverageByGroup.set(setCode, {
    groupKind: 'starter-deck',
    expansionId: evidence.idExpansion,
    seededExactMappings: 0,
    ...result.stats,
  });
}

for (const evidence of starterExpansionEvidence.ambiguous) {
  for (const card of uniqueCoreCards.filter((candidate) =>
    isOptcgStarterPrintingForSet(candidate, evidence.setCode),
  )) {
    cardmarketUnavailable.set(printingIdentity(card), {
      identity: printingIdentity(card),
      number: regularRulesCardId(card),
      groupCode: evidence.setCode,
      groupKind: 'starter-deck',
      reason: evidence.reason,
    });
  }
}

const coreCardByPrintingIdentityV10 = new Map(
  uniqueCoreCards.map((card) => [printingIdentity(card), card]),
);
const previousAssetByIdV10 = new Map(
  (previousSnapshot?.assets ?? []).map((asset) => [asset.id, asset]),
);
const baselineAssetByIdV9 = new Map(
  (baselineSnapshotV9?.assets ?? []).map((asset) => [asset.id, asset]),
);
const cardmarketArtworkReferencesV10 = new Map();
const artworkReferenceFailuresV10 = [];
let persistedArtworkReferencesV10 = 0;
let discoveredArtworkReferencesV10 = 0;
let persistedRegularArtworkReferencesV10 = 0;
let discoveredRegularArtworkReferencesV10 = 0;
let deferredRegularArtworkReferencesV10 = 0;
const persistedArtworkReferenceIdentitiesV10 = new Set();
const discoveredArtworkReferenceIdentitiesV10 = new Set();
const migratedLegacyArtworkReferenceIdentitiesV10 = new Set();
const artworkTransientFallbacksV10 = new Map();
let deferredArtworkReferencesV10 = 0;
const CARDMARKET_ARTWORK_MATCH_POLICY_V10 = 'cardmarket-image-correlation-v2-complete-candidates';
const artworkVerificationObservedAtV10 = new Date().toISOString();

function artworkSourceImageV10(card, number) {
  const starterEnrichment = card.__source === 'starter'
    ? starterEnrichments.get(`${number}|${card.card_name}`) ?? null
    : null;
  return trustedCardImage(card)
    ?? starterEnrichment?.imageUrl
    ?? EXACT_OPTCG_IMAGE_OVERRIDES.get(String(card.card_image_id ?? ''))
    ?? null;
}

const ambiguousArtworkEntriesV10 = [...cardmarketAmbiguities.entries()]
  .map(([identity, ambiguity]) => ({
    identity,
    ambiguity,
    card: coreCardByPrintingIdentityV10.get(identity) ?? null,
  }))
  .filter(({ card }) => card
    && card.__source !== 'don');

const artworkDiscoveryQueueV10 = [];
for (const entry of ambiguousArtworkEntriesV10) {
  const { identity, ambiguity, card } = entry;
  const stableId = cardStableId(card);
  const previousAsset = previousAssetByIdV10.get(stableId) ?? null;
  const previousReference = previousAsset?.cardmarketArtworkReference
    ?? previousAsset?.cardmarketRegularArtReference
    ?? null;
  const reviewedMapping = REVIEWED_CARDMARKET_ARTWORK_MAPPINGS_V10.get(
    String(card.card_image_id ?? ''),
  ) ?? null;
  const reviewedReferenceIsCurrent = previousReference?.reviewedMappingId == null
    || (
      reviewedMapping
      && previousReference.reviewedMappingId === reviewedMapping.reviewId
      && Number(previousReference.productId) === reviewedMapping.productId
      && previousReference.sourceImageDigest === reviewedMapping.sourceImageDigest
      && previousReference.productImageDigest === reviewedMapping.productImageDigest
    );
  const previousProductId = Number(previousReference?.productId);
  const currentCandidate = ambiguity.candidates.find(
    (candidate) => candidate.productId === previousProductId,
  );
  const previousCandidateIds = (previousAsset?.cardmarketCandidates ?? [])
    .map((candidate) => Number(candidate.productId))
    .sort((left, right) => left - right);
  const currentCandidateIds = ambiguity.candidates
    .map((candidate) => Number(candidate.productId))
    .sort((left, right) => left - right);
  const candidateSetUnchanged = previousCandidateIds.length === currentCandidateIds.length
    && previousCandidateIds.every((productId, index) => productId === currentCandidateIds[index]);
  const legacyCandidateCoverageProven = previousReference?.matchPolicy === 'cardmarket-image-correlation-v1'
    && (
      currentCandidateIds.length === 1
      || (currentCandidateIds.length === 2 && Number(previousReference.runnerUpCorrelation) >= 0)
    );
  const completeCandidateCoverageProven = (
    previousReference?.matchPolicy === CARDMARKET_ARTWORK_MATCH_POLICY_V10
    && reviewedReferenceIsCurrent
    && Number(previousReference.candidateCount) === currentCandidateIds.length
    && (
      currentCandidateIds.length === 1
      || Number(previousReference.runnerUpCorrelation) >= 0
    )
  ) || legacyCandidateCoverageProven;
  const legacyImageVerifiedAtV10 = legacyCandidateCoverageProven
    && Number.isFinite(Date.parse(previousSnapshot?.generatedAt ?? ''))
    ? previousSnapshot.generatedAt
    : null;
  const previousImageVerifiedAtV10 = previousReference?.imageVerifiedAt
    ?? legacyImageVerifiedAtV10;
  const evidenceAgeMs = Date.parse(artworkVerificationObservedAtV10)
    - Date.parse(previousImageVerifiedAtV10 ?? '');
  if (
    previousReference?.matchPolicy === CARDMARKET_ARTWORK_MATCH_POLICY_V10
    && completeCandidateCoverageProven
    && candidateSetUnchanged
    && Number.isFinite(evidenceAgeMs)
    && evidenceAgeMs >= 0
    && evidenceAgeMs <= ARTWORK_EVIDENCE_TRANSIENT_GRACE_MS_V10
    && Number(previousReference.expansionId) === Number(ambiguity.expansionId)
    && currentCandidate
  ) {
    artworkTransientFallbacksV10.set(identity, {
      previousReference,
      previousProductId,
      candidateCount: currentCandidateIds.length,
    });
  }
  const imageEvidenceIsFresh = Number.isFinite(evidenceAgeMs)
    && evidenceAgeMs >= 0
    && evidenceAgeMs <= ARTWORK_EVIDENCE_MAX_AGE_MS_V10
    && !sourceRefreshScheduledV10(previousProductId, artworkVerificationObservedAtV10);
  if (
    completeCandidateCoverageProven
    && candidateSetUnchanged
    && imageEvidenceIsFresh
    && Number(previousReference.expansionId) === Number(ambiguity.expansionId)
    && currentCandidate
  ) {
    cardmarketArtworkReferencesV10.set(identity, {
      ...previousReference,
      productId: previousProductId,
      expansionId: Number(ambiguity.expansionId),
      trend: round(cardmarketPricesByProduct.get(previousProductId)?.trend),
      observedAt: priceGuide.createdAt,
      source: 'Cardmarket official price guide + persisted image match',
      matchPolicy: CARDMARKET_ARTWORK_MATCH_POLICY_V10,
      candidateCount: currentCandidateIds.length,
      imageVerifiedAt: previousImageVerifiedAtV10,
      evidence: 'The exact sourced artwork independently matches this Cardmarket product image above the frozen correlation and separation thresholds. The product mapping and trend are eligible for collection valuation and acquisition growth.',
    });
    persistedArtworkReferenceIdentitiesV10.add(identity);
    if (previousReference.matchPolicy === 'cardmarket-image-correlation-v1') {
      migratedLegacyArtworkReferenceIdentitiesV10.add(identity);
    }
    persistedArtworkReferencesV10 += 1;
    if (card.card_image_id === regularRulesCardId(card)) {
      persistedRegularArtworkReferencesV10 += 1;
    }
    continue;
  }
  artworkDiscoveryQueueV10.push(entry);
}
artworkDiscoveryQueueV10.sort((left, right) => {
  const leftSetCode = setCodeForCard(left.card, regularRulesCardId(left.card));
  const rightSetCode = setCodeForCard(right.card, regularRulesCardId(right.card));
  return Number(rightSetCode === requiredCompleteLatestStarterArtworkSetCodeV10)
    - Number(leftSetCode === requiredCompleteLatestStarterArtworkSetCodeV10);
});

function reviewedCardmarketArtworkMatchV10({
  card,
  ambiguity,
  sourceFingerprint,
  candidateImages,
}) {
  const sourcePrintingId = String(card.card_image_id ?? '');
  const reviewed = REVIEWED_CARDMARKET_ARTWORK_MAPPINGS_V10.get(sourcePrintingId) ?? null;
  if (!reviewed) return null;
  const number = regularRulesCardId(card);
  const setCode = setCodeForCard(card, number);
  const candidateProductIds = candidateImages
    .map((candidate) => Number(candidate.productId))
    .sort((left, right) => left - right);
  if (
    reviewed.setCode !== setCode
    || reviewed.number !== number
    || ambiguity.groupCode !== reviewed.setCode
    || candidateProductIds.length !== reviewed.candidateProductIds.length
    || candidateProductIds.some(
      (productId, index) => productId !== reviewed.candidateProductIds[index],
    )
  ) {
    throw new Error(
      `Reviewed Cardmarket artwork mapping ${reviewed.reviewId} left its exact release candidate set.`,
    );
  }
  const selected = candidateImages.find(
    (candidate) => Number(candidate.productId) === reviewed.productId,
  );
  if (
    sourceFingerprint.digest !== reviewed.sourceImageDigest
    || selected?.fingerprint.digest !== reviewed.productImageDigest
  ) {
    throw new Error(
      `Reviewed Cardmarket artwork mapping ${reviewed.reviewId} changed an image digest.`,
    );
  }
  const ranking = candidateImages
    .map((candidate) => ({
      candidate,
      correlation: artworkCorrelationV1(sourceFingerprint, candidate.fingerprint),
    }))
    .sort((left, right) => right.correlation - left.correlation
      || Number(left.candidate.productId) - Number(right.candidate.productId));
  if (
    Number(ranking[0]?.candidate.productId) !== reviewed.productId
    || ranking[0].correlation < reviewed.minimumCorrelation
  ) {
    throw new Error(
      `Reviewed Cardmarket artwork mapping ${reviewed.reviewId} lost its complete-candidate correlation.`,
    );
  }
  const runnerUpCorrelation = ranking[1]?.correlation ?? null;
  return {
    productId: reviewed.productId,
    correlation: ranking[0].correlation,
    runnerUpCorrelation,
    margin: ranking[0].correlation - (runnerUpCorrelation ?? -1),
    sourceDigest: sourceFingerprint.digest,
    productDigest: selected.fingerprint.digest,
    reviewedMappingId: reviewed.reviewId,
    reviewedMinimumCorrelation: reviewed.minimumCorrelation,
    reviewedEvidence: reviewed.evidence,
  };
}

const artworkDiscoveryDeadlineV10 = Date.now() + ARTWORK_DISCOVERY_BUDGET_MS_V9;
const artworkDiscoveryResultsV10 = await mapWithConcurrencyV1(
  artworkDiscoveryQueueV10,
  4,
  async ({ identity, ambiguity, card }) => {
    if (Date.now() >= artworkDiscoveryDeadlineV10) {
      return {
        identity,
        error: 'The bounded exact-artwork discovery budget was exhausted.',
        transient: true,
      };
    }
    const number = regularRulesCardId(card);
    const sourceImageUrl = artworkSourceImageV10(card, number);
    if (!sourceImageUrl) {
      return { identity, error: 'The sourced printing has no trusted image URL.' };
    }
    try {
      const sourceFingerprint = await artworkFingerprintFromUrlV9(sourceImageUrl);
      const candidateResults = await Promise.all(ambiguity.candidates.map(async (candidate) => {
        try {
          const image = await cardmarketProductFingerprintV9(
            ambiguity.groupCode,
            candidate.productId,
          );
          return { image: {
            productId: candidate.productId,
            fingerprint: image.fingerprint,
            imageUrl: image.url,
          } };
        } catch (error) {
          return {
            image: null,
            transient: artworkImageErrorIsTransientV10(error),
          };
        }
      }));
      const candidateImages = candidateResults
        .map((result) => result.image)
        .filter(Boolean);
      if (!hasCompleteArtworkCandidateSetV2(ambiguity.candidates, candidateImages)) {
        const missingResults = candidateResults.filter((result) => !result.image);
        return {
          identity,
          error: `Only ${candidateImages.length} of ${ambiguity.candidates.length} Cardmarket candidate images were available; exact-art matching is fail-closed until the complete candidate set can be compared.`,
          transient: missingResults.length > 0
            && missingResults.every((result) => result.transient === true),
        };
      }
      const match = reviewedCardmarketArtworkMatchV10({
        card,
        ambiguity,
        sourceFingerprint,
        candidateImages,
      }) ?? chooseRegularArtImageMatchV1({
        sourceFingerprint,
        candidates: candidateImages,
      });
      if (!match) {
        return {
          identity,
          error: 'No Cardmarket candidate passed the frozen image-correlation and separation thresholds.',
        };
      }
      const matchedImage = candidateImages.find(
        (candidate) => candidate.productId === match.productId,
      );
      return {
        identity,
        reference: {
          productId: match.productId,
          expansionId: Number(ambiguity.expansionId),
          trend: round(cardmarketPricesByProduct.get(match.productId)?.trend),
          observedAt: priceGuide.createdAt,
          source: 'Cardmarket official price guide + product image',
          matchPolicy: CARDMARKET_ARTWORK_MATCH_POLICY_V10,
          candidateCount: candidateImages.length,
          imageVerifiedAt: artworkVerificationObservedAtV10,
          correlation: Number(match.correlation.toFixed(6)),
          runnerUpCorrelation: match.runnerUpCorrelation == null
            ? null
            : Number(match.runnerUpCorrelation.toFixed(6)),
          margin: Number(match.margin.toFixed(6)),
          sourceImageUrl,
          productImageUrl: matchedImage.imageUrl,
          sourceImageDigest: match.sourceDigest,
          productImageDigest: match.productDigest,
          ...(match.reviewedMappingId ? {
            reviewedMappingId: match.reviewedMappingId,
            reviewedMinimumCorrelation: match.reviewedMinimumCorrelation,
          } : {}),
          evidence: match.reviewedMappingId
            ? `The exact sourced artwork uses reviewed normalized-image digests after the complete release candidate set was compared. ${match.reviewedEvidence}`
            : 'The exact sourced artwork independently matches this Cardmarket product image above the frozen correlation and separation thresholds. The product mapping and trend are eligible for collection valuation and acquisition growth.',
        },
      };
    } catch (error) {
      return {
        identity,
        error: error instanceof Error ? error.message : String(error),
        transient: artworkImageErrorIsTransientV10(error),
      };
    }
  },
);

for (const result of artworkDiscoveryResultsV10) {
  if (result.reference) {
    cardmarketArtworkReferencesV10.set(result.identity, result.reference);
    discoveredArtworkReferenceIdentitiesV10.add(result.identity);
    discoveredArtworkReferencesV10 += 1;
    const card = coreCardByPrintingIdentityV10.get(result.identity);
    if (card?.card_image_id === regularRulesCardId(card)) {
      discoveredRegularArtworkReferencesV10 += 1;
    }
  } else if (result.transient && artworkTransientFallbacksV10.has(result.identity)) {
    const fallback = artworkTransientFallbacksV10.get(result.identity);
    cardmarketArtworkReferencesV10.set(result.identity, {
      ...fallback.previousReference,
      productId: fallback.previousProductId,
      trend: round(cardmarketPricesByProduct.get(fallback.previousProductId)?.trend),
      observedAt: priceGuide.createdAt,
      source: 'Cardmarket official price guide + persisted image match; transient image refresh deferred',
      matchPolicy: CARDMARKET_ARTWORK_MATCH_POLICY_V10,
      candidateCount: fallback.candidateCount,
      imageVerifiedAt: fallback.previousReference.imageVerifiedAt,
      refreshDeferredAt: artworkVerificationObservedAtV10,
      refreshDeferredReason: result.error,
      evidence: 'The exact sourced artwork previously passed the complete-candidate image policy. A bounded transient network failure deferred its scheduled image revalidation within the 21-day grace window; the original imageVerifiedAt timestamp is preserved and its current product trend remains eligible for valuation.',
    });
    persistedArtworkReferenceIdentitiesV10.add(result.identity);
    persistedArtworkReferencesV10 += 1;
    deferredArtworkReferencesV10 += 1;
    const card = coreCardByPrintingIdentityV10.get(result.identity);
    if (card?.card_image_id === regularRulesCardId(card)) {
      persistedRegularArtworkReferencesV10 += 1;
      deferredRegularArtworkReferencesV10 += 1;
    }
  } else {
    const ambiguity = cardmarketAmbiguities.get(result.identity);
    artworkReferenceFailuresV10.push({
      identity: result.identity,
      groupCode: ambiguity?.groupCode ?? null,
      number: ambiguity?.number ?? null,
      reason: result.error,
    });
  }
}
const artworkReferenceConflictsV10 = [];
const duplicateArtworkAliasIdentityV10 = new Map();
const artworkReferenceIdentitiesByProductV10 = new Map();
for (const [identity, reference] of cardmarketArtworkReferencesV10) {
  const identities = artworkReferenceIdentitiesByProductV10.get(reference.productId) ?? [];
  identities.push(identity);
  artworkReferenceIdentitiesByProductV10.set(reference.productId, identities);
}
for (const [productId, identities] of artworkReferenceIdentitiesByProductV10) {
  const sourceDigests = new Set(identities
    .map((identity) => cardmarketArtworkReferencesV10.get(identity)?.sourceImageDigest)
    .filter((digest) => typeof digest === 'string' && digest.length > 0));
  if (identities.length <= 1) continue;
  const physicalPrintingKeys = new Set(identities.map((identity) => {
    const card = coreCardByPrintingIdentityV10.get(identity);
    return [
      rulesCardId(card),
      setCodeForCard(card, rulesCardId(card)),
      card?.card_image_id,
    ].join('|');
  }));
  const safeDuplicateSourceRecords = sourceDigests.size === 1
    && physicalPrintingKeys.size === 1;
  let rejectedIdentities = identities;
  let canonicalIdentity = null;
  let aliasedIdentities = [];
  if (safeDuplicateSourceRecords) {
    const orderedIdentities = [...identities].sort((leftIdentity, rightIdentity) => {
      const left = coreCardByPrintingIdentityV10.get(leftIdentity);
      const right = coreCardByPrintingIdentityV10.get(rightIdentity);
      const qualifier = /(?:alternate art|full art|dash pack|special|\(sp\)|reprint)/i;
      const leftRank = qualifier.test(String(left?.card_name ?? '')) ? 1 : 0;
      const rightRank = qualifier.test(String(right?.card_name ?? '')) ? 1 : 0;
      return leftRank - rightRank || leftIdentity.localeCompare(rightIdentity);
    });
    [canonicalIdentity] = orderedIdentities;
    aliasedIdentities = orderedIdentities.slice(1);
    for (const aliasIdentity of aliasedIdentities) {
      duplicateArtworkAliasIdentityV10.set(aliasIdentity, canonicalIdentity);
    }
    // These rows are duplicate source records for one physical printing, not
    // competing artwork matches. Keep the verified quote on every stable ID so
    // an existing collection created before canonicalization retains its value;
    // catalogAliasOf hides the aliases from all new-add flows.
    rejectedIdentities = [];
  }
  const conflict = {
    productId,
    identities,
    rejectedIdentities,
    canonicalIdentity,
    aliasedIdentities,
    sourceImageDigests: [...sourceDigests],
    reason: safeDuplicateSourceRecords
      ? 'Duplicate OPTCG source records share one physical printing. A deterministic canonical add target is retained; hidden aliases keep the identical verified quote so historical collection values remain intact.'
      : sourceDigests.size > 1
      ? 'One Cardmarket product image independently matched multiple visually distinct source images; every conflicting mapping was rejected.'
      : 'One Cardmarket product image matched multiple distinct physical-printing identities; every conflicting mapping was rejected.',
  };
  artworkReferenceConflictsV10.push(conflict);
  for (const identity of rejectedIdentities) {
    const card = coreCardByPrintingIdentityV10.get(identity);
    cardmarketArtworkReferencesV10.delete(identity);
    if (persistedArtworkReferenceIdentitiesV10.delete(identity)) {
      migratedLegacyArtworkReferenceIdentitiesV10.delete(identity);
      persistedArtworkReferencesV10 -= 1;
      if (card?.card_image_id === regularRulesCardId(card)) {
        persistedRegularArtworkReferencesV10 -= 1;
      }
    }
    if (discoveredArtworkReferenceIdentitiesV10.delete(identity)) {
      discoveredArtworkReferencesV10 -= 1;
      if (card?.card_image_id === regularRulesCardId(card)) {
        discoveredRegularArtworkReferencesV10 -= 1;
      }
    }
    const ambiguity = cardmarketAmbiguities.get(identity);
    artworkReferenceFailuresV10.push({
      identity,
      groupCode: ambiguity?.groupCode ?? null,
      number: ambiguity?.number ?? null,
      reason: conflict.reason,
    });
  }
}
for (const [productId, identities] of artworkReferenceIdentitiesByProductV10) {
  const retainedIdentities = identities.filter(
    (identity) => cardmarketArtworkReferencesV10.has(identity),
  );
  if (retainedIdentities.length > 1) {
    const canonicalIdentities = retainedIdentities.filter(
      (identity) => !duplicateArtworkAliasIdentityV10.has(identity),
    );
    const canonicalIdentity = canonicalIdentities.length === 1
      ? canonicalIdentities[0]
      : null;
    const isOnePhysicalPrintingAliasGroup = canonicalIdentity != null
      && retainedIdentities.every((identity) => identity === canonicalIdentity
        || duplicateArtworkAliasIdentityV10.get(identity) === canonicalIdentity);
    if (!isOnePhysicalPrintingAliasGroup) {
      throw new Error(`Cardmarket artwork reference is not one-to-one for product ${productId}.`);
    }
  }
}
const metadataMappedProductIdsV10 = new Set(
  [...cardmarketMatches.values()].map((match) => Number(match.product.idProduct)),
);
for (const reference of cardmarketArtworkReferencesV10.values()) {
  if (metadataMappedProductIdsV10.has(Number(reference.productId))) {
    throw new Error(`Cardmarket product ${reference.productId} is mapped by both metadata and image identity.`);
  }
}
const regularArtworkReferenceFailuresV10 = artworkReferenceFailuresV10.filter(({ identity }) => {
  const card = coreCardByPrintingIdentityV10.get(identity);
  return card?.card_image_id === regularRulesCardId(card);
});

// Preserve the conservative standard-art joins above. For every other exact
// Cardmarket-mapped set printing, promote a TCGplayer identity only when the
// Cardmarket product image independently selects one product from the complete
// non-presale TCGCSV candidate set for that exact released group and number.
// Names, source order, product IDs, and prices never participate in the match.
const tcgplayerArtworkMatchesV1 = new Map();
const tcgplayerArtworkReferenceFailuresV1 = [];
const persistedTcgplayerArtworkReferenceIdentitiesV1 = new Set();
const discoveredTcgplayerArtworkReferenceIdentitiesV1 = new Set();
const deferredTcgplayerArtworkReferenceIdentitiesV1 = new Set();
const tcgplayerArtworkMappingsByGroupV1 = new Map(
  tcgcsvMarketSources.map((source) => [source.abbreviation, 0]),
);
const verifiedOp13LuffyArtworkPairsV1 = new Map([
  [857338, 657403],
  [857339, 657402],
  [857340, 657401],
  [857341, 657404],
]);
const TCGPLAYER_ARTWORK_BUDGET_EXHAUSTED_V1 = 'The bounded TCGplayer exact-artwork discovery budget was exhausted; optional mappings were deferred without aborting the catalog sync.';

function exactCardmarketProductIdForIdentityV1(identity) {
  const metadataMatch = cardmarketMatches.get(identity) ?? null;
  const imageReference = cardmarketArtworkReferencesV10.get(identity) ?? null;
  const productId = Number(metadataMatch?.product?.idProduct ?? imageReference?.productId);
  return Number.isInteger(productId) && productId > 0 ? productId : null;
}

function tcgplayerArtworkImageUrlV1(product) {
  const imageUrl = canonicalImageUrl(product?.imageUrl);
  return imageUrl && isTrustedTcgplayerImage(imageUrl) ? imageUrl : null;
}

function currentCardmarketCandidateProductIdsV1(identity, cardmarketProductId) {
  const ambiguity = cardmarketAmbiguities.get(identity) ?? null;
  if (!ambiguity) return [cardmarketProductId];
  const productIds = ambiguity.candidates
    .map((candidate) => Number(candidate.productId))
    .sort((left, right) => left - right);
  return productIds.length > 0
    && productIds.every((productId) => Number.isInteger(productId) && productId > 0)
    && new Set(productIds).size === productIds.length
    && productIds.includes(cardmarketProductId)
    ? productIds
    : [];
}

function persistedTcgplayerArtworkMatchV1(entry, reusable, deferredReason = null) {
  const product = entry.candidates.find(
    (candidate) => Number(candidate.productId) === reusable.productId,
  );
  if (!product) {
    throw new Error(`Persisted TCGplayer product ${reusable.productId} left its exact candidate set.`);
  }
  const {
    refreshDeferredAt: _previousRefreshDeferredAt,
    refreshDeferredReason: _previousRefreshDeferredReason,
    ...previousReference
  } = reusable.reference;
  const priceRows = tcgcsvPriceRows(entry.source.priceIndex, product.productId);
  return {
    product,
    price: exactTcgcsvPrice(entry.source.priceIndex, product.productId),
    priceRows,
    groupId: entry.source.groupId,
    abbreviation: entry.source.abbreviation,
    reference: {
      ...previousReference,
      productId: reusable.productId,
      setCode: entry.setCode,
      groupId: entry.source.groupId,
      groupAbbreviation: entry.source.abbreviation,
      number: entry.number,
      cardmarketProductId: entry.cardmarketProductId,
      observedAt: tcgcsvCreatedAt,
      source: deferredReason
        ? 'TCGCSV product catalog + persisted complete-candidate image match (refresh deferred)'
        : 'TCGCSV product catalog + persisted complete-candidate image match',
      matchPolicy: TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.version,
      candidateCount: entry.candidateProductIds.length,
      candidateProductIds: entry.candidateProductIds,
      cardmarketCandidateCount: entry.cardmarketCandidateProductIds.length,
      cardmarketCandidateProductIds: entry.cardmarketCandidateProductIds,
      imageVerifiedAt: reusable.reference.imageVerifiedAt,
      ...(deferredReason ? {
        refreshDeferredAt: artworkVerificationObservedAtV10,
        refreshDeferredReason: deferredReason,
      } : {}),
      evidence: deferredReason
        ? 'The exact Cardmarket and TCGplayer artwork previously passed the frozen complete-candidate image policy. The provider candidate sets and exact set, group, number, and Cardmarket identity are unchanged; a bounded transient refresh failure was deferred within the 21-day grace window while the original imageVerifiedAt timestamp was preserved.'
        : 'The exact Cardmarket and TCGplayer artwork previously passed the frozen complete-candidate image policy. The provider candidate sets and exact set, group, number, and Cardmarket identity remain unchanged within the 14-day freshness window.',
    },
  };
}

const tcgplayerArtworkDiscoveryQueueV1 = [];
for (const card of uniqueCoreCards) {
  const identity = printingIdentity(card);
  if (baseTcgplayerMatches.has(identity) || card.__source !== 'set') continue;
  const cardmarketProductId = exactCardmarketProductIdForIdentityV1(identity);
  if (cardmarketProductId == null) continue;

  const number = regularRulesCardId(card);
  const matchingSources = tcgcsvMarketSources.filter(
    (source) => isOptcgReleasePrintingForGroup(card, source),
  );
  if (matchingSources.length !== 1) {
    tcgplayerArtworkReferenceFailuresV1.push({
      identity,
      number,
      cardmarketProductId,
      reason: `Expected one exact released TCGCSV group for the OPTCG source printing; found ${matchingSources.length}.`,
    });
    continue;
  }

  const [source] = matchingSources;
  const setCode = setCodeForCard(card, number);
  const candidates = source.products.filter((product) => (
    tcgcsvCardNumber(product) === number
    && product.presaleInfo?.isPresale !== true
  ));
  const candidateProductIds = candidates
    .map((product) => Number(product.productId))
    .sort((left, right) => left - right);
  const cardmarketCandidateProductIds = currentCardmarketCandidateProductIdsV1(
    identity,
    cardmarketProductId,
  );
  if (
    !setCode
    || candidates.length === 0
    || candidateProductIds.some((productId) => !Number.isInteger(productId) || productId <= 0)
    || new Set(candidateProductIds).size !== candidateProductIds.length
    || candidates.some((product) => Number(product.groupId) !== Number(source.groupId))
    || cardmarketCandidateProductIds.length === 0
  ) {
    tcgplayerArtworkReferenceFailuresV1.push({
      identity,
      groupCode: source.abbreviation,
      groupId: source.groupId,
      number,
      cardmarketProductId,
      candidateProductIds,
      cardmarketCandidateProductIds,
      reason: 'The exact released set/group/number provider candidate sets were empty, duplicated, or lost their source identity.',
    });
    continue;
  }

  const entry = {
    identity,
    number,
    setCode,
    source,
    groupCode: source.abbreviation,
    cardmarketProductId,
    cardmarketTrend: Number(cardmarketPricesByProduct.get(cardmarketProductId)?.trend),
    requiredInvariant: number === 'OP13-118'
      && verifiedOp13LuffyArtworkPairsV1.has(cardmarketProductId),
    candidates,
    candidateProductIds,
    cardmarketCandidateProductIds,
  };
  const reusable = reusableTcgplayerArtworkReferenceV1({
    previousAsset: previousAssetByIdV10.get(cardStableId(card)) ?? null,
    cardmarketProductId,
    cardmarketCandidateProductIds,
    setCode,
    groupId: source.groupId,
    groupAbbreviation: source.abbreviation,
    number,
    requestedCandidates: candidates,
    observedAt: artworkVerificationObservedAtV10,
  });
  if (
    reusable?.fresh
    && !tcgplayerArtworkRefreshScheduledV1(
      cardmarketProductId,
      artworkVerificationObservedAtV10,
    )
  ) {
    tcgplayerArtworkMatchesV1.set(
      identity,
      persistedTcgplayerArtworkMatchV1(entry, reusable),
    );
    persistedTcgplayerArtworkReferenceIdentitiesV1.add(identity);
    continue;
  }
  tcgplayerArtworkDiscoveryQueueV1.push({ ...entry, reusable });
}
tcgplayerArtworkDiscoveryQueueV1.sort(compareTcgplayerArtworkDiscoveryPriorityV1);

const tcgplayerArtworkDiscoveryDeadlineV1 = Date.now()
  + TCGPLAYER_ARTWORK_DISCOVERY_BUDGET_MS_V1;
const tcgplayerArtworkDiscoveryResultsV1 = await mapWithConcurrencyV1(
  tcgplayerArtworkDiscoveryQueueV1,
  4,
  async (entry) => {
    const {
      identity,
      number,
      setCode,
      source,
      cardmarketProductId,
      candidates,
      candidateProductIds,
      cardmarketCandidateProductIds,
    } = entry;
    if (Date.now() >= tcgplayerArtworkDiscoveryDeadlineV1) {
      return {
        entry,
        identity,
        groupCode: source.abbreviation,
        number,
        cardmarketProductId,
        candidateProductIds,
        transient: true,
        error: TCGPLAYER_ARTWORK_BUDGET_EXHAUSTED_V1,
      };
    }
    try {
      const cardmarketImage = await cardmarketProductFingerprintV9(
        source.abbreviation,
        cardmarketProductId,
      );
      if (Date.now() >= tcgplayerArtworkDiscoveryDeadlineV1) {
        return {
          entry,
          identity,
          groupCode: source.abbreviation,
          number,
          cardmarketProductId,
          candidateProductIds,
          transient: true,
          error: TCGPLAYER_ARTWORK_BUDGET_EXHAUSTED_V1,
        };
      }
      const candidateResults = await Promise.all(candidates.map(async (product) => {
        const imageUrl = tcgplayerArtworkImageUrlV1(product);
        if (!imageUrl) return { image: null, transient: false };
        try {
          return {
            image: {
              productId: Number(product.productId),
              imageUrl,
              fingerprint: await artworkFingerprintFromUrlV9(imageUrl),
            },
          };
        } catch (error) {
          return {
            image: null,
            transient: artworkImageErrorIsTransientV10(error),
          };
        }
      }));
      const candidateImages = candidateResults
        .map((result) => result.image)
        .filter(Boolean);
      if (!hasCompleteTcgplayerArtworkCandidateSetV1(candidates, candidateImages)) {
        const missingResults = candidateResults.filter((result) => !result.image);
        return {
          entry,
          identity,
          groupCode: source.abbreviation,
          number,
          cardmarketProductId,
          candidateProductIds,
          transient: missingResults.length > 0
            && missingResults.every((result) => result.transient === true),
          error: `Only ${candidateImages.length} of ${candidates.length} exact TCGplayer candidate images were available; artwork identity remains unmapped.`,
        };
      }

      const match = chooseTcgplayerArtworkImageMatchV1({
        cardmarketProductId,
        cardmarketFingerprint: cardmarketImage.fingerprint,
        requestedCandidates: candidates,
        availableCandidateImages: candidateImages,
      });
      if (!match) {
        return {
          entry,
          identity,
          groupCode: source.abbreviation,
          number,
          cardmarketProductId,
          candidateProductIds,
          transient: false,
          error: 'No TCGplayer candidate passed the frozen Cardmarket-image correlation and separation thresholds.',
        };
      }

      const product = candidates.find(
        (candidate) => Number(candidate.productId) === match.productId,
      );
      if (!product) throw new Error(`Matched TCGplayer product ${match.productId} left its candidate set.`);
      const priceRows = tcgcsvPriceRows(source.priceIndex, product.productId);
      const price = exactTcgcsvPrice(source.priceIndex, product.productId);
      return {
        entry,
        identity,
        match: {
          product,
          price,
          priceRows,
          groupId: source.groupId,
          abbreviation: source.abbreviation,
          reference: {
            productId: match.productId,
            setCode,
            groupId: source.groupId,
            groupAbbreviation: source.abbreviation,
            number,
            cardmarketProductId,
            observedAt: tcgcsvCreatedAt,
            source: 'TCGCSV product catalog + TCGplayer product image + Cardmarket product image',
            matchPolicy: TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.version,
            candidateCount: match.candidateCount,
            candidateProductIds: match.candidateProductIds,
            cardmarketCandidateCount: cardmarketCandidateProductIds.length,
            cardmarketCandidateProductIds,
            imageVerifiedAt: artworkVerificationObservedAtV10,
            correlation: Number(match.correlation.toFixed(6)),
            runnerUpCorrelation: match.runnerUpCorrelation == null
              ? null
              : Number(match.runnerUpCorrelation.toFixed(6)),
            margin: Number(match.margin.toFixed(6)),
            cardmarketImageUrl: cardmarketImage.url,
            tcgplayerImageUrl: match.tcgplayerImageUrl,
            cardmarketImageDigest: match.cardmarketImageDigest,
            tcgplayerImageDigest: match.tcgplayerImageDigest,
            evidence: 'The exact Cardmarket product image independently matches this TCGplayer product image above the frozen correlation and separation thresholds after every non-presale product for the exact released group and printed number was compared.',
          },
        },
      };
    } catch (error) {
      return {
        entry,
        identity,
        groupCode: source.abbreviation,
        number,
        cardmarketProductId,
        candidateProductIds,
        transient: artworkImageErrorIsTransientV10(error),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

for (const result of tcgplayerArtworkDiscoveryResultsV1) {
  if (result.match) {
    tcgplayerArtworkMatchesV1.set(result.identity, result.match);
    discoveredTcgplayerArtworkReferenceIdentitiesV1.add(result.identity);
  } else if (result.transient && result.entry?.reusable) {
    tcgplayerArtworkMatchesV1.set(
      result.identity,
      persistedTcgplayerArtworkMatchV1(
        result.entry,
        result.entry.reusable,
        result.error,
      ),
    );
    persistedTcgplayerArtworkReferenceIdentitiesV1.add(result.identity);
    deferredTcgplayerArtworkReferenceIdentitiesV1.add(result.identity);
  } else {
    tcgplayerArtworkReferenceFailuresV1.push({
      identity: result.identity,
      groupCode: result.groupCode,
      number: result.number,
      cardmarketProductId: result.cardmarketProductId,
      candidateProductIds: result.candidateProductIds,
      reason: result.error,
    });
  }
}
const requiredLatestStarterArtworkCardsV10 = requiredCompleteLatestStarterArtworkSetCodeV10
  ? uniqueCoreCards.filter((card) => (
    setCodeForCard(card, regularRulesCardId(card))
      === requiredCompleteLatestStarterArtworkSetCodeV10
  ))
  : [];
const incompleteRequiredLatestStarterArtworkCardsV10 =
  requiredLatestStarterArtworkCardsV10.filter((card) => {
    const identity = printingIdentity(card);
    const productId = Number(
      cardmarketMatches.get(identity)?.product?.idProduct
      ?? cardmarketArtworkReferencesV10.get(identity)?.productId,
    );
    return !Number.isInteger(productId)
      || productId <= 0
      || cardmarketPricesByProduct.get(productId)?.trend == null;
  });
if (
  requiredCompleteLatestStarterArtworkSetCodeV10 == null
  || requiredLatestStarterArtworkCardsV10.length === 0
  || incompleteRequiredLatestStarterArtworkCardsV10.length > 0
) {
  throw new Error(
    `Latest released starter artwork coverage is incomplete for ${
      requiredCompleteLatestStarterArtworkSetCodeV10 ?? 'unknown'
    }: ${incompleteRequiredLatestStarterArtworkCardsV10
      .map((card) => String(card.card_image_id ?? regularRulesCardId(card)))
      .join(', ') || 'no released starter records'}.`,
  );
}

// One provider product may represent only one visible physical printing. The
// sole exception is the existing hidden-alias mechanism for duplicate OPTCG
// source rows that already share one exact physical artwork.
const tcgplayerIdentitiesByProductV1 = new Map();
for (const [identity, match] of baseTcgplayerMatches) {
  tcgplayerIdentitiesByProductV1.set(Number(match.product.productId), [identity]);
}
for (const [identity, match] of tcgplayerArtworkMatchesV1) {
  const productId = Number(match.product.productId);
  const identities = tcgplayerIdentitiesByProductV1.get(productId) ?? [];
  identities.push(identity);
  tcgplayerIdentitiesByProductV1.set(productId, identities);
}
for (const [productId, identities] of tcgplayerIdentitiesByProductV1) {
  if (identities.length <= 1) continue;
  const canonicalIdentities = identities.filter(
    (identity) => !duplicateArtworkAliasIdentityV10.has(identity),
  );
  const canonicalIdentity = canonicalIdentities.length === 1
    ? canonicalIdentities[0]
    : null;
  const isOnePhysicalPrintingAliasGroup = canonicalIdentity != null
    && identities.every((identity) => identity === canonicalIdentity
      || duplicateArtworkAliasIdentityV10.get(identity) === canonicalIdentity);
  if (isOnePhysicalPrintingAliasGroup) continue;
  for (const identity of identities) {
    const rejected = tcgplayerArtworkMatchesV1.get(identity);
    if (!rejected) continue;
    tcgplayerArtworkMatchesV1.delete(identity);
    persistedTcgplayerArtworkReferenceIdentitiesV1.delete(identity);
    discoveredTcgplayerArtworkReferenceIdentitiesV1.delete(identity);
    deferredTcgplayerArtworkReferenceIdentitiesV1.delete(identity);
    tcgplayerArtworkReferenceFailuresV1.push({
      identity,
      groupCode: rejected.abbreviation,
      number: rejected.reference.number,
      cardmarketProductId: rejected.reference.cardmarketProductId,
      candidateProductIds: rejected.reference.candidateProductIds,
      reason: `TCGplayer product ${productId} matched more than one distinct physical printing; every non-base conflicting artwork mapping was rejected.`,
    });
  }
}

for (const match of tcgplayerArtworkMatchesV1.values()) {
  tcgplayerArtworkMappingsByGroupV1.set(
    match.abbreviation,
    (tcgplayerArtworkMappingsByGroupV1.get(match.abbreviation) ?? 0) + 1,
  );
}
const exactTcgplayerMatchesV1 = new Map(baseTcgplayerMatches);
for (const [identity, match] of tcgplayerArtworkMatchesV1) {
  if (exactTcgplayerMatchesV1.has(identity)) {
    throw new Error(`TCGplayer artwork mapping attempted to replace a preserved base mapping for ${identity}.`);
  }
  exactTcgplayerMatchesV1.set(identity, match);
}

const additionalBoosterCardmarketMatches = additionalCardmarketMatches.filter(
  (match) => match.groupKind === 'booster',
);
const additionalStarterCardmarketMatches = additionalCardmarketMatches.filter(
  (match) => match.groupKind === 'starter-deck',
);
if (additionalBoosterCardmarketMatches.length < 150) {
  throw new Error(`Cardmarket v8 exact booster coverage regressed to ${additionalBoosterCardmarketMatches.length}; expected at least 150 safe additions.`);
}
if (new Set([...cardmarketMatches.values()].map((match) => Number(match.product.idProduct))).size
  !== cardmarketMatches.size) {
  throw new Error('Cardmarket v8 exact mappings reused a product across printings.');
}

const generatedAt = new Date().toISOString();
const coreCardAssets = uniqueCoreCards.map((card) => {
  const number = rulesCardId(card);
  const canonicalName = card.__source === 'don'
    ? String(card.optcg_don_name ?? card.card_name ?? 'DON!! Card').trim()
    : nameByRulesCard.get(number) ?? String(card.card_name ?? number).trim();
  const exactPrintingIdentity = printingIdentity(card);
  const cardmarketMatch = cardmarketMatches.get(exactPrintingIdentity) ?? null;
  const cardmarketAmbiguity = cardmarketAmbiguities.get(exactPrintingIdentity) ?? null;
  const cardmarketUnavailableEntry = cardmarketUnavailable.get(exactPrintingIdentity) ?? null;
  const cardmarketArtworkReference = cardmarketArtworkReferencesV10.get(exactPrintingIdentity) ?? null;
  const cardmarketPrice = cardmarketMatch?.price
    ?? (cardmarketArtworkReference
      ? cardmarketPricesByProduct.get(cardmarketArtworkReference.productId) ?? null
      : null);
  const cardmarketRegularArtReference = card.card_image_id === regularRulesCardId(card)
    ? cardmarketArtworkReference
    : null;
  const baseTcgplayerMatch = baseTcgplayerMatches.get(exactPrintingIdentity) ?? null;
  const tcgplayerArtworkMatch = tcgplayerArtworkMatchesV1.get(exactPrintingIdentity) ?? null;
  const exactTcgplayerMatch = exactTcgplayerMatchesV1.get(exactPrintingIdentity) ?? null;
  const starterEnrichment = card.__source === 'starter'
    ? starterEnrichments.get(`${number}|${card.card_name}`) ?? null
    : null;
  const imageUrl = trustedCardImage(card)
    ?? starterEnrichment?.imageUrl
    ?? EXACT_OPTCG_IMAGE_OVERRIDES.get(String(card.card_image_id ?? ''))
    ?? null;
  const tcgplayerPrice = exactTcgplayerMatch?.price ?? starterEnrichment?.price ?? null;
  const tcgplayerPriceRows = exactTcgplayerMatch?.priceRows
    ?? (starterEnrichment ? [starterEnrichment.price] : []);
  const stableId = cardStableId(card);
  const canonicalArtworkIdentity = duplicateArtworkAliasIdentityV10.get(exactPrintingIdentity);
  const catalogAliasOf = canonicalArtworkIdentity
    ? cardStableId(coreCardByPrintingIdentityV10.get(canonicalArtworkIdentity))
    : null;
  const optcgDate = String(card.date_scraped ?? generatedAt);
  const cardmarketPriceState = cardmarketMatch || cardmarketArtworkReference
    ? cardmarketPrice?.trend != null ? 'available' : 'trend-unavailable'
    : cardmarketAmbiguity
      ? 'ambiguous-artwork'
      : 'unmapped';
  const cardmarketPriceReason = cardmarketMatch
    ? cardmarketPrice?.trend != null
      ? 'An exact Cardmarket product is verified for this artwork and its daily trend is available.'
      : 'An exact Cardmarket product is verified, but the current daily price guide has no trend for it.'
    : cardmarketArtworkReference
      ? cardmarketPrice?.trend != null
        ? 'This exact artwork is verified against its Cardmarket product image and its daily trend is available.'
        : 'This exact artwork is verified against its Cardmarket product image, but the current daily price guide has no trend for it.'
    : cardmarketAmbiguity
      ? `${cardmarketAmbiguity.reason} Candidate prices are not used for collection valuation.`
      : cardmarketUnavailableEntry?.reason
        ?? (card.__source === 'don'
          ? 'The Cardmarket public catalog does not expose an artwork-safe product mapping for this DON!! design.'
          : 'No exact Cardmarket product mapping is proven for this printing by the available public catalogs.');
  const cardmarketCandidates = cardmarketAmbiguity?.candidates.map((candidate) => ({
    productId: candidate.productId,
    trend: round(candidate.trend),
  })) ?? null;
  const cardmarketCandidatePriceRange = cardmarketAmbiguity ? {
    minimumTrend: round(cardmarketAmbiguity.priceRange.minimumTrend),
    maximumTrend: round(cardmarketAmbiguity.priceRange.maximumTrend),
    pricedCandidates: cardmarketAmbiguity.priceRange.pricedCandidates,
    totalCandidates: cardmarketAmbiguity.priceRange.totalCandidates,
  } : null;

  return {
    id: stableId,
    ...(catalogAliasOf ? { catalogAliasOf } : {}),
    kind: 'card',
    name: canonicalName,
    set: setNameForCard(card),
    setCode: setCodeForCard(card, number),
    number,
    rulesCardId: number,
    printingId: printingId(card),
    sourcePrintingId: card.card_image_id ?? null,
    cardmarketProductId: cardmarketMatch?.product.idProduct
      ?? cardmarketArtworkReference?.productId
      ?? null,
    cardmarketExpansionId: cardmarketMatch?.product.idExpansion
      ?? cardmarketArtworkReference?.expansionId
      ?? null,
    cardmarketPriceState,
    cardmarketPriceReason,
    ...(cardmarketMatch ? { cardmarketMappingEvidence: cardmarketMatch.mappingEvidence } : {}),
    ...(!cardmarketMatch && cardmarketArtworkReference ? {
      cardmarketMappingEvidence: cardmarketArtworkReference.evidence,
    } : {}),
    ...(cardmarketAmbiguity ? {
      cardmarketCandidateExpansionId: cardmarketAmbiguity.expansionId,
      cardmarketCandidates,
      cardmarketCandidatePriceRange,
    } : {}),
    ...(cardmarketArtworkReference ? { cardmarketArtworkReference } : {}),
    // Retain the v9 field on Standard printings for one release so persisted
    // clients and acquisition records can migrate without losing evidence.
    ...(cardmarketRegularArtReference ? { cardmarketRegularArtReference } : {}),
    tcgplayerProductId: exactTcgplayerMatch?.product.productId ?? starterEnrichment?.product.productId ?? null,
    ...(baseTcgplayerMatch ? {
      tcgplayerGroupId: baseTcgplayerMatch.groupId,
      tcgplayerGroupAbbreviation: baseTcgplayerMatch.abbreviation,
      tcgplayerMappingEvidence: 'Exact released English booster group + printed number + unique unqualified base product',
    } : tcgplayerArtworkMatch ? {
      tcgplayerGroupId: tcgplayerArtworkMatch.groupId,
      tcgplayerGroupAbbreviation: tcgplayerArtworkMatch.abbreviation,
      tcgplayerMappingEvidence: tcgplayerArtworkMatch.reference.evidence,
      tcgplayerArtworkReference: tcgplayerArtworkMatch.reference,
    } : starterEnrichment ? {
      tcgplayerGroupId: starterEnrichment.groupId,
      tcgplayerMappingEvidence: 'Exact audited TCGCSV starter product ID + printed number + title',
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
    usPriceSource: exactTcgplayerMatch
      ? 'TCGplayer via TCGCSV'
      : starterEnrichment
        ? 'TCGplayer via TCGCSV (verified starter product)'
        : 'OPTCG API',
    ...(exactTcgplayerMatch || starterEnrichment ? {
      tcgplayerPriceState: tcgplayerPriceRows.length > 1
        ? 'multiple-subtypes'
        : tcgplayerPrice?.marketPrice != null
          ? 'available'
          : tcgplayerPrice
            ? 'market-unavailable'
            : 'unavailable',
    } : {}),
    quote: {
      cardmarket: round(cardmarketPrice?.trend),
      tcgplayer: exactTcgplayerMatch || starterEnrichment ? round(tcgplayerPrice?.marketPrice) : round(card.market_price),
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
      usMarket: exactTcgplayerMatch
        ? tcgcsvPricingDetails(tcgplayerPrice, exactTcgplayerMatch.priceRows)
        : starterEnrichment ? tcgcsvPricingDetails(tcgplayerPrice) : {
        market: round(card.market_price),
        inventory: round(card.inventory_price),
        source: 'OPTCG API',
      },
    },
    sourceUpdatedAt: {
      cardmarket: priceGuide.createdAt,
      optcg: optcgDate,
      ...(exactTcgplayerMatch || starterEnrichment ? { tcgcsv: tcgcsvCreatedAt } : {}),
    },
  };
});

if (coreCardAssets.filter((asset) => asset.cardmarketProductId != null).length
  !== cardmarketMatches.size + cardmarketArtworkReferencesV10.size) {
  throw new Error('Metadata-verified plus complete-image-verified Cardmarket mapping counts do not match emitted core assets.');
}
if (coreCardAssets.some((asset) => !asset.cardmarketPriceState || !asset.cardmarketPriceReason)) {
  throw new Error('Every core card printing must explain its Cardmarket price state.');
}
if (coreCardAssets.some((asset) =>
  asset.cardmarketPriceState === 'available'
  && (asset.cardmarketProductId == null || asset.quote.cardmarket == null),
)) {
  throw new Error('A Cardmarket-available card lost its exact product or trend.');
}
if (coreCardAssets.some((asset) => asset.cardmarketArtworkReference && (
  asset.cardmarketArtworkReference.matchPolicy !== CARDMARKET_ARTWORK_MATCH_POLICY_V10
  || asset.cardmarketArtworkReference.candidateCount !== asset.cardmarketCandidates?.length
  || !Number.isFinite(Date.parse(asset.cardmarketArtworkReference.imageVerifiedAt ?? ''))
  || asset.cardmarketProductId !== asset.cardmarketArtworkReference.productId
  || asset.quote.cardmarket !== asset.cardmarketArtworkReference.trend
))) {
  throw new Error('A complete-image-verified Cardmarket artwork mapping lost its exact valuation identity.');
}
if (coreCardAssets.some((asset) =>
  asset.cardmarketPriceState === 'ambiguous-artwork'
  && (asset.cardmarketProductId != null
    || asset.quote.cardmarket != null
    || !Array.isArray(asset.cardmarketCandidates)
    || asset.cardmarketCandidates.length === 0),
)) {
  throw new Error('An artwork-ambiguous Cardmarket card leaked an exact product or valuation.');
}
if (coreCardAssets.some((asset) => asset.tcgplayerArtworkReference && (
  asset.tcgplayerArtworkReference.matchPolicy !== TCGPLAYER_ARTWORK_MAPPING_POLICY_V1.version
  || asset.tcgplayerProductId !== asset.tcgplayerArtworkReference.productId
  || asset.setCode !== asset.tcgplayerArtworkReference.setCode
  || asset.tcgplayerGroupId !== asset.tcgplayerArtworkReference.groupId
  || asset.cardmarketProductId !== asset.tcgplayerArtworkReference.cardmarketProductId
  || asset.tcgplayerArtworkReference.candidateCount
    !== asset.tcgplayerArtworkReference.candidateProductIds?.length
  || asset.tcgplayerArtworkReference.cardmarketCandidateCount
    !== asset.tcgplayerArtworkReference.cardmarketCandidateProductIds?.length
  || !asset.tcgplayerArtworkReference.cardmarketCandidateProductIds
    ?.includes(asset.cardmarketProductId)
  || !Number.isFinite(Date.parse(asset.tcgplayerArtworkReference.imageVerifiedAt ?? ''))
  || asset.usPriceSource !== 'TCGplayer via TCGCSV'
  || asset.quote.tcgplayer !== (asset.pricing?.usMarket.market ?? null)
))) {
  throw new Error('A complete-candidate TCGplayer artwork mapping lost its exact provider or price identity.');
}
for (const [cardmarketProductId, tcgplayerProductId] of verifiedOp13LuffyArtworkPairsV1) {
  const asset = coreCardAssets.find((candidate) => (
    candidate.number === 'OP13-118'
    && candidate.cardmarketProductId === cardmarketProductId
  ));
  if (
    asset?.tcgplayerProductId !== tcgplayerProductId
    || asset.tcgplayerArtworkReference?.cardmarketProductId !== cardmarketProductId
  ) {
    throw new Error(`Verified OP13-118 artwork pair ${cardmarketProductId}/${tcgplayerProductId} was not reproduced by the complete-candidate image policy.`);
  }
}

// TCGplayer places promotional printings in one broad group while Cardmarket
// separates them into release-specific expansions. Only reviewed, released
// English promo expansions enter this candidate pool. For each printed number,
// every TCGplayer image and every Cardmarket image in that pool must be
// available, and a pair must be the unique best match in both directions.
// Titles, product order, IDs, and prices never select a promotional artwork.
const reviewedPromoExpansionIdsV1 = new Set(
  cardmarketPromoExpansionRegistryV1.expansions.map((entry) => entry.idExpansion),
);
const allReviewedCardmarketPromoProductsV1 = productCatalog.products.filter(
  (product) => reviewedPromoExpansionIdsV1.has(Number(product.idExpansion)),
);
for (const expansion of cardmarketPromoExpansionRegistryV1.expansions) {
  const actualUnnumberedProductIds = allReviewedCardmarketPromoProductsV1
    .filter((product) => Number(product.idExpansion) === expansion.idExpansion)
    .filter((product) => !cardmarketPromoPrintedNumberV1(product.name))
    .map((product) => Number(product.idProduct))
    .sort((left, right) => left - right);
  const reviewedUnnumberedProductIds = [...expansion.excludedUnnumberedProductIds]
    .sort((left, right) => left - right);
  if (
    actualUnnumberedProductIds.length !== reviewedUnnumberedProductIds.length
    || actualUnnumberedProductIds.some(
      (productId, index) => productId !== reviewedUnnumberedProductIds[index],
    )
  ) {
    throw new Error(
      `Reviewed Cardmarket promo expansion ${expansion.idExpansion} changed its unnumbered products: expected ${reviewedUnnumberedProductIds.join(', ') || 'none'}, received ${actualUnnumberedProductIds.join(', ') || 'none'}.`,
    );
  }
}
const reviewedUnnumberedPromoProductIdsV1 = new Set(
  cardmarketPromoExpansionRegistryV1.expansions.flatMap(
    (entry) => entry.excludedUnnumberedProductIds,
  ),
);
const reviewedCardmarketPromoProductsV1 = allReviewedCardmarketPromoProductsV1.filter(
  (product) => !reviewedUnnumberedPromoProductIdsV1.has(Number(product.idProduct)),
);
if (reviewedCardmarketPromoProductsV1.some((product) => (
  Number(product.idCategory) !== 1621
  || !Number.isInteger(Number(product.idProduct))
  || Number(product.idProduct) <= 0
  || !cardmarketPromoPrintedNumberV1(product.name)
))) {
  throw new Error('A reviewed Cardmarket promotional expansion contains a malformed or unnumbered single; review the expansion registry before publishing.');
}

const cardmarketPromoCandidatesByNumberV1 = groupBy(
  reviewedCardmarketPromoProductsV1.map((product) => ({
    productId: Number(product.idProduct),
    product,
    number: cardmarketPromoPrintedNumberV1(product.name),
    expansion: cardmarketPromoExpansionByIdV1.get(Number(product.idExpansion)),
  })),
  (candidate) => candidate.number,
);
const tcgplayerPromoCandidatesByNumberV1 = groupBy(
  numberedTcgcsvPromoProducts.filter((product) => (
    tcgcsvLanguage(product.name) === 'English'
    && product.presaleInfo?.isPresale !== true
    && Number(product.groupId) === TCGCSV_PROMO_GROUP_ID
  )).map((product) => ({
    productId: Number(product.productId),
    product,
    number: tcgcsvCardNumber(product),
  })),
  (candidate) => candidate.number,
);

function sortedPromoCandidateIdsV1(candidates) {
  return candidates.map((candidate) => Number(candidate.productId))
    .sort((left, right) => left - right);
}

function samePromoCandidateIdsV1(left, right) {
  return left.length === right.length
    && left.every((productId, index) => productId === right[index]);
}

function reviewedPromoCrossMarketMatchesV1(
  number,
  availableTcgplayerImages,
  availableCardmarketImages,
) {
  const reviewedMappings = cardmarketPromoExpansionRegistryV1.reviewedArtworkMappings
    .filter((mapping) => mapping.printedNumber === number);
  return reviewedMappings.map((mapping) => {
    const tcgplayer = availableTcgplayerImages.find(
      (candidate) => Number(candidate.productId) === mapping.tcgplayerProductId,
    );
    const cardmarket = availableCardmarketImages.find(
      (candidate) => Number(candidate.productId) === mapping.cardmarketProductId,
    );
    if (!tcgplayer || !cardmarket) {
      throw new Error(
        `Reviewed promotional artwork mapping ${mapping.reviewId} left its complete candidate matrix.`,
      );
    }
    if (
      tcgplayer.fingerprint.digest !== mapping.tcgplayerImageDigest
      || cardmarket.fingerprint.digest !== mapping.cardmarketImageDigest
    ) {
      throw new Error(
        `Reviewed promotional artwork mapping ${mapping.reviewId} changed an image digest.`,
      );
    }

    const cardmarketRanking = availableCardmarketImages
      .map((candidate) => ({
        candidate,
        correlation: artworkCorrelationV1(tcgplayer.fingerprint, candidate.fingerprint),
      }))
      .sort((left, right) => right.correlation - left.correlation
        || Number(left.candidate.productId) - Number(right.candidate.productId));
    const selectedCardmarketIndex = cardmarketRanking.findIndex(
      ({ candidate }) => Number(candidate.productId) === mapping.cardmarketProductId,
    );
    const selectedCardmarket = cardmarketRanking[selectedCardmarketIndex];
    if (
      selectedCardmarketIndex !== 0
      || selectedCardmarket.correlation < mapping.minimumCorrelation
    ) {
      throw new Error(
        `Reviewed promotional artwork mapping ${mapping.reviewId} no longer has its reviewed complete-matrix correlation.`,
      );
    }
    const cardmarketRunnerUpCorrelation = cardmarketRanking[1]?.correlation ?? null;
    const cardmarketMargin = selectedCardmarket.correlation
      - (cardmarketRunnerUpCorrelation ?? -1);
    const tcgplayerRanking = availableTcgplayerImages
      .map((candidate) => ({
        candidate,
        correlation: artworkCorrelationV1(candidate.fingerprint, cardmarket.fingerprint),
      }))
      .sort((left, right) => right.correlation - left.correlation
        || Number(left.candidate.productId) - Number(right.candidate.productId));
    const selectedTcgplayerIndex = tcgplayerRanking.findIndex(
      ({ candidate }) => Number(candidate.productId) === mapping.tcgplayerProductId,
    );
    const selectedTcgplayer = tcgplayerRanking[selectedTcgplayerIndex];
    if (
      selectedTcgplayerIndex < 0
      || selectedTcgplayer.correlation < mapping.minimumCorrelation
    ) {
      throw new Error(
        `Reviewed promotional artwork mapping ${mapping.reviewId} lost its reviewed reverse correlation.`,
      );
    }
    const tcgplayerRunnerUpCorrelation = tcgplayerRanking.find(
      ({ candidate }) => Number(candidate.productId) !== mapping.tcgplayerProductId,
    )?.correlation ?? null;
    const tcgplayerMargin = selectedTcgplayer.correlation
      - (tcgplayerRunnerUpCorrelation ?? -1);
    const runnerUpCorrelation = Math.max(
      cardmarketRunnerUpCorrelation ?? -1,
      tcgplayerRunnerUpCorrelation ?? -1,
    );

    return {
      tcgplayerProductId: mapping.tcgplayerProductId,
      cardmarketProductId: mapping.cardmarketProductId,
      correlation: selectedCardmarket.correlation,
      runnerUpCorrelation: runnerUpCorrelation < 0 ? null : runnerUpCorrelation,
      margin: Math.min(cardmarketMargin, tcgplayerMargin),
      cardmarketRunnerUpCorrelation,
      cardmarketMargin,
      tcgplayerRunnerUpCorrelation,
      tcgplayerMargin,
      tcgplayerCandidateCount: availableTcgplayerImages.length,
      tcgplayerCandidateProductIds: availableTcgplayerImages
        .map((candidate) => Number(candidate.productId))
        .sort((left, right) => left - right),
      cardmarketCandidateCount: availableCardmarketImages.length,
      cardmarketCandidateProductIds: availableCardmarketImages
        .map((candidate) => Number(candidate.productId))
        .sort((left, right) => left - right),
      tcgplayerImageUrl: tcgplayer.imageUrl,
      cardmarketImageUrl: cardmarket.imageUrl,
      tcgplayerImageDigest: tcgplayer.fingerprint.digest,
      cardmarketImageDigest: cardmarket.fingerprint.digest,
      reviewedMappingId: mapping.reviewId,
      reviewedMinimumCorrelation: mapping.minimumCorrelation,
      allowSharedCardmarketProduct: mapping.allowSharedCardmarketProduct,
      reviewedEvidence: mapping.evidence,
    };
  });
}

function reusablePromoReferenceV1(tcgplayerCandidate, cardmarketCandidates) {
  const previousAsset = previousAssetByIdV10.get(promoStableId(tcgplayerCandidate.product)) ?? null;
  const reference = previousAsset?.tcgplayerArtworkReference ?? null;
  const currentTcgplayerIds = sortedPromoCandidateIdsV1(
    tcgplayerPromoCandidatesByNumberV1.get(tcgplayerCandidate.number) ?? [],
  );
  const currentCardmarketIds = sortedPromoCandidateIdsV1(cardmarketCandidates);
  const previousTcgplayerIds = (reference?.candidateProductIds ?? [])
    .map(Number)
    .sort((left, right) => left - right);
  const previousCardmarketIds = (reference?.cardmarketCandidateProductIds ?? [])
    .map(Number)
    .sort((left, right) => left - right);
  const selectedCardmarket = cardmarketCandidates.find(
    (candidate) => candidate.productId === Number(reference?.cardmarketProductId),
  );
  const evidenceAgeMs = Date.parse(artworkVerificationObservedAtV10)
    - Date.parse(reference?.imageVerifiedAt ?? '');
  const reviewedMapping = reviewedPromoArtworkMappingByReviewIdV1.get(
    reference?.reviewedMappingId,
  ) ?? null;
  const reviewedEvidenceIsCurrent = reviewedMapping
    ? reviewedMapping.printedNumber === tcgplayerCandidate.number
      && reviewedMapping.tcgplayerProductId === tcgplayerCandidate.productId
      && reviewedMapping.cardmarketProductId === Number(reference.cardmarketProductId)
      && reviewedMapping.tcgplayerImageDigest === reference.tcgplayerImageDigest
      && reviewedMapping.cardmarketImageDigest === reference.cardmarketImageDigest
    : false;
  const automaticConfidenceIsCurrent = reference?.reviewedMappingId == null
    && Number(reference?.correlation) >= PROMO_CROSS_MARKET_MAPPING_POLICY_V1.minimumCorrelation
    && Number(reference?.margin) >= PROMO_CROSS_MARKET_MAPPING_POLICY_V1.minimumMargin;
  const reusable = reference?.matchPolicy === PROMO_CROSS_MARKET_MAPPING_POLICY_V1.version
    && Number(reference.productId) === tcgplayerCandidate.productId
    && Number(reference.groupId) === TCGCSV_PROMO_GROUP_ID
    && reference.groupAbbreviation === 'OP-PR'
    && reference.number === tcgplayerCandidate.number
    && Number(reference.candidateCount) === currentTcgplayerIds.length
    && Number(reference.cardmarketCandidateCount) === currentCardmarketIds.length
    && samePromoCandidateIdsV1(previousTcgplayerIds, currentTcgplayerIds)
    && samePromoCandidateIdsV1(previousCardmarketIds, currentCardmarketIds)
    && selectedCardmarket
    && Number(reference.cardmarketExpansionId) === Number(selectedCardmarket.product.idExpansion)
    && Number(previousAsset?.cardmarketProductId) === Number(reference.cardmarketProductId)
    && Number(previousAsset?.tcgplayerProductId) === tcgplayerCandidate.productId
    && (reviewedEvidenceIsCurrent || automaticConfidenceIsCurrent)
    && /^[a-f0-9]{64}$/i.test(String(reference.cardmarketImageDigest ?? ''))
    && /^[a-f0-9]{64}$/i.test(String(reference.tcgplayerImageDigest ?? ''))
    && Number.isFinite(evidenceAgeMs)
    && evidenceAgeMs >= 0
    && evidenceAgeMs <= ARTWORK_EVIDENCE_TRANSIENT_GRACE_MS_V10;
  return reusable ? {
    previousAsset,
    reference,
    evidenceAgeMs,
    cardmarketCandidate: selectedCardmarket,
  } : null;
}

function persistedPromoMatchV1(tcgplayerCandidate, reusable, deferredReason = null) {
  const cardmarketProductId = Number(reusable.reference.cardmarketProductId);
  return {
    cardmarketProduct: reusable.cardmarketCandidate.product,
    reference: {
      ...reusable.reference,
      observedAt: tcgcsvCreatedAt,
      source: deferredReason
        ? 'TCGCSV product catalog + persisted TCGplayer/Cardmarket image match (refresh deferred)'
        : 'TCGCSV product catalog + persisted TCGplayer/Cardmarket image match',
      imageVerifiedAt: reusable.reference.imageVerifiedAt,
      ...(deferredReason ? {
        refreshDeferredAt: artworkVerificationObservedAtV10,
        refreshDeferredReason: deferredReason,
      } : {}),
      cardmarketProductId,
      cardmarketExpansionId: Number(reusable.cardmarketCandidate.product.idExpansion),
      evidence: 'This exact promotional printing remains bound to the same Cardmarket product after both providers retained the complete same-number candidate sets previously verified by a bidirectional image match.',
    },
  };
}

const promoCrossMarketMatchesV1 = new Map();
const promoCrossMarketReferenceFailuresV1 = [];
const promoCrossMarketCompleteMatrixNumbersV1 = new Set();
const requiredCompletePricedPromoNumbersV1 = new Set(
  cardmarketPromoExpansionRegistryV1.requiredCompletePricedPrintedNumbers,
);
let persistedPromoCrossMarketReferencesV1 = 0;
let discoveredPromoCrossMarketReferencesV1 = 0;
let deferredPromoCrossMarketReferencesV1 = 0;
const promoCrossMarketDiscoveryQueueV1 = [];

for (const [number, tcgplayerCandidates] of tcgplayerPromoCandidatesByNumberV1) {
  if (cardmarketPromoCandidatesByNumberV1.has(number)) continue;
  promoCrossMarketReferenceFailuresV1.push({
    number,
    tcgplayerCandidateProductIds: sortedPromoCandidateIdsV1(tcgplayerCandidates),
    cardmarketCandidateProductIds: [],
    reason: 'The released English TCGplayer promotional candidates have no candidate in the reviewed English Cardmarket promo expansions for this exact printed number.',
  });
}

for (const [number, cardmarketCandidates] of cardmarketPromoCandidatesByNumberV1) {
  const tcgplayerCandidates = tcgplayerPromoCandidatesByNumberV1.get(number) ?? [];
  if (tcgplayerCandidates.length === 0) {
    promoCrossMarketReferenceFailuresV1.push({
      number,
      cardmarketCandidateProductIds: sortedPromoCandidateIdsV1(cardmarketCandidates),
      reason: 'The reviewed Cardmarket promotional candidates have no released English TCGplayer candidate for this exact printed number.',
    });
    continue;
  }

  const reusableByTcgplayerProduct = new Map(
    tcgplayerCandidates.map((candidate) => [
      candidate.productId,
      reusablePromoReferenceV1(candidate, cardmarketCandidates),
    ]).filter(([, reusable]) => reusable),
  );
  const freshestReusable = [...reusableByTcgplayerProduct.values()]
    .sort((left, right) => left.evidenceAgeMs - right.evidenceAgeMs)[0] ?? null;
  const refreshSourceId = Math.min(...sortedPromoCandidateIdsV1(cardmarketCandidates));
  const imageEvidenceIsFresh = freshestReusable
    && freshestReusable.evidenceAgeMs <= ARTWORK_EVIDENCE_MAX_AGE_MS_V10
    && !sourceRefreshScheduledV10(refreshSourceId, artworkVerificationObservedAtV10);
  if (imageEvidenceIsFresh) {
    for (const tcgplayerCandidate of tcgplayerCandidates) {
      const reusable = reusableByTcgplayerProduct.get(tcgplayerCandidate.productId);
      if (!reusable) continue;
      promoCrossMarketMatchesV1.set(
        tcgplayerCandidate.productId,
        persistedPromoMatchV1(tcgplayerCandidate, reusable),
      );
      persistedPromoCrossMarketReferencesV1 += 1;
    }
    continue;
  }

  const maximumCardmarketTrend = Math.max(
    ...cardmarketCandidates.map((candidate) => (
      Number(cardmarketPricesByProduct.get(candidate.productId)?.trend) || 0
    )),
  );
  promoCrossMarketDiscoveryQueueV1.push({
    number,
    tcgplayerCandidates,
    cardmarketCandidates,
    reusableByTcgplayerProduct,
    maximumCardmarketTrend,
    requiredInvariant: cardmarketPromoExpansionRegistryV1.verifiedPairInvariants
      .some((invariant) => invariant.printedNumber === number)
      || requiredCompletePricedPromoNumbersV1.has(number),
  });
}
promoCrossMarketDiscoveryQueueV1.sort((left, right) =>
  Number(right.requiredInvariant) - Number(left.requiredInvariant)
  || right.maximumCardmarketTrend - left.maximumCardmarketTrend
  || left.number.localeCompare(right.number),
);

const promoCrossMarketDiscoveryDeadlineV1 = Date.now()
  + PROMO_CROSS_MARKET_DISCOVERY_BUDGET_MS_V1;
const promoCrossMarketDiscoveryResultsV1 = await mapWithConcurrencyV1(
  promoCrossMarketDiscoveryQueueV1,
  3,
  async ({ number, tcgplayerCandidates, cardmarketCandidates, reusableByTcgplayerProduct }) => {
    if (Date.now() >= promoCrossMarketDiscoveryDeadlineV1) {
      return {
        number,
        reusableByTcgplayerProduct,
        transient: true,
        error: 'The bounded promo artwork refresh window was exhausted; optional mappings were deferred without aborting the catalog sync.',
      };
    }

    const tcgplayerResults = await Promise.all(tcgplayerCandidates.map(async (candidate) => {
      const imageUrl = tcgplayerArtworkImageUrlV1(candidate.product);
      if (!imageUrl) return { image: null, transient: false };
      try {
        return {
          image: {
            productId: candidate.productId,
            imageUrl,
            fingerprint: await artworkFingerprintFromUrlV9(imageUrl),
          },
          transient: false,
        };
      } catch (error) {
        return { image: null, transient: artworkImageErrorIsTransientV10(error) };
      }
    }));
    const cardmarketResults = await Promise.all(cardmarketCandidates.map(async (candidate) => {
      try {
        const image = await cardmarketPromoProductFingerprintV1(
          candidate.expansion.imageFolder,
          candidate.productId,
        );
        return {
          image: {
            productId: candidate.productId,
            imageUrl: image.url,
            fingerprint: image.fingerprint,
          },
          transient: false,
        };
      } catch (error) {
        return { image: null, transient: artworkImageErrorIsTransientV10(error) };
      }
    }));
    const availableTcgplayerImages = tcgplayerResults.map((result) => result.image).filter(Boolean);
    const availableCardmarketImages = cardmarketResults.map((result) => result.image).filter(Boolean);
    const complete = hasCompletePromoArtworkCandidateMatrixV1({
      requestedTcgplayerCandidates: tcgplayerCandidates,
      availableTcgplayerImages,
      requestedCardmarketCandidates: cardmarketCandidates,
      availableCardmarketImages,
    });
    if (!complete) {
      return {
        number,
        reusableByTcgplayerProduct,
        transient: [...tcgplayerResults, ...cardmarketResults].some((result) => result.transient),
        error: `Only ${availableTcgplayerImages.length}/${tcgplayerCandidates.length} TCGplayer and ${availableCardmarketImages.length}/${cardmarketCandidates.length} Cardmarket candidate images were available; this complete same-number matrix remains unmapped.`,
      };
    }

    const automaticMatches = choosePromoCrossMarketImageMatchesV1({
      requestedTcgplayerCandidates: tcgplayerCandidates,
      availableTcgplayerImages,
      requestedCardmarketCandidates: cardmarketCandidates,
      availableCardmarketImages,
    });
    const reviewedMatches = reviewedPromoCrossMarketMatchesV1(
      number,
      availableTcgplayerImages,
      availableCardmarketImages,
    );
    const matchesByTcgplayerProduct = new Map(
      automaticMatches.map((match) => [match.tcgplayerProductId, match]),
    );
    for (const reviewedMatch of reviewedMatches) {
      const automaticMatch = matchesByTcgplayerProduct.get(
        reviewedMatch.tcgplayerProductId,
      );
      if (
        automaticMatch
        && automaticMatch.cardmarketProductId !== reviewedMatch.cardmarketProductId
      ) {
        throw new Error(
          `Reviewed promotional artwork mapping ${reviewedMatch.reviewedMappingId} conflicts with the automatic complete-matrix match.`,
        );
      }
      matchesByTcgplayerProduct.set(
        reviewedMatch.tcgplayerProductId,
        reviewedMatch,
      );
    }

    return {
      number,
      complete: true,
      tcgplayerCandidates,
      cardmarketCandidates,
      matches: [...matchesByTcgplayerProduct.values()]
        .sort((left, right) => left.tcgplayerProductId - right.tcgplayerProductId),
    };
  },
);

for (const result of promoCrossMarketDiscoveryResultsV1) {
  if (result.complete) {
    promoCrossMarketCompleteMatrixNumbersV1.add(result.number);
    for (const match of result.matches) {
      const tcgplayerCandidate = result.tcgplayerCandidates.find(
        (candidate) => candidate.productId === match.tcgplayerProductId,
      );
      const cardmarketCandidate = result.cardmarketCandidates.find(
        (candidate) => candidate.productId === match.cardmarketProductId,
      );
      if (!tcgplayerCandidate || !cardmarketCandidate) {
        throw new Error(`Promo image match for ${result.number} left its complete candidate matrix.`);
      }
      promoCrossMarketMatchesV1.set(match.tcgplayerProductId, {
        cardmarketProduct: cardmarketCandidate.product,
        reference: {
          productId: match.tcgplayerProductId,
          groupId: TCGCSV_PROMO_GROUP_ID,
          groupAbbreviation: 'OP-PR',
          number: result.number,
          cardmarketProductId: match.cardmarketProductId,
          cardmarketExpansionId: Number(cardmarketCandidate.product.idExpansion),
          observedAt: tcgcsvCreatedAt,
          source: 'TCGCSV product catalog + TCGplayer product images + reviewed Cardmarket promotional expansion images',
          matchPolicy: PROMO_CROSS_MARKET_MAPPING_POLICY_V1.version,
          candidateCount: match.tcgplayerCandidateCount,
          candidateProductIds: match.tcgplayerCandidateProductIds,
          cardmarketCandidateCount: match.cardmarketCandidateCount,
          cardmarketCandidateProductIds: match.cardmarketCandidateProductIds,
          imageVerifiedAt: artworkVerificationObservedAtV10,
          correlation: Number(match.correlation.toFixed(6)),
          runnerUpCorrelation: match.runnerUpCorrelation == null
            ? null
            : Number(match.runnerUpCorrelation.toFixed(6)),
          margin: Number(match.margin.toFixed(6)),
          cardmarketRunnerUpCorrelation: match.cardmarketRunnerUpCorrelation == null
            ? null
            : Number(match.cardmarketRunnerUpCorrelation.toFixed(6)),
          cardmarketMargin: Number(match.cardmarketMargin.toFixed(6)),
          tcgplayerRunnerUpCorrelation: match.tcgplayerRunnerUpCorrelation == null
            ? null
            : Number(match.tcgplayerRunnerUpCorrelation.toFixed(6)),
          tcgplayerMargin: Number(match.tcgplayerMargin.toFixed(6)),
          cardmarketImageUrl: match.cardmarketImageUrl,
          tcgplayerImageUrl: match.tcgplayerImageUrl,
          cardmarketImageDigest: match.cardmarketImageDigest,
          tcgplayerImageDigest: match.tcgplayerImageDigest,
          ...(match.reviewedMappingId ? {
            reviewedMappingId: match.reviewedMappingId,
            reviewedMinimumCorrelation: match.reviewedMinimumCorrelation,
            allowSharedCardmarketProduct: match.allowSharedCardmarketProduct,
          } : {}),
          evidence: match.reviewedMappingId
            ? `This exact promotional artwork uses reviewed normalized-image digests after the complete same-number matrix was compared. ${match.reviewedEvidence}`
            : 'This exact TCGplayer promotional printing and Cardmarket product are mutual unique best image matches above frozen correlation and separation thresholds after every released English TCGplayer promo and every product from each reviewed English Cardmarket promo expansion for the printed number were compared.',
        },
      });
      discoveredPromoCrossMarketReferencesV1 += 1;
    }
    continue;
  }

  promoCrossMarketReferenceFailuresV1.push({
    number: result.number,
    reason: result.error,
  });
  if (!result.transient) continue;
  for (const [tcgplayerProductId, reusable] of result.reusableByTcgplayerProduct ?? []) {
    const tcgplayerCandidate = (tcgplayerPromoCandidatesByNumberV1.get(result.number) ?? [])
      .find((candidate) => candidate.productId === tcgplayerProductId);
    if (!tcgplayerCandidate) continue;
    promoCrossMarketMatchesV1.set(
      tcgplayerProductId,
      persistedPromoMatchV1(tcgplayerCandidate, reusable, result.error),
    );
    persistedPromoCrossMarketReferencesV1 += 1;
    deferredPromoCrossMarketReferencesV1 += 1;
  }
}

const promoTcgplayerIdsByCardmarketProductV1 = groupBy(
  [...promoCrossMarketMatchesV1.entries()],
  ([, match]) => String(match.cardmarketProduct.idProduct),
);
for (const [cardmarketProductId, mappings] of promoTcgplayerIdsByCardmarketProductV1) {
  if (mappings.length === 1) continue;
  const mappedTcgplayerProductIds = mappings
    .map(([tcgplayerProductId]) => Number(tcgplayerProductId))
    .sort((left, right) => left - right);
  const reviewedSharedTcgplayerProductIds = cardmarketPromoExpansionRegistryV1
    .reviewedArtworkMappings
    .filter((mapping) => (
      mapping.cardmarketProductId === Number(cardmarketProductId)
      && mapping.allowSharedCardmarketProduct
    ))
    .map((mapping) => mapping.tcgplayerProductId)
    .sort((left, right) => left - right);
  if (!samePromoCandidateIdsV1(
    mappedTcgplayerProductIds,
    reviewedSharedTcgplayerProductIds,
  )) {
    throw new Error(`Cardmarket promotional product ${cardmarketProductId} mapped to multiple TCGplayer printings.`);
  }
}
for (const invariant of cardmarketPromoExpansionRegistryV1.verifiedPairInvariants) {
  const match = promoCrossMarketMatchesV1.get(invariant.tcgplayerProductId) ?? null;
  if (match && Number(match.cardmarketProduct.idProduct) !== invariant.cardmarketProductId) {
    throw new Error(`Verified promotional pair ${invariant.tcgplayerProductId}/${invariant.cardmarketProductId} changed identity.`);
  }
  if (
    promoCrossMarketCompleteMatrixNumbersV1.has(invariant.printedNumber)
    && Number(match?.cardmarketProduct.idProduct) !== invariant.cardmarketProductId
  ) {
    throw new Error(`Complete promotional image verification did not reproduce invariant ${invariant.tcgplayerProductId}/${invariant.cardmarketProductId}.`);
  }
}
for (const number of requiredCompletePricedPromoNumbersV1) {
  const tcgplayerCandidates = tcgplayerPromoCandidatesByNumberV1.get(number) ?? [];
  const cardmarketCandidates = cardmarketPromoCandidatesByNumberV1.get(number) ?? [];
  const matches = tcgplayerCandidates.map(
    (candidate) => promoCrossMarketMatchesV1.get(candidate.productId) ?? null,
  );
  const mappedCardmarketProductIds = matches
    .map((match) => Number(match?.cardmarketProduct.idProduct))
    .filter((productId) => Number.isInteger(productId));
  const completeCoverage = tcgplayerCandidates.length > 0
    && cardmarketCandidates.length > 0
    && matches.every(Boolean)
    && mappedCardmarketProductIds.every(
      (productId) => cardmarketCandidates.some(
        (candidate) => candidate.productId === productId,
      ),
    );
  if (!completeCoverage) {
    throw new Error(
      `Required promotional number ${number} did not retain a complete exact-art mapping across both providers.`,
    );
  }
  if (mappedCardmarketProductIds.some(
    (productId) => cardmarketPricesByProduct.get(productId)?.trend == null,
  )) {
    throw new Error(
      `Required promotional number ${number} has an exact Cardmarket product without a current trend price.`,
    );
  }
}

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
  const stableSetCode = baselineAssetByIdV9.get(stableId)?.setCode
    ?? previousAssetByIdV10.get(stableId)?.setCode
    ?? normalizeSetCode(metadata?.set_id, 'PROMO');
  const imageUrl = tcgcsvImageUrl(product);
  const priceRows = tcgcsvPriceRows(tcgcsvPromoPriceIndex, product.productId);
  const price = exactTcgcsvPrice(tcgcsvPromoPriceIndex, product.productId);
  const rarity = tcgcsvExtendedValue(product, 'Rarity') ?? metadata?.rarity ?? 'Unknown';
  const language = tcgcsvLanguage(product.name);
  const optcgDate = String(metadata?.date_scraped ?? generatedAt);
  const promoCardmarketMatch = promoCrossMarketMatchesV1.get(Number(product.productId)) ?? null;
  const promoCardmarketPrice = promoCardmarketMatch
    ? cardmarketPricesByProduct.get(Number(promoCardmarketMatch.cardmarketProduct.idProduct)) ?? null
    : null;

  return {
    id: stableId,
    kind: 'card',
    name: canonicalName,
    productName: product.name,
    set: 'One Piece Promotion Cards',
    setCode: stableSetCode,
    number,
    rulesCardId: number,
    printingId: `tcgplayer:${product.productId}`,
    sourcePrintingId: `tcgplayer:${product.productId}`,
    tcgplayerProductId: Number(product.productId),
    tcgplayerGroupId: TCGCSV_PROMO_GROUP_ID,
    tcgplayerGroupAbbreviation: 'OP-PR',
    tcgplayerMappingEvidence: 'Exact TCGCSV promotional product ID, printed number, artwork, and product-specific price',
    ...(promoCardmarketMatch ? {
      tcgplayerArtworkReference: promoCardmarketMatch.reference,
    } : {}),
    cardmarketProductId: promoCardmarketMatch
      ? Number(promoCardmarketMatch.cardmarketProduct.idProduct)
      : null,
    cardmarketExpansionId: promoCardmarketMatch
      ? Number(promoCardmarketMatch.cardmarketProduct.idExpansion)
      : null,
    cardmarketPriceState: promoCardmarketMatch
      ? promoCardmarketPrice?.trend != null ? 'available' : 'trend-unavailable'
      : 'unmapped',
    cardmarketPriceReason: promoCardmarketMatch
      ? promoCardmarketPrice?.trend != null
        ? 'This exact promotional artwork is verified against its Cardmarket product by a complete bidirectional image match, and the current daily trend is available.'
        : 'This exact promotional artwork is verified against its Cardmarket product, but the current daily price guide has no trend for it.'
      : 'No complete bidirectional image match proves a Cardmarket product for this exact TCGplayer promotional printing in the reviewed released English promo expansions.',
    ...(promoCardmarketMatch ? {
      cardmarketMappingEvidence: promoCardmarketMatch.reference.evidence,
    } : {}),
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
      imageUnavailableReason: 'TCGCSV does not provide a trusted artwork URL for this exact product.',
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
      cardmarket: round(promoCardmarketPrice?.trend),
      tcgplayer: round(price?.marketPrice),
    },
    change: {
      cardmarket: promoCardmarketPrice ? {
        '1D': percentAgainst(promoCardmarketPrice.trend, promoCardmarketPrice.avg1),
        '1W': percentAgainst(promoCardmarketPrice.trend, promoCardmarketPrice.avg7),
        '1M': percentAgainst(promoCardmarketPrice.trend, promoCardmarketPrice.avg30),
      } : emptyChanges(),
      tcgplayer: emptyChanges(),
    },
    pricing: {
      cardmarket: pricingDetails(promoCardmarketPrice),
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
const approvedCardmarketMappingChanges = previousSnapshot?.assets
  ? assertCardmarketMappingContinuity({
    previousAssets: previousSnapshot.assets,
    nextAssets: cardAssets,
    approvals: APPROVED_CARDMARKET_MAPPING_CHANGES,
    generatedAt,
  })
  : [];

const sealedCatalogCandidates = nonSinglesCatalog.products
  .filter((product) => SEALED_CATEGORIES.has(product.categoryName))
  .filter((product) => !NON_ENGLISH_SEALED.test(product.name))
  .filter((product) => !UNSUPPORTED_EMPTY_PACKAGING_SEALED_V10.test(product.name));
const releasedSealedExpansionIdsV10 = new Set([
  ...Object.values(englishExpansionIds),
  ...Object.values(englishStarterExpansionIds),
].map(Number));
const previousSealedProductIdsV10 = new Set((previousSnapshot?.assets ?? [])
  .filter((asset) => asset.kind === 'sealed' && asset.cardmarketProductId != null)
  .map((asset) => Number(asset.cardmarketProductId)));
const staticSealedProductReleaseState = (product) => {
  const exactGate = EXACT_SEALED_RELEASE_GATES_V10.get(Number(product.idProduct));
  if (exactGate) {
    return Date.parse(generatedAt) >= Date.parse(`${exactGate.releasedOn}T00:00:00.000Z`)
      ? 'released'
      : 'future';
  }
  const category = SEALED_CATEGORIES.get(product.categoryName);
  if (category?.productType === 'Promo product') return 'unmanaged';
  const setCode = sealedSetCode(
    product,
    category,
    officialDeckSetCodesByTitle,
    releasedSealedSetCodeByExpansionIdV1,
  );
  const codeReleaseState = officialSetCodeReleaseState(
    setCode,
    releasedOfficialCardSetCodes,
    futureOfficialCardSetCodes,
  );
  if (codeReleaseState === 'future') return 'future';
  if (!isCanonicalCardmarketSealedProductV1(product, category?.productType)) {
    return 'unmanaged';
  }
  if (releasedSealedExpansionIdsV10.has(Number(product.idExpansion))) return 'released';
  return codeReleaseState === 'released' ? 'released' : 'unmanaged';
};
const sealedCandidateByProductIdV10 = new Map(
  sealedCatalogCandidates.map((product) => [Number(product.idProduct), product]),
);
const previousDynamicSealedReleaseAuditsV10 = previousSnapshot?.provenance?.cardmarket
  ?.dynamicSealedReleaseAudits ?? [];
const previousDynamicSealedReleaseAuditByProductIdV10 = new Map(
  previousDynamicSealedReleaseAuditsV10.map((audit) => [Number(audit.cardmarketProductId), audit]),
);
const carriedDynamicSealedReleaseAuditsV10 = previousDynamicSealedReleaseAuditsV10
  .filter((audit) => audit.state === 'released')
  .filter((audit) => sealedCandidateByProductIdV10.has(Number(audit.cardmarketProductId)))
  .filter((audit) => audit.legacyBootstrap === true
    || audit.releasedExpansionEvidence === true
    || /^\d{4}-\d{2}-\d{2}$/.test(String(audit.releasedOn ?? '')))
  .map((audit) => {
    const product = sealedCandidateByProductIdV10.get(Number(audit.cardmarketProductId));
    const expectedPageUrl = cardmarketProductPageUrlV1(product);
    if (
      audit.name !== product.name
      || audit.pageUrl !== expectedPageUrl
    ) {
      throw new Error(`Persisted sealed release evidence changed identity for Cardmarket product ${product.idProduct}.`);
    }
    return {
      ...audit,
      state: audit.legacyBootstrap === true || audit.releasedExpansionEvidence === true
        ? 'released'
        : officialProductAvailableAt({
          releasedOn: audit.releasedOn,
          releasePrecision: audit.releasePrecision ?? 'day',
        }, new Date(generatedAt)) ? 'released' : 'future',
      policy: audit.policy.split('; carried forward from verified snapshot ')[0],
      carriedFromSnapshotGeneratedAt: previousSnapshot.generatedAt,
    };
  });
const carriedDynamicSealedReleaseAuditByProductIdV10 = new Map(
  carriedDynamicSealedReleaseAuditsV10.map((audit) => [audit.cardmarketProductId, audit]),
);
const officialSealedProductsByTitleV10 = groupBy(
  bandaiCatalog.products,
  (product) => normalizedSealedProductTitleV10(product.title),
);
const unmanagedSealedProductsV10 = sealedCatalogCandidates.filter(
  (product) => staticSealedProductReleaseState(product) === 'unmanaged',
);
const officialTitleSealedReleaseAuditsV10 = unmanagedSealedProductsV10.flatMap((product) => {
  if (carriedDynamicSealedReleaseAuditByProductIdV10.has(Number(product.idProduct))) return [];
  const matches = officialSealedProductsByTitleV10.get(
    normalizedSealedProductTitleV10(product.name),
  ) ?? [];
  const uniqueMatches = [...new Map(matches.map((match) => [
    `${match.productUrl}|${match.releasedOn}|${match.releasePrecision}`,
    match,
  ])).values()];
  if (uniqueMatches.length !== 1) return [];
  const [officialEvidence] = uniqueMatches;
  return [{
    cardmarketProductId: Number(product.idProduct),
    name: product.name,
    pageUrl: cardmarketProductPageUrlV1(product),
    releasedOn: officialEvidence.releasedOn,
    releasePrecision: officialEvidence.releasePrecision,
    releaseLabel: officialEvidence.releaseLabel,
    state: officialProductAvailableAt(officialEvidence, new Date(generatedAt))
      ? 'released'
      : 'future',
    policy: 'Unique punctuation-normalized title match to the official Bandai product archive',
    evidenceUrl: officialEvidence.productUrl,
  }];
});
const officialTitleSealedReleaseAuditByProductIdV10 = new Map(
  officialTitleSealedReleaseAuditsV10.map((audit) => [audit.cardmarketProductId, audit]),
);
const baselineSealedAssetByProductIdV10 = new Map((baselineSnapshotV9?.assets ?? [])
  .filter((asset) => asset.kind === 'sealed' && asset.cardmarketProductId != null)
  .map((asset) => [Number(asset.cardmarketProductId), asset]));
const reviewedLegacySealedReleaseAuditsV10 = unmanagedSealedProductsV10.flatMap((product) => {
  const productId = Number(product.idProduct);
  if (
    carriedDynamicSealedReleaseAuditByProductIdV10.has(productId)
    || officialTitleSealedReleaseAuditByProductIdV10.has(productId)
  ) return [];
  const baselineAsset = baselineSealedAssetByProductIdV10.get(productId);
  if (!baselineAsset) return [];
  if (baselineAsset.name !== product.name) {
    throw new Error(`Legacy sealed release review changed identity for Cardmarket product ${productId}.`);
  }
  return [{
    cardmarketProductId: productId,
    name: product.name,
    pageUrl: cardmarketProductPageUrlV1(product),
    releasedOn: null,
    releasePrecision: null,
    state: 'released',
    presaleMarkerPresent: false,
    legacyBootstrap: true,
    legacySnapshotReview: true,
    baselineSnapshotGeneratedAt: baselineSnapshotV9.generatedAt,
    policy: 'Frozen one-time v9 release review: the exact Cardmarket product ID and title were already present in the checked-in released catalog; every identified presale is independently date-gated before this review can apply',
    evidenceUrl: CARDMARKET_NONSINGLES,
  }];
});
const reviewedLegacySealedReleaseAuditByProductIdV10 = new Map(
  reviewedLegacySealedReleaseAuditsV10.map((audit) => [audit.cardmarketProductId, audit]),
);
const unmanagedSealedProductsNeedingAuditV10 = unmanagedSealedProductsV10.filter(
  (product) => !carriedDynamicSealedReleaseAuditByProductIdV10.has(Number(product.idProduct))
    && !officialTitleSealedReleaseAuditByProductIdV10.has(Number(product.idProduct))
    && !reviewedLegacySealedReleaseAuditByProductIdV10.has(Number(product.idProduct)),
);
const newlyFetchedDynamicSealedReleaseAuditsV10 = await mapWithConcurrencyV1(
  unmanagedSealedProductsNeedingAuditV10,
  3,
  async (product) => {
    const pageUrl = cardmarketProductPageUrlV1(product);
    const pageHtml = await fetchText(pageUrl);
    const audit = cardmarketProductPageReleaseAuditV1(pageHtml, product.name, generatedAt);
    const previousAudit = previousDynamicSealedReleaseAuditByProductIdV10.get(
      Number(product.idProduct),
    );
    const previousExplicitDateStillApplies = audit.state === 'unknown'
      && /^\d{4}-\d{2}-\d{2}$/.test(String(previousAudit?.releasedOn ?? ''));
    const releasedExpansionEvidenceApplies = audit.state === 'unknown'
      && audit.presaleMarkerPresent === false
      && SEALED_CATEGORIES.get(product.categoryName)?.productType !== 'Promo product'
      && releasedSealedExpansionIdsV10.has(Number(product.idExpansion));
    return {
      cardmarketProductId: Number(product.idProduct),
      name: product.name,
      pageUrl,
      ...(previousExplicitDateStillApplies ? {
        releasedOn: previousAudit.releasedOn,
        releasePrecision: previousAudit.releasePrecision ?? 'day',
        state: officialProductAvailableAt({
          releasedOn: previousAudit.releasedOn,
          releasePrecision: previousAudit.releasePrecision ?? 'day',
        }, new Date(generatedAt)) ? 'released' : 'future',
        policy: 'Previously verified explicit release date; exact Cardmarket product identity revalidated and no conflicting presale date is currently shown',
        evidenceUrl: previousAudit.evidenceUrl ?? previousAudit.pageUrl,
        previousEvidenceSnapshotGeneratedAt: previousSnapshot.generatedAt,
      } : releasedExpansionEvidenceApplies ? {
        releasedOn: null,
        releasePrecision: null,
        state: 'released',
        presaleMarkerPresent: false,
        legacyBootstrap: false,
        releasedExpansionEvidence: true,
        policy: 'Exact Cardmarket product identity revalidated with no presale marker, and its Cardmarket expansion is uniquely mapped to a Bandai-confirmed released set or starter deck',
        evidenceUrl: pageUrl,
        cardmarketExpansionId: Number(product.idExpansion),
      } : audit),
    };
  },
);
const dynamicSealedReleaseAuditsV10 = [
  ...carriedDynamicSealedReleaseAuditsV10,
  ...officialTitleSealedReleaseAuditsV10,
  ...reviewedLegacySealedReleaseAuditsV10,
  ...newlyFetchedDynamicSealedReleaseAuditsV10,
];
const dynamicSealedReleaseAuditByProductIdV10 = new Map(
  dynamicSealedReleaseAuditsV10.map((audit) => [audit.cardmarketProductId, audit]),
);
const officialSealedProductReleaseState = (product) => {
  const staticState = staticSealedProductReleaseState(product);
  if (staticState !== 'unmanaged') return staticState;
  const dynamicAudit = dynamicSealedReleaseAuditByProductIdV10.get(Number(product.idProduct));
  if (dynamicAudit) return dynamicAudit.state;
  throw new Error(`Unmanaged sealed product ${product.idProduct} escaped the required product-page release audit.`);
};
const releasedSealedSourceProducts = sealedCatalogCandidates
  .filter((product) => officialSealedProductReleaseState(product) === 'released');
const futureSealedProductsExcluded = sealedCatalogCandidates
  .filter((product) => officialSealedProductReleaseState(product) === 'future');
const unknownManifestSealedProductsExcluded = sealedCatalogCandidates
  .filter((product) => officialSealedProductReleaseState(product) === 'unknown');
if (unknownManifestSealedProductsExcluded.length > 0) {
  throw new Error(
    `Sealed Cardmarket products require release review: ${JSON.stringify(
      unknownManifestSealedProductsExcluded.map((product) => ({
        cardmarketProductId: product.idProduct,
        name: product.name,
        pageUrl: dynamicSealedReleaseAuditByProductIdV10.get(Number(product.idProduct))?.pageUrl,
      })),
    )}`,
  );
}
const sealedImageDiscoveryDeadlineV10 = Date.now() + SEALED_IMAGE_DISCOVERY_BUDGET_MS_V10;
const sealedImageResultsV10 = await mapWithConcurrencyV1(
  releasedSealedSourceProducts,
  6,
  async (product) => {
    const stableId = `sealed-cardmarket-${product.idProduct}`;
    const previousAsset = previousAssetByIdV10.get(stableId) ?? null;
    const existing = await existingSealedImageV10(previousAsset, product.idProduct, generatedAt);
    if (existing) return { productId: Number(product.idProduct), image: { ...existing, reused: true } };
    if (Date.now() >= sealedImageDiscoveryDeadlineV10) {
      const deferred = await deferredSealedImageV10(
        previousAsset,
        product.idProduct,
        generatedAt,
        'The bounded sealed-image discovery budget was exhausted.',
      );
      if (deferred) {
        return { productId: Number(product.idProduct), image: deferred };
      }
      throw new Error(`The bounded sealed-image discovery budget was exhausted before product ${product.idProduct}.`);
    }
    return {
      productId: Number(product.idProduct),
      image: await acquireSealedImageV10(product, previousAsset, generatedAt),
    };
  },
);
const sealedImageByProductIdV10 = new Map(
  sealedImageResultsV10.map((result) => [result.productId, result.image]),
);
const reusedSealedImagesV10 = sealedImageResultsV10.filter((result) => result.image.reused).length;
const discoveredSealedImagesV10 = sealedImageResultsV10.length - reusedSealedImagesV10;
const deferredSealedImageRefreshesV10 = sealedImageResultsV10.filter(
  (result) => result.image.imageRefreshDeferred,
).length;
const sealedAssets = releasedSealedSourceProducts
  .map((product) => ({ product, price: cardmarketPricesByProduct.get(product.idProduct) }))
  .map(({ product, price }) => {
    const category = SEALED_CATEGORIES.get(product.categoryName);
    const stableId = `sealed-cardmarket-${product.idProduct}`;
    const languageOverride = EXACT_SEALED_LANGUAGE_OVERRIDES_V10.get(Number(product.idProduct)) ?? null;
    const regionOverride = EXACT_SEALED_REGION_OVERRIDES_V10.get(Number(product.idProduct)) ?? null;
    const language = languageOverride?.language ?? 'English';
    const sealedImage = sealedImageByProductIdV10.get(Number(product.idProduct));
    if (!sealedImage) throw new Error(`Verified sealed image missing for Cardmarket product ${product.idProduct}.`);
    const { reused: _reused, ...sealedImageFields } = sealedImage;
    return {
      id: stableId,
      kind: 'sealed',
      name: product.name,
      set: product.categoryName.replace(/^One Piece\s+/, ''),
      setCode: sealedSetCode(
        product,
        category,
        officialDeckSetCodesByTitle,
        releasedSealedSetCodeByExpansionIdV1,
      ),
      rarity: 'Sealed',
      variant: regionOverride?.variant ?? `${language} release`,
      productType: category.productType,
      language,
      languageEvidence: languageOverride?.reason
        ?? 'English-market Cardmarket catalog row; product-level Cardmarket trends can aggregate listing languages.',
      region: regionOverride?.region ?? 'Europe / global English market',
      regionEvidenceUrl: regionOverride?.evidenceUrl ?? null,
      condition: 'Factory sealed',
      quantity: 1,
      addedAt: generatedAt,
      color: colorFor(stableId),
      ...sealedImageFields,
      cardmarketProductId: product.idProduct,
      cardmarketExpansionId: product.idExpansion,
      cardmarketPriceState: price?.trend != null
        ? 'available'
        : 'trend-unavailable',
      cardmarketPriceReason: price?.trend != null
        ? 'This sealed Cardmarket product has a daily product-level trend; Cardmarket does not split its public price guide by listing language.'
        : 'This sealed Cardmarket product has no product-level trend in the current daily price guide.',
      quote: {
        cardmarket: round(price?.trend),
        tcgplayer: null,
      },
      change: {
        cardmarket: {
          '1D': percentAgainst(price?.trend, price?.avg1),
          '1W': percentAgainst(price?.trend, price?.avg7),
          '1M': percentAgainst(price?.trend, price?.avg30),
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

const approvedCatalogRemovals = previousSnapshot?.assets
  ? assertManagedCatalogContinuity(
    previousSnapshot.assets,
    [...cardAssets, ...sealedAssets],
    activeCatalogRemovalApprovalIds(APPROVED_CATALOG_REMOVALS, generatedAt),
  )
  : [];
for (const removed of approvedCatalogRemovals) {
  if (!APPROVED_CATALOG_REMOVALS.has(removed.id)) {
    throw new Error(`Catalog removal ${removed.id} passed continuity without a recorded review reason.`);
  }
}
const reviewedBaselineCatalogRemovals = baselineSnapshotV9?.assets
  ? assertManagedCatalogContinuity(
    baselineSnapshotV9.assets,
    [...cardAssets, ...sealedAssets],
    activeCatalogRemovalApprovalIds(APPROVED_CATALOG_REMOVALS, generatedAt),
  )
  : approvedCatalogRemovals;
for (const removed of reviewedBaselineCatalogRemovals) {
  if (!APPROVED_CATALOG_REMOVALS.has(removed.id)) {
    throw new Error(`Baseline catalog removal ${removed.id} has no recorded review reason.`);
  }
}

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

const sealedAssetsByProductIdV10 = new Map(
  sealedAssets.map((asset) => [Number(asset.cardmarketProductId), asset]),
);
const sharedSealedImageDigestGroupsV10 = [...groupBy(
  sealedAssets,
  (asset) => asset.imageSourceDigest,
).entries()].filter(([, assets]) => assets.length > 1);
for (const [sourceDigest, assets] of sharedSealedImageDigestGroupsV10) {
  const exactAssets = assets.filter(
    (asset) => asset.imageSourceRelationship === 'exact-product',
  );
  const containedAssets = assets.filter(
    (asset) => asset.imageSourceRelationship === 'contained-unit',
  );
  const exactSource = exactAssets.length === 1 ? exactAssets[0] : null;
  const everyContainedAssetExplained = exactSource != null
    && containedAssets.length === assets.length - 1
    && containedAssets.every((asset) => {
      const sourceAsset = sealedAssetsByProductIdV10.get(Number(asset.imageSourceProductId));
      return sourceAsset === exactSource
        && sourceAsset.imageSourceDigest === sourceDigest;
    });
  if (!everyContainedAssetExplained) {
    throw new Error(
      `Sealed image digest ${sourceDigest} is reused across unrelated products: ${assets.map((asset) => asset.cardmarketProductId).join(', ')}.`,
    );
  }
}

const releasedRepresentativeSetCodes = [...new Set(tcgcsvMarketSources
  .flatMap((source) => source.memberSetCodes))]
  .sort((left, right) => left.localeCompare(right, 'en-US', { numeric: true }));
const allRepresentativeCandidates = [...baseCardmarketMatches.values()]
  .filter((match) => releasedRepresentativeSetCodes.includes(setCodeFromNumber(match.number)))
  .sort((left, right) => right.price.trend - left.price.trend || left.number.localeCompare(right.number));
const onePerReleasedSet = releasedRepresentativeSetCodes.flatMap((code) =>
  allRepresentativeCandidates.filter((match) => setCodeFromNumber(match.number) === code).slice(0, 1));
const selectedRepresentativeIds = new Set(onePerReleasedSet.map((match) => cardStableId(match.card)));
const initialBaseMatches = [
  ...onePerReleasedSet,
  ...allRepresentativeCandidates.filter((match) => !selectedRepresentativeIds.has(cardStableId(match.card))),
].slice(0, 40);
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
if (coreCardAssets.some((asset) => asset.catalogAliasOf && (
  !emittedIds.has(asset.catalogAliasOf)
  || coreCardAssets.find((candidate) => candidate.id === asset.catalogAliasOf)?.catalogAliasOf
  || coreCardAssets.find((candidate) => candidate.id === asset.catalogAliasOf)?.rulesCardId !== asset.rulesCardId
))) {
  throw new Error('A duplicate visible-art alias lost its canonical catalog target.');
}
if (coreCardAssets.length !== uniqueCoreCards.length) {
  throw new Error('A set, starter, or DON!! printing was lost while building assets.');
}
if (coreCardAssets.some((asset) => !catalogSetCodeIsReleased(
  asset.setCode,
  releasedOfficialCardSetCodes,
))) {
  throw new Error('An announced-but-unreleased Bandai set or deck leaked into the core card catalog.');
}
if (sealedAssets.length !== releasedSealedSourceProducts.length) {
  throw new Error('An eligible released Cardmarket sealed catalog row was lost while building assets.');
}
if (sealedAssets.some((asset) =>
  asset.imageState !== 'available'
  || !/^\/catalog\/sealed\/v1\/\d+-[a-f0-9]{12}\.webp$/.test(asset.imageUrl ?? '')
  || Number(asset.imageSourceProductId) !== sealedImageSourceProductIdV10(asset.cardmarketProductId)
  || asset.imageSourceRelationship !== (
    EXACT_SEALED_IMAGE_OVERRIDES_V10.get(Number(asset.cardmarketProductId))?.relationship
      ?? 'exact-product'
  )
  || !/^[a-f0-9]{64}$/.test(asset.imageSourceDigest ?? '')
  || CARDMARKET_SEALED_IMAGE_POLICY_V1.knownPlaceholderSourceDigests.includes(
    asset.imageSourceDigest,
  )
  || !/^[a-f0-9]{64}$/.test(asset.imageOutputDigest ?? '')
  || asset.imageUnavailableReason
  || asset.quote.cardmarket !== asset.pricing.cardmarket.trend
)) {
  throw new Error('Sealed catalog image/nullable-price provenance invariant failed.');
}
if (promoAssets.length !== numberedTcgcsvPromoProducts.length) {
  throw new Error('A numbered TCGCSV promo product was lost while building assets.');
}
if (promoAssets.some((asset) => asset.language !== 'English' && asset.language !== 'Japanese')) {
  throw new Error('Unsupported promo language emitted.');
}
if (promoAssets.some((asset) => asset.cardmarketProductId != null && (
  asset.language !== 'English'
  || asset.tcgplayerArtworkReference?.matchPolicy !== PROMO_CROSS_MARKET_MAPPING_POLICY_V1.version
  || asset.tcgplayerArtworkReference.productId !== asset.tcgplayerProductId
  || asset.tcgplayerArtworkReference.cardmarketProductId !== asset.cardmarketProductId
  || asset.tcgplayerArtworkReference.cardmarketExpansionId !== asset.cardmarketExpansionId
  || asset.tcgplayerArtworkReference.candidateCount
    !== asset.tcgplayerArtworkReference.candidateProductIds?.length
  || asset.tcgplayerArtworkReference.cardmarketCandidateCount
    !== asset.tcgplayerArtworkReference.cardmarketCandidateProductIds?.length
))) {
  throw new Error('A complete bidirectional promotional mapping lost its exact provider, language, or candidate-set identity.');
}
if ([...cardAssets, ...sealedAssets].some((asset) => asset.language === 'German')) {
  throw new Error('German must never be emitted without a source-backed product.');
}
for (const [productId, expectedImageUrl] of EXACT_TCGPLAYER_IMAGE_OVERRIDES) {
  const asset = promoAssets.find((candidate) => candidate.tcgplayerProductId === productId);
  if (!asset || asset.imageState !== 'available' || asset.imageUrl !== expectedImageUrl) {
    throw new Error(`Exact promotional image override ${productId} was not emitted correctly.`);
  }
}
for (const [sourcePrintingId, expectedImageUrl] of EXACT_OPTCG_IMAGE_OVERRIDES) {
  const asset = coreCardAssets.find((candidate) => candidate.sourcePrintingId === sourcePrintingId);
  if (!asset || asset.imageState !== 'available' || asset.imageUrl !== expectedImageUrl) {
    throw new Error(`Exact OPTCG image override ${sourcePrintingId} was not emitted correctly.`);
  }
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
const exactCrossMarketAssets = cardAssets.filter((asset) =>
  asset.cardmarketProductId != null
  && asset.tcgplayerProductId != null
  && asset.usPriceSource === 'TCGplayer via TCGCSV'
  && asset.quote.cardmarket != null
  && asset.quote.tcgplayer != null,
);
const exactCrossMarketProviderPairs = cardAssets.filter((asset) =>
  asset.cardmarketProductId != null
  && asset.tcgplayerProductId != null
  && asset.usPriceSource === 'TCGplayer via TCGCSV',
);
const exactCrossMarketTwentyEuroAssets = exactCrossMarketAssets.filter(
  (asset) => asset.quote.cardmarket >= 20,
);
const exactCrossMarketNonStandardAssets = exactCrossMarketAssets.filter(
  (asset) => asset.variant !== 'Standard',
);
const exactCrossMarketPromoAssets = exactCrossMarketAssets.filter(
  (asset) => asset.tcgplayerGroupId === TCGCSV_PROMO_GROUP_ID,
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
  throw new Error(`Exact cross-market coverage unexpectedly fell to ${baseTcgplayerMatches.size} preserved base mappings / ${exactCrossMarketAssets.length} priced cards.`);
}

function databaseSetCode(value) {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (normalized.length >= 2 && normalized.length <= 24) return normalized;
  if (normalized === 'P') return 'PROMO';
  return `SET-${hash(normalized || 'UNKNOWN', 12).toUpperCase()}`;
}

function databaseLanguage(value) {
  if (value === 'English') return 'EN';
  if (value === 'French') return 'FR';
  if (value === 'Japanese') return 'JP';
  throw new Error(`Supabase ingestion refuses unsupported language ${value}.`);
}

function databaseSealedProductType(value) {
  const types = new Map([
    ['Booster', 'booster_pack'],
    ['Booster box', 'booster_box'],
    ['Preconstructed deck', 'starter_deck'],
    ['Promo product', 'promotional_product'],
  ]);
  return types.get(value) ?? 'other';
}

function mergeExternalIdentifiers(existing, additions) {
  return Object.fromEntries(Object.entries({ ...(existing ?? {}), ...additions })
    .filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function withoutArtworkVerificationMetadataV10(existing) {
  return Object.fromEntries(Object.entries(existing ?? {})
    .filter(([key]) => !key.startsWith('verification_')));
}

function preferActiveByKey(rows, keyFor, inactiveField) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    const current = result.get(key);
    if (!current || (current[inactiveField] != null && row[inactiveField] == null)) result.set(key, row);
  }
  return result;
}

function preferCurrentProviderMappingByKey(rows, keyFor) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    const current = result.get(key);
    const rowIsActive = row.disabled_at == null;
    const currentIsActive = current?.disabled_at == null;
    const rowVersion = Number(row.mapping_version ?? 1);
    const currentVersion = Number(current?.mapping_version ?? 1);
    const rowUpdatedAt = Date.parse(row.updated_at ?? row.verified_at ?? '') || 0;
    const currentUpdatedAt = Date.parse(current?.updated_at ?? current?.verified_at ?? '') || 0;
    if (!current
      || (rowIsActive && !currentIsActive)
      || (rowIsActive === currentIsActive && rowVersion > currentVersion)
      || (rowIsActive === currentIsActive
        && rowVersion === currentVersion
        && rowUpdatedAt > currentUpdatedAt)) {
      result.set(key, row);
    }
  }
  return result;
}

async function fetchAllSupabaseRows(queryFactory) {
  const pageSize = 1_000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw new Error(`Supabase catalog read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) return rows;
  }
}

async function upsertSupabaseRows(supabase, table, rows, onConflict = 'id') {
  const batchSize = 250;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(offset, offset + batchSize), { onConflict });
    if (error) throw new Error(`Supabase ${table} ingestion failed: ${error.message}`);
  }
}

async function stageSupabaseRowsV3(supabase, runId, entityType, rows, keyFor) {
  const batchSize = 250;
  const keyedRows = rows.map((row, index) => {
    const stageKey = String(keyFor(row, index));
    if (!stageKey.trim() || stageKey.length > 240) {
      throw new Error(`Supabase ${entityType} staging produced an invalid row key.`);
    }
    return { ...row, _stage_key: stageKey };
  });
  if (new Set(keyedRows.map((row) => row._stage_key)).size !== keyedRows.length) {
    throw new Error(`Supabase ${entityType} staging produced duplicate row keys.`);
  }
  for (let offset = 0; offset < keyedRows.length; offset += batchSize) {
    const batch = keyedRows.slice(offset, offset + batchSize);
    const { data, error } = await supabase.rpc('stage_catalog_sync_rows_v3', {
      p_run_id: runId,
      p_entity_type: entityType,
      p_rows: batch,
    });
    if (error) throw new Error(`Supabase ${entityType} staging failed: ${error.message}`);
    if (Number(data) !== batch.length) {
      throw new Error(`Supabase ${entityType} staging acknowledged ${data} of ${batch.length} rows.`);
    }
  }
}

async function acquireProviderSyncLock(supabase, providerRows) {
  // PostgREST commits each request independently, so a client-side sequence
  // cannot be one database transaction. These existing provider columns form
  // the publish barrier: one writer owns both providers, last_sync_at changes
  // only after the complete idempotent plan succeeds, and failures are counted.
  const startedAt = new Date().toISOString();
  const lockUntil = new Date(Date.now() + (30 * 60 * 1_000)).toISOString();
  const providerIds = providerRows.map((provider) => provider.id);
  const { data, error } = await supabase
    .from('pricing_providers')
    .update({ sync_lock_until: lockUntil })
    .in('id', providerIds)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${startedAt}`)
    .select('id,consecutive_failures');
  if (error) throw new Error(`Supabase catalog sync lock failed: ${error.message}`);

  const lockedRows = data ?? [];
  if (lockedRows.length !== providerIds.length) {
    const { error: releaseError } = await supabase
      .from('pricing_providers')
      .update({ sync_lock_until: null })
      .in('id', providerIds)
      .eq('sync_lock_until', lockUntil);
    if (releaseError) {
      throw new Error(`Another catalog sync is active, and the partial lock could not be released: ${releaseError.message}`);
    }
    throw new Error('Another catalog sync is active; refusing to interleave provider writes.');
  }

  return {
    startedAt,
    lockUntil,
    failuresByProviderId: new Map(lockedRows.map((row) => [row.id, row.consecutive_failures ?? 0])),
  };
}

async function markProviderSyncFailed(supabase, providerRows, syncLock) {
  const statusErrors = [];
  for (const provider of providerRows) {
    const { data, error } = await supabase
      .from('pricing_providers')
      .update({
        sync_lock_until: null,
        consecutive_failures: (syncLock.failuresByProviderId.get(provider.id) ?? 0) + 1,
      })
      .eq('id', provider.id)
      .eq('sync_lock_until', syncLock.lockUntil)
      .select('id');
    if (error) statusErrors.push(`${provider.slug}: ${error.message}`);
    else if ((data ?? []).length !== 1) statusErrors.push(`${provider.slug}: sync lock ownership changed`);
  }
  if (statusErrors.length > 0) {
    throw new Error(`Supabase provider failure status could not be recorded (${statusErrors.join('; ')}).`);
  }
}

async function ingestSnapshotToSupabase(snapshot, officialCatalog, { required = false } = {}) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl && !supabaseSecretKey) {
    if (required) {
      throw new Error('Supabase ingestion was requested, but SUPABASE_URL and SUPABASE_SECRET_KEY are not configured.');
    }
    console.log('Supabase ingestion skipped (SUPABASE_URL and SUPABASE_SECRET_KEY are not configured).');
    return;
  }
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error('Supabase ingestion requires both SUPABASE_URL and SUPABASE_SECRET_KEY (legacy SUPABASE_SERVICE_ROLE_KEY is also accepted).');
  }

  const supabase = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const gameRows = await fetchAllSupabaseRows(() => supabase
    .from('games')
    .select('id,slug,archived_at')
    .eq('slug', 'one-piece-card-game')
    .order('id'));
  if (gameRows.length > 1) throw new Error('Supabase contains duplicate One Piece game rows.');
  const gameId = gameRows[0]?.id ?? '10000000-0000-4000-8000-000000000001';
  await upsertSupabaseRows(supabase, 'games', [{
    id: gameId,
    slug: 'one-piece-card-game',
    name: 'One Piece Card Game',
    publisher: 'Bandai',
    is_active: true,
    archived_at: null,
  }]);

  const providerDefinitions = [
    { slug: 'cardmarket', name: 'Cardmarket', market_region: 'europe', native_currency: 'EUR' },
    { slug: 'tcgplayer', name: 'TCGplayer', market_region: 'united_states', native_currency: 'USD' },
  ];
  const existingProviders = await fetchAllSupabaseRows(() => supabase
    .from('pricing_providers')
    .select('id,slug,last_sync_at')
    .in('slug', providerDefinitions.map((provider) => provider.slug))
    .order('id'));
  assertSnapshotCanAdvanceProviders(snapshot.generatedAt, existingProviders);
  const existingProviderBySlug = new Map(existingProviders.map((row) => [row.slug.toLowerCase(), row]));
  const providerRows = providerDefinitions.map((provider) => ({
    id: existingProviderBySlug.get(provider.slug)?.id ?? stableUuid('tcg-harbor-provider', provider.slug),
    ...provider,
    data_mode: 'live',
    is_enabled: true,
    requests_per_minute: 30,
    min_refresh_interval_seconds: 86_400,
  }));
  await upsertSupabaseRows(supabase, 'pricing_providers', providerRows);
  const providerBySlug = new Map(providerRows.map((row) => [row.slug, row]));
  const syncRunId = hash(JSON.stringify({
    generatedAt: snapshot.generatedAt,
    assets: snapshot.assets.map((asset) => asset.id).sort(),
  }), 32);
  const activeApprovedCatalogRemovalIds = activeCatalogRemovalApprovalIds(
    APPROVED_CATALOG_REMOVALS,
    snapshot.generatedAt,
  );
  const syncLock = await acquireProviderSyncLock(supabase, providerRows);
  let publishRunId = null;

  try {

  const releaseBySetCode = new Map();
  const releaseByFullOfficialCode = new Map();
  for (const product of officialCatalog.products.filter((candidate) => candidate.officialCode)) {
    const fullCode = normalizeSetCode(product.officialCode);
    const existingFullRelease = releaseByFullOfficialCode.get(fullCode);
    if (existingFullRelease && existingFullRelease.officialCode !== product.officialCode) {
      throw new Error(`Official release code ${fullCode} is ambiguous between ${existingFullRelease.officialCode} and ${product.officialCode}.`);
    }
    releaseByFullOfficialCode.set(fullCode, product);
    for (const code of officialMemberSetCodes(product.officialCode)) {
      const current = releaseBySetCode.get(code);
      if (!current || product.releasedOn < current.releasedOn) {
        releaseBySetCode.set(code, product);
      }
    }
  }
  // Combined products such as OP14-EB04 and OP15-EB04 keep their own official
  // release metadata while member codes retain the earliest applicable date.
  for (const [code, product] of releaseByFullOfficialCode) releaseBySetCode.set(code, product);

  const setAssets = new Map();
  for (const asset of snapshot.assets) {
    const code = databaseSetCode(asset.setCode);
    const bucket = setAssets.get(code) ?? [];
    bucket.push(asset);
    setAssets.set(code, bucket);
  }
  const existingSets = await fetchAllSupabaseRows(() => supabase
    .from('card_sets')
    .select('id,code,external_identifiers,archived_at')
    .eq('game_id', gameId)
    .order('id'));
  const existingSetByCode = preferActiveByKey(
    existingSets,
    (row) => row.code.toUpperCase(),
    'archived_at',
  );
  const setRows = [...setAssets.entries()].map(([code, assets]) => {
    const existing = existingSetByCode.get(code);
    const officialRelease = releaseBySetCode.get(code);
    const representative = assets.find((asset) => asset.kind === 'card') ?? assets[0];
    return {
      id: existing?.id ?? stableUuid('tcg-harbor-set', code),
      game_id: gameId,
      code,
      name: representative.set || code,
      release_date: officialRelease?.releasedOn ?? null,
      external_identifiers: mergeExternalIdentifiers(existing?.external_identifiers, {
        tcg_harbor_set_code: code,
        tcg_harbor_game_slug: 'one-piece-card-game',
        catalog_sync_run_id: syncRunId,
        catalog_sync_generated_at: snapshot.generatedAt,
        bandai_official_code: officialRelease?.officialCode,
      }),
      archived_at: null,
    };
  });
  // Public catalog rows are not changed here. They are staged after the full
  // continuity plan is known and published together by finalize_catalog_sync_v3.
  const setIdByCode = new Map(setRows.map((row) => [row.code, row.id]));

  const cardAssets = snapshot.assets.filter((asset) => asset.kind === 'card');
  const cardAssetGroups = new Map();
  for (const asset of cardAssets) {
    const setCode = databaseSetCode(asset.setCode);
    const key = `${setCode}|${String(asset.number).toUpperCase()}`;
    const bucket = cardAssetGroups.get(key) ?? [];
    bucket.push(asset);
    cardAssetGroups.set(key, bucket);
  }
  const existingCards = await fetchAllSupabaseRows(() => supabase
    .from('cards')
    .select('id,card_set_id,card_number,external_identifiers,archived_at')
    .eq('game_id', gameId)
    .order('id'));
  const existingCardByNaturalKey = preferActiveByKey(
    existingCards,
    (row) => `${row.card_set_id}|${row.card_number.toUpperCase()}`,
    'archived_at',
  );
  const cardRows = [...cardAssetGroups.entries()].map(([key, assets]) => {
    const [setCode] = key.split('|');
    const representative = assets.find((asset) => asset.variant === 'Standard') ?? assets[0];
    const cardSetId = setIdByCode.get(setCode);
    const naturalKey = `${cardSetId}|${String(representative.number).toUpperCase()}`;
    const existing = existingCardByNaturalKey.get(naturalKey);
    return {
      id: existing?.id ?? stableUuid('tcg-harbor-card', key),
      game_id: gameId,
      card_set_id: cardSetId,
      card_number: representative.number,
      name: representative.name,
      rarity: representative.rarity,
      card_type: representative.rarity === 'DON!!' ? 'DON!!' : 'Card',
      colors: [],
      image_url: representative.imageUrl ?? null,
      release_date: releaseBySetCode.get(setCode)?.releasedOn ?? null,
      external_identifiers: mergeExternalIdentifiers(existing?.external_identifiers, {
        tcg_harbor_rules_card_id: representative.rulesCardId ?? representative.number,
        tcg_harbor_game_slug: 'one-piece-card-game',
        catalog_sync_run_id: syncRunId,
        catalog_sync_generated_at: snapshot.generatedAt,
      }),
      archived_at: null,
    };
  });
  const cardIdByNaturalKey = new Map(cardRows.map((row) => [
    `${databaseSetCode(setRows.find((set) => set.id === row.card_set_id)?.code)}|${row.card_number.toUpperCase()}`,
    row.id,
  ]));

  const existingVariants = await fetchAllSupabaseRows(() => supabase
    .from('card_variants')
    .select('id,card_id,variant_identifier,language,external_identifiers,archived_at')
    .order('id'));
  const existingVariantByNaturalKey = preferActiveByKey(
    existingVariants,
    (row) => `${row.card_id}|${row.variant_identifier.toLowerCase()}|${row.language}`,
    'archived_at',
  );
  const variantRows = cardAssets.map((asset) => {
    const setCode = databaseSetCode(asset.setCode);
    const cardId = cardIdByNaturalKey.get(`${setCode}|${String(asset.number).toUpperCase()}`);
    const language = databaseLanguage(asset.language);
    const naturalKey = `${cardId}|${asset.id.toLowerCase()}|${language}`;
    const existing = existingVariantByNaturalKey.get(naturalKey);
    return {
      id: existing?.id ?? stableUuid('tcg-harbor-variant', asset.id),
      card_id: cardId,
      variant_identifier: asset.id,
      variant_name: asset.variant,
      language,
      image_url: asset.imageUrl ?? null,
      external_identifiers: mergeExternalIdentifiers(existing?.external_identifiers, {
        tcg_harbor_asset_id: asset.id,
        tcg_harbor_game_slug: 'one-piece-card-game',
        catalog_sync_run_id: syncRunId,
        catalog_sync_generated_at: snapshot.generatedAt,
        source_printing_id: asset.sourcePrintingId,
        cardmarket_product_id: asset.cardmarketProductId,
        tcgplayer_product_id: asset.tcgplayerProductId,
      }),
      archived_at: null,
    };
  });
  if (variantRows.some((row) => !row.card_id)) throw new Error('Supabase variant ingestion lost a parent card ID.');
  const variantIdByAssetId = new Map(variantRows.map((row) => [
    row.external_identifiers.tcg_harbor_asset_id,
    row.id,
  ]));

  const sealedAssets = snapshot.assets.filter((asset) => asset.kind === 'sealed');
  const existingSealed = await fetchAllSupabaseRows(() => supabase
    .from('sealed_products')
    .select('id,name,product_type,language,external_identifiers,archived_at')
    .eq('game_id', gameId)
    .order('id'));
  const existingSealedByNaturalKey = preferActiveByKey(
    existingSealed,
    (row) => `${row.name.toLowerCase()}|${row.product_type}|${row.language}`,
    'archived_at',
  );
  const sealedRows = sealedAssets.map((asset) => {
    const language = databaseLanguage(asset.language);
    const productType = databaseSealedProductType(asset.productType);
    const naturalKey = `${asset.name.toLowerCase()}|${productType}|${language}`;
    const existing = existingSealedByNaturalKey.get(naturalKey);
    const setCode = databaseSetCode(asset.setCode);
    return {
      id: existing?.id ?? stableUuid('tcg-harbor-sealed', asset.id),
      game_id: gameId,
      card_set_id: setIdByCode.get(setCode) ?? null,
      name: asset.name,
      product_type: productType,
      language,
      region: asset.region ?? 'Europe',
      image_url: asset.imageUrl ?? null,
      release_date: releaseBySetCode.get(setCode)?.releasedOn ?? null,
      external_identifiers: mergeExternalIdentifiers(existing?.external_identifiers, {
        tcg_harbor_asset_id: asset.id,
        tcg_harbor_game_slug: 'one-piece-card-game',
        catalog_sync_run_id: syncRunId,
        catalog_sync_generated_at: snapshot.generatedAt,
        cardmarket_product_id: asset.cardmarketProductId,
        image_source_product_id: asset.imageSourceProductId,
        image_source_relationship: asset.imageSourceRelationship,
        cardmarket_price_language_scope: 'product-level',
      }),
      archived_at: null,
    };
  });
  const sealedIdByAssetId = new Map(sealedRows.map((row) => [
    row.external_identifiers.tcg_harbor_asset_id,
    row.id,
  ]));

  const existingMappings = await fetchAllSupabaseRows(() => supabase
    .from('provider_catalog_mappings')
    .select('id,provider_id,card_variant_id,sealed_product_id,provider_product_id,provider_listing_id,condition,language,variant_key,mapping_metadata,verified_at,updated_at,disabled_at,supersedes_mapping_id,mapping_version')
    .in('provider_id', providerRows.map((provider) => provider.id))
    .order('id'));
  const existingMappingByNaturalKey = preferCurrentProviderMappingByKey(
    existingMappings,
    (row) => `${row.provider_id}|${row.card_variant_id ?? row.sealed_product_id}|${row.condition}|${row.language}|${row.variant_key}`,
  );
  const mappingPlans = [];
  for (const asset of snapshot.assets) {
    const isCard = asset.kind === 'card';
    const targetId = isCard ? variantIdByAssetId.get(asset.id) : sealedIdByAssetId.get(asset.id);
    if (!targetId) throw new Error(`Supabase mapping ingestion lost catalog target ${asset.id}.`);
    const condition = pricingConditionForAsset(asset.kind);
    const language = databaseLanguage(asset.language);
    const providers = [
      asset.cardmarketProductId != null ? ['cardmarket', String(asset.cardmarketProductId)] : null,
      asset.tcgplayerProductId != null ? ['tcgplayer', String(asset.tcgplayerProductId)] : null,
    ].filter(Boolean);
    for (const [providerSlug, providerProductId] of providers) {
      const provider = providerBySlug.get(providerSlug);
      const variantKey = isCard ? asset.id : 'sealed';
      const naturalKey = `${provider.id}|${targetId}|${condition}|${language}|${variantKey}`;
      const existing = existingMappingByNaturalKey.get(naturalKey);
      const reusesActiveIdentity = providerMappingCanReuseActiveIdentity(
        existing,
        providerProductId,
      );
      const mappingVersion = reusesActiveIdentity
        ? Number(existing.mapping_version ?? 1)
        : Number(existing?.mapping_version ?? 0) + 1;
      const supersedesMappingId = reusesActiveIdentity
        ? existing.supersedes_mapping_id ?? null
        : existing?.id ?? null;
      const mapping = {
        id: reusesActiveIdentity
          ? existing.id
          : stableUuid(
            'tcg-harbor-mapping-version-v3',
            providerMappingVersionSeed(
              providerSlug,
              asset.id,
              condition,
              providerProductId,
              existing?.id ?? 'initial',
            ),
          ),
        provider_id: provider.id,
        card_variant_id: isCard ? targetId : null,
        sealed_product_id: isCard ? null : targetId,
        provider_product_id: providerProductId,
        provider_listing_id: reusesActiveIdentity ? existing.provider_listing_id ?? null : null,
        condition,
        language,
        variant_key: variantKey,
        mapping_metadata: mergeExternalIdentifiers(
          withoutArtworkVerificationMetadataV10(existing?.mapping_metadata),
          {
            ...productLevelMappingMetadata({
              assetId: asset.id,
              syncRunId,
              syncGeneratedAt: snapshot.generatedAt,
              source: providerSlug === 'cardmarket'
                ? (asset.kind === 'sealed' ? CARDMARKET_NONSINGLES : CARDMARKET_PRODUCTS)
                : 'TCGCSV / TCGplayer',
            }),
            mapping_history_policy: 'append-only-provider-identity-v3',
            mapping_version: mappingVersion,
            supersedes_mapping_id: supersedesMappingId,
            ...(existing && !reusesActiveIdentity ? {
              previous_provider_product_id: existing.provider_product_id,
            } : {}),
            ...(providerSlug === 'cardmarket' && asset.cardmarketArtworkReference ? {
              verification_policy: asset.cardmarketArtworkReference.matchPolicy,
              verification_candidate_count: asset.cardmarketArtworkReference.candidateCount,
              verification_image_observed_at: asset.cardmarketArtworkReference.imageVerifiedAt,
              verification_refresh_deferred_at: asset.cardmarketArtworkReference.refreshDeferredAt,
              verification_refresh_deferred_reason: asset.cardmarketArtworkReference.refreshDeferredReason,
              verification_correlation: asset.cardmarketArtworkReference.correlation,
              verification_runner_up_correlation: asset.cardmarketArtworkReference.runnerUpCorrelation,
              verification_margin: asset.cardmarketArtworkReference.margin,
              verification_source_image_url: asset.cardmarketArtworkReference.sourceImageUrl,
              verification_product_image_url: asset.cardmarketArtworkReference.productImageUrl,
              verification_source_image_digest: asset.cardmarketArtworkReference.sourceImageDigest,
              verification_product_image_digest: asset.cardmarketArtworkReference.productImageDigest,
              verification_reviewed_mapping_id:
                asset.cardmarketArtworkReference.reviewedMappingId,
              verification_reviewed_minimum_correlation:
                asset.cardmarketArtworkReference.reviewedMinimumCorrelation,
              verification_evidence: asset.cardmarketArtworkReference.evidence,
            } : {}),
            ...(providerSlug === 'tcgplayer' && asset.tcgplayerArtworkReference ? {
              verification_policy: asset.tcgplayerArtworkReference.matchPolicy,
              verification_candidate_count: asset.tcgplayerArtworkReference.candidateCount,
              verification_candidate_product_ids: asset.tcgplayerArtworkReference.candidateProductIds,
              verification_image_observed_at: asset.tcgplayerArtworkReference.imageVerifiedAt,
              verification_correlation: asset.tcgplayerArtworkReference.correlation,
              verification_runner_up_correlation: asset.tcgplayerArtworkReference.runnerUpCorrelation,
              verification_margin: asset.tcgplayerArtworkReference.margin,
              verification_cardmarket_product_id: asset.tcgplayerArtworkReference.cardmarketProductId,
              verification_cardmarket_image_url: asset.tcgplayerArtworkReference.cardmarketImageUrl,
              verification_tcgplayer_image_url: asset.tcgplayerArtworkReference.tcgplayerImageUrl,
              verification_cardmarket_image_digest: asset.tcgplayerArtworkReference.cardmarketImageDigest,
              verification_tcgplayer_image_digest: asset.tcgplayerArtworkReference.tcgplayerImageDigest,
              verification_reviewed_mapping_id:
                asset.tcgplayerArtworkReference.reviewedMappingId,
              verification_reviewed_minimum_correlation:
                asset.tcgplayerArtworkReference.reviewedMinimumCorrelation,
              verification_evidence: asset.tcgplayerArtworkReference.evidence,
            } : {}),
          },
        ),
        verified_at: snapshot.generatedAt,
        disabled_at: null,
        supersedes_mapping_id: supersedesMappingId,
        mapping_version: mappingVersion,
      };
      mappingPlans.push({ asset, providerSlug, provider, mapping });
    }
  }
  const priceSnapshotRows = mappingPlans.map(({ asset, providerSlug, provider, mapping }) => ({
    mapping_id: mapping.id,
    provider_id: provider.id,
    card_variant_id: mapping.card_variant_id,
    sealed_product_id: mapping.sealed_product_id,
    currency: provider.native_currency,
    market_value: providerSlug === 'cardmarket' ? asset.quote.cardmarket : asset.quote.tcgplayer,
    condition: mapping.condition,
    language: mapping.language,
    observed_at: providerSlug === 'cardmarket'
      ? asset.sourceUpdatedAt?.cardmarket ?? snapshot.generatedAt
      : asset.sourceUpdatedAt?.tcgcsv ?? snapshot.generatedAt,
    data_mode: 'live',
  }));
  // Retire importer-owned rows only after every current row and price snapshot
  // has been written. Manual/admin-created catalog data is never touched.
  const onePieceCardIds = new Set(existingCards.map((row) => row.id));
  const onePieceVariantIds = new Set(existingVariants
    .filter((row) => onePieceCardIds.has(row.card_id))
    .map((row) => row.id));
  const onePieceSealedIds = new Set(existingSealed.map((row) => row.id));
  const staleMappings = activeManagedRowsMissingFromPlan(
    existingMappings,
    new Set(mappingPlans.map((plan) => plan.mapping.id)),
    {
      inactiveField: 'disabled_at',
      managedAssetId: (row) => (
        row.mapping_metadata?.tcg_harbor_asset_id
        && (
          onePieceVariantIds.has(row.card_variant_id)
          || onePieceSealedIds.has(row.sealed_product_id)
        )
      ),
    },
  );
  const staleVariants = activeManagedRowsMissingFromPlan(
    existingVariants,
    new Set(variantRows.map((row) => row.id)),
    {
      inactiveField: 'archived_at',
      managedAssetId: (row) => (
        row.external_identifiers?.tcg_harbor_asset_id
        && onePieceCardIds.has(row.card_id)
      ),
    },
  );
  const staleSealed = activeManagedRowsMissingFromPlan(
    existingSealed,
    new Set(sealedRows.map((row) => row.id)),
    {
      inactiveField: 'archived_at',
      managedAssetId: (row) => row.external_identifiers?.tcg_harbor_asset_id,
    },
  );
  const staleCards = activeManagedRowsMissingFromPlan(
    existingCards,
    new Set(cardRows.map((row) => row.id)),
    {
      inactiveField: 'archived_at',
      managedAssetId: (row) => row.external_identifiers?.tcg_harbor_rules_card_id,
    },
  );
  const staleSets = activeManagedRowsMissingFromPlan(
    existingSets,
    new Set(setRows.map((row) => row.id)),
    {
      inactiveField: 'archived_at',
      managedAssetId: (row) => row.external_identifiers?.tcg_harbor_set_code,
    },
  );
  const unapprovedStaleCatalogRows = [
    ...staleVariants.map((row) => ({
      kind: 'card variant',
      id: row.id,
      assetId: row.external_identifiers?.tcg_harbor_asset_id,
    })),
    ...staleSealed.map((row) => ({
      kind: 'sealed product',
      id: row.id,
      assetId: row.external_identifiers?.tcg_harbor_asset_id,
    })),
  ].filter((row) => !activeApprovedCatalogRemovalIds.has(row.assetId));
  if (unapprovedStaleCatalogRows.length > 0) {
    throw new Error(
      `Supabase catalog retirement rejected ${unapprovedStaleCatalogRows.length} unreviewed managed rows: ${JSON.stringify(unapprovedStaleCatalogRows.slice(0, 20))}.`,
    );
  }

  const activeCollectionItems = await fetchAllSupabaseRows(() => supabase
    .from('collection_items')
    .select('id,card_variant_id,sealed_product_id')
    .is('deleted_at', null)
    .order('id'));
  const heldVariantIds = new Set(activeCollectionItems.map((item) => item.card_variant_id).filter(Boolean));
  const heldSealedIds = new Set(activeCollectionItems.map((item) => item.sealed_product_id).filter(Boolean));
  const heldRowsMarkedStale = [
    ...staleVariants.filter((row) => heldVariantIds.has(row.id)).map((row) => ({ kind: 'card variant', id: row.id })),
    ...staleSealed.filter((row) => heldSealedIds.has(row.id)).map((row) => ({ kind: 'sealed product', id: row.id })),
  ];
  if (heldRowsMarkedStale.length > 0) {
    // Every stale card/sealed row reached here only after its stable asset ID
    // passed the explicit, expiring removal approval above. Soft-archiving the
    // catalog row prevents new adds while the owner-scoped collection join
    // deliberately keeps an existing holding visible as a null-priced fallback.
    console.warn(
      `Archiving ${heldRowsMarkedStale.length} reviewed catalog row(s) referenced by active holdings; existing holdings remain visible but cannot be newly added: ${JSON.stringify(heldRowsMarkedStale.slice(0, 20))}.`,
    );
  }
  const stagedEntities = [
    ['card_sets', setRows, (row) => row.id],
    ['cards', cardRows, (row) => row.id],
    ['card_variants', variantRows, (row) => row.id],
    ['sealed_products', sealedRows, (row) => row.id],
    ['provider_catalog_mappings', mappingPlans.map((plan) => plan.mapping), (row) => row.id],
    ['price_snapshots', priceSnapshotRows, (row) => `${row.mapping_id}|${row.observed_at}`],
    ['retire_provider_catalog_mappings', staleMappings.map((row) => ({ id: row.id })), (row) => row.id],
    ['retire_card_variants', staleVariants.map((row) => ({ id: row.id })), (row) => row.id],
    ['retire_sealed_products', staleSealed.map((row) => ({ id: row.id })), (row) => row.id],
    ['retire_cards', staleCards.map((row) => ({ id: row.id })), (row) => row.id],
    ['retire_card_sets', staleSets.map((row) => ({ id: row.id })), (row) => row.id],
  ];
  const expectedCounts = Object.fromEntries(
    stagedEntities.map(([entityType, rows]) => [entityType, rows.length]),
  );
  publishRunId = randomUUID();
  const { error: beginPublishError } = await supabase.rpc('begin_catalog_sync_v3', {
    p_run_id: publishRunId,
    p_game_id: gameId,
    p_snapshot_generated_at: snapshot.generatedAt,
    p_provider_ids: providerRows.map((provider) => provider.id),
    p_provider_lock_until: syncLock.lockUntil,
    p_expected_counts: expectedCounts,
  });
  if (beginPublishError) {
    throw new Error(`Supabase atomic catalog publish could not begin: ${beginPublishError.message}`);
  }
  for (const [entityType, rows, keyFor] of stagedEntities) {
    await stageSupabaseRowsV3(supabase, publishRunId, entityType, rows, keyFor);
  }
  const { data: publishResult, error: publishError } = await supabase
    .rpc('finalize_catalog_sync_v3', { p_run_id: publishRunId });
  if (publishError) {
    throw new Error(`Supabase atomic catalog publish failed: ${publishError.message}`);
  }

  console.log(`Supabase ingestion: ${setRows.length} sets, ${cardRows.length} rules cards, ${variantRows.length} variants, ${sealedRows.length} sealed products, ${mappingPlans.length} provider mappings/snapshots.`);
  console.log(`Supabase retirement: ${staleMappings.length} mappings, ${staleVariants.length} variants, ${staleSealed.length} sealed products, ${staleCards.length} rules cards, ${staleSets.length} sets.`);
  console.log(`Supabase atomic publish: ${JSON.stringify(publishResult)}.`);
  } catch (error) {
    try {
      let runStatus = 'missing';
      if (publishRunId) {
        const { data, error: abortError } = await supabase.rpc('abort_catalog_sync_v3', {
          p_run_id: publishRunId,
          p_failure_message: error instanceof Error ? error.message : String(error),
        });
        if (abortError) {
          await markProviderSyncFailed(supabase, providerRows, syncLock);
          runStatus = 'fallback-failed';
        } else {
          runStatus = String(data ?? 'missing');
        }
      }
      if (runStatus === 'missing') {
        await markProviderSyncFailed(supabase, providerRows, syncLock);
      }
      if (runStatus === 'published') {
        console.warn('Supabase catalog publish committed, but the client lost the successful RPC response.');
        return;
      }
    } catch (statusError) {
      const originalMessage = error instanceof Error ? error.message : String(error);
      const statusMessage = statusError instanceof Error ? statusError.message : String(statusError);
      throw new Error(`${originalMessage} Additionally, ${statusMessage}`);
    }
    throw error;
  }
}

const output = {
  generatedAt,
  provenance: {
    matchingPolicy: 'OPTCG remains printing truth for Bandai-confirmed released sets, starter decks, and DON!! cards; recognizable future OP/EB/PRB/ST records are excluded until their official English release. Numbered TCGCSV/TCGplayer products are printing truth for promotional cards and join to OPTCG by printed card number only for rules metadata. Conservative standard cross-market joins remain preserved. Other exact Cardmarket-mapped set printings receive a TCGplayer identity only when the Cardmarket image uniquely matches one product image after every non-presale TCGCSV product for the exact released English group and printed number is compared above frozen correlation and separation thresholds. Cardmarket-only exact coverage maps booster or starter-deck artwork when identity is uniquely proven by catalog metadata, when the sourced artwork independently clears the complete-candidate thresholds, or through an exact reviewed normalized-image digest when visually similar arts reduce the generic margin. Released English promotional mappings require mutual unique-best image matches across the complete same-number matrix, except exact reviewed normalized-image digests may preserve a mapping when provider scans differ or Cardmarket consolidates visually identical TCGplayer releases. A Cardmarket product can serve multiple TCGplayer records only through that explicit same-art review. Product names, order, IDs, and prices never infer V.1/V.2. Image-verified exact products populate the selected art quote, collection acquisition value, growth, and eligible comparisons. Promo identity, artwork, and USD price stay bound to the same TCGplayer productId. Source-backed Japanese/French products keep those languages, English-market products remain English, and German is never invented.',
    englishExpansionIds,
    englishStarterExpansionIds,
    releasedSealedSetCodeByExpansionId: Object.fromEntries(
      releasedSealedSetCodeByExpansionIdV1,
    ),
    englishExpansionEvidence: tcgcsvMarketSources.map((source) => ({
      tcgcsvAbbreviation: source.abbreviation,
      officialBandaiCode: source.release.officialCode,
      officialReleasePrecision: source.release.releasePrecision,
      tcgcsvGroupId: source.groupId,
      officialEnglishReleasedOn: source.releasedOn,
      memberSetCodes: source.memberSetCodes,
      cardmarketExpansionId: cardmarketExpansionEvidenceByGroup.get(source.groupId).idExpansion,
      policy: cardmarketExpansionEvidenceByGroup.get(source.groupId).policy,
      evidenceProductIds: cardmarketExpansionEvidenceByGroup.get(source.groupId).evidenceProductIds,
    })),
    englishReleaseManifest: {
      source: BANDAI_ENGLISH_PRODUCTS,
      auditedAt: bandaiCatalog.fetchedAt.slice(0, 10),
      fetchedAt: bandaiCatalog.fetchedAt,
      archivePagesChecked: bandaiCatalog.pageCount,
      policy: 'Every official Bandai English product archive page is checked on each sync, including full-width legacy code brackets; vetted first-party records and previously verified already-released products protect historical releases if archive markup omits them. Unreleased announcements never carry forward. Exact released booster codes must map one-to-one to a TCGCSV English group. Day-level dates unlock on that day and month-only announcements unlock only after the announced month. Unknown core set codes and missing mappings fail the sync instead of retiring released cards or leaking presale data.',
      futureProductsExcluded: bandaiCatalog.products
        .filter((product) => (product.category === 'boosters' || product.category === 'decks')
          && product.officialCode)
        .filter((product) => !officialProductAvailableAt(product, new Date(generatedAt)))
        .map((product) => releaseMetadataForOfficialProduct(product)),
      officialProducts: bandaiCatalog.products
        .filter((product) => (product.category === 'boosters' || product.category === 'decks')
          && product.officialCode)
        .map((product) => releaseMetadataForOfficialProduct(product)),
      officialOtherProducts: bandaiCatalog.products
        .filter((product) => product.category === 'other')
        .map((product) => ({
          title: product.title,
          releasedOn: product.releasedOn,
          releaseLabel: product.releaseLabel,
          releasePrecision: product.releasePrecision,
          productUrl: product.productUrl,
        })),
    },
    crossMarketCoverage: {
      exactMappingsByGroup: Object.fromEntries(exactMappingsByGroup),
      exactArtworkMappingsByGroup: Object.fromEntries(tcgplayerArtworkMappingsByGroupV1),
      releasedGroupsWithoutExactStandardMappings: groupsWithoutExactMappings,
      ambiguityPolicy: 'Missing, incomplete, or visually inseparable candidate sets are excluded; product name, order, ID, and market price are never used to choose an artwork identity.',
      artworkReferencePolicy: {
        ...TCGPLAYER_ARTWORK_MAPPING_POLICY_V1,
        discoveryBudgetSeconds: TCGPLAYER_ARTWORK_DISCOVERY_BUDGET_MS_V1 / 1_000,
        persistencePolicy: 'Complete-candidate evidence is reused only while the policy, both provider candidate-ID sets, Cardmarket product, and exact set/group/number remain unchanged. Evidence is fresh for at most 14 days with staggered refreshes; a transient fetch failure or global-budget deferral may preserve unchanged evidence for at most 21 days. New unresolved artwork stays unmapped, while required OP13 invariants are attempted first.',
        mappedReferences: tcgplayerArtworkMatchesV1.size,
        persistedReferences: persistedTcgplayerArtworkReferenceIdentitiesV1.size,
        discoveredReferences: discoveredTcgplayerArtworkReferenceIdentitiesV1.size,
        deferredReferences: deferredTcgplayerArtworkReferenceIdentitiesV1.size,
        unresolvedReferences: tcgplayerArtworkReferenceFailuresV1.length,
        unresolvedSamples: tcgplayerArtworkReferenceFailuresV1.slice(0, 50),
      },
      promoArtworkReferencePolicy: {
        ...PROMO_CROSS_MARKET_MAPPING_POLICY_V1,
        registryVersion: cardmarketPromoExpansionRegistryV1.schemaVersion,
        reviewedExpansionIds: cardmarketPromoExpansionRegistryV1.expansions.map(
          (entry) => entry.idExpansion,
        ),
        requiredCompletePricedPrintedNumbers:
          cardmarketPromoExpansionRegistryV1.requiredCompletePricedPrintedNumbers,
        reviewedDigestMappings:
          cardmarketPromoExpansionRegistryV1.reviewedArtworkMappings.length,
        discoveryBudgetSeconds: PROMO_CROSS_MARKET_DISCOVERY_BUDGET_MS_V1 / 1_000,
        persistencePolicy: 'Complete-matrix evidence is reused only while both provider candidate-ID sets remain unchanged. Reviewed exceptions additionally require the same registry ID and normalized provider-image digests. Refreshes are staggered; a transient timeout may defer prior evidence for at most 21 days, except a required priced printed number still blocks publication if complete mapped coverage is absent.',
        mappedReferences: promoCrossMarketMatchesV1.size,
        persistedReferences: persistedPromoCrossMarketReferencesV1,
        discoveredReferences: discoveredPromoCrossMarketReferencesV1,
        deferredReferences: deferredPromoCrossMarketReferencesV1,
        unresolvedReferences: promoCrossMarketReferenceFailuresV1.length,
        unresolvedSamples: promoCrossMarketReferenceFailuresV1.slice(0, 50),
      },
      ambiguousCardmarketSamples: ambiguousCardmarketBaseMappings.slice(0, 25),
      unavailableCardmarketPriceSamples: cardmarketBasePricesUnavailable.slice(0, 25),
      ambiguousTcgplayerSamples: ambiguousBaseTcgplayerNumbers.slice(0, 25),
      missingOrAmbiguousOptcgSamples: optcgBaseCandidatesMissingOrAmbiguous.slice(0, 25),
    },
    cardmarketCoverage: {
      exactMappingsByGroup: Object.fromEntries([...cardmarketCoverageByGroup].map(([groupCode, coverage]) => [
        groupCode,
        coverage.seededExactMappings + coverage.exactMappings,
      ])),
      additionalExactMappingsByGroup: Object.fromEntries([...cardmarketCoverageByGroup].map(([groupCode, coverage]) => [
        groupCode,
        coverage.exactMappings,
      ])),
      coverageByGroup: Object.fromEntries(cardmarketCoverageByGroup),
      starterExpansionEvidence: Object.fromEntries(starterExpansionEvidence.exact),
      ambiguousStarterExpansionEvidence: starterExpansionEvidence.ambiguous,
      mappingPolicy: 'Seed independently verified standard mappings first. Then map only a 1-to-1 remainder by proven English expansion and exact printed number, for booster and starter-deck source printings. Product ID order, price, and title similarity never identify artwork.',
      ambiguityPolicy: 'Multiple Cardmarket products or multiple source printings remain exact-artwork ambiguous until verified. Candidate price order never identifies regular versus alternate art. A product mapping and valuation are promoted for a sourced printing only after its exact image passes the complete-candidate correlation policy.',
      regularArtReferencePolicy: {
        version: CARDMARKET_ARTWORK_MATCH_POLICY_V10,
        featureWidth: CARDMARKET_REGULAR_ART_POLICY_V1.featureWidth,
        featureHeight: CARDMARKET_REGULAR_ART_POLICY_V1.featureHeight,
        minimumCorrelation: CARDMARKET_REGULAR_ART_POLICY_V1.minimumCorrelation,
        minimumMargin: CARDMARKET_REGULAR_ART_POLICY_V1.minimumMargin,
        candidateCoverage: 'complete',
        refreshBuckets: IMAGE_REFRESH_BUCKETS_V10,
        maximumEvidenceAgeDays: ARTWORK_EVIDENCE_MAX_AGE_MS_V10 / (24 * 60 * 60_000),
        transientGraceDays: ARTWORK_EVIDENCE_TRANSIENT_GRACE_MS_V10 / (24 * 60 * 60_000),
        imageFetchAttempts: ARTWORK_IMAGE_MAX_ATTEMPTS_V10,
        persistedReferences: persistedRegularArtworkReferencesV10,
        migratedCompleteLegacyReferences: [...migratedLegacyArtworkReferenceIdentitiesV10]
          .filter((identity) => {
            const card = coreCardByPrintingIdentityV10.get(identity);
            return card?.card_image_id === regularRulesCardId(card);
          }).length,
        discoveredReferences: discoveredRegularArtworkReferencesV10,
        deferredRefreshes: deferredRegularArtworkReferencesV10,
        unresolvedReferences: regularArtworkReferenceFailuresV10.length,
        unresolvedSamples: regularArtworkReferenceFailuresV10.slice(0, 50),
      },
      artworkReferencePolicy: {
        version: CARDMARKET_ARTWORK_MATCH_POLICY_V10,
        featureWidth: CARDMARKET_REGULAR_ART_POLICY_V1.featureWidth,
        featureHeight: CARDMARKET_REGULAR_ART_POLICY_V1.featureHeight,
        minimumCorrelation: CARDMARKET_REGULAR_ART_POLICY_V1.minimumCorrelation,
        minimumMargin: CARDMARKET_REGULAR_ART_POLICY_V1.minimumMargin,
        candidateCoverage: 'complete',
        refreshBuckets: IMAGE_REFRESH_BUCKETS_V10,
        maximumEvidenceAgeDays: ARTWORK_EVIDENCE_MAX_AGE_MS_V10 / (24 * 60 * 60_000),
        transientGraceDays: ARTWORK_EVIDENCE_TRANSIENT_GRACE_MS_V10 / (24 * 60 * 60_000),
        imageFetchAttempts: ARTWORK_IMAGE_MAX_ATTEMPTS_V10,
        persistedReferences: persistedArtworkReferencesV10,
        migratedCompleteLegacyReferences: migratedLegacyArtworkReferenceIdentitiesV10.size,
        discoveredReferences: discoveredArtworkReferencesV10,
        deferredRefreshes: deferredArtworkReferencesV10,
        unresolvedReferences: artworkReferenceFailuresV10.length,
        unresolvedSamples: artworkReferenceFailuresV10.slice(0, 50),
        rejectedProductConflicts: artworkReferenceConflictsV10.length,
        rejectedProductConflictSamples: artworkReferenceConflictsV10.slice(0, 25),
        reviewedDigestMappings: REVIEWED_CARDMARKET_ARTWORK_MAPPINGS_V10.size,
      },
      continuityPolicy: 'A previously exact card asset must retain the same Cardmarket product ID. Changes or removals fail the sync unless one stable asset has an exact old/new-ID approval with a reason and unexpired review window.',
      approvedMappingChanges: approvedCardmarketMappingChanges,
      ambiguousArtworkSamples: [...cardmarketAmbiguities.values()].slice(0, 50),
      unavailableSamples: [...cardmarketUnavailable.values()].slice(0, 50),
    },
    catalogCounts: {
      rawOptcgRecords: rawCards.length,
      rawOptcgPromoRecords: rawPromoCards.length,
      rawOptcgCoreRecords: rawCoreCards.length,
      releasedOptcgCoreRecords: releasedRawCoreCards.length,
      futureOptcgCoreRecordsExcluded: futureRawCoreCardsExcluded.length,
      unknownManifestOptcgCoreRecords: unknownManifestRawCoreCards.length,
      releasedOfficialCardSetCodes: releasedOfficialCardSetCodes.size,
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
      cardmarketMappedBaseArts: baseCardmarketMatches.size,
      cardmarketMappedCardPrintings: cardAssets.filter((asset) => asset.cardmarketProductId != null).length,
      cardmarketPricedCardPrintings: cardAssets.filter((asset) => asset.cardmarketPriceState === 'available').length,
      cardmarketTrendUnavailableCardPrintings: cardAssets.filter((asset) => asset.cardmarketPriceState === 'trend-unavailable').length,
      cardmarketAmbiguousCardPrintings: cardAssets.filter((asset) => asset.cardmarketPriceState === 'ambiguous-artwork').length,
      cardmarketUnmappedCardPrintings: cardAssets.filter((asset) => asset.cardmarketPriceState === 'unmapped').length,
      cardmarketImageVerifiedRegularArtReferences: cardAssets.filter(
        (asset) => asset.cardmarketRegularArtReference?.matchPolicy === CARDMARKET_ARTWORK_MATCH_POLICY_V10,
      ).length,
      cardmarketImageVerifiedArtworkReferences: cardAssets.filter(
        (asset) => asset.cardmarketArtworkReference?.matchPolicy === CARDMARKET_ARTWORK_MATCH_POLICY_V10,
      ).length,
      cardmarketImageVerifiedAlternativeArtReferences: cardAssets.filter(
        (asset) => asset.cardmarketArtworkReference?.matchPolicy === CARDMARKET_ARTWORK_MATCH_POLICY_V10
          && asset.cardmarketRegularArtReference == null,
      ).length,
      cardmarketPersistedRegularArtReferences: persistedRegularArtworkReferencesV10,
      cardmarketDiscoveredRegularArtReferences: discoveredRegularArtworkReferencesV10,
      cardmarketUnresolvedRegularArtReferences: regularArtworkReferenceFailuresV10.length,
      cardmarketPersistedArtworkReferences: persistedArtworkReferencesV10,
      cardmarketDiscoveredArtworkReferences: discoveredArtworkReferencesV10,
      cardmarketUnresolvedArtworkReferences: artworkReferenceFailuresV10.length,
      duplicateVisibleArtworkAliasesHiddenFromAdds: duplicateArtworkAliasIdentityV10.size,
      cardmarketAdditionalExactMappings: additionalCardmarketMatches.length,
      cardmarketAdditionalExactBoosterMappings: additionalBoosterCardmarketMatches.length,
      cardmarketAdditionalExactStarterMappings: additionalStarterCardmarketMatches.length,
      cardmarketStarterExpansionMappings: starterExpansionEvidence.exact.size,
      cardmarketAmbiguousStarterExpansionMappings: starterExpansionEvidence.ambiguous.length,
      approvedCardmarketMappingChanges: approvedCardmarketMappingChanges.length,
      tcgplayerMappedBaseArts: baseTcgplayerMatches.size,
      tcgplayerImageVerifiedArtworkMappings: tcgplayerArtworkMatchesV1.size,
      persistedTcgplayerArtworkMappings: persistedTcgplayerArtworkReferenceIdentitiesV1.size,
      discoveredTcgplayerArtworkMappings: discoveredTcgplayerArtworkReferenceIdentitiesV1.size,
      deferredTcgplayerArtworkMappings: deferredTcgplayerArtworkReferenceIdentitiesV1.size,
      cardmarketTcgplayerImageVerifiedPromoMappings: promoCrossMarketMatchesV1.size,
      persistedPromoCrossMarketMappings: persistedPromoCrossMarketReferencesV1,
      discoveredPromoCrossMarketMappings: discoveredPromoCrossMarketReferencesV1,
      deferredPromoCrossMarketMappings: deferredPromoCrossMarketReferencesV1,
      promoCrossMarketMappingFailures: promoCrossMarketReferenceFailuresV1.length,
      tcgplayerExactProviderPairs: exactCrossMarketProviderPairs.length,
      exactCrossMarketComparablePrices: exactCrossMarketAssets.length,
      exactCrossMarketCardmarketTwentyEuroOrMore: exactCrossMarketTwentyEuroAssets.length,
      exactCrossMarketNonStandardComparablePrices: exactCrossMarketNonStandardAssets.length,
      exactCrossMarketPromoComparablePrices: exactCrossMarketPromoAssets.length,
      tcgplayerArtworkMappingFailures: tcgplayerArtworkReferenceFailuresV1.length,
      tcgcsvCategoryGroups: tcgcsvGroups.length,
      releasedEnglishMarketGroups: tcgcsvMarketSources.length,
      releasedEnglishMainGroups: tcgcsvMarketSources.filter((source) => mainSetOrdinalForGroup(source.group) != null).length,
      releasedEnglishSpecialGroups: tcgcsvMarketSources.filter((source) => mainSetOrdinalForGroup(source.group) == null).length,
      releasedGroupsWithoutExactStandardMappings: groupsWithoutExactMappings.length,
      ambiguousCardmarketBaseMappingsExcluded: ambiguousCardmarketBaseMappings.length,
      exactCardmarketProductsWithoutTrendExcluded: cardmarketBasePricesUnavailable.length,
      ambiguousTcgplayerBaseMappingsExcluded: ambiguousBaseTcgplayerNumbers.length,
      missingOrAmbiguousOptcgBaseCandidatesExcluded: optcgBaseCandidatesMissingOrAmbiguous.length,
      releasedSealedProducts: sealedAssets.length,
      sealedSourceCandidates: sealedCatalogCandidates.length,
      futureSealedProductsExcluded: futureSealedProductsExcluded.length,
      unknownManifestSealedProductsExcluded: unknownManifestSealedProductsExcluded.length,
      releasedSealedProductsWithTrend: sealedAssets.filter((asset) => asset.quote.cardmarket != null).length,
      releasedSealedProductsWithoutTrend: sealedAssets.filter((asset) => asset.quote.cardmarket == null).length,
      releasedSealedProductsWithImages: sealedAssets.filter((asset) => asset.imageState === 'available').length,
      releasedSealedProductsWithoutImages: sealedAssets.filter((asset) => asset.imageState !== 'available').length,
      sealedImagesReused: reusedSealedImagesV10,
      sealedImagesDiscovered: discoveredSealedImagesV10,
      sealedImageRefreshesDeferred: deferredSealedImageRefreshesV10,
      sealedContainedUnitImages: sealedAssets.filter(
        (asset) => asset.imageSourceRelationship === 'contained-unit',
      ).length,
      sealedSharedSourceImageGroups: sharedSealedImageDigestGroupsV10.length,
      exactSealedLanguageOverrides: EXACT_SEALED_LANGUAGE_OVERRIDES_V10.size,
      dynamicallyAuditedNewSealedProducts: newlyFetchedDynamicSealedReleaseAuditsV10.length,
      officialTitleMatchedSealedProducts: officialTitleSealedReleaseAuditsV10.length,
      reviewedLegacySealedReleaseProducts: reviewedLegacySealedReleaseAuditsV10.length,
      carriedDynamicSealedReleaseAudits: carriedDynamicSealedReleaseAuditsV10.length,
      totalAssets: cardAssets.length + sealedAssets.length,
      representativeInitialHoldings: initialAssetIds.length,
      approvedCatalogRemovals: approvedCatalogRemovals.length,
    },
    cardmarket: {
      source: CARDMARKET_PRICES,
      catalog: CARDMARKET_PRODUCTS,
      nonSinglesCatalog: CARDMARKET_NONSINGLES,
      createdAt: priceGuide.createdAt,
      priceField: 'trend',
      currency: 'EUR',
      expansionEvidencePolicy: 'Exact Cardmarket lot suffix for OP/EB releases; exact packaging-free English booster plus booster-box title for PRB releases. Multiple expansion IDs fail the sync.',
      starterExpansionEvidencePolicy: 'A released ST code must resolve to one Cardmarket expansion through a standalone English Starter Deck row matched by explicit code, exact official Bandai title, or the audited ST20 product-ID override. Demo decks and combined Deck Set products are excluded.',
      requiredCompleteLatestStarterArtworkSetCode:
        requiredCompleteLatestStarterArtworkSetCodeV10,
      reviewedExactArtworkMappingIds: [...REVIEWED_CARDMARKET_ARTWORK_MAPPINGS_V10.values()]
        .map((mapping) => mapping.reviewId),
      sealedSetClassificationPolicy: 'Every sealed product in a uniquely proven released English Cardmarket booster or starter-deck expansion inherits that exact catalog set code. Explicit title, exact product override, official-title, and expansion evidence must agree or the sync fails.',
      exactStarterDeckSetCodeOverrides: Object.fromEntries(EXACT_CARDMARKET_DECK_SET_CODE_OVERRIDES),
      exactMappingContinuityApprovals: Object.fromEntries(APPROVED_CARDMARKET_MAPPING_CHANGES),
      promoExpansionRegistry: {
        schemaVersion: cardmarketPromoExpansionRegistryV1.schemaVersion,
        reviewedAt: cardmarketPromoExpansionRegistryV1.reviewedAt,
        expansions: cardmarketPromoExpansionRegistryV1.expansions,
        requiredCompletePricedPrintedNumbers:
          cardmarketPromoExpansionRegistryV1.requiredCompletePricedPrintedNumbers,
        reviewedArtworkMappings:
          cardmarketPromoExpansionRegistryV1.reviewedArtworkMappings,
        verifiedPairInvariants: cardmarketPromoExpansionRegistryV1.verifiedPairInvariants,
      },
      sealedCategories: [...SEALED_CATEGORIES.keys()],
      sealedExclusions: ['Lots', 'Empty packaging without cards or sealed contents', 'Rows whose title explicitly identifies an unsupported non-English edition'],
      exactSealedLanguageOverrides: Object.fromEntries(EXACT_SEALED_LANGUAGE_OVERRIDES_V10),
      sealedReleasePolicy: 'Only canonical booster, box, and standalone-deck shapes can inherit a Bandai-confirmed set release; ancillary and Promo Product rows cannot release from an embedded old set code. Known presales are independently date-gated. Exact IDs and titles from the frozen v9 released catalog form a one-time reviewed bootstrap after those gates. Every genuinely new ancillary product requires a unique official Bandai title match or its exact Cardmarket page; an explicit presale notice gates it to that date, and missing evidence fails the sync for visible review.',
      exactSealedReleaseGates: Object.fromEntries(EXACT_SEALED_RELEASE_GATES_V10),
      dynamicSealedReleaseAudits: dynamicSealedReleaseAuditsV10,
      sealedImagePolicy: 'Each released row uses a validated immutable local WebP. Source revalidation is deterministically staggered by upstream source product across a seven-day cycle, so an exact source and contained-unit consumers refresh together. Images receive three bounded attempts. A previously verified digest may survive only a transient outage for at most 21 days while preserving its original imageObservedAt; otherwise the sync fails closed. The normal source is that exact product image from Cardmarket, Bandai, or TCGplayer via TCGCSV. If an outer case uses a generic or wrong image and no exact replacement exists, a reviewed contained-unit override uses the corresponding real sleeved-booster image and records imageSourceRelationship=contained-unit; it is never described as a photo of the outer case. Known placeholder digests and unexplained cross-product image digests fail the sync; older immutable files remain harmless unreferenced cache objects.',
      cardmarketSealedPriceLanguageScope: 'The public Cardmarket price guide is product-level and can aggregate listing languages. Sealed quotes are not represented as language-specific prices.',
      futureSealedProductsExcluded: futureSealedProductsExcluded.map((product) => ({
        cardmarketProductId: product.idProduct,
        name: product.name,
        setCode: sealedSetCode(
          product,
          SEALED_CATEGORIES.get(product.categoryName),
          officialDeckSetCodesByTitle,
          releasedSealedSetCodeByExpansionIdV1,
        ),
      })),
      unknownManifestSealedProductsExcluded: unknownManifestSealedProductsExcluded.map((product) => ({
        cardmarketProductId: product.idProduct,
        name: product.name,
        setCode: sealedSetCode(
          product,
          SEALED_CATEGORIES.get(product.categoryName),
          officialDeckSetCodesByTitle,
          releasedSealedSetCodeByExpansionIdV1,
        ),
      })),
      approvedCatalogRemovalReviews: Object.fromEntries(reviewedBaselineCatalogRemovals.map((asset) => [
        asset.id,
        APPROVED_CATALOG_REMOVALS.get(asset.id),
      ])),
      sealedImageOverrides: Object.fromEntries(EXACT_SEALED_IMAGE_OVERRIDES_V10),
      sealedReleaseGates: Object.fromEntries(EXACT_SEALED_RELEASE_GATES_V10),
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
        exactMappings: (exactMappingsByGroup.get(source.abbreviation) ?? 0)
          + (tcgplayerArtworkMappingsByGroupV1.get(source.abbreviation) ?? 0),
        baseMappings: exactMappingsByGroup.get(source.abbreviation) ?? 0,
        artworkMappings: tcgplayerArtworkMappingsByGroupV1.get(source.abbreviation) ?? 0,
      }])),
      priceField: 'marketPrice',
      currency: 'USD',
      role: 'Direct TCGplayer product identity and product-specific USD price for preserved standard joins, complete-candidate image-verified released English OP/EB/PRB artworks, and promotional printings; reviewed English Cardmarket promo expansions join only through complete bidirectional artwork verification; exact enrichment for two missing starter images',
      imagePolicy: 'Use the source imageUrl. Upgrade only the audited productId allowlist to TCGplayer’s documented _in_1000x1000 derivative. Seven exact product/printing overrides use independently verified public records when the source URL is missing or returns HTTP 403; ambiguous artwork remains unavailable.',
      usagePolicy: 'Backend snapshot sync with a custom User-Agent; no browser-side polling.',
      exactImageOverrides: {
        tcgplayerProductIds: Object.fromEntries(EXACT_TCGPLAYER_IMAGE_OVERRIDES),
        optcgSourcePrintingIds: Object.fromEntries(EXACT_OPTCG_IMAGE_OVERRIDES),
      },
    },
    optcg: {
      source: 'https://optcgapi.com/documentation',
      feeds: OPTCG_FEEDS.map((feed) => feed.url),
      createdAt: optcgDates.at(-1) ?? generatedAt,
      retrievalMode: optcgFeedResult.retrievalMode,
      cacheFetchedAt: optcgFeedResult.cacheFetchedAt,
      liveFetchError: optcgFeedResult.liveFetchError,
      priceField: 'market_price',
      currency: 'USD',
      role: 'Set, starter-deck, and DON!! printing truth; promotional rules metadata joined by card number; US market reference for non-promo printings. A transient live-source outage may use only the checked-in SHA-256 integrity-checked cache for at most seven days, and that cache must already have been validated against every currently released official Bandai set before publication.',
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

const optcgCacheDocumentToWrite = optcgFeedResult.retrievalMode === 'live'
  ? buildOptcgSourceCacheV1(feedResponses, {
    fetchedAt: optcgFeedResult.sourceFetchedAt,
    releaseVerifiedAt: bandaiCatalog.fetchedAt,
    releasedSetCodes: [...releasedOfficialCardSetCodes],
  })
  : null;

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
if (optcgCacheDocumentToWrite) {
  await mkdir(dirname(OPTCG_CACHE), { recursive: true });
  await writeFile(OPTCG_CACHE, serializeOptcgSourceCacheV1(optcgCacheDocumentToWrite), 'utf8');
}
await ingestSnapshotToSupabase(output, bandaiCatalog);
console.log(`Wrote ${cardAssets.length} card printings (${output.provenance.catalogCounts.cardPrintingsWithImages} with images, ${output.provenance.catalogCounts.cardPrintingsWithoutImages} explicitly unavailable) and ${sealedAssets.length} released sealed products to ${OUTPUT}`);
console.log(`TCGCSV promo printings: ${promoAssets.length} (${promoAssetsWithPrices.length} headline market prices, ${promoAssetsWithMultiplePriceSubtypes.length} multi-subtype price sets, ${promoAssetsWithoutPriceRows.length} without price rows, ${japanesePromoAssets.length} explicitly Japanese)`);
console.log(`Representative initial holdings: ${initialAssetIds.length}`);
console.log(`Cardmarket-mapped card printings: ${output.provenance.catalogCounts.cardmarketMappedCardPrintings} (${output.provenance.catalogCounts.cardmarketMappedBaseArts} seeded base, ${additionalBoosterCardmarketMatches.length} additional booster, ${additionalStarterCardmarketMatches.length} starter-deck)`);
console.log(`Cardmarket exact-art mappings: ${cardmarketArtworkReferencesV10.size} (${persistedArtworkReferencesV10} persisted, ${discoveredArtworkReferencesV10} newly image-verified, ${deferredArtworkReferencesV10} refreshes deferred after transient failures, ${artworkReferenceFailuresV10.length} unresolved)`);
console.log(`TCGplayer exact-art mappings: ${tcgplayerArtworkMatchesV1.size} complete-candidate image matches (${persistedTcgplayerArtworkReferenceIdentitiesV1.size} persisted, ${discoveredTcgplayerArtworkReferenceIdentitiesV1.size} discovered, ${deferredTcgplayerArtworkReferenceIdentitiesV1.size} refreshes deferred, ${tcgplayerArtworkReferenceFailuresV1.length} unresolved)`);
console.log(`Promo exact cross-market mappings: ${promoCrossMarketMatchesV1.size} complete bidirectional image matches (${persistedPromoCrossMarketReferencesV1} persisted, ${discoveredPromoCrossMarketReferencesV1} discovered, ${deferredPromoCrossMarketReferencesV1} refreshes deferred, ${promoCrossMarketReferenceFailuresV1.length} unresolved)`);
console.log(`Sealed product images: ${sealedAssets.length} real local WebPs (${reusedSealedImagesV10} cache-verified, ${discoveredSealedImagesV10} newly mirrored)`);
console.log(`Released English market groups: ${tcgcsvMarketSources.length} (${tcgcsvMarketSources.map((source) => source.abbreviation).join(', ')})`);
console.log(`Exact cross-market mappings: ${exactCrossMarketProviderPairs.length} provider pairs (${exactCrossMarketAssets.length} with both market prices; ${exactCrossMarketTwentyEuroAssets.length} at Cardmarket EUR 20+; ${exactCrossMarketNonStandardAssets.length} non-standard; ${exactCrossMarketPromoAssets.length} promotional)`);
if (groupsWithoutExactMappings.length > 0) console.log(`Released groups with no exact standard mapping: ${groupsWithoutExactMappings.join(', ')}`);
console.log(`Cardmarket snapshot: ${priceGuide.createdAt}`);
console.log(`TCGCSV snapshot: ${tcgcsvCreatedAt}`);
console.log(`OPTCG snapshot: ${output.provenance.optcg.createdAt}`);
console.log(`OPTCG retrieval mode: ${output.provenance.optcg.retrievalMode}${output.provenance.optcg.cacheFetchedAt ? ` (${output.provenance.optcg.cacheFetchedAt})` : ''}`);
console.log(`ECB USD per EUR: ${exchangeRate.usdPerEur} (${exchangeRate.observationDate})`);

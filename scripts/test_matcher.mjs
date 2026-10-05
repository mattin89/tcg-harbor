import fs from 'node:fs';

const marketRaw = JSON.parse(fs.readFileSync('src/data/generated/onepiece-market-v10.json', 'utf8'));
const { applyDonMappings } = await import('../src/data/catalogDonMappings.ts');
const { allErrataAssets } = await import('../src/data/catalogErrata.ts');
const singles = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_singles.json', 'utf8'));
const priceGuide = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_price_guide.json', 'utf8'));
const tcgCache = JSON.parse(fs.readFileSync('scripts/data/cache/tcgcsv_cache.json', 'utf8'));

// Build Cardmarket indexes
const singlesList = singles.products || singles;
const priceMap = new Map();
for (const p of (priceGuide.priceGuides || priceGuide.products || priceGuide)) {
  priceMap.set(p.idProduct, p);
}

const cmByNumber = new Map();
for (const p of singlesList) {
  const m = p.name.match(/\(([^)]+)\)/);
  if (m) {
    const num = m[1].trim().toUpperCase();
    if (!cmByNumber.has(num)) cmByNumber.set(num, []);
    cmByNumber.get(num).push(p);
  }
}

// Build TCGCSV indexes
const allTcgProducts = [];
const allTcgPrices = new Map();
for (const [gid, prods] of Object.entries(tcgCache.productsByGroup)) {
  for (const p of prods) allTcgProducts.push(p);
}
for (const [gid, prices] of Object.entries(tcgCache.pricesByGroup)) {
  for (const p of prices) allTcgPrices.set(p.productId, p);
}

const tcgByNumber = new Map();
for (const p of allTcgProducts) {
  const numData = p.extendedData?.find(x => x.name === 'Number')?.value;
  const num = (numData || '').trim().toUpperCase();
  if (num) {
    if (!tcgByNumber.has(num)) tcgByNumber.set(num, []);
    tcgByNumber.get(num).push(p);
  }
}

console.log(`Indexed ${cmByNumber.size} Cardmarket card numbers and ${tcgByNumber.size} TCGplayer card numbers.`);

// Get all flagged assets
const baseCatalog = marketRaw.assets;
const baseWithErrata = [...baseCatalog, ...allErrataAssets];
const catalogAssets = applyDonMappings(baseWithErrata);

function diagnoseCatalogItem(asset) {
  const issues = [];
  if (asset.cardmarketPriceState === 'unmapped') issues.push('unmapped-cardmarket');
  else if (asset.cardmarketPriceState === 'ambiguous-artwork') issues.push('ambiguous-artwork');
  else if (asset.cardmarketPriceState === 'trend-unavailable') issues.push('trend-unavailable');

  if (asset.imageState === 'unavailable' || !asset.imageUrl) issues.push('missing-image');
  if (asset.tcgplayerPriceState === 'unavailable' && (asset.quote?.tcgplayer === null || asset.quote?.tcgplayer === undefined)) {
    issues.push('price-unavailable');
  }
  return { issues, isFlaggedOrError: issues.length > 0 };
}

const flagged = catalogAssets.filter(a => diagnoseCatalogItem(a).isFlaggedOrError);
console.log(`Total flagged assets to map: ${flagged.length}`);

let cmResolvable = 0;
let tcgResolvable = 0;
let bothResolvable = 0;
const unresolvedSamples = [];

for (const asset of flagged) {
  const num = (asset.number || asset.rulesCardId || '').trim().toUpperCase();
  let hasCm = Boolean(asset.cardmarketProductId);
  let hasTcg = Boolean(asset.tcgplayerProductId && (asset.quote?.tcgplayer != null || allTcgPrices.has(asset.tcgplayerProductId)));

  // If ambiguous, can we resolve candidate?
  if (asset.cardmarketPriceState === 'ambiguous-artwork' && asset.cardmarketCandidates?.length) {
    hasCm = true;
  } else if (!hasCm && num && cmByNumber.has(num)) {
    hasCm = true;
  }

  if (!hasTcg && num && tcgByNumber.has(num)) {
    hasTcg = true;
  }

  if (hasCm) cmResolvable++;
  if (hasTcg) tcgResolvable++;
  if (hasCm && hasTcg) bothResolvable++;
  else {
    if (unresolvedSamples.length < 15) {
      unresolvedSamples.push({
        id: asset.id,
        name: asset.name,
        num: asset.number,
        set: asset.setCode,
        hasCm,
        hasTcg,
        cmState: asset.cardmarketPriceState,
        tcgState: asset.tcgplayerPriceState
      });
    }
  }
}

console.log(`Cardmarket resolvable: ${cmResolvable} / ${flagged.length} (${(cmResolvable/flagged.length*100).toFixed(1)}%)`);
console.log(`TCGplayer resolvable: ${tcgResolvable} / ${flagged.length} (${(tcgResolvable/flagged.length*100).toFixed(1)}%)`);
console.log(`Both resolvable: ${bothResolvable} / ${flagged.length} (${(bothResolvable/flagged.length*100).toFixed(1)}%)`);
console.log('Unresolved samples:', unresolvedSamples);

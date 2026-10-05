import fs from 'node:fs';
import https from 'node:https';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed with status ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

const cacheDir = 'scripts/data/cache';
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

const singlesPath = `${cacheDir}/cardmarket_singles.json`;
const pricePath = `${cacheDir}/cardmarket_price_guide.json`;

if (!fs.existsSync(singlesPath) || fs.statSync(singlesPath).size < 1000000) {
  await downloadFile('https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json', singlesPath);
}
if (!fs.existsSync(pricePath) || fs.statSync(pricePath).size < 10000) {
  await downloadFile('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json', pricePath);
}

const rawCatalog = JSON.parse(fs.readFileSync('src/data/generated/onepiece-market-v10.json', 'utf8'));
const assets = rawCatalog.assets;

const cmSingles = JSON.parse(fs.readFileSync(singlesPath, 'utf8')).products;
const cmPriceGuide = JSON.parse(fs.readFileSync(pricePath, 'utf8')).priceGuides;
const priceMap = new Map(cmPriceGuide.map(p => [p.idProduct, p]));

// Known non-English expansions to exclude when asset language is English
const nonEnglishExpansions = new Set([
  6233, // The Best Vol.2 Booster (Non-English)
  5511, // Japanese promos
  5598, // Japanese promos
  5303, // Japanese starter/promos
  5574, // Japanese OP05
  5829, // Japanese OP06
  6021  // Japanese OP07
]);

const overrides = {};
const resolvedSummary = [];

// Helper to record an override
function addOverride(asset, cmProduct, confidenceReason) {
  const price = priceMap.get(cmProduct.idProduct);
  const trend = (price && typeof price.trend === 'number' && price.trend > 0) ? price.trend : null;
  overrides[asset.id] = {
    id: asset.id,
    cardmarketProductId: cmProduct.idProduct,
    cardmarketExpansionId: cmProduct.idExpansion,
    cardmarketPriceState: trend !== null ? 'available' : 'trend-unavailable',
    cardmarketPriceReason: `Cardmarket: ${cmProduct.name} (Product #${cmProduct.idProduct})`,
    cardmarketTrendPrice: trend,
    errorResolved: true,
    isApproved: true,
    adminNote: `Verified via ${confidenceReason}. Cardmarket Product #${cmProduct.idProduct} ("${cmProduct.name}")`,
    updatedAt: new Date().toISOString()
  };
  resolvedSummary.push({
    assetId: asset.id,
    name: asset.name,
    number: asset.number || 'DON!!',
    cmProductId: cmProduct.idProduct,
    cmName: cmProduct.name,
    expansionId: cmProduct.idExpansion,
    trend,
    reason: confidenceReason
  });
}

// 1. Resolve 8 Film Red & unique P- promo cards
const promoAssets = assets.filter(a => a.cardmarketPriceState === 'unmapped' && (a.setCode === 'P' || (a.number && a.number.startsWith('P-'))));
const cmPromoProducts = cmSingles.filter(p => p.name.includes('(P-') && !nonEnglishExpansions.has(p.idExpansion));

for (const asset of promoAssets) {
  const number = asset.number;
  if (!number) continue;
  const token = `(${number})`;
  const candidates = cmPromoProducts.filter(p => p.name.includes(token));
  if (candidates.length === 1) {
    addOverride(asset, candidates[0], 'unique printed number in English promo expansion');
  }
}

// 2. Resolve DON!! cards with unique character/expansion combinations
const donAssets = assets.filter(a => a.cardmarketPriceState === 'unmapped' && (a.setCode === 'DON' || a.number === 'DON!!'));
const cmDonProducts = cmSingles.filter(p => (p.name.toUpperCase().includes('DON!') || p.name.toUpperCase().includes('DON!!')) && !nonEnglishExpansions.has(p.idExpansion));

for (const asset of donAssets) {
  // Check double pack & special collection DONs
  if (asset.name.includes('Double Pack Set Vol. 8') && asset.name.includes('3D')) {
    const p = cmDonProducts.find(x => x.idProduct === 845306);
    if (p) addOverride(asset, p, 'exact Double Pack Vol. 8 3D DON match');
  } else if (asset.name.includes('Double Pack Set Vol. 8') && asset.name.includes('2Y')) {
    const p = cmDonProducts.find(x => x.idProduct === 845307);
    if (p) addOverride(asset, p, 'exact Double Pack Vol. 8 2Y DON match');
  } else if (asset.name.includes('Devil Fruits Collection Vol. 3') && asset.name.includes('Op-Op Fruit')) {
    const p = cmDonProducts.find(x => x.idProduct === 865592);
    if (p) addOverride(asset, p, 'exact Devil Fruits Collection Vol. 3 Op-Op Fruit DON match');
  } else if (asset.name.includes('Grand Asia Open') || (asset.name.includes('Silver') && asset.name.includes('OP-PR'))) {
    const p = cmDonProducts.find(x => x.idProduct === 804814);
    if (p) addOverride(asset, p, 'exact Silver Grand Asia Open DON match');
  } else if (asset.name.includes('Grand Asia Open') || (asset.name.includes('Bronze') && asset.name.includes('OP-PR'))) {
    const p = cmDonProducts.find(x => x.idProduct === 804813);
    if (p) addOverride(asset, p, 'exact Bronze Grand Asia Open DON match');
  } else if (asset.name.includes('Straw Hat Crew (ST-01)') && asset.name.includes('Monkey.D.Luffy')) {
    const p = cmDonProducts.find(x => x.idProduct === 696662);
    if (p) addOverride(asset, p, 'exact ST01 Luffy DON match');
  } else if (asset.name.includes('Worst Generation (ST-02)') && asset.name.includes('Eustass')) {
    const p = cmDonProducts.find(x => x.idProduct === 696667);
    if (p) addOverride(asset, p, 'exact ST02 Kid DON match');
  } else if (asset.name.includes('The Seven Warlords of the Sea (ST-03)') && asset.name.includes('Crocodile')) {
    const p = cmDonProducts.find(x => x.idProduct === 696666);
    if (p) addOverride(asset, p, 'exact ST03 Crocodile DON match');
  } else if (asset.name.includes('Animal Kingdom Pirates (ST-04)') && asset.name.includes('Kaido')) {
    const p = cmDonProducts.find(x => x.idProduct === 696670);
    if (p) addOverride(asset, p, 'exact ST04 Kaido DON match');
  } else if (asset.name.includes('ONE PIECE FILM edition (ST-05)') && asset.name.includes('Shanks')) {
    const p = cmDonProducts.find(x => x.idProduct === 708277);
    if (p) addOverride(asset, p, 'exact ST05 Shanks DON match');
  } else if (asset.name.includes('Absolute Justice (ST-06)') && asset.name.includes('Sakazuki')) {
    const p = cmDonProducts.find(x => x.idProduct === 708278);
    if (p) addOverride(asset, p, 'exact ST06 Sakazuki DON match');
  } else if (asset.name.includes('Big Mom Pirates (ST-07)') && asset.name.includes('Charlotte Linlin')) {
    const p = cmDonProducts.find(x => x.idProduct === 708279);
    if (p) addOverride(asset, p, 'exact ST07 Big Mom DON match');
  } else if (asset.name.includes('Monkey D. Luffy (ST-08)') && asset.name.includes('Monkey.D.Luffy')) {
    const p = cmDonProducts.find(x => x.idProduct === 726880);
    if (p) addOverride(asset, p, 'exact ST08 Luffy DON match');
  } else if (asset.name.includes('Yamato (ST-09)') && asset.name.includes('Yamato')) {
    const p = cmDonProducts.find(x => x.idProduct === 726881);
    if (p) addOverride(asset, p, 'exact ST09 Yamato DON match');
  } else if (asset.name.includes('The Three Captains (ST-10)')) {
    const p = cmDonProducts.find(x => x.idProduct === 746238 || x.idProduct === 746239);
    if (p) addOverride(asset, p, 'exact ST10 Captains DON match');
  } else if (asset.name.includes('Uta (ST-11)')) {
    const p = cmDonProducts.find(x => x.idProduct === 752070);
    if (p) addOverride(asset, p, 'exact ST11 Uta DON match');
  } else if (asset.name.includes('Zoro and Sanji (ST-12)')) {
    const p = cmDonProducts.find(x => x.idProduct === 762652);
    if (p) addOverride(asset, p, 'exact ST12 Zoro & Sanji DON match');
  } else if (asset.name.includes('3D2Y (ST-14)')) {
    const p = cmDonProducts.find(x => x.idProduct === 780210);
    if (p) addOverride(asset, p, 'exact ST14 3D2Y DON match');
  }
}

// 3. Resolve single unmapped cards from regular expansions (like ST07 Daifuku)
const otherAssets = assets.filter(a => a.cardmarketPriceState === 'unmapped' && !overrides[a.id]);
for (const asset of otherAssets) {
  if (asset.number === 'ST07-005') {
    const p = cmSingles.find(x => x.idProduct === 721216);
    if (p) addOverride(asset, p, 'exact ST07-005 printed number & expansion match');
  }
}

console.log(`Generated ${Object.keys(overrides).length} administrative overrides.`);
console.log('Sample overrides:');
console.log(JSON.stringify(resolvedSummary.slice(0, 15), null, 2));

// Save output to seed file
const seedPath = 'src/data/seedAdminCatalogOverrides.json';
fs.writeFileSync(seedPath, JSON.stringify(overrides, null, 2), 'utf8');
console.log(`Saved overrides to ${seedPath}`);

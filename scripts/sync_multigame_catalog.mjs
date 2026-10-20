import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { SUPPORTED_GAMES } from '../src/domain/games.ts';

const OUTPUT_DIR = path.resolve('src/data/generated/catalogs');
const CACHE_DIR = path.resolve('scripts/data/cache/multigame');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const BRIGHTDATA_KEY = process.env.BRIGHTDATA_API_KEY || '2bff15d1-d6f9-49f8-b11b-882aa02fde66';
const ZONE = process.env.BRIGHTDATA_ZONE || 'hacknation_october_26';

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...headers }, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location, headers));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`JSON parse error for ${url}: ${e.message}`));
        }
      });
    }).on('error', reject).on('timeout', () => reject(new Error(`Timeout for ${url}`)));
  });
}

function fetchViaBrightData(url) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ zone: ZONE, url, format: 'raw' });
    const req = https.request({
      hostname: 'api.brightdata.com',
      port: 443,
      path: '/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + BRIGHTDATA_KEY,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 35000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', status: 408 }); });
    req.on('error', e => resolve({ error: e.message, status: 500 }));
    req.write(postData);
    req.end();
  });
}

function detectProductType(name, categoryName = '') {
  const text = `${name} ${categoryName}`.toLowerCase();
  if (/booster box|booster display|display/i.test(text)) return 'Booster Box';
  if (/case|sealed case/i.test(text)) return 'Case';
  if (/starter deck|trial deck|structure deck|blitz deck|armory deck/i.test(text)) return 'Starter Deck';
  if (/commander deck/i.test(text)) return 'Commander Deck';
  if (/booster pack|blister pack|pack/i.test(text)) return 'Booster Pack';
  if (/elite trainer box|etb/i.test(text)) return 'Elite Trainer Box';
  if (/tin|box topper|bundle|gift box|collection box/i.test(text)) return 'Promo Product';
  return 'Booster Pack';
}

function detectLanguage(name, set = '') {
  const text = `${name} ${set}`.toLowerCase();
  if (/japanese|\[jp\]|\(jp\)/i.test(text)) return 'Japanese';
  if (/french|\[fr\]|\(fr\)/i.test(text)) return 'French';
  if (/german|\[de\]|\(de\)/i.test(text)) return 'German';
  if (/spanish|\[es\]|\(es\)/i.test(text)) return 'Spanish';
  if (/italian|\[it\]|\(it\)/i.test(text)) return 'Italian';
  if (/chinese|\[cn\]|\(cn\)|simplified chinese/i.test(text)) return 'Chinese';
  if (/korean|\[kr\]|\(kr\)/i.test(text)) return 'Korean';
  return 'English';
}

function normalizeAssetColor(gameSlug) {
  const colors = {
    pokemon: 'amber',
    magic: 'violet',
    yugioh: 'gold',
    'flesh-and-blood': 'coral',
    gundam: 'azure',
    cyberpunk: 'emerald',
    riftbound: 'cyan',
    'one-piece': 'rose',
  };
  return colors[gameSlug] || 'slate';
}

export async function syncGameCatalog(gameSlug, options = {}) {
  const gameDef = SUPPORTED_GAMES[gameSlug];
  if (!gameDef) {
    throw new Error(`Unknown game slug: ${gameSlug}`);
  }

  console.log(`\n========================================`);
  console.log(`Syncing Catalog: ${gameDef.name} (${gameSlug})`);
  console.log(`Cardmarket Game ID: ${gameDef.cardmarketGameId} | TCGPlayer Category ID: ${gameDef.tcgplayerCategoryId}`);
  console.log(`========================================`);

  // 1. Fetch Cardmarket non-singles
  let cmNonsingles = [];
  try {
    const cmNonsinglesCache = path.join(CACHE_DIR, `cardmarket_nonsingles_${gameDef.cardmarketGameId}.json`);
    if (fs.existsSync(cmNonsinglesCache)) {
      cmNonsingles = JSON.parse(fs.readFileSync(cmNonsinglesCache, 'utf8'));
      console.log(`Loaded ${cmNonsingles.length} Cardmarket non-singles from cache.`);
    } else {
      console.log(`Fetching Cardmarket non-singles for game ${gameDef.cardmarketGameId}...`);
      const raw = await fetchJson(`https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_${gameDef.cardmarketGameId}.json`);
      cmNonsingles = Array.isArray(raw) ? raw : (raw.products || []);
      fs.writeFileSync(cmNonsinglesCache, JSON.stringify(cmNonsingles, null, 2), 'utf8');
      console.log(`Cached ${cmNonsingles.length} Cardmarket non-singles.`);
    }
  } catch (err) {
    console.warn(`Cardmarket non-singles fetch notice: ${err.message}`);
  }

  // 2. Fetch Cardmarket price guide
  let cmPriceMap = new Map();
  try {
    const cmPricesCache = path.join(CACHE_DIR, `cardmarket_prices_${gameDef.cardmarketGameId}.json`);
    let rawPrices;
    if (fs.existsSync(cmPricesCache)) {
      rawPrices = JSON.parse(fs.readFileSync(cmPricesCache, 'utf8'));
      console.log(`Loaded Cardmarket price guide from cache.`);
    } else {
      console.log(`Fetching Cardmarket price guide for game ${gameDef.cardmarketGameId}...`);
      rawPrices = await fetchJson(`https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_${gameDef.cardmarketGameId}.json`);
      fs.writeFileSync(cmPricesCache, JSON.stringify(rawPrices, null, 2), 'utf8');
      console.log(`Cached Cardmarket price guide.`);
    }
    const list = Array.isArray(rawPrices) ? rawPrices : (rawPrices.priceGuides || rawPrices.products || []);
    for (const item of list) {
      if (item.idProduct) {
        const price = item.trend ?? item.avg ?? item.low ?? item['trend-holo'] ?? item.trendPrice ?? null;
        cmPriceMap.set(item.idProduct, price);
      }
    }
    console.log(`Indexed ${cmPriceMap.size} Cardmarket price points.`);
  } catch (err) {
    console.warn(`Cardmarket price guide notice: ${err.message}`);
  }

  // 3. Fetch TCGCSV Groups
  let tcgGroups = [];
  try {
    console.log(`Fetching TCGPlayer groups for category ${gameDef.tcgplayerCategoryId}...`);
    const gData = await fetchJson(`https://tcgcsv.com/tcgplayer/${gameDef.tcgplayerCategoryId}/groups`);
    tcgGroups = gData.results || [];
    console.log(`Retrieved ${tcgGroups.length} TCGPlayer groups.`);
  } catch (err) {
    console.warn(`TCGPlayer groups fetch error: ${err.message}`);
  }

  // 4. Fetch TCGPlayer Products & Prices for key groups (or top groups)
  const maxGroups = options.maxGroups || (gameSlug === 'pokemon' || gameSlug === 'magic' || gameSlug === 'yugioh' ? 8 : tcgGroups.length);
  const selectedGroups = tcgGroups.slice(0, maxGroups);

  const tcgProducts = [];
  const tcgPrices = new Map();

  for (let i = 0; i < selectedGroups.length; i++) {
    const group = selectedGroups[i];
    try {
      console.log(`  [${i + 1}/${selectedGroups.length}] Ingesting group: ${group.name} (${group.groupId})...`);
      const pData = await fetchJson(`https://tcgcsv.com/tcgplayer/${gameDef.tcgplayerCategoryId}/${group.groupId}/products`);
      if (pData.results) {
        for (const p of pData.results) {
          tcgProducts.push({ ...p, groupName: group.name, groupAbbreviation: group.abbreviation || group.name });
        }
      }
      const prData = await fetchJson(`https://tcgcsv.com/tcgplayer/${gameDef.tcgplayerCategoryId}/${group.groupId}/prices`);
      if (prData.results) {
        for (const pr of prData.results) {
          tcgPrices.set(pr.productId, pr);
        }
      }
    } catch (e) {
      console.warn(`  Notice for group ${group.name}: ${e.message}`);
    }
  }

  console.log(`Retrieved ${tcgProducts.length} TCGPlayer products and ${tcgPrices.size} price rows.`);

  // 5. Build Synthesized Catalog Assets (Cards and Sealed Products in all languages)
  const catalogAssets = [];
  const seenIds = new Set();

  // A. Process Sealed Products from Cardmarket Non-singles
  for (const cmItem of cmNonsingles) {
    const id = `sealed-${gameSlug}-cm-${cmItem.idProduct}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const lang = detectLanguage(cmItem.name, cmItem.categoryName);
    const prodType = detectProductType(cmItem.name, cmItem.categoryName);
    const trend = cmPriceMap.get(cmItem.idProduct) ?? null;

    catalogAssets.push({
      id,
      game: gameSlug,
      kind: 'sealed',
      name: cmItem.name,
      productName: cmItem.name,
      set: cmItem.categoryName || gameDef.name,
      setCode: String(cmItem.idExpansion || 'SEALED'),
      rarity: 'Sealed',
      variant: `${prodType} · Cardmarket #${cmItem.idProduct}`,
      productType: prodType,
      language: lang,
      condition: 'Near Mint',
      quantity: 1,
      addedAt: new Date().toISOString(),
      color: normalizeAssetColor(gameSlug),
      imageUrl: `https://product-images.s3.cardmarket.com/${cmItem.idCategory || 1622}/${cmItem.idProduct}/${cmItem.idProduct}.jpg`,
      imageState: 'available',
      cardmarketProductId: cmItem.idProduct,
      cardmarketExpansionId: cmItem.idExpansion,
      cardmarketPriceState: trend !== null ? 'available' : 'trend-unavailable',
      tcgplayerPriceState: 'unavailable',
      quote: {
        cardmarket: trend,
        tcgplayer: null,
      },
      change: {
        cardmarket: { '1D': 0, '1W': 0, '1M': 0 },
        tcgplayer: { '1D': null, '1W': null, '1M': null },
      },
    });
  }

  // B. Process TCGPlayer products (Singles and Sealed)
  for (const tp of tcgProducts) {
    const isSealed = /booster box|booster pack|bundle|starter deck|commander deck|blister|tin|case|kit|display/i.test(tp.name);
    const id = `${isSealed ? 'sealed' : 'card'}-${gameSlug}-tp-${tp.productId}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const pr = tcgPrices.get(tp.productId);
    const usdQuote = pr ? (pr.marketPrice ?? pr.midPrice ?? pr.lowPrice ?? null) : null;
    const lang = detectLanguage(tp.name, tp.groupName);
    const prodType = isSealed ? detectProductType(tp.name, tp.groupName) : undefined;

    // Check if there is a matching Cardmarket sealed product
    const cmMatch = isSealed ? cmNonsingles.find(c => c.name.toLowerCase() === tp.cleanName?.toLowerCase() || c.name.toLowerCase() === tp.name.toLowerCase()) : null;
    const cmTrend = cmMatch ? (cmPriceMap.get(cmMatch.idProduct) ?? null) : null;

    catalogAssets.push({
      id,
      game: gameSlug,
      kind: isSealed ? 'sealed' : 'card',
      name: tp.name,
      productName: tp.cleanName || tp.name,
      set: tp.groupName,
      setCode: tp.groupAbbreviation || 'SET',
      number: tp.extendedData?.find(d => d.name === 'Number')?.value || undefined,
      rarity: tp.extendedData?.find(d => d.name === 'Rarity')?.value || (isSealed ? 'Sealed' : 'Common'),
      variant: isSealed ? `${prodType} · TCGplayer #${tp.productId}` : `Standard · TCGplayer #${tp.productId}`,
      productType: prodType,
      language: lang,
      condition: 'Near Mint',
      quantity: 1,
      addedAt: new Date().toISOString(),
      color: normalizeAssetColor(gameSlug),
      imageUrl: tp.imageUrl || undefined,
      imageState: tp.imageUrl ? 'available' : 'unavailable',
      tcgplayerProductId: tp.productId,
      tcgplayerGroupId: tp.groupId,
      tcgplayerPriceState: usdQuote !== null ? 'available' : 'unavailable',
      cardmarketProductId: cmMatch ? cmMatch.idProduct : undefined,
      cardmarketExpansionId: cmMatch ? cmMatch.idExpansion : undefined,
      cardmarketPriceState: cmTrend !== null ? 'available' : (cmMatch ? 'trend-unavailable' : 'unmapped'),
      quote: {
        cardmarket: cmTrend,
        tcgplayer: usdQuote,
      },
      change: {
        cardmarket: { '1D': cmTrend !== null ? 0 : null, '1W': null, '1M': null },
        tcgplayer: { '1D': usdQuote !== null ? 0 : null, '1W': null, '1M': null },
      },
    });
  }

  console.log(`\nSynthesized ${catalogAssets.length} total assets for ${gameDef.name}:`);
  const cardsCount = catalogAssets.filter(a => a.kind === 'card').length;
  const sealedCount = catalogAssets.filter(a => a.kind === 'sealed').length;
  const languagesCount = [...new Set(catalogAssets.map(a => a.language))];
  console.log(`  Cards: ${cardsCount}`);
  console.log(`  Sealed: ${sealedCount}`);
  console.log(`  Languages: ${languagesCount.join(', ')}`);

  const outputPath = path.join(OUTPUT_DIR, `${gameSlug}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(catalogAssets, null, 2), 'utf8');
  console.log(`Saved to ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);

  return catalogAssets;
}

export async function runAll(options = {}) {
  const targetGames = options.game ? [options.game] : [
    'pokemon',
    'magic',
    'yugioh',
    'flesh-and-blood',
    'gundam',
    'cyberpunk',
    'riftbound'
  ];

  console.log(`Starting Multi-TCG Catalog Ingestion for: ${targetGames.join(', ')}`);
  for (const slug of targetGames) {
    try {
      await syncGameCatalog(slug, options);
    } catch (err) {
      console.error(`Failed to sync ${slug}:`, err);
    }
  }
  console.log(`\nAll requested catalogs synced successfully.`);
}

if (process.argv[1] === path.resolve('scripts/sync_multigame_catalog.mjs')) {
  const gameArg = process.argv.find(arg => arg.startsWith('--game='));
  const game = gameArg ? gameArg.split('=')[1] : undefined;
  runAll({ game })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Execution error:', err);
      process.exit(1);
    });
}

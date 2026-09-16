import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG_PATH = resolve(ROOT, 'src/data/generated/onepiece-market-v10.json');
const CARDMARKET_PRICES_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json';

export async function pushDailyCardPrices(options = {}) {
  const supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = options.supabaseKey || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY');
  }

  console.log('Fetching daily Cardmarket price guide from S3...');
  const priceGuideRes = await fetch(CARDMARKET_PRICES_URL);
  if (!priceGuideRes.ok) {
    throw new Error(`Failed to fetch Cardmarket price guide: ${priceGuideRes.status} ${priceGuideRes.statusText}`);
  }
  const priceGuide = await priceGuideRes.json();
  const createdAt = priceGuide.createdAt || new Date().toISOString();
  const priceDate = createdAt.split('T')[0];
  console.log(`Cardmarket price guide date: ${priceDate} (${createdAt})`);

  const cardmarketPrices = new Map();
  for (const item of priceGuide.priceGuides || []) {
    if (item.idProduct != null) {
      cardmarketPrices.set(item.idProduct, item);
    }
  }
  console.log(`Loaded ${cardmarketPrices.size} Cardmarket product prices.`);

  console.log('Reading local One Piece catalog snapshot...');
  const catalogRaw = await readFile(CATALOG_PATH, 'utf8');
  const catalog = JSON.parse(catalogRaw);
  const assets = catalog.assets || [];
  console.log(`Catalog contains ${assets.length} assets.`);

  const prices = {};
  let cmMatchCount = 0;

  for (const asset of assets) {
    if (!asset.id) continue;
    let cmPrice = null;

    if (asset.cardmarketProductId != null && cardmarketPrices.has(asset.cardmarketProductId)) {
      const p = cardmarketPrices.get(asset.cardmarketProductId);
      const trend = p.trend ?? p.avg ?? p.low;
      if (typeof trend === 'number' && Number.isFinite(trend) && trend > 0) {
        cmPrice = Math.round(trend * 100) / 100;
        cmMatchCount += 1;
      }
    }

    const tcgPrice = (typeof asset.quote?.tcgplayer === 'number' && asset.quote.tcgplayer > 0)
      ? asset.quote.tcgplayer
      : null;

    if (cmPrice !== null || tcgPrice !== null) {
      prices[asset.id] = {
        cardmarket: cmPrice,
        tcgplayer: tcgPrice,
      };
    }
  }

  console.log(`Mapped ${cmMatchCount} assets with fresh Cardmarket prices. Total priced: ${Object.keys(prices).length}`);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(`Calling push_daily_card_prices RPC for date ${priceDate}...`);
  const { data, error } = await supabase.rpc('push_daily_card_prices', {
    p_price_date: priceDate,
    p_prices: prices,
  });

  if (error) {
    throw new Error(`RPC push_daily_card_prices failed: ${error.message} (${error.code})`);
  }

  console.log('push_daily_card_prices completed successfully:', data);
  return { priceDate, ...data };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  pushDailyCardPrices()
    .then((result) => {
      console.log('Daily price push finished:', result);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Daily price push failed:', err);
      process.exit(1);
    });
}
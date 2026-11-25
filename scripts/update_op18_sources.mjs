import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fetchJsonWithRetryV8 } from './lib/resilient-fetch-v8.mjs';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
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

async function main() {
  const cacheDir = 'scripts/data/cache';
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  console.log('Downloading latest Cardmarket files from S3...');
  await downloadFile(
    'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json',
    path.join(cacheDir, 'cardmarket_singles.json')
  );
  console.log('Downloaded cardmarket_singles.json');

  await downloadFile(
    'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_18.json',
    path.join(cacheDir, 'cardmarket_nonsingles.json')
  );
  console.log('Downloaded cardmarket_nonsingles.json');

  await downloadFile(
    'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json',
    path.join(cacheDir, 'cardmarket_price_guide.json')
  );
  console.log('Downloaded cardmarket_price_guide.json');

  // Fetch TCGCSV OP18 products and prices (group 24833)
  console.log('Fetching TCGCSV group 24833 (OP18)...');
  const productsRes = await fetchJsonWithRetryV8('https://tcgcsv.com/tcgplayer/68/24833/products', {
    headers: { 'User-Agent': 'TCG-Harbor/4.0' }
  });
  const pricesRes = await fetchJsonWithRetryV8('https://tcgcsv.com/tcgplayer/68/24833/prices', {
    headers: { 'User-Agent': 'TCG-Harbor/4.0' }
  });

  const tcgCachePath = path.join(cacheDir, 'tcgcsv_cache.json');
  let tcgCache = { productsByGroup: {}, pricesByGroup: {}, updatedAt: new Date().toISOString() };
  if (fs.existsSync(tcgCachePath)) {
    try {
      tcgCache = JSON.parse(fs.readFileSync(tcgCachePath, 'utf8'));
    } catch {}
  }
  tcgCache.productsByGroup = tcgCache.productsByGroup || {};
  tcgCache.pricesByGroup = tcgCache.pricesByGroup || {};

  tcgCache.productsByGroup['24833'] = productsRes.results || [];
  tcgCache.pricesByGroup['24833'] = pricesRes.results || [];
  tcgCache.updatedAt = new Date().toISOString();

  fs.writeFileSync(tcgCachePath, JSON.stringify(tcgCache, null, 2), 'utf8');
  console.log(`Saved group 24833 to ${tcgCachePath} (${tcgCache.productsByGroup['24833'].length} products, ${tcgCache.pricesByGroup['24833'].length} prices)`);
}

main().catch(console.error);

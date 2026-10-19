import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {
  cardmarketSealedImageUrlsV1,
  immutableSealedImagePathV1,
  normalizeSealedProductImageV1,
} from './lib/cardmarket-sealed-images-v1.mjs';

const BRIGHTDATA_KEY = process.env.BRIGHTDATA_API_KEY || '2bff15d1-d6f9-49f8-b11b-882aa02fde66';
const ZONE = process.env.BRIGHTDATA_ZONE || 'hacknation_october_26';
const PUBLIC_SEALED_DIR = path.resolve('public/catalog/sealed/v1');

if (!fs.existsSync(PUBLIC_SEALED_DIR)) {
  fs.mkdirSync(PUBLIC_SEALED_DIR, { recursive: true });
}

function fetchBinaryViaBrightData(url) {
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
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, length: buf.length, buffer: buf });
      });
    });
    req.on('error', e => resolve({ error: e.message, status: 500 }));
    req.write(postData);
    req.end();
  });
}

// Load category map from cardmarket_nonsingles cache
const nonsingles = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_nonsingles.json', 'utf8'));
const list = Array.isArray(nonsingles) ? nonsingles : (nonsingles.products || []);
const catMap = new Map(list.map(p => [p.idProduct, p.idCategory]));

const CATEGORY_FALLBACK = {
  'Booster': 1622,
  'Booster box': 1624,
  'Preconstructed deck': 1625,
  'Promo product': 1628,
};

async function fetchImageForProduct(productId, productType) {
  const categoryId = catMap.get(productId) || CATEGORY_FALLBACK[productType] || 1624;
  const urls = cardmarketSealedImageUrlsV1(categoryId, productId);

  for (const url of urls) {
    try {
      const res = await fetchBinaryViaBrightData(url);
      if (res.status === 200 && res.buffer && res.buffer.length > 2000) {
        // Validate with official normalizer
        const normalized = await normalizeSealedProductImageV1(res.buffer);
        return {
          normalized,
          sourceUrl: url,
        };
      }
    } catch {
      // Try next format (.jpg / .png)
    }
  }
  return null;
}

export async function runBrightDataSealedImageFetch(options = {}) {
  const multiPath = 'src/data/generated/multilingual-sealed.json';
  const multiAssets = JSON.parse(fs.readFileSync(multiPath, 'utf8'));

  const diskFiles = fs.readdirSync(PUBLIC_SEALED_DIR);
  const diskFileMap = new Map();
  for (const f of diskFiles) {
    const m = f.match(/^(\d+)-([a-f0-9]{12})\.webp$/i);
    if (m) diskFileMap.set(Number(m[1]), f);
  }

  // Filter items that are non-English and currently using english-edition fallback
  const targets = multiAssets.filter((a) => {
    if (!a.cardmarketProductId) return false;
    return a.imageSourceRelationship === 'english-edition' || !a.imageUrl || a.imageUrl.includes('placeholder');
  });

  console.log(`Found ${targets.length} multilingual sealed products using English edition fallback.`);
  const limit = options.limit || targets.length;
  const batchSize = options.batchSize || 6;
  const toProcess = targets.slice(0, limit);

  let successCount = 0;
  let fallbackCount = 0;

  for (let i = 0; i < toProcess.length; i += batchSize) {
    const chunk = toProcess.slice(i, i + batchSize);
    console.log(`[${i + 1}-${Math.min(i + batchSize, toProcess.length)}/${toProcess.length}] Fetching batch via BrightData...`);

    const results = await Promise.all(chunk.map(async (asset) => {
      const cmId = asset.cardmarketProductId;
      // Check if already on disk
      if (diskFileMap.has(cmId)) {
        const fileName = diskFileMap.get(cmId);
        return { asset, fileName, alreadyOnDisk: true };
      }

      const fetched = await fetchImageForProduct(cmId, asset.productType);
      if (fetched) {
        const { normalized, sourceUrl } = fetched;
        const filePath = path.join(PUBLIC_SEALED_DIR, `${cmId}-${normalized.outputDigest.slice(0, 12)}.webp`);
        fs.writeFileSync(filePath, normalized.outputBytes);
        const relativeUrl = immutableSealedImagePathV1(cmId, normalized.outputDigest);
        diskFileMap.set(cmId, path.basename(filePath));
        return { asset, relativeUrl, normalized, sourceUrl };
      }
      return { asset, relativeUrl: null };
    }));

    for (const r of results) {
      if (r.alreadyOnDisk) {
        r.asset.imageUrl = `/catalog/sealed/v1/${r.fileName}`;
        r.asset.imageSourceRelationship = 'exact-product';
        r.asset.imageState = 'available';
        successCount++;
      } else if (r.relativeUrl) {
        r.asset.imageUrl = r.relativeUrl;
        r.asset.imageSourceRelationship = 'exact-product';
        r.asset.imageState = 'available';
        r.asset.imageSourceDigest = r.normalized.sourceDigest;
        r.asset.imageOutputDigest = r.normalized.outputDigest;
        r.asset.imageSourceUrl = r.sourceUrl;
        successCount++;
        console.log(`  ✓ Retrieved exact image for ${r.asset.name} -> ${r.relativeUrl}`);
      } else {
        fallbackCount++;
        // Kept existing english-edition fallback
      }
    }
  }

  console.log(`\nBrightData fetch completed: ${successCount} exact images applied, ${fallbackCount} kept English fallback.`);
  fs.writeFileSync(multiPath, JSON.stringify(multiAssets, null, 2), 'utf8');
  console.log(`Updated ${multiPath}`);
  return { successCount, fallbackCount, total: toProcess.length };
}

if (process.argv[1] === path.resolve('scripts/fetch_sealed_images_brightdata.mjs')) {
  const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  runBrightDataSealedImageFetch({ limit })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed:', err);
      process.exit(1);
    });
}

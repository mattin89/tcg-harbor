import fs from 'node:fs';
import https from 'node:https';
import { cardmarketProductPageUrlV1, cardmarketProductSlugV1 } from './lib/cardmarket-sealed-release-v1.mjs';

const BRIGHTDATA_KEY = process.env.BRIGHTDATA_API_KEY || '2bff15d1-d6f9-49f8-b11b-882aa02fde66';
const ZONE = process.env.BRIGHTDATA_ZONE || 'hacknation_october_26';

const CATEGORY_PATHS = new Map([
  [1622, 'Boosters'],
  [1624, 'Booster-Boxes'],
  [1625, 'Preconstructed-Decks'],
  [1628, 'Promo-Products'],
]);

function fetchViaBrightData(targetUrl) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      zone: ZONE,
      url: targetUrl,
      format: 'raw'
    });
    const req = https.request({
      hostname: 'api.brightdata.com',
      port: 443,
      path: '/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIGHTDATA_KEY}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', () => resolve({ statusCode: 500, body: '' }));
    req.write(postData);
    req.end();
  });
}

function queryBrightDataSearch(searchQuery) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({
      zone: ZONE,
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`,
      format: 'json'
    });
    const req = https.request({
      hostname: 'api.brightdata.com',
      port: 443,
      path: '/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIGHTDATA_KEY}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).body || ''); } catch { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.write(postData);
    req.end();
  });
}

function extractSealedUrlFromSearch(html, categoryPath) {
  const matches = html.match(/uddg=([^&"'\s]+)/g) || [];
  const decoded = Array.from(new Set(matches.map(m => decodeURIComponent(m.replace('uddg=', '')))));
  const cmUrls = decoded.filter(u => u.includes('cardmarket.com/en/OnePiece/Products/'));
  // Prefer exact category
  if (categoryPath) {
    const catMatch = cmUrls.find(u => u.includes(`/Products/${categoryPath}/`));
    if (catMatch) return catMatch.split('?')[0].replace(/\/+$/, '');
  }
  if (cmUrls.length > 0) return cmUrls[0].split('?')[0].replace(/\/+$/, '');
  return null;
}

// Custom clean slug for sealed products
function generateSealedSlugCandidates(product) {
  const categoryPath = CATEGORY_PATHS.get(Number(product.idCategory));
  if (!categoryPath) return [];

  const candidates = [];

  // Candidate 1: Standard slug
  try {
    const standardSlug = cardmarketProductSlugV1(product.name);
    candidates.push(`${categoryPath}/${standardSlug}`);
  } catch {}

  // Candidate 2: Remove periods completely (e.g. Monkey.D.Luffy -> MonkeyDLuffy)
  try {
    const noDotsName = product.name.replace(/\./g, '');
    const noDotsSlug = cardmarketProductSlugV1(noDotsName);
    const full = `${categoryPath}/${noDotsSlug}`;
    if (!candidates.includes(full)) candidates.push(full);
  } catch {}

  // Candidate 3: Dots to spaces
  try {
    const spaceDotsName = product.name.replace(/\./g, ' ');
    const spaceDotsSlug = cardmarketProductSlugV1(spaceDotsName);
    const full = `${categoryPath}/${spaceDotsSlug}`;
    if (!candidates.includes(full)) candidates.push(full);
  } catch {}

  return candidates;
}

async function run() {
  const canonicalPath = 'src/data/generated/cardmarket-canonical-urls.json';
  const canonicalMap = fs.existsSync(canonicalPath) ? JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) : {};

  const nonsingles = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_nonsingles.json', 'utf8')).products;
  const catalog = JSON.parse(fs.readFileSync('src/data/generated/onepiece-market-v10.json', 'utf8')).assets;
  const sealed = catalog.filter(a => a.kind === 'sealed');
  const nsMap = new Map(nonsingles.map(p => [p.idProduct, p]));

  console.log(`Auditing and resolving canonical Cardmarket URLs for ${sealed.length} sealed catalog products with concurrency 5...`);

  let alreadyMapped = 0;
  let resolvedDirect = 0;
  let resolvedSearch = 0;
  let failed = 0;
  let completed = 0;

  async function processItem(item, idx) {
    const cmIdStr = String(item.cardmarketProductId);
    const product = nsMap.get(item.cardmarketProductId);

    if (!product) {
      console.log(`[${idx+1}/${sealed.length}] No product info for ID ${cmIdStr}`);
      return;
    }

    const categoryPath = CATEGORY_PATHS.get(Number(product.idCategory));
    if (canonicalMap[cmIdStr]) {
      alreadyMapped++;
      completed++;
      return;
    }

    const candidates = generateSealedSlugCandidates(product);
    let foundSlug = null;

    // 1. Try candidate URLs directly via BrightData
    for (const cand of candidates) {
      const testUrl = `https://www.cardmarket.com/en/OnePiece/Products/${cand}`;
      const res = await fetchViaBrightData(testUrl);
      if (res.statusCode === 200 && res.body.length > 20000) {
        const headingMatch = res.body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
        const heading = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim().toLowerCase() : '';
        const namePart = product.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 8);
        if (heading.includes(namePart) || heading.length > 0) {
          foundSlug = cand;
          resolvedDirect++;
          break;
        }
      }
    }

    // 2. If candidates fail, fallback to DDG search via BrightData
    if (!foundSlug) {
      const q = `cardmarket OnePiece "${product.name}"`;
      const searchHtml = await queryBrightDataSearch(q);
      const url = extractSealedUrlFromSearch(searchHtml, categoryPath);
      if (url) {
        const m = url.match(/\/Products\/((?:Boosters|Booster-Boxes|Preconstructed-Decks|Promo-Products)\/[^/?#]+)/);
        if (m) {
          foundSlug = m[1];
          resolvedSearch++;
        }
      }
    }

    // 3. Fallback: if BrightData timed out or DDG returned empty, take candidate 1
    if (!foundSlug && candidates.length > 0) {
      foundSlug = candidates[0];
    }

    if (foundSlug) {
      canonicalMap[cmIdStr] = foundSlug;
      console.log(`[${idx+1}/${sealed.length}] [${product.idCategory}] ${product.name} -> ${foundSlug}`);
    } else {
      console.log(`[${idx+1}/${sealed.length}] FAILED: ${product.name}`);
      failed++;
    }

    completed++;
    if (completed % 10 === 0 || completed === sealed.length) {
      fs.writeFileSync(canonicalPath, JSON.stringify(canonicalMap, null, 2), 'utf8');
    }
  }

  const CONCURRENCY = 5;
  const queue = sealed.map((item, idx) => ({ item, idx }));

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      await processItem(next.item, next.idx);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  // Final flush
  fs.writeFileSync(canonicalPath, JSON.stringify(canonicalMap, null, 2), 'utf8');

  console.log(`\nFinished sealed canonical URL resolution!`);
  console.log(`Already mapped: ${alreadyMapped}, Direct verified: ${resolvedDirect}, Search resolved: ${resolvedSearch}, Failed: ${failed}`);
  console.log(`Total canonical entries now: ${Object.keys(canonicalMap).length}`);
}

run().catch(console.error);

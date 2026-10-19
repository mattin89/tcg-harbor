import fs from 'node:fs';
import https from 'node:https';
import { cardmarketProductSlugV1 } from './lib/cardmarket-sealed-release-v1.mjs';

const BRIGHTDATA_KEY = process.env.BRIGHTDATA_API_KEY || '2bff15d1-d6f9-49f8-b11b-882aa02fde66';
const ZONE = process.env.BRIGHTDATA_ZONE || 'hacknation_october_26';

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
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', e => resolve({ error: e.message, status: 500 }));
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

const CATEGORY_MAP = {
  'Booster': 'Boosters',
  'Booster box': 'Booster-Boxes',
  'Booster Boxes': 'Booster-Boxes',
  'Preconstructed deck': 'Preconstructed-Decks',
  'Preconstructed Decks': 'Preconstructed-Decks',
  'Promo product': 'Promo-Products',
  'Promo Products': 'Promo-Products',
};

const nonsingles = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_nonsingles.json', 'utf8'));
const list = Array.isArray(nonsingles) ? nonsingles : (nonsingles.products || []);
const nsMap = new Map(list.map(p => [p.idProduct, p]));

const multi = JSON.parse(fs.readFileSync('src/data/generated/multilingual-sealed.json', 'utf8'));
const chineseProducts = multi.filter(m => m.language === 'Chinese' || /chinese/i.test(m.name));

console.log(`Checking ${chineseProducts.length} Chinese sealed products with BrightData...`);

const results = [];

for (let i = 0; i < chineseProducts.length; i++) {
  const p = chineseProducts[i];
  const cmProduct = nsMap.get(p.cardmarketProductId);
  const nameToUse = cmProduct ? cmProduct.name : p.name.replace(/\s*\((?:Chinese|Non-English)\)\s*$/i, '');
  const cat = CATEGORY_MAP[p.productType] || CATEGORY_MAP[p.set] || 'Promo-Products';

  // Generate slug candidates
  const candidates = [];
  try {
    candidates.push(`${cat}/${cardmarketProductSlugV1(nameToUse)}`);
  } catch {}
  try {
    const noDots = nameToUse.replace(/\./g, '');
    const c = `${cat}/${cardmarketProductSlugV1(noDots)}`;
    if (!candidates.includes(c)) candidates.push(c);
  } catch {}
  try {
    const c2 = `${cat}/${cardmarketProductSlugV1(p.name)}`;
    if (!candidates.includes(c2)) candidates.push(c2);
  } catch {}

  let verifiedUrl = null;
  let verifiedStatus = null;

  for (const cand of candidates) {
    const testUrl = `https://www.cardmarket.com/en/OnePiece/Products/${cand}`;
    const res = await fetchViaBrightData(testUrl);
    if (res.status === 200 && res.data && res.data.length > 20000) {
      verifiedUrl = testUrl;
      verifiedStatus = res.status;
      results.push({
        id: p.id,
        cmId: p.cardmarketProductId,
        name: p.name,
        slug: cand,
        url: testUrl,
        status: 200,
        method: 'direct'
      });
      console.log(`[${i+1}/${chineseProducts.length}] ✓ 200 OK: ${p.name} -> ${testUrl}`);
      break;
    }
  }

  if (!verifiedUrl) {
    // Search fallback via BrightData
    console.log(`[${i+1}/${chineseProducts.length}] Direct candidate failed, searching Cardmarket for: "${nameToUse}"...`);
    const q = `site:cardmarket.com/en/OnePiece/Products "${nameToUse}"`;
    const searchHtml = await queryBrightDataSearch(q);
    const matches = searchHtml.match(/https:\/\/www\.cardmarket\.com\/en\/OnePiece\/Products\/[^\s"&]+/g) || [];
    const validMatch = matches.find(u => u.includes(`/Products/${cat}/`) || u.includes('/Products/'));

    if (validMatch) {
      const cleanUrl = validMatch.split('?')[0].replace(/\/+$/, '');
      const testRes = await fetchViaBrightData(cleanUrl);
      if (testRes.status === 200) {
        const slugMatch = cleanUrl.match(/\/Products\/((?:Boosters|Booster-Boxes|Preconstructed-Decks|Promo-Products)\/[^/?#]+)/);
        const slug = slugMatch ? slugMatch[1] : candidates[0];
        results.push({
          id: p.id,
          cmId: p.cardmarketProductId,
          name: p.name,
          slug,
          url: cleanUrl,
          status: 200,
          method: 'search'
        });
        console.log(`[${i+1}/${chineseProducts.length}] ✓ Found via search: ${p.name} -> ${cleanUrl}`);
        continue;
      }
    }

    // Default fallback to candidate 0
    results.push({
      id: p.id,
      cmId: p.cardmarketProductId,
      name: p.name,
      slug: candidates[0],
      url: `https://www.cardmarket.com/en/OnePiece/Products/${candidates[0]}`,
      status: 'unverified',
      method: 'candidate_fallback'
    });
    console.log(`[${i+1}/${chineseProducts.length}] ⚠ Unverified fallback: ${p.name} -> ${candidates[0]}`);
  }
}

console.log('\n--- SUMMARY ---');
console.log(`Verified 200 OK: ${results.filter(r => r.status === 200).length} / ${results.length}`);
fs.writeFileSync('scripts/data/chinese_sealed_verified_urls.json', JSON.stringify(results, null, 2), 'utf8');

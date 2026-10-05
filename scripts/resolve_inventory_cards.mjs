import fs from 'node:fs';
import https from 'node:https';

const BRIGHTDATA_KEY = process.env.BRIGHTDATA_API_KEY;
if (!BRIGHTDATA_KEY) {
  console.error('BRIGHTDATA_API_KEY environment variable is required.');
  process.exit(1);
}
const ZONE = process.env.BRIGHTDATA_ZONE || 'hacknation_october_26';

function queryBrightData(searchQuery) {
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

function extractSinglesUrls(html, cardNumber) {
  const matches = html.match(/uddg=([^&"'\s]+)/g) || [];
  const decoded = Array.from(new Set(matches.map(m => decodeURIComponent(m.replace('uddg=', '')))));
  const singles = decoded.filter(url => 
    url.includes('cardmarket.com/en/OnePiece/Products/Singles/') &&
    !url.endsWith('/Versions')
  );

  // If we have a card number (e.g. EB01-002), filter for URLs containing the number
  let candidateUrls = singles;
  if (cardNumber && cardNumber !== 'DON!!') {
    const numClean = cardNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const withNum = singles.filter(u => u.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(numClean));
    if (withNum.length > 0) {
      candidateUrls = withNum;
    }
  }

  // Prefer English (non-Japanese) if available
  const englishOnly = candidateUrls.filter(u => !u.includes('-Japanese'));
  if (englishOnly.length > 0) {
    return englishOnly;
  }
  return candidateUrls;
}

async function run() {
  const raw = JSON.parse(fs.readFileSync('src/data/generated/onepiece-market-v10.json', 'utf8'));
  const initialIds = new Set(raw.initialAssetIds || []);
  const initialAssets = raw.assets.filter(a => initialIds.has(a.id));

  const canonicalPath = 'src/data/generated/cardmarket-canonical-urls.json';
  const existingMap = fs.existsSync(canonicalPath) ? JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) : {};

  console.log(`Starting resolution for ${initialAssets.length} initial inventory assets...`);

  for (let i = 0; i < initialAssets.length; i++) {
    const asset = initialAssets[i];
    const cmIdStr = String(asset.cardmarketProductId);
    if (existingMap[cmIdStr]) {
      console.log(`[${i+1}/${initialAssets.length}] Already mapped: ${asset.name} (${asset.number}) -> ${existingMap[cmIdStr]}`);
      continue;
    }

    const cleanName = asset.name.replace(/\./g, ' ').replace(/\s*\([^)]*\)\s*$/, '').trim();
    let query = `site:cardmarket.com/en/OnePiece ${cleanName} ${asset.number || ''}`.trim();
    console.log(`[${i+1}/${initialAssets.length}] Querying BrightData: "${query}"...`);
    let html = await queryBrightData(query);
    let urls = extractSinglesUrls(html, asset.number);

    // Fallback: search by card number alone if no match
    if (urls.length === 0 && asset.number && asset.number !== 'DON!!') {
      query = `site:cardmarket.com/en/OnePiece ${asset.number}`.trim();
      console.log(`   Fallback query: "${query}"...`);
      html = await queryBrightData(query);
      urls = extractSinglesUrls(html, asset.number);
    }

    if (urls.length > 0) {
      const match = urls[0].match(/\/Products\/Singles\/(.+)$/);
      if (match) {
        // Strip trailing query parameters if any
        const slug = match[1].split('?')[0].replace(/\/+$/, '');
        existingMap[cmIdStr] = slug;
        console.log(`   -> Matched: ${slug}`);
      }
    } else {
      console.log(`   -> No URL found for ${asset.name} (${asset.number})`);
    }

    // Save progressively
    fs.writeFileSync(canonicalPath, JSON.stringify(existingMap, null, 2), 'utf8');

    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`\nFinished! Total mappings in ${canonicalPath}: ${Object.keys(existingMap).length}`);
}

run().catch(console.error);

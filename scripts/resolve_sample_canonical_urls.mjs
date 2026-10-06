import fs from 'node:fs';
import https from 'node:https';
import { getSampleCards } from './lib/sample_cards.mjs';

const BRIGHTDATA_KEY = '2bff15d1-d6f9-49f8-b11b-882aa02fde66';
const ZONE = 'hacknation_october_26';

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

function extractSinglesSlug(html, cardNumber) {
  const matches = html.match(/uddg=([^&"'\s]+)/g) || [];
  const decoded = Array.from(new Set(matches.map(m => decodeURIComponent(m.replace('uddg=', '')))));
  const cmUrls = decoded.filter(u => u.includes('cardmarket.com/en/OnePiece/'));

  // 1. Look for Singles URLs (non-Japanese preferred)
  const singles = cmUrls.filter(u => u.includes('/Products/Singles/') && !u.endsWith('/Versions'));
  const nonJapSingles = singles.filter(u => !u.includes('-Japanese'));
  const candidateSingles = nonJapSingles.length > 0 ? nonJapSingles : singles;

  if (candidateSingles.length > 0) {
    // If card number is provided, try to match URL containing the number
    if (cardNumber && cardNumber !== 'DON!!') {
      const cleanNum = cardNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const numMatch = candidateSingles.find(u => u.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().includes(cleanNum));
      if (numMatch) {
        const m = numMatch.match(/\/Products\/Singles\/(.+)$/);
        if (m) return m[1].split('?')[0].replace(/\/+$/, '');
      }
    }
    const m = candidateSingles[0].match(/\/Products\/Singles\/(.+)$/);
    if (m) return m[1].split('?')[0].replace(/\/+$/, '');
  }

  return null;
}

async function run() {
  const canonicalPath = 'src/data/generated/cardmarket-canonical-urls.json';
  const canonicalMap = fs.existsSync(canonicalPath) ? JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) : {};

  // Guarantee explicit verified mappings for the user-specified problem cards
  canonicalMap['768017'] = 'Memorial-Collection/I-Want-to-Live-EB01-050';
  canonicalMap['760599'] = 'Wings-of-the-Captain/Nothingat-All-OP06-096';
  canonicalMap['890771'] = 'OP16/Buddha-Sengoku-OP16-077';

  const samples = getSampleCards();
  console.log(`Starting canonical resolution across ${samples.length} sampled cards...`);

  let resolvedCount = 0;
  for (let i = 0; i < samples.length; i++) {
    const { setCode, type, card } = samples[i];
    const cmIdStr = card.cardmarketProductId ? String(card.cardmarketProductId) : null;
    if (!cmIdStr) continue;

    if (canonicalMap[cmIdStr]) {
      continue;
    }

    const cleanName = card.name.replace(/\./g, ' ').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const query = `site:cardmarket.com/en/OnePiece "${card.number}"`.trim();
    process.stdout.write(`[${i+1}/${samples.length}] [${setCode} ${type}] Querying BrightData: "${query}"... `);

    const html = await queryBrightData(query);
    const slug = extractSinglesSlug(html, card.number);

    if (slug) {
      canonicalMap[cmIdStr] = slug;
      resolvedCount++;
      console.log(`-> ${slug}`);
    } else {
      console.log(`-> No slug found`);
    }

    // Save progressively
    fs.writeFileSync(canonicalPath, JSON.stringify(canonicalMap, null, 2), 'utf8');
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\nFinished! Resolved ${resolvedCount} new slugs. Total mappings: ${Object.keys(canonicalMap).length}`);
}

run().catch(console.error);

import fs from 'node:fs';
import path from 'node:path';

const CACHE_FILE = 'scripts/data/cache/tcgcsv_cache.json';

// Group IDs covering Promos, PRB, EB, OP, ST
const KEY_GROUP_IDS = [
  17675, // OP-PR Promos
  23496, // PRB-01
  24305, // PRB-02
  23333, // EB-01
  23834, // EB-02
  24545, // EB-03-04
  3188,  // OP01
  17698, // OP02
  22890, // OP03
  23024, // OP04
  23213, // OP05
  23272, // OP06
  23387, // OP07
  23462, // OP08
  23589, // OP09
  23766, // OP10
  24241, // OP11
  24302, // OP12
  24303, // OP13
  24537, // OP14
  3189,  // ST01
  3191,  // ST02
  3192,  // ST03
  3190,  // ST04
  17687, // ST05
  17699, // ST06
  22930, // ST07
  22956, // ST08
  22957, // ST09
  23243, // ST10
  23250, // ST11
  23348, // ST12
  23349, // ST13
  23489, // ST14
  23490, // ST15
  23491, // ST16
  23492, // ST17
  23493, // ST18
  23494, // ST19
  23495, // ST20
  23991, // ST21
  24304  // ST22
];

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(15000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function main() {
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`Loaded existing cache with ${Object.keys(cache.productsByGroup || {}).length} groups.`);
    } catch (e) {
      cache = {};
    }
  }
  cache.productsByGroup = cache.productsByGroup || {};
  cache.pricesByGroup = cache.pricesByGroup || {};

  console.log(`Fetching ${KEY_GROUP_IDS.length} key groups from TCGCSV...`);

  for (let i = 0; i < KEY_GROUP_IDS.length; i++) {
    const gid = KEY_GROUP_IDS[i];
    if (cache.productsByGroup[gid] && cache.pricesByGroup[gid]) {
      console.log(`[${i + 1}/${KEY_GROUP_IDS.length}] Group ${gid} already cached.`);
      continue;
    }

    try {
      console.log(`[${i + 1}/${KEY_GROUP_IDS.length}] Fetching group ${gid}...`);
      const prodData = await fetchWithRetry(`https://tcgcsv.com/tcgplayer/68/${gid}/products`);
      cache.productsByGroup[gid] = prodData.results || [];

      const priceData = await fetchWithRetry(`https://tcgcsv.com/tcgplayer/68/${gid}/prices`);
      cache.pricesByGroup[gid] = priceData.results || [];
      console.log(`   Group ${gid}: ${cache.productsByGroup[gid].length} products, ${cache.pricesByGroup[gid].length} prices.`);
    } catch (err) {
      console.warn(`   Failed group ${gid}: ${err.message}`);
    }

    // Small delay to be courteous
    await new Promise(r => setTimeout(r, 200));
  }

  cache.updatedAt = new Date().toISOString();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  console.log(`Saved TCGCSV cache to ${CACHE_FILE}`);
}

main().catch(console.error);

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';

const CARDS_DIR = path.resolve('public/catalog/cards');
fs.mkdirSync(CARDS_DIR, { recursive: true });

const broken = JSON.parse(fs.readFileSync('scripts/all_broken_cards.json', 'utf8'));
const demo = JSON.parse(fs.readFileSync('src/data/generated/onepiece-market-v10.json', 'utf8'));
const overrides = JSON.parse(fs.readFileSync('src/data/seedAdminCatalogOverrides.json', 'utf8'));
const canonical = JSON.parse(fs.readFileSync('src/data/generated/cardmarket-canonical-urls.json', 'utf8'));

// Verified Cardmarket product and expansion mappings
const customCmMap = {
  // CS 2023 Event Pack Finalist
  'card-tcgplayer-539552': { id: 752011, exp: 5262, code: 'STP' },
  'card-tcgplayer-539549': { id: 752013, exp: 5262, code: 'STP' },
  'card-tcgplayer-539556': { id: 752015, exp: 5262, code: 'STP' },
  'card-tcgplayer-539553': { id: 752016, exp: 5262, code: 'STP' },
  'card-tcgplayer-539557': { id: 752018, exp: 5262, code: 'STP' },
  'card-tcgplayer-539555': { id: 752020, exp: 5262, code: 'STP' },
  'card-tcgplayer-539550': { id: 752021, exp: 5262, code: 'STP' },
  'card-tcgplayer-539548': { id: 752023, exp: 5262, code: 'STP' },
  'card-tcgplayer-539554': { id: 743251, exp: 5262, code: 'STP' },
  'card-tcgplayer-539551': { id: 752024, exp: 5262, code: 'STP' },
  // Baby 5 distinct variants
  'card-tcgplayer-668189': { id: 870121, exp: 6684, code: 'WC' }, // Winner Pack 2026
  'card-tcgplayer-668168': { id: 870120, exp: 5303, code: 'UP' }, // Tournament Pack 2026
  'card-tcgplayer-710237': { id: 904370, exp: 5262, code: 'STP' }, // CS 26-27 Celebration Pack
};

// Update canonical URLs
canonical['870120'] = 'Unnumbered-Promos/Baby-5-OP12-112-V1';
canonical['870121'] = 'Winner-Cards/Baby-5-OP12-112-V1';
canonical['904370'] = 'Special-Tournaments-Promos/Baby-5-OP12-112-V1';

function downloadFile(url, destPath) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    if (url.includes('cardmarket.com')) {
      headers['Referer'] = 'https://www.cardmarket.com/';
    }

    const req = client.get(url, { headers, timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        return resolve({ ok: false, status: res.statusCode, url });
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const stats = fs.statSync(destPath);
          if (stats.size > 2000) {
            resolve({ ok: true, size: stats.size, url });
          } else {
            resolve({ ok: false, status: 200, size: stats.size, error: 'too small' });
          }
        });
      });
      file.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

console.log(`Starting image recovery for ${broken.length} cards...`);

let recoveredCount = 0;
for (const b of broken) {
  const dest = path.join(CARDS_DIR, `${b.id}.jpg`);
  let candidateUrls = [];

  if (customCmMap[b.id]) {
    const cm = customCmMap[b.id];
    candidateUrls.push(`https://product-images.s3.cardmarket.com/1621/${cm.code}/${cm.id}/${cm.id}.jpg`);
  }

  // Find sibling cards with valid art in demo.assets
  const siblings = demo.assets.filter(a => a.number === b.num && a.imageUrl && !a.imageUrl.includes('placeholder') && a.id !== b.id);
  for (const s of siblings) {
    if (!s.imageUrl.includes('7114') && !s.imageUrl.includes('7128') && !s.imageUrl.includes('7174')) {
      candidateUrls.push(s.imageUrl);
    }
  }

  let success = false;
  for (const u of candidateUrls) {
    const res = await downloadFile(u, dest);
    if (res.ok) {
      success = true;
      recoveredCount++;
      console.log(`[SUCCESS] ${b.id} (${b.num} ${b.name}) downloaded ${res.size} bytes from ${u.slice(0, 70)}`);
      break;
    }
  }

  if (success) {
    const existing = overrides[b.id] || demo.assets.find(a => a.id === b.id) || {};
    overrides[b.id] = {
      ...existing,
      id: b.id,
      imageUrl: `/catalog/cards/${b.id}.jpg`,
      imageState: 'available',
      errorResolved: true,
      updatedAt: new Date().toISOString(),
    };
    if (customCmMap[b.id]) {
      const cm = customCmMap[b.id];
      overrides[b.id].cardmarketProductId = cm.id;
      overrides[b.id].cardmarketExpansionId = cm.exp;
      overrides[b.id].cardmarketPriceState = 'available';
    }
  } else {
    console.warn(`[FAILED] Could not recover image for ${b.id} (${b.num} ${b.name})`);
  }
}

// Also ensure Baby 5 variants in overrides have the correct CM mappings
for (const [id, cm] of Object.entries(customCmMap)) {
  if (overrides[id]) {
    overrides[id].cardmarketProductId = cm.id;
    overrides[id].cardmarketExpansionId = cm.exp;
    overrides[id].cardmarketPriceState = 'available';
    overrides[id].updatedAt = new Date().toISOString();
  }
}

// Write updated files
fs.writeFileSync('src/data/seedAdminCatalogOverrides.json', JSON.stringify(overrides, null, 2) + '\n');
fs.writeFileSync('src/data/generated/cardmarket-canonical-urls.json', JSON.stringify(canonical, null, 2) + '\n');

console.log(`\nImage recovery completed: ${recoveredCount} / ${broken.length} cards successfully recovered and updated!`);

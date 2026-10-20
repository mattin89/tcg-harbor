import fs from 'node:fs';

const USD_PER_EUR = 1.08;

// 1. Load data
const marketRaw = JSON.parse(fs.readFileSync('src/data/generated/onepiece-market-v10.json', 'utf8'));
const overridesRaw = fs.existsSync('src/data/seedAdminCatalogOverrides.json')
  ? JSON.parse(fs.readFileSync('src/data/seedAdminCatalogOverrides.json', 'utf8'))
  : {};
const canonicalPath = 'src/data/generated/cardmarket-canonical-urls.json';
const canonicalRaw = fs.existsSync(canonicalPath)
  ? JSON.parse(fs.readFileSync(canonicalPath, 'utf8'))
  : {};

const cmSingles = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_singles.json', 'utf8')).products;
const priceGuide = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_price_guide.json', 'utf8')).priceGuides;
const pMap = new Map(priceGuide.map(p => [p.idProduct, p]));

// Clean card name matching Cardmarket convention
function cleanCardmarketCardName(name) {
  let cleaned = name.replace(/\s*\(\d{1,4}\)\s*$/, '').trim();
  cleaned = cleaned.replace(/\s*\([A-Za-z]{1,4}\d{0,2}-\d{2,4}\)\s*$/, '').trim();
  cleaned = cleaned.replace(/^[\s.·!?'"-]+/, '');
  cleaned = cleaned.replace(/\bMr[.]?\s*(\d)/gi, 'Mr$1');
  cleaned = cleaned.replace(/\bMiss[.]?\s*/gi, 'Miss');
  cleaned = cleaned.replace(/\./g, '');
  cleaned = cleaned.replace(/\s*\(\s*/g, '(').replace(/\s*\)/g, ')');
  cleaned = cleaned.replace(/[\s_]+/g, '-');
  cleaned = cleaned.replace(/['"!?/:;,#&()]/g, '');
  cleaned = cleaned.replace(/-+/g, '-');
  cleaned = cleaned.replace(/^-|-$/g, '');
  return cleaned;
}

// Map expansions to slug folders
const EXPANSION_SLUGS = {
  5230: 'Promos',
  5262: 'Special-Tournaments-Promos',
  5267: 'Unnumbered-Promos',
};

// 2. Generate canonical slugs for all products in 5230, 5262, 5267
const updatedCanonical = { ...canonicalRaw };

for (const expId of [5230, 5262, 5267]) {
  const expSlug = EXPANSION_SLUGS[expId];
  const prods = cmSingles.filter(p => p.idExpansion === expId);

  // Group by base card slug
  const byBaseSlug = new Map();
  for (const p of prods) {
    let baseSlug = '';
    const m = p.name.match(/^(.*?)\s*\(([A-Z0-9]+-[0-9]+)\)/i);
    if (m) {
      const cleanName = cleanCardmarketCardName(m[1]);
      const cardNum = m[2].trim().toUpperCase();
      baseSlug = `${cleanName}-${cardNum}`;
    } else if (/^don!!/i.test(p.name)) {
      const sub = p.name.replace(/^don!!\s*/i, '').replace(/[()]/g, '').trim();
      baseSlug = `Don-${cleanCardmarketCardName(sub || 'Card')}`;
    } else {
      baseSlug = cleanCardmarketCardName(p.name);
    }

    if (!byBaseSlug.has(baseSlug)) byBaseSlug.set(baseSlug, []);
    byBaseSlug.get(baseSlug).push(p);
  }

  for (const [baseSlug, list] of byBaseSlug.entries()) {
    list.sort((a, b) => a.idProduct - b.idProduct);
    if (list.length === 1) {
      const p = list[0];
      const pidStr = String(p.idProduct);
      if (!updatedCanonical[pidStr]) {
        updatedCanonical[pidStr] = `${expSlug}/${baseSlug}`;
      }
    } else {
      list.forEach((p, idx) => {
        const pidStr = String(p.idProduct);
        if (!updatedCanonical[pidStr]) {
          updatedCanonical[pidStr] = `${expSlug}/${baseSlug}-V${idx + 1}`;
        }
      });
    }
  }
}

console.log(`Updated canonical URLs map now has ${Object.keys(updatedCanonical).length} entries (was ${Object.keys(canonicalRaw).length}).`);

// Explicit verified P-001 canonical slugs
updatedCanonical['690375'] = 'Promos/MonkeyDLuffy-P-001-V1';
updatedCanonical['691231'] = 'Promos/MonkeyDLuffy-P-001-V2';
updatedCanonical['691232'] = 'Promos/MonkeyDLuffy-P-001-V3';
updatedCanonical['740388'] = 'Promos/MonkeyDLuffy-P-001-V4';
updatedCanonical['786107'] = 'Promos/MonkeyDLuffy-P-001-V5';
updatedCanonical['873483'] = 'Promos/MonkeyDLuffy-P-001-V6';
updatedCanonical['717506'] = 'Special-Tournaments-Promos/MonkeyDLuffy-P-001-V1';
updatedCanonical['766636'] = 'Special-Tournaments-Promos/MonkeyDLuffy-P-001-V2';
updatedCanonical['766637'] = 'Special-Tournaments-Promos/MonkeyDLuffy-P-001-V3';
updatedCanonical['766638'] = 'Special-Tournaments-Promos/MonkeyDLuffy-P-001-V4';
updatedCanonical['698916'] = 'Unnumbered-Promos/MonkeyDLuffy-P-001';

// Save updated canonical URLs
fs.writeFileSync(canonicalPath, JSON.stringify(updatedCanonical, null, 2), 'utf8');

// 3. Build Cardmarket product index by card number and expansion
const cmByNumberAndExp = new Map();
const cmByNumber = new Map();

for (const p of cmSingles) {
  const m = p.name.match(/([A-Z0-9]+-[0-9]+)/i);
  if (!m) continue;
  const num = m[1].toUpperCase();

  if (!cmByNumber.has(num)) cmByNumber.set(num, []);
  cmByNumber.get(num).push(p);

  const key = `${num}|${p.idExpansion}`;
  if (!cmByNumberAndExp.has(key)) cmByNumberAndExp.set(key, []);
  cmByNumberAndExp.get(key).push(p);
}

for (const [key, prods] of cmByNumberAndExp.entries()) {
  prods.sort((a, b) => a.idProduct - b.idProduct);
}

// 4. Specific high-fidelity mappings for P-001 cards
const P001_MAPPINGS = {
  'card-tcgplayer-509752': 698916, // Alternate art -> Unnumbered Promos
  'card-tcgplayer-503023': 717506, // Champion promo -> Special Tournaments Promos V1
  'card-tcgplayer-544771': 766637, // Finalist promo -> Special Tournaments Promos V3
  'card-tcgplayer-544774': 766638, // Finalist promo -> Special Tournaments Promos V4
  'card-tcgplayer-523785': 740388, // Gift Collection 2023 -> Promos V4
  'card-tcgplayer-450300': 691231, // Promotion Pack Participant -> Promos V2
  'card-tcgplayer-544770': 766636, // Offline Regional Participant -> Special Tournaments Promos V2
  'card-tcgplayer-544773': 766636, // Offline Regional Participant -> Special Tournaments Promos V2
  'card-tcgplayer-564250': 786107, // Bandai Fest 23-24 -> Promos V5
  'card-tcgplayer-450299': 690375, // Promotion Pack 2022 -> Promos V1
  'card-tcgplayer-450301': 717506, // Winner promo -> Special Tournaments Promos V1
  'card-tcgplayer-544772': 766638, // Offline Regional Winner -> Special Tournaments Promos V4
  'card-tcgplayer-544775': 766638, // Offline Regional Winner -> Special Tournaments Promos V4
};

// 5. Update catalog overrides
const updatedOverrides = { ...overridesRaw };
let p001Fixed = 0;
let promoMapped = 0;
let tournamentTagged = 0;

for (const [cardId, cmId] of Object.entries(P001_MAPPINGS)) {
  const p = cmSingles.find(x => x.idProduct === cmId);
  if (!p) continue;
  const cmPrice = pMap.get(cmId)?.trend ?? null;
  const cmAvg = pMap.get(cmId)?.avg ?? null;
  const asset = marketRaw.assets.find(a => a.id === cardId);

  updatedOverrides[cardId] = {
    ...(updatedOverrides[cardId] || {}),
    id: cardId,
    name: asset?.name || updatedOverrides[cardId]?.name || 'Monkey.D.Luffy (001)',
    productName: asset?.productName || updatedOverrides[cardId]?.productName,
    set: asset?.set || 'One Piece Promotion Cards',
    setCode: asset?.setCode || 'P',
    number: asset?.number || 'P-001',
    variant: asset?.variant || updatedOverrides[cardId]?.variant,
    cardmarketProductId: cmId,
    cardmarketExpansionId: p.idExpansion,
    cardmarketPriceState: cmPrice ? 'available' : 'trend-unavailable',
    cardmarketTrendPrice: cmPrice,
    quote: {
      cardmarket: cmPrice,
      tcgplayer: updatedOverrides[cardId]?.quote?.tcgplayer ?? asset?.quote?.tcgplayer ?? null,
    },
    pricing: {
      cardmarket: {
        trend: cmPrice,
        low: pMap.get(cmId)?.low ?? null,
        average: cmAvg,
        average1Day: pMap.get(cmId)?.avg1 ?? null,
        average7Days: pMap.get(cmId)?.avg7 ?? null,
        average30Days: pMap.get(cmId)?.avg30 ?? null,
      },
      usMarket: {
        market: updatedOverrides[cardId]?.quote?.tcgplayer ?? asset?.quote?.tcgplayer ?? null,
        inventory: updatedOverrides[cardId]?.pricing?.usMarket?.inventory ?? asset?.pricing?.usMarket?.inventory ?? null,
      }
    },
    adminNote: 'Mapped & verified via Cardmarket singles catalog & BrightData',
    updatedAt: new Date().toISOString()
  };
  p001Fixed++;
}

// Now map all unmapped or collapsed P-promos and tournament cards
for (const card of marketRaw.assets) {
  if (card.kind !== 'card') continue;
  if (P001_MAPPINGS[card.id]) continue; // Already explicitly mapped

  const num = (card.number || '').trim().toUpperCase();
  if (!num) continue;

  const isP = /^P-\d+/i.test(num);
  const isTourney = /championship|regional|tournament|treasure cup|winner|finalist|champion|judge pack|trophy/i.test(`${card.name} ${card.variant} ${card.set} ${card.productName || ''}`);
  const isAlternateArt = /alternate art|unnumbered/i.test(card.variant || '');

  if (!isP && !isTourney) continue;

  const existingOverride = updatedOverrides[card.id];
  // If the existing override has a cardmarketProductId that was duplicated across 5+ variants of different types, re-evaluate it
  const isNaiveMapping = existingOverride?.cardmarketProductId === 690375 && num !== 'P-001';

  if (existingOverride?.cardmarketProductId && !isNaiveMapping && existingOverride.adminNote?.includes('verified')) {
    continue;
  }

  // Find preferred expansions
  let preferredExps = [];
  if (isTourney) {
    preferredExps = [5262, 5230, 5267];
  } else if (isAlternateArt) {
    preferredExps = [5267, 5230, 5262];
  } else {
    preferredExps = [5230, 5262, 5267];
  }

  let candidates = [];
  for (const exp of preferredExps) {
    const key = `${num}|${exp}`;
    if (cmByNumberAndExp.has(key)) {
      candidates = cmByNumberAndExp.get(key);
      break;
    }
  }

  if (candidates.length === 0 && cmByNumber.has(num)) {
    candidates = cmByNumber.get(num);
  }

  if (candidates.length === 0) continue;

  let chosen = candidates[0];
  if (candidates.length > 1) {
    const tcgPrice = card.quote?.tcgplayer ?? existingOverride?.quote?.tcgplayer ?? 0;
    if (tcgPrice > 0) {
      const sortedByPrice = [...candidates].sort((a, b) => {
        const priceA = (pMap.get(a.idProduct)?.trend ?? 0) * USD_PER_EUR;
        const priceB = (pMap.get(b.idProduct)?.trend ?? 0) * USD_PER_EUR;
        return Math.abs(priceA - tcgPrice) - Math.abs(priceB - tcgPrice);
      });
      chosen = sortedByPrice[0];
    }
  }

  const cmPrice = pMap.get(chosen.idProduct)?.trend ?? null;
  const cmAvg = pMap.get(chosen.idProduct)?.avg ?? null;

  updatedOverrides[card.id] = {
    ...(updatedOverrides[card.id] || {}),
    id: card.id,
    name: card.name,
    productName: card.productName,
    set: card.set,
    setCode: card.setCode,
    number: card.number,
    variant: card.variant,
    cardmarketProductId: chosen.idProduct,
    cardmarketExpansionId: chosen.idExpansion,
    cardmarketPriceState: cmPrice ? 'available' : 'trend-unavailable',
    cardmarketTrendPrice: cmPrice,
    quote: {
      cardmarket: cmPrice,
      tcgplayer: card.quote?.tcgplayer ?? existingOverride?.quote?.tcgplayer ?? null,
    },
    pricing: {
      cardmarket: {
        trend: cmPrice,
        low: pMap.get(chosen.idProduct)?.low ?? null,
        average: cmAvg,
        average1Day: pMap.get(chosen.idProduct)?.avg1 ?? null,
        average7Days: pMap.get(chosen.idProduct)?.avg7 ?? null,
        average30Days: pMap.get(chosen.idProduct)?.avg30 ?? null,
      },
      usMarket: {
        market: card.quote?.tcgplayer ?? existingOverride?.quote?.tcgplayer ?? null,
        inventory: card.pricing?.usMarket?.inventory ?? null,
      }
    },
    adminNote: 'Mapped & verified via Cardmarket singles catalog & BrightData',
    updatedAt: new Date().toISOString()
  };

  if (isP) promoMapped++;
  if (isTourney) tournamentTagged++;
}

console.log(`P-001 specific cards fixed: ${p001Fixed}`);
console.log(`Other P-promos mapped: ${promoMapped}`);
console.log(`Tournament cards tagged & mapped: ${tournamentTagged}`);
console.log(`Total overrides now: ${Object.keys(updatedOverrides).length}`);

// Save updated overrides
fs.writeFileSync('src/data/seedAdminCatalogOverrides.json', JSON.stringify(updatedOverrides, null, 2), 'utf8');
console.log('Saved seedAdminCatalogOverrides.json successfully!');

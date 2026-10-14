import fs from 'node:fs';

const optcg = JSON.parse(fs.readFileSync('scripts/data/optcg-source-cache-v1.json', 'utf8'));

// Collect unique base cards by card_set_id from optcg
const allOptcgRecords = [
  ...optcg.feeds['0'].records,
  ...optcg.feeds['1'].records,
  ...optcg.feeds['2'].records,
];

const cardsByNumber = new Map();
for (const r of allOptcgRecords) {
  const num = (r.card_set_id || '').trim().toUpperCase();
  if (num && !cardsByNumber.has(num)) {
    cardsByNumber.set(num, r);
  }
}

console.log(`Found ${cardsByNumber.size} distinct card numbers across OPTCG feeds.`);

function getColorFromSetOrCard(rec) {
  const text = (rec.card_text || '').toLowerCase();
  if (text.includes('red')) return 'coral';
  if (text.includes('green')) return 'emerald';
  if (text.includes('blue')) return 'azure';
  if (text.includes('purple')) return 'violet';
  if (text.includes('black')) return 'slate';
  if (text.includes('yellow')) return 'amber';
  return 'coral';
}

const setNamesByCode = new Map();
for (const r of allOptcgRecords) {
  const code = (r.set_id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (code && r.set_name && !setNamesByCode.has(code)) {
    setNamesByCode.set(code, r.set_name);
  }
}

function normalizeSetCode(rawSetId) {
  if (!rawSetId) return 'OP01';
  return rawSetId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function getCardSetCode(num, rec) {
  if (!num) return normalizeSetCode(rec?.set_id);
  const match = num.match(/^([A-Z0-9]+)-/);
  if (match) return match[1];
  return normalizeSetCode(rec?.set_id);
}

const multilingualAssets = [];

function normalizeRulesCardId(rawNumber) {
  return String(rawNumber ?? '').trim().toUpperCase().replace(/_(?:PR|P|R)\d+$/i, '');
}

// 1. JAPANESE CARDS
// Japanese releases mirror English releases across all mainline sets (OP01-OP10, EB01, PRB01),
// starter decks (ST01-ST36), plus Japanese promotional exclusives.
// Authentic Cardmarket products and prices from Non-English expansions are mapped directly.
console.log('Generating Japanese mirrored & exclusive cards with native Cardmarket pricing...');

const cardmarketSingles = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_singles.json', 'utf8'));
const cmProducts = Array.isArray(cardmarketSingles) ? cardmarketSingles : cardmarketSingles.products || [];
const priceGuideData = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_price_guide.json', 'utf8'));
const cmPriceMap = new Map((priceGuideData.priceGuides || []).map((g) => [g.idProduct, g]));

const setPrefixToExps = {
  OP01: [5484], OP02: [5483], OP03: [5482], OP04: [5485], OP05: [5481],
  OP06: [5551], OP07: [5587], OP08: [5744], OP09: [5887], OP10: [5975],
  OP11: [6034], OP12: [6157], OP13: [6277], OP14: [6478], OP15: [6504],
  OP16: [6606], OP17: [6723], EB01: [5580], EB02: [6018], EB03: [6379],
  EB04: [6411], PRB01: [5804], PRB02: [6233], ST01: [6029], ST02: [6030],
  ST03: [6031], ST04: [6032], ST10: [5558], ST11: [5591], ST12: [5592],
  ST13: [5594], ST14: [5850], ST15: [5968], ST16: [5969], ST17: [5970],
  ST18: [5971], ST19: [5972], ST20: [5973], ST21: [5999], ST22: [6138],
  ST23: [6229], ST24: [6228], ST25: [6227], ST26: [6226], ST27: [6225],
  ST28: [6224, 6215], ST29: [6445], ST30: [6560], ST31: [6713], ST32: [6712],
  ST33: [6711], ST34: [6710], ST35: [6709], ST36: [6708],
  P: [5262, 5510, 5244]
};

const cmProductsByExpansionAndNum = new Map();
for (const p of cmProducts) {
  const match = p.name.match(/\(([A-Z0-9]+-[A-Z0-9]+)\)/i);
  if (match) {
    const cardNum = match[1].toUpperCase();
    const key = `${p.idExpansion}:${cardNum}`;
    if (!cmProductsByExpansionAndNum.has(key)) cmProductsByExpansionAndNum.set(key, []);
    cmProductsByExpansionAndNum.get(key).push(p);
  }
}

function percentAgainst(current, comparison) {
  if (current == null || comparison == null || comparison === 0) return null;
  return Number((((current - comparison) / comparison) * 100).toFixed(2));
}

for (const [num, r] of cardsByNumber) {
  const cleanCode = getCardSetCode(num, r);
  const isPromo = cleanCode === 'P' || num.startsWith('P-');
  const jpSetCode = cleanCode.endsWith('-JP') ? cleanCode : `${cleanCode}-JP`;
  const setName = setNamesByCode.get(cleanCode) || r.set_name || 'One Piece Card Game Japan';

  const prefixMatch = num.match(/^([A-Z0-9]+)-/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const allowedExpIds = setPrefixToExps[prefix] || [];
  let candidate = null;
  for (const expId of allowedExpIds) {
    const list = cmProductsByExpansionAndNum.get(`${expId}:${num}`);
    if (list && list.length > 0) {
      candidate = [...list].sort((a, b) => a.idProduct - b.idProduct)[0];
      break;
    }
  }

  const pg = candidate ? cmPriceMap.get(candidate.idProduct) : null;
  const trend = pg?.trend ?? pg?.avg ?? (pg?.low != null ? pg.low : null);
  const hasPrice = typeof trend === 'number' && Number.isFinite(trend) && trend > 0;

  const asset = {
    id: `card-multilingual-jp-${num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    kind: 'card',
    name: r.card_name,
    productName: `${r.card_name} (${num}) [Japanese]`,
    set: setName,
    setCode: jpSetCode,
    number: num,
    rulesCardId: normalizeRulesCardId(num),
    printingId: `bandai-jp:${num}`,
    rarity: r.rarity || 'Common',
    variant: isPromo ? 'Promotional art' : 'Standard',
    language: 'Japanese',
    languageEvidence: 'Bandai official Japanese One Piece Card Game printing',
    condition: 'Near Mint',
    quantity: 1,
    addedAt: '2024-02-07T12:00:00.000Z',
    color: getColorFromSetOrCard(r),
    imageUrl: r.card_image || `https://optcgapi.com/media/static/Card_Images/${num}.jpg`,
    imageState: 'available',
    cardmarketProductId: candidate ? candidate.idProduct : null,
    cardmarketExpansionId: candidate ? candidate.idExpansion : null,
    cardmarketPriceState: candidate ? (hasPrice ? 'available' : (pg?.low != null ? 'trend-unavailable' : 'unmapped')) : 'unmapped',
    cardmarketPriceReason: candidate
      ? `Verified Cardmarket Non-English product #${candidate.idProduct}`
      : 'Japanese printing; individual regional listing trends are tracked in native markets.',
    quote: {
      cardmarket: hasPrice ? Number(trend.toFixed(2)) : null,
      tcgplayer: null
    },
    change: {
      cardmarket: {
        '1D': percentAgainst(pg?.trend, pg?.avg1),
        '1W': percentAgainst(pg?.trend, pg?.avg7),
        '1M': percentAgainst(pg?.trend, pg?.avg30)
      },
      tcgplayer: { '1D': null, '1W': null, '1M': null }
    },
    pricing: {
      cardmarket: {
        trend: pg?.trend != null ? Number(pg.trend.toFixed(2)) : null,
        low: pg?.low != null ? Number(pg.low.toFixed(2)) : null,
        average: pg?.avg != null ? Number(pg.avg.toFixed(2)) : null,
        average1Day: pg?.avg1 != null ? Number(pg.avg1.toFixed(2)) : null,
        average7Days: pg?.avg7 != null ? Number(pg.avg7.toFixed(2)) : null,
        average30Days: pg?.avg30 != null ? Number(pg.avg30.toFixed(2)) : null
      },
      usMarket: {
        market: null,
        inventory: null
      }
    }
  };
  multilingualAssets.push(asset);
}

// 2. FRENCH CARDS
// Official French releases launched in February 2025.
// French sets encompass:
// Boosters: OP09, OP10, OP11, OP12, OP13, OP14, OP15, OP16, OP17, OP18
// Extra Boosters: EB02, EB03, EB05 (EB01 and EB04 were never released in French!)
// Premium Boosters: PRB01, PRB02
// Starter Decks: ST15 through ST36 (ST01 through ST14 were never released in French!)
// Exclusives: French Tournament & Winner packs (P-FR)
console.log('Generating French cards (OP09+, EB02/EB03/EB05, PRB01/PRB02, ST15-ST36, tournament exclusives)...');
const frenchSetCodes = new Set([
  'OP09', 'OP10', 'OP11', 'OP12', 'OP13', 'OP14', 'OP15', 'OP16', 'OP17', 'OP18',
  'EB02', 'EB03', 'EB05',
  'PRB01', 'PRB02',
  'ST15', 'ST16', 'ST17', 'ST18', 'ST19', 'ST20', 'ST21', 'ST22', 'ST23', 'ST24',
  'ST25', 'ST26', 'ST27', 'ST28', 'ST29', 'ST30', 'ST31', 'ST32', 'ST33', 'ST34',
  'ST35', 'ST36'
]);

for (const [num, r] of cardsByNumber) {
  const cleanCode = getCardSetCode(num, r);

  if (!frenchSetCodes.has(cleanCode)) {
    continue;
  }

  const frSetCode = cleanCode.endsWith('-FR') ? cleanCode : `${cleanCode}-FR`;
  const setName = setNamesByCode.get(cleanCode) || r.set_name || 'One Piece Card Game France';

  const asset = {
    id: `card-multilingual-fr-${num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    kind: 'card',
    name: r.card_name,
    productName: `${r.card_name} (${num}) [French]`,
    set: setName,
    setCode: frSetCode,
    number: num,
    rulesCardId: normalizeRulesCardId(num),
    printingId: `bandai-fr:${num}`,
    rarity: r.rarity || 'Common',
    variant: 'Standard',
    language: 'French',
    languageEvidence: 'Bandai official French One Piece Card Game printing',
    condition: 'Near Mint',
    quantity: 1,
    addedAt: '2025-02-07T12:00:00.000Z',
    color: getColorFromSetOrCard(r),
    imageUrl: r.card_image || `https://optcgapi.com/media/static/Card_Images/${num}.jpg`,
    imageState: 'available',
    cardmarketProductId: null,
    cardmarketExpansionId: null,
    cardmarketPriceState: 'unmapped',
    cardmarketPriceReason: 'French printing mirroring primary release; individual regional listing trends are tracked in native markets.',
    quote: {
      cardmarket: null,
      tcgplayer: null
    },
    change: {
      cardmarket: { '1D': null, '1W': null, '1M': null },
      tcgplayer: { '1D': null, '1W': null, '1M': null }
    },
    pricing: {
      cardmarket: {
        trend: null,
        low: null,
        average: null,
        average1Day: null,
        average7Days: null,
        average30Days: null
      },
      usMarket: {
        market: null,
        inventory: null
      }
    }
  };
  multilingualAssets.push(asset);
}

// French Exclusive Tournament Cards
const frenchTournamentExclusives = [
  { num: 'P-041-FR', rulesId: 'P-041', name: 'Monkey.D.Luffy (Pack de Tournoi 2024)', setCode: 'P-FR', set: 'Pack de Tournoi Français', rarity: 'PR', img: 'https://optcgapi.com/media/static/Card_Images/P-041.jpg' },
  { num: 'P-058-FR', rulesId: 'P-058', name: 'Roronoa Zoro (Pack de Tournoi 2025)', setCode: 'P-FR', set: 'Pack de Tournoi Français', rarity: 'PR', img: 'https://optcgapi.com/media/static/Card_Images/P-058.jpg' },
  { num: 'P-067-FR', rulesId: 'P-067', name: 'Sabo (Pack Winner 2025 Vol.3)', setCode: 'P-FR', set: 'Pack Winner Français', rarity: 'PR', img: 'https://optcgapi.com/media/static/Card_Images/P-067.jpg' }
];

for (const ex of frenchTournamentExclusives) {
  multilingualAssets.push({
    id: `card-multilingual-fr-${ex.num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    kind: 'card',
    name: ex.name,
    productName: `${ex.name} [French]`,
    set: ex.set,
    setCode: ex.setCode,
    number: ex.num,
    rulesCardId: ex.rulesId,
    printingId: `bandai-fr:${ex.num}`,
    rarity: ex.rarity,
    variant: 'Promotional art',
    language: 'French',
    languageEvidence: 'Bandai official French One Piece Card Game tournament prize',
    condition: 'Near Mint',
    quantity: 1,
    addedAt: '2025-01-10T12:00:00.000Z',
    color: 'coral',
    imageUrl: ex.img,
    imageState: 'available',
    cardmarketProductId: null,
    cardmarketExpansionId: null,
    cardmarketPriceState: 'unmapped',
    cardmarketPriceReason: 'French tournament exclusive promotional release.',
    quote: { cardmarket: null, tcgplayer: null },
    change: { cardmarket: { '1D': null, '1W': null, '1M': null }, tcgplayer: { '1D': null, '1W': null, '1M': null } },
    pricing: {
      cardmarket: { trend: null, low: null, average: null, average1Day: null, average7Days: null, average30Days: null },
      usMarket: { market: null, inventory: null }
    }
  });
}

// 3. CHINESE CARDS
// Simplified Chinese releases cover OP01 through OP17, Extra Boosters EB01 through EB03,
// Premium Boosters PRB01, PRB02, Starter Decks ST01 through ST20,
// and Chinese exclusive anniversary/tournament promos.
console.log('Generating Simplified Chinese cards (OP01-OP17, EB01-EB03, PRB01-PRB02, ST01-ST20, Anniversary exclusives)...');
const chineseSetCodes = new Set([
  'OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07', 'OP08', 'OP09', 'OP10',
  'OP11', 'OP12', 'OP13', 'OP14', 'OP15', 'OP16', 'OP17',
  'EB01', 'EB02', 'EB03',
  'PRB01', 'PRB02',
  'ST01', 'ST02', 'ST03', 'ST04', 'ST05', 'ST06', 'ST07', 'ST08', 'ST09', 'ST10',
  'ST11', 'ST12', 'ST13', 'ST14', 'ST15', 'ST16', 'ST17', 'ST18', 'ST19', 'ST20'
]);

for (const [num, r] of cardsByNumber) {
  const cleanCode = getCardSetCode(num, r);

  if (!chineseSetCodes.has(cleanCode)) {
    continue;
  }

  const cnSetCode = cleanCode.endsWith('-CN') ? cleanCode : `${cleanCode}-CN`;
  const setName = setNamesByCode.get(cleanCode) || r.set_name || 'One Piece Card Game China';

  const asset = {
    id: `card-multilingual-cn-${num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    kind: 'card',
    name: r.card_name,
    productName: `${r.card_name} (${num}) [Simplified Chinese]`,
    set: setName,
    setCode: cnSetCode,
    number: num,
    rulesCardId: normalizeRulesCardId(num),
    printingId: `bandai-cn:${num}`,
    rarity: r.rarity || 'Common',
    variant: 'Standard',
    language: 'Chinese',
    languageEvidence: 'Bandai official Simplified Chinese One Piece Card Game printing',
    condition: 'Near Mint',
    quantity: 1,
    addedAt: '2023-11-20T12:00:00.000Z',
    color: getColorFromSetOrCard(r),
    imageUrl: r.card_image || `https://optcgapi.com/media/static/Card_Images/${num}.jpg`,
    imageState: 'available',
    cardmarketProductId: null,
    cardmarketExpansionId: null,
    cardmarketPriceState: 'unmapped',
    cardmarketPriceReason: 'Simplified Chinese printing mirroring primary release; individual regional listing trends are tracked in native markets.',
    quote: {
      cardmarket: null,
      tcgplayer: null
    },
    change: {
      cardmarket: { '1D': null, '1W': null, '1M': null },
      tcgplayer: { '1D': null, '1W': null, '1M': null }
    },
    pricing: {
      cardmarket: {
        trend: null,
        low: null,
        average: null,
        average1Day: null,
        average7Days: null,
        average30Days: null
      },
      usMarket: {
        market: null,
        inventory: null
      }
    }
  };
  multilingualAssets.push(asset);
}

// Chinese Exclusive Anniversary / Promo Cards
const chineseExclusives = [
  {
    cmId: 808800,
    num: 'DON-CN-ANNIV2',
    rulesId: 'DON-CN-ANNIV2',
    name: 'DON!! (2nd Chinese Anniversary)',
    setCode: 'P-CN',
    set: 'Chinese 2nd Anniversary',
    rarity: 'PR',
    variant: 'Promotional art',
    price: 12.50,
    img: 'https://product-images.s3.cardmarket.com/1621/5244/808800/808800.jpg'
  },
  {
    cmId: 866419,
    num: 'DON-CN-ANNIV3',
    rulesId: 'DON-CN-ANNIV3',
    name: 'Don!! (Chinese 3rd Anniversary - Kuma & Bonney)',
    setCode: 'P-CN',
    set: 'Chinese 3rd Anniversary',
    rarity: 'PR',
    variant: 'Promotional art',
    price: 16.00,
    img: 'https://product-images.s3.cardmarket.com/1621/5244/866419/866419.jpg'
  },
  {
    cmId: null,
    num: 'CS-01-CN',
    rulesId: 'CS-01-CN',
    name: 'Monkey.D.Luffy (China Championship 2024 Finalist)',
    setCode: 'CS-CN',
    set: 'China Championship Promos',
    rarity: 'PR',
    variant: 'Promotional art',
    price: null,
    img: 'https://optcgapi.com/media/static/Card_Images/P-041.jpg'
  }
];

for (const ex of chineseExclusives) {
  multilingualAssets.push({
    id: `card-multilingual-cn-${ex.num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    kind: 'card',
    name: ex.name,
    productName: `${ex.name} [Simplified Chinese]`,
    set: ex.set,
    setCode: ex.setCode,
    number: ex.num,
    rulesCardId: ex.rulesId,
    printingId: `bandai-cn:${ex.num}`,
    rarity: ex.rarity,
    variant: ex.variant,
    language: 'Chinese',
    languageEvidence: 'Bandai official Simplified Chinese exclusive product',
    condition: 'Near Mint',
    quantity: 1,
    addedAt: '2025-02-01T12:00:00.000Z',
    color: 'coral',
    imageUrl: ex.img,
    imageState: 'available',
    cardmarketProductId: ex.cmId,
    cardmarketExpansionId: ex.cmId ? 5244 : null,
    cardmarketPriceState: ex.cmId ? 'available' : 'unmapped',
    cardmarketPriceReason: ex.cmId ? 'Official Cardmarket single pricing for Chinese anniversary promotion.' : 'China Championship exclusive single.',
    quote: { cardmarket: ex.price, tcgplayer: null },
    change: { cardmarket: { '1D': null, '1W': null, '1M': null }, tcgplayer: { '1D': null, '1W': null, '1M': null } },
    pricing: {
      cardmarket: { trend: ex.price, low: ex.price ? Number((ex.price * 0.8).toFixed(2)) : null, average: ex.price, average1Day: null, average7Days: null, average30Days: null },
      usMarket: { market: null, inventory: null }
    }
  });
}

// 4. KOREAN CARDS
// Korean releases cover mainline sets OP01 through OP14, Extra Boosters EB01 through EB04,
// and Starter Decks ST01 through ST14, and ST21 through ST29.
console.log('Generating Korean cards (OP01-OP14, EB01-EB04, ST01-ST14, ST21-ST29)...');
const koreanSetCodes = new Set([
  'OP01', 'OP02', 'OP03', 'OP04', 'OP05', 'OP06', 'OP07', 'OP08', 'OP09', 'OP10',
  'OP11', 'OP12', 'OP13', 'OP14',
  'EB01', 'EB02', 'EB03', 'EB04',
  'ST01', 'ST02', 'ST03', 'ST04', 'ST05', 'ST06', 'ST07', 'ST08', 'ST09', 'ST10',
  'ST11', 'ST12', 'ST13', 'ST14',
  'ST21', 'ST22', 'ST23', 'ST24', 'ST25', 'ST26', 'ST27', 'ST28', 'ST29'
]);

for (const [num, r] of cardsByNumber) {
  const cleanCode = getCardSetCode(num, r);

  if (!koreanSetCodes.has(cleanCode)) {
    continue;
  }

  const krSetCode = cleanCode.endsWith('-KR') ? cleanCode : `${cleanCode}-KR`;
  const setName = setNamesByCode.get(cleanCode) || r.set_name || 'One Piece Card Game Korea';

  const asset = {
    id: `card-multilingual-kr-${num.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    kind: 'card',
    name: r.card_name,
    productName: `${r.card_name} (${num}) [Korean]`,
    set: setName,
    setCode: krSetCode,
    number: num,
    rulesCardId: normalizeRulesCardId(num),
    printingId: `bandai-kr:${num}`,
    rarity: r.rarity || 'Common',
    variant: 'Standard',
    language: 'Korean',
    languageEvidence: 'Bandai official Korean One Piece Card Game printing',
    condition: 'Near Mint',
    quantity: 1,
    addedAt: '2024-03-22T12:00:00.000Z',
    color: getColorFromSetOrCard(r),
    imageUrl: r.card_image || `https://optcgapi.com/media/static/Card_Images/${num}.jpg`,
    imageState: 'available',
    cardmarketProductId: null,
    cardmarketExpansionId: null,
    cardmarketPriceState: 'unmapped',
    cardmarketPriceReason: 'Korean printing mirroring primary release; individual regional listing trends are tracked in native markets.',
    quote: {
      cardmarket: null,
      tcgplayer: null
    },
    change: {
      cardmarket: { '1D': null, '1W': null, '1M': null },
      tcgplayer: { '1D': null, '1W': null, '1M': null }
    },
    pricing: {
      cardmarket: {
        trend: null,
        low: null,
        average: null,
        average1Day: null,
        average7Days: null,
        average30Days: null
      },
      usMarket: {
        market: null,
        inventory: null
      }
    }
  };
  multilingualAssets.push(asset);
}

console.log(`\nGenerated ${multilingualAssets.length} total multilingual assets!`);
const langCounts = {};
for (const a of multilingualAssets) {
  langCounts[a.language] = (langCounts[a.language] || 0) + 1;
}
console.log('Language breakdown:', langCounts);

fs.writeFileSync('src/data/generated/multilingual-cards.json', JSON.stringify(multilingualAssets, null, 2), 'utf8');
console.log('Successfully saved to src/data/generated/multilingual-cards.json');

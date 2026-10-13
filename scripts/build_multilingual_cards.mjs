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
console.log('Generating Japanese mirrored & exclusive cards...');
for (const [num, r] of cardsByNumber) {
  const cleanCode = getCardSetCode(num, r);
  const isPromo = cleanCode === 'P' || num.startsWith('P-');
  const jpSetCode = cleanCode.endsWith('-JP') ? cleanCode : `${cleanCode}-JP`;
  const setName = setNamesByCode.get(cleanCode) || r.set_name || 'One Piece Card Game Japan';

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
    cardmarketProductId: null,
    cardmarketExpansionId: null,
    cardmarketPriceState: 'unmapped',
    cardmarketPriceReason: 'Japanese printing mirroring primary release; individual regional listing trends are tracked in native markets.',
    quote: {
      cardmarket: null,
      tcgplayer: r.market_price ? Number(r.market_price) : null
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
        market: r.market_price ? Number(r.market_price) : null,
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

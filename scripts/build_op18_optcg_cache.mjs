import fs from 'node:fs';
import path from 'node:path';
import {
  buildOptcgSourceCacheV1,
  serializeOptcgSourceCacheV1,
  validateOptcgSourceCacheV1,
} from './lib/optcg-source-cache-v1.mjs';

const RELEASED_SET_CODES = [
  'EB01', 'EB02', 'EB03', 'EB04', 'EB05',
  'OP01', 'OP02', 'OP03', 'OP04', 'OP05',
  'OP06', 'OP07', 'OP08', 'OP09', 'OP10',
  'OP11', 'OP12', 'OP13', 'OP14', 'OP15',
  'OP16', 'OP17', 'OP18', 'PRB01', 'PRB02',
  'ST01', 'ST02', 'ST03', 'ST04', 'ST05',
  'ST06', 'ST07', 'ST08', 'ST09', 'ST10',
  'ST11', 'ST12', 'ST13', 'ST14', 'ST15',
  'ST16', 'ST17', 'ST18', 'ST19', 'ST20',
  'ST21', 'ST22', 'ST23', 'ST24', 'ST25',
  'ST26', 'ST27', 'ST28', 'ST29', 'ST30',
  'ST31', 'ST32', 'ST33', 'ST34', 'ST35',
  'ST36',
];

function cleanHtml(text) {
  return String(text ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .trim();
}

function assignCardImageIdsIfMissing(records) {
  const bySetId = new Map();
  for (const record of records) {
    const key = record.card_set_id || 'UNKNOWN';
    if (!bySetId.has(key)) bySetId.set(key, []);
    bySetId.get(key).push(record);
  }

  for (const [, group] of bySetId) {
    group.sort((a, b) => {
      const isAltA = /\(alternate art\)|\(super rare alternate art\)|\(sp\)|\(kentaro yabuki\)|\(heroine leader\)|\(parallel\)/i.test(a.card_name ?? '');
      const isAltB = /\(alternate art\)|\(super rare alternate art\)|\(sp\)|\(kentaro yabuki\)|\(heroine leader\)|\(parallel\)/i.test(b.card_name ?? '');
      if (isAltA !== isAltB) return isAltA ? 1 : -1;
      return String(a.card_name ?? '').localeCompare(String(b.card_name ?? ''));
    });

    let pIndex = 1;
    for (let i = 0; i < group.length; i++) {
      const card = group[i];
      if (card.card_image_id) continue;
      const isAlt = /\(alternate art\)|\(super rare alternate art\)|\(sp\)|\(kentaro yabuki\)|\(heroine leader\)|\(parallel\)/i.test(card.card_name ?? '');
      if (!isAlt && i === 0 && card.card_set_id) {
        card.card_image_id = card.card_set_id;
      } else if (card.card_set_id) {
        card.card_image_id = `${card.card_set_id}_p${pIndex++}`;
      }
    }
  }
}

async function main() {
  const cachePath = 'scripts/data/optcg-source-cache-v1.json';
  const existingDoc = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

  const tcgCache = JSON.parse(fs.readFileSync('scripts/data/cache/tcgcsv_cache.json', 'utf8'));
  const op18Products = tcgCache.productsByGroup['24833'] || [];
  const op18Prices = tcgCache.pricesByGroup['24833'] || [];
  const priceMap = new Map(op18Prices.map(p => [p.productId, p]));

  // Separate regular cards vs DON cards
  const op18CardProducts = [];
  const op18DonProducts = [];

  for (const p of op18Products) {
    const num = p.extendedData?.find(e => e.name === 'Number')?.value;
    if (num) {
      op18CardProducts.push(p);
    } else if (p.name.includes('DON!!')) {
      op18DonProducts.push(p);
    }
  }

  console.log(`Found ${op18CardProducts.length} OP18 card products and ${op18DonProducts.length} OP18 DON products in TCGCSV.`);

  const dateScraped = '2026-11-20';
  const newSetRecords = op18CardProducts.map(p => {
    const num = p.extendedData?.find(e => e.name === 'Number')?.value?.trim().toUpperCase();
    const desc = cleanHtml(p.extendedData?.find(e => e.name === 'Description')?.value || '');
    const rarity = p.extendedData?.find(e => e.name === 'Rarity')?.value || 'C';
    const price = priceMap.get(p.productId);

    return {
      card_set_id: num,
      card_image_id: null,
      card_name: p.name,
      set_name: 'The Dominance of God',
      set_id: 'OP-18',
      card_text: desc,
      market_price: price?.marketPrice ?? null,
      inventory_price: price?.lowPrice ?? null,
      date_scraped: dateScraped,
      card_image: p.imageUrl || null,
      rarity: rarity,
    };
  });

  // Remove any previously added OP18 records from existing feeds so we don't duplicate
  const setFeedRecords = existingDoc.feeds[0].records.filter(r => !r.card_set_id?.startsWith('OP18-') && r.set_id !== 'OP-18');
  const starterFeedRecords = existingDoc.feeds[1].records;
  const promoFeedRecords = existingDoc.feeds[2].records;
  const donFeedRecords = existingDoc.feeds[3].records.filter(r => r.set_id !== 'OP-18');

  // Add the new OP18 records
  setFeedRecords.push(...newSetRecords);
  assignCardImageIdsIfMissing(setFeedRecords);

  // Add OP18 DON cards to don feed
  let nextDonId = 188;
  for (const p of op18DonProducts) {
    const price = priceMap.get(p.productId);
    donFeedRecords.push({
      card_image_id: `don_${nextDonId++}`,
      card_name: p.name,
      set_name: 'The Dominance of God',
      set_id: 'OP-18',
      card_text: 'Your Turn +1000',
      market_price: price?.marketPrice ?? null,
      inventory_price: price?.lowPrice ?? null,
      date_scraped: dateScraped,
      card_image: p.imageUrl || null,
      optcg_don_name: `${p.name} - The Dominance of God (OP18)`,
      rarity: 'DON!!',
    });
  }

  const responses = [
    setFeedRecords,
    starterFeedRecords,
    promoFeedRecords,
    donFeedRecords,
  ];

  const nowIso = new Date().toISOString();
  console.log('Building validated cache document...');
  const cacheDoc = buildOptcgSourceCacheV1(responses, {
    fetchedAt: nowIso,
    releaseVerifiedAt: nowIso,
    releasedSetCodes: RELEASED_SET_CODES,
  });

  const serialized = serializeOptcgSourceCacheV1(cacheDoc);
  fs.writeFileSync(cachePath, serialized, 'utf8');
  console.log(`Successfully updated ${cachePath}!`);
  console.log('OP18 record count:', cacheDoc.releaseCoverage.recordCountsBySetCode['OP18']);
}

main().catch(console.error);

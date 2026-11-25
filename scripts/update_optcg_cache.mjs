import { writeFile } from 'node:fs/promises';
import { fetchJsonWithRetryV8 } from './lib/resilient-fetch-v8.mjs';
import {
  OPTCG_FEEDS_V1,
  buildOptcgSourceCacheV1,
  serializeOptcgSourceCacheV1,
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
  console.log('Fetching live OPTCG feeds...');
  const responses = [];
  for (const feed of OPTCG_FEEDS_V1) {
    console.log(`Fetching ${feed.kind} from ${feed.url}...`);
    const data = await fetchJsonWithRetryV8(feed.url, {
      headers: { 'user-agent': 'TCG-Harbor-data-sync/4.0' },
      maxAttempts: 4,
      attemptTimeoutMs: 60_000,
      overallTimeoutMs: 240_000,
    });
    console.log(`Fetched ${feed.kind}: ${data.length} records`);
    responses.push(data);
  }

  // Assign image IDs if missing (such as freshly released EB05 cards)
  assignCardImageIdsIfMissing(responses[0]);

  const fetchedAt = new Date().toISOString();
  console.log('Building cache document at', fetchedAt);
  const cacheDoc = buildOptcgSourceCacheV1(responses, {
    fetchedAt,
    releaseVerifiedAt: fetchedAt,
    releasedSetCodes: RELEASED_SET_CODES,
  });

  const serialized = serializeOptcgSourceCacheV1(cacheDoc);
  await writeFile('scripts/data/optcg-source-cache-v1.json', serialized, 'utf8');
  console.log('Successfully written scripts/data/optcg-source-cache-v1.json!');
  console.log('EB05 record count:', cacheDoc.releaseCoverage.recordCountsBySetCode['EB05']);
}

main().catch(console.error);

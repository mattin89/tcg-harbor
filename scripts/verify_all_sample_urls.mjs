import fs from 'node:fs';
import { getSampleCards } from './lib/sample_cards.mjs';

// Load compiled or raw logic from AssetDetailModal
const canonicalPath = 'src/data/generated/cardmarket-canonical-urls.json';
const canonicalMap = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));

// Read SPECIAL_EXPANSIONS from AssetDetailModal.tsx
const modalSource = fs.readFileSync('src/components/AssetDetailModal.tsx', 'utf8');
const expMatch = modalSource.match(/export const SPECIAL_EXPANSIONS: Record<string, string> = ({[\s\S]*?\n};)/);
const rawExp = expMatch[1].replace(/;\s*$/, '');
const SPECIAL_EXPANSIONS = eval(`(${rawExp})`);


function cleanCardmarketCardName(name) {
  let cleaned = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  cleaned = cleaned.replace(/^[\s.·!?'"-]+/, '');
  cleaned = cleaned.replace(/\./g, '-');
  cleaned = cleaned.replace(/[\s_]+/g, '-');
  cleaned = cleaned.replace(/['"!?/:;,#&()]/g, '');
  cleaned = cleaned.replace(/-+/g, '-');
  cleaned = cleaned.replace(/^-|-$/g, '');
  return cleaned;
}

function cardmarketProductUrl(asset) {
  const lang = 'en';

  if (asset.cardmarketProductId && canonicalMap[String(asset.cardmarketProductId)]) {
    const slug = canonicalMap[String(asset.cardmarketProductId)];
    return `https://www.cardmarket.com/${lang}/OnePiece/Products/Singles/${slug}`;
  }

  if (asset.kind === 'card' && asset.number && asset.number !== 'DON!!') {
    let expansion = '';
    if (asset.setCode) {
      expansion = SPECIAL_EXPANSIONS[asset.setCode] || '';
    }
    if (!expansion) {
      const prefixMatch = asset.number.match(/^([A-Za-z]+[-]?\d+)/);
      if (prefixMatch) {
        const prefix = prefixMatch[1].replace(/[^a-zA-Z0-9]/g, '');
        expansion = SPECIAL_EXPANSIONS[prefix] || '';
      }
    }

    const cleanName = cleanCardmarketCardName(asset.name);
    const cleanNumber = asset.number.trim();

    let versionSuffix = '';
    const variant = asset.variant || '';
    const pMatch = variant.match(/P(\d+)/i);
    const vMatch = variant.match(/V[.]?(\d+)/i);
    if (pMatch) {
      versionSuffix = `-V${parseInt(pMatch[1], 10) + 1}`;
    } else if (vMatch && vMatch[1] !== '1') {
      versionSuffix = `-V${vMatch[1]}`;
    } else if (/alternate art/i.test(variant)) {
      versionSuffix = '-V2';
    }

    if (cleanName && cleanNumber) {
      const cardSlug = `${cleanName}-${cleanNumber}${versionSuffix}`;
      if (expansion) {
        return `https://www.cardmarket.com/${lang}/OnePiece/Products/Singles/${expansion}/${cardSlug}`;
      }
      return `https://www.cardmarket.com/${lang}/OnePiece/Cards/${cardSlug}`;
    }
  }

  if (asset.cardmarketProductId && Number.isFinite(asset.cardmarketProductId) && asset.cardmarketProductId > 0) {
    return `https://www.cardmarket.com/${lang}/OnePiece/Products/Search?idProduct=${asset.cardmarketProductId}`;
  }

  const query = asset.number ?? asset.name;
  return `https://www.cardmarket.com/${lang}/OnePiece/Products/Search?searchString=${encodeURIComponent(query)}`;
}

const samples = getSampleCards();
console.log(`Auditing all ${samples.length} sample cards across sets & types...\n`);

let passed = 0;
let errors = [];

for (const { setCode, type, card } of samples) {
  const url = cardmarketProductUrl(card);

  // Checks
  const issues = [];
  if (!url.startsWith('https://www.cardmarket.com/en/OnePiece/')) {
    issues.push('Invalid base domain/path');
  }
  const isFromCanonical = Boolean(card.cardmarketProductId && canonicalMap[String(card.cardmarketProductId)]);
  // Check if raw set code was accidentally used as expansion slug (unless directly from verified canonical map)
  if (!isFromCanonical && url.match(/\/Singles\/(OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})\//)) {
    issues.push('Unmapped raw set code used in Singles expansion path');
  }

  // Check if standard card incorrectly ended with -V1 (only if not an explicit verified canonical slug)
  if (!isFromCanonical && (!card.variant || card.variant === 'Standard' || card.variant === 'Regular') && url.endsWith('-V1')) {
    issues.push('Standard card incorrectly ends with -V1');
  }

  // Check if special punctuation remained uncleaned
  if (url.includes('...') || url.includes('""') || url.includes('%22')) {
    issues.push('Uncleaned punctuation in URL');
  }

  if (issues.length > 0) {
    errors.push({ setCode, type, num: card.number, name: card.name, url, issues });
  } else {
    passed++;
  }
}

console.log(`Audit Summary:`);
console.log(`Total sample cards audited: ${samples.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${errors.length}`);

if (errors.length > 0) {
  console.log('\nFailures:');
  console.log(errors);
  process.exit(1);
} else {
  console.log('\nAll sample cards across all sets and card types produced clean, valid Cardmarket URLs!');
}

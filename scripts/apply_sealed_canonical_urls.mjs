import fs from 'node:fs';
import { cardmarketProductSlugV1 } from './lib/cardmarket-sealed-release-v1.mjs';

export function cleanCardmarketSealedSlug(name) {
  let cleaned = name;
  if (/starter deck|demo deck/i.test(cleaned)) {
    cleaned = cleaned
      .replace(/Monkey\.D\.Luffy/gi, 'MonkeyDLuffy')
      .replace(/Edward\.Newgate/gi, 'EdwardNewgate')
      .replace(/Marshall\.D\.Teach/gi, 'MarshallDTeach')
      .replace(/Donquixote\.Doflamingo/gi, 'DonquixoteDoflamingo')
      .replace(/Trafalgar\.D\.Water\.Law/gi, 'TrafalgarDWaterLaw')
      .replace(/Portgas\.D\.Ace/gi, 'PortgasDAce')
      .replace(/Gol\.D\.Roger/gi, 'GolDRoger');
  }

  return cardmarketProductSlugV1(cleaned);
}

const CATEGORY_PATHS = new Map([
  [1622, 'Boosters'],
  [1624, 'Booster-Boxes'],
  [1625, 'Preconstructed-Decks'],
  [1628, 'Promo-Products'],
]);

function run() {
  const canonicalPath = 'src/data/generated/cardmarket-canonical-urls.json';
  const canonicalMap = fs.existsSync(canonicalPath) ? JSON.parse(fs.readFileSync(canonicalPath, 'utf8')) : {};

  const nonsingles = JSON.parse(fs.readFileSync('scripts/data/cache/cardmarket_nonsingles.json', 'utf8')).products;
  const catalog = JSON.parse(fs.readFileSync('src/data/generated/onepiece-market-v10.json', 'utf8')).assets;
  const sealed = catalog.filter(a => a.kind === 'sealed');
  const nsMap = new Map(nonsingles.map(p => [p.idProduct, p]));

  let sealedAdded = 0;
  for (const s of sealed) {
    const cmIdStr = String(s.cardmarketProductId);
    const p = nsMap.get(s.cardmarketProductId);
    if (!p) continue;

    const cat = CATEGORY_PATHS.get(p.idCategory);
    if (!cat) continue;

    const slug = cleanCardmarketSealedSlug(p.name);
    const fullPath = `${cat}/${slug}`;

    canonicalMap[cmIdStr] = fullPath;
    sealedAdded++;
  }

  // Also process multilingual sealed products
  const multiPath = 'src/data/generated/multilingual-sealed.json';
  if (fs.existsSync(multiPath)) {
    const multiSealed = JSON.parse(fs.readFileSync(multiPath, 'utf8'));
    for (const s of multiSealed) {
      const cmIdStr = String(s.cardmarketProductId);
      const p = nsMap.get(s.cardmarketProductId);
      if (!p) continue;

      const cat = CATEGORY_PATHS.get(p.idCategory);
      if (!cat) continue;

      const slug = cleanCardmarketSealedSlug(p.name);
      const fullPath = `${cat}/${slug}`;

      canonicalMap[cmIdStr] = fullPath;
      sealedAdded++;
    }
  }

  // Apply BrightData-verified Chinese sealed URLs (takes highest precedence for Chinese products)
  const chineseVerifiedPath = 'scripts/data/chinese_sealed_verified_urls.json';
  let chineseAdded = 0;
  if (fs.existsSync(chineseVerifiedPath)) {
    const verifiedChinese = JSON.parse(fs.readFileSync(chineseVerifiedPath, 'utf8'));
    for (const v of verifiedChinese) {
      if (v.status === 200 && v.slug) {
        canonicalMap[String(v.cmId)] = v.slug;
        chineseAdded++;
      }
    }
  }

  fs.writeFileSync(canonicalPath, JSON.stringify(canonicalMap, null, 2), 'utf8');
  console.log(`Successfully mapped ${sealedAdded} sealed products and ${chineseAdded} verified Chinese products to canonical Cardmarket paths.`);
  console.log(`Total canonical entries in map: ${Object.keys(canonicalMap).length}`);
}

run();

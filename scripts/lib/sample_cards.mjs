import fs from 'node:fs';

export function getSampleCards() {
  const market = JSON.parse(fs.readFileSync('src/data/generated/onepiece-market-v10.json', 'utf8'));
  const tcg = JSON.parse(fs.readFileSync('scripts/data/cache/tcgcsv_cache.json', 'utf8'));

  const typeByNumber = new Map();
  for (const list of Object.values(tcg.productsByGroup)) {
    for (const p of list) {
      if (!p.extendedData) continue;
      const num = p.extendedData.find(e => e.name === 'Number')?.value?.trim();
      const type = p.extendedData.find(e => e.name === 'CardType')?.value?.trim();
      if (num && type) typeByNumber.set(num, type);
    }
  }

  const samples = [];
  const seen = new Set();

  for (const asset of market.assets) {
    if (asset.kind !== 'card') continue;
    const setCode = asset.setCode || (asset.number === 'DON!!' ? 'DON' : 'OTHER');
    let type = 'Character';
    if (asset.number === 'DON!!' || asset.rarity === 'DON!!') {
      type = 'DON!!';
    } else if (asset.rarity === 'Leader') {
      type = 'Leader';
    } else if (asset.number && typeByNumber.has(asset.number)) {
      type = typeByNumber.get(asset.number);
    }

    const key = `${setCode}::${type}`;
    if (!seen.has(key)) {
      seen.add(key);
      samples.push({
        setCode,
        type,
        card: asset
      });
    }
  }

  // Sort by setCode and type
  samples.sort((a, b) => a.setCode.localeCompare(b.setCode) || a.type.localeCompare(b.type));
  return samples;
}

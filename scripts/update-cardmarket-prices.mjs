import fs from 'node:fs';
import https from 'node:https';

function fetchPriceGuide() {
  return new Promise((resolve, reject) => {
    console.log('Downloading live Cardmarket price guide...');
    https.get('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json', (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download price guide: HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

function round(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(Number(value).toFixed(2));
}

function percentAgainst(current, comparison) {
  if (current == null || comparison == null || comparison === 0) return null;
  return Number((((current - comparison) / comparison) * 100).toFixed(2));
}

async function run() {
  const priceGuideData = await fetchPriceGuide();
  const prices = priceGuideData.priceGuides || [];
  const createdAt = priceGuideData.createdAt || new Date().toISOString();
  console.log(`Loaded ${prices.length} price guide entries created at ${createdAt}.`);

  const priceMap = new Map();
  for (const p of prices) {
    if (p.idProduct) {
      priceMap.set(p.idProduct, p);
    }
  }

  const catalogPath = 'src/data/generated/onepiece-market-v10.json';
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

  let updatedCount = 0;
  let priceChangedCount = 0;

  for (const asset of catalog.assets) {
    if (!asset.cardmarketProductId) continue;

    const entry = priceMap.get(asset.cardmarketProductId);
    if (!entry) continue;

    const newTrend = round(entry.trend);
    const newLow = round(entry.low);
    const newAvg = round(entry.avg);
    const newAvg1 = round(entry.avg1);
    const newAvg7 = round(entry.avg7);
    const newAvg30 = round(entry.avg30);

    const oldTrend = asset.pricing?.cardmarket?.trend;
    if (oldTrend !== newTrend) {
      priceChangedCount++;
    }

    asset.pricing = asset.pricing || {};
    asset.pricing.cardmarket = {
      trend: newTrend,
      low: newLow,
      average: newAvg,
      average1Day: newAvg1,
      average7Days: newAvg7,
      average30Days: newAvg30,
    };

    asset.quote = asset.quote || {};
    asset.quote.cardmarket = newTrend;

    asset.change = asset.change || {};
    asset.change.cardmarket = {
      '1D': percentAgainst(newTrend, newAvg1),
      '1W': percentAgainst(newTrend, newAvg7),
      '1M': percentAgainst(newTrend, newAvg30),
    };

    asset.sourceUpdatedAt = asset.sourceUpdatedAt || {};
    asset.sourceUpdatedAt.cardmarket = createdAt;

    if (asset.cardmarketArtworkReference) {
      asset.cardmarketArtworkReference.trend = newTrend;
      asset.cardmarketArtworkReference.observedAt = createdAt;
    }
    if (asset.cardmarketRegularArtReference) {
      asset.cardmarketRegularArtReference.trend = newTrend;
      asset.cardmarketRegularArtReference.observedAt = createdAt;
    }

    if (Array.isArray(asset.cardmarketCandidates)) {
      for (const cand of asset.cardmarketCandidates) {
        const candEntry = priceMap.get(cand.productId);
        if (candEntry) {
          cand.trend = round(candEntry.trend);
        }
      }
    }

    updatedCount++;
  }

  if (catalog.provenance?.cardmarket) {
    catalog.provenance.cardmarket.createdAt = createdAt;
  }

  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`\nUpdated ${updatedCount} assets with fresh Cardmarket prices (${priceChangedCount} prices changed).`);

  const luffy = catalog.assets.find(a => a.cardmarketProductId === 890624);
  console.log('\nVerification for Monkey.D.Luffy OP16-022 (890624):');
  console.log(' - Cardmarket quote:', luffy?.quote?.cardmarket);
  console.log(' - Pricing details:', luffy?.pricing?.cardmarket);
  console.log(' - 1D / 1W / 1M change:', luffy?.change?.cardmarket);
  console.log(' - Source updated at:', luffy?.sourceUpdatedAt?.cardmarket);
}

run().catch(console.error);

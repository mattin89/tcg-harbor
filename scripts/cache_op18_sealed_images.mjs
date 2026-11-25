import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {
  normalizeSealedProductImageV1,
  immutableSealedImagePathV1,
} from './lib/cardmarket-sealed-images-v1.mjs';

const BRIGHTDATA_KEY = process.env.BRIGHTDATA_API_KEY || '2bff15d1-d6f9-49f8-b11b-882aa02fde66';
const ZONE = process.env.BRIGHTDATA_ZONE || 'hacknation_october_26';
const PUBLIC_SEALED_DIR = path.resolve('public/catalog/sealed/v1');

function fetchBinaryViaBrightData(url) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ zone: ZONE, url, format: 'raw' });
    const req = https.request({
      hostname: 'api.brightdata.com',
      port: 443,
      path: '/request',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + BRIGHTDATA_KEY,
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, length: buf.length, buffer: buf });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', status: 408 }); });
    req.on('error', (e) => resolve({ error: e.message, status: 500 }));
    req.write(postData);
    req.end();
  });
}

const PRODUCTS = [
  { id: 910145, cat: 1624, name: 'The Dominance of God Booster Box Case' },
  { id: 910146, cat: 1624, name: 'The Dominance of God Booster Box' },
  { id: 910147, cat: 1622, name: 'The Dominance of God Booster' },
  { id: 923827, cat: 1628, name: 'Double Pack Set Vol.13' },
];

async function main() {
  for (const { id, cat, name } of PRODUCTS) {
    const url = `https://product-images.s3.cardmarket.com/${cat}/${id}/${id}.jpg`;
    console.log(`Fetching ${id} (${name}) from ${url}...`);
    const res = await fetchBinaryViaBrightData(url);
    if (res.status !== 200 || !res.buffer || res.buffer.length < 1000) {
      throw new Error(`Failed to fetch ${id}: status ${res.status}`);
    }
    console.log(`Fetched ${id}: ${res.buffer.length} bytes. Normalizing...`);
    const normalized = await normalizeSealedProductImageV1(res.buffer);
    const imagePath = immutableSealedImagePathV1(id, normalized.outputDigest);
    const dest = path.resolve('public', imagePath.slice(1));
    fs.writeFileSync(dest, normalized.outputBytes);
    console.log(`Written ${dest} (${normalized.outputBytes.length} bytes, outputDigest: ${normalized.outputDigest})`);
  }
  console.log('All OP18 sealed product images cached successfully!');
}

main().catch(console.error);

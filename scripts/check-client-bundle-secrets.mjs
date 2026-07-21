import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIRECTORY = fileURLToPath(new URL('../dist/', import.meta.url));
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map']);

async function textFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(path);
    return TEXT_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}

function jwtRole(token) {
  try {
    const [, payload] = token.split('.');
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof value.role === 'string' ? value.role : null;
  } catch {
    return null;
  }
}

for (const path of await textFiles(DIST_DIRECTORY)) {
  const bundle = await readFile(path, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]+/.test(bundle)) {
    throw new Error(`Unsafe Supabase secret key detected in client bundle: ${path}`);
  }
  const jwtCandidates = bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? [];
  if (jwtCandidates.some((token) => jwtRole(token) === 'service_role')) {
    throw new Error(`Unsafe Supabase service-role JWT detected in client bundle: ${path}`);
  }
}

console.log('Client bundle secret scan passed.');

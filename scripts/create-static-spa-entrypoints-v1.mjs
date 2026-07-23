import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATIC_SPA_ENTRYPOINT_ROUTES_V1 = Object.freeze(['/cards', '/stores']);

export function staticSpaEntrypointPathV1(route) {
  const normalized = String(route ?? '').trim();
  if (!/^\/[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(normalized)) {
    throw new Error(`Unsafe static SPA entrypoint route: ${String(route)}.`);
  }
  return `${normalized.slice(1)}/index.html`;
}

export async function createStaticSpaEntrypointsV1({
  outputDirectory = resolve('dist'),
  routes = STATIC_SPA_ENTRYPOINT_ROUTES_V1,
} = {}) {
  const source = resolve(outputDirectory, 'index.html');
  const created = [];

  for (const route of routes) {
    const relativeDestination = staticSpaEntrypointPathV1(route);
    const destination = resolve(outputDirectory, relativeDestination);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(source, destination);
    created.push(relativeDestination.replaceAll('\\', '/'));
  }

  return Object.freeze(created);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  const created = await createStaticSpaEntrypointsV1();
  console.log(`Created static SPA entrypoint${created.length === 1 ? '' : 's'}: ${created.join(', ')}`);
}

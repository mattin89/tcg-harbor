import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PUBLIC_SITE_ORIGIN_V1 = 'https://tcg-harbor.onrender.com';

export const PUBLIC_CANONICAL_PATHS_V1 = Object.freeze([
  '/cards',
  '/stores',
]);

export const PRIVATE_ROUTE_PREFIXES_V1 = Object.freeze([
  '/dashboard',
  '/collection',
  '/market-comparison',
  '/communities',
  '/messages',
  '/settings',
  '/store-admin',
  '/scan',
  '/join',
  '/signin',
]);

export const SEARCH_DISCOVERY_AGENTS_V1 = Object.freeze([
  'OAI-SearchBot',
  'Claude-SearchBot',
]);

export const RESTRICTED_AI_AGENTS_V1 = Object.freeze([
  'GPTBot',
  'Claude-Web',
  'ClaudeBot',
  'Google-Extended',
  'Amazonbot',
  'anthropic-ai',
  'Bytespider',
  'CCBot',
  'Applebot-Extended',
  'meta-externalagent',
]);

export const PUBLIC_AGENT_SKILL_V1 = Object.freeze({
  name: 'browse-tcg-harbor',
  type: 'skill-md',
  relativePath: '/.well-known/agent-skills/browse-tcg-harbor/SKILL.md',
});

export function normalizePublicSiteOriginV1(value = DEFAULT_PUBLIC_SITE_ORIGIN_V1) {
  const url = new URL(String(value).trim());
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw new Error('PUBLIC_SITE_ORIGIN must use HTTPS outside local development.');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error('PUBLIC_SITE_ORIGIN must be an origin without credentials, path, query, or fragment.');
  }
  return url.origin;
}

function routeRulesV1() {
  return [
    ...PUBLIC_CANONICAL_PATHS_V1.map((path) => `Allow: ${path}`),
    ...PRIVATE_ROUTE_PREFIXES_V1.map((path) => `Disallow: ${path}`),
  ].join('\n');
}

export function renderRobotsTxtV1(origin = DEFAULT_PUBLIC_SITE_ORIGIN_V1) {
  const normalizedOrigin = normalizePublicSiteOriginV1(origin);
  const publicRules = routeRulesV1();
  const contentSignal = 'Content-Signal: ai-train=no, search=yes, ai-input=yes';

  return [
    '# TCG Harbor public discovery policy.',
    '# robots.txt controls crawler access; authenticated routes remain server-protected.',
    'User-agent: *',
    publicRules,
    contentSignal,
    '',
    '# Search discovery is allowed for public cards and approved stores.',
    ...SEARCH_DISCOVERY_AGENTS_V1.map((agent) => `User-agent: ${agent}`),
    publicRules,
    contentSignal,
    '',
    '# Automated model-training and bulk AI corpus crawlers are not permitted.',
    ...RESTRICTED_AI_AGENTS_V1.map((agent) => `User-agent: ${agent}`),
    'Disallow: /',
    'Content-Signal: ai-train=no, search=no, ai-input=no',
    '',
    `Sitemap: ${normalizedOrigin}/sitemap.xml`,
    '',
  ].join('\n');
}

export function renderSitemapXmlV1(origin = DEFAULT_PUBLIC_SITE_ORIGIN_V1) {
  const normalizedOrigin = normalizePublicSiteOriginV1(origin);
  const entries = PUBLIC_CANONICAL_PATHS_V1
    .map((path) => `  <url>\n    <loc>${normalizedOrigin}${path}</loc>\n  </url>`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    '',
  ].join('\n');
}

export function renderAgentSkillsIndexV1({
  origin = DEFAULT_PUBLIC_SITE_ORIGIN_V1,
  skillContents,
} = {}) {
  if (typeof skillContents !== 'string' || !skillContents.trim()) {
    throw new Error('A non-empty SKILL.md is required to generate the discovery index.');
  }
  const normalizedOrigin = normalizePublicSiteOriginV1(origin);
  const digest = createHash('sha256').update(skillContents, 'utf8').digest('hex');
  const frontmatter = skillContents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const skillName = frontmatter?.[1].match(/^name:\s*(.+?)\s*$/m)?.[1];
  const description = frontmatter?.[1].match(/^description:\s*(.+?)\s*$/m)?.[1];
  if (skillName !== PUBLIC_AGENT_SKILL_V1.name || !description) {
    throw new Error('SKILL.md frontmatter must include the expected name and a description.');
  }

  return `${JSON.stringify({
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [{
      name: PUBLIC_AGENT_SKILL_V1.name,
      type: PUBLIC_AGENT_SKILL_V1.type,
      description,
      url: `${normalizedOrigin}${PUBLIC_AGENT_SKILL_V1.relativePath}`,
      digest: `sha256:${digest}`,
    }],
  }, null, 2)}\n`;
}

async function writeIfChangedV1(filePath, contents) {
  let existing = null;
  try {
    existing = await readFile(filePath, 'utf8');
  } catch (reason) {
    if (reason?.code !== 'ENOENT') throw reason;
  }
  if (existing === contents) return false;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
  return true;
}

export async function generatePublicDiscoveryV1({
  publicDirectory = resolve('public'),
  origin = process.env.PUBLIC_SITE_ORIGIN ?? DEFAULT_PUBLIC_SITE_ORIGIN_V1,
} = {}) {
  const normalizedOrigin = normalizePublicSiteOriginV1(origin);
  const skillPath = resolve(
    publicDirectory,
    PUBLIC_AGENT_SKILL_V1.relativePath.replace(/^\//, ''),
  );
  const skillContents = await readFile(skillPath, 'utf8');
  const outputs = [
    ['robots.txt', renderRobotsTxtV1(normalizedOrigin)],
    ['sitemap.xml', renderSitemapXmlV1(normalizedOrigin)],
    [
      '.well-known/agent-skills/index.json',
      renderAgentSkillsIndexV1({ origin: normalizedOrigin, skillContents }),
    ],
  ];

  const changed = [];
  for (const [relativePath, contents] of outputs) {
    if (await writeIfChangedV1(resolve(publicDirectory, relativePath), contents)) {
      changed.push(relativePath);
    }
  }
  return Object.freeze(changed);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  const changed = await generatePublicDiscoveryV1();
  console.log(changed.length
    ? `Generated public discovery files: ${changed.join(', ')}`
    : 'Public discovery files are already current.');
}

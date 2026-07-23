import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLIC_SITE_ORIGIN_V1,
  PRIVATE_ROUTE_PREFIXES_V1,
  PUBLIC_AGENT_SKILL_V1,
  PUBLIC_CANONICAL_PATHS_V1,
  RESTRICTED_AI_AGENTS_V1,
  SEARCH_DISCOVERY_AGENTS_V1,
  normalizePublicSiteOriginV1,
  renderAgentSkillsIndexV1,
  renderRobotsTxtV1,
  renderSitemapXmlV1,
} from '../../scripts/generate-public-discovery-v1.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicRoot = resolve(repositoryRoot, 'public');

describe('public discovery v1', () => {
  it('keeps generated robots and sitemap files synchronized with the route policy', async () => {
    const robots = await readFile(resolve(publicRoot, 'robots.txt'), 'utf8');
    const sitemap = await readFile(resolve(publicRoot, 'sitemap.xml'), 'utf8');

    expect(robots).toBe(renderRobotsTxtV1());
    expect(sitemap).toBe(renderSitemapXmlV1());
    expect(robots).toContain(`Sitemap: ${DEFAULT_PUBLIC_SITE_ORIGIN_V1}/sitemap.xml`);
    expect(robots).toContain('Content-Signal: ai-train=no, search=yes, ai-input=yes');

    for (const agent of [...SEARCH_DISCOVERY_AGENTS_V1, ...RESTRICTED_AI_AGENTS_V1]) {
      expect(robots).toContain(`User-agent: ${agent}`);
    }
    for (const path of PRIVATE_ROUTE_PREFIXES_V1) {
      expect(robots).toContain(`Disallow: ${path}`);
      expect(sitemap).not.toContain(path);
    }
  });

  it('accepts HTTPS origins and HTTP loopback development origins only', () => {
    expect(normalizePublicSiteOriginV1('https://example.com')).toBe('https://example.com');
    expect(normalizePublicSiteOriginV1('http://localhost:4173')).toBe('http://localhost:4173');
    expect(normalizePublicSiteOriginV1('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
    expect(() => normalizePublicSiteOriginV1('http://example.com')).toThrow(/HTTPS/);
    expect(() => normalizePublicSiteOriginV1('ftp://localhost')).toThrow(/HTTPS/);
    expect(() => normalizePublicSiteOriginV1('ws://127.0.0.1')).toThrow(/HTTPS/);
  });

  it('lists only stable public canonical URLs without queries, fragments, or trailing slashes', async () => {
    const sitemap = await readFile(resolve(publicRoot, 'sitemap.xml'), 'utf8');
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

    expect(locations).toEqual(
      PUBLIC_CANONICAL_PATHS_V1.map((path) => `${DEFAULT_PUBLIC_SITE_ORIGIN_V1}${path}`),
    );
    expect(locations.every((location) => location.startsWith('https://'))).toBe(true);
    expect(locations.every((location) => !/[?#]/.test(location) && !location.endsWith('/'))).toBe(true);
  });

  it('publishes one real skill with a digest of the served SKILL.md', async () => {
    const skillPath = resolve(
      publicRoot,
      PUBLIC_AGENT_SKILL_V1.relativePath.replace(/^\//, ''),
    );
    const skillContents = await readFile(skillPath, 'utf8');
    const indexContents = await readFile(
      resolve(publicRoot, '.well-known/agent-skills/index.json'),
      'utf8',
    );
    const index = JSON.parse(indexContents);

    expect(indexContents).toBe(renderAgentSkillsIndexV1({ skillContents }));
    expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');
    expect(index.skills).toHaveLength(1);
    expect(index.skills[0]).toMatchObject({
      name: PUBLIC_AGENT_SKILL_V1.name,
      type: 'skill-md',
      description: skillContents.match(/^description:\s*(.+?)\s*$/m)?.[1],
      url: `${DEFAULT_PUBLIC_SITE_ORIGIN_V1}${PUBLIC_AGENT_SKILL_V1.relativePath}`,
      digest: `sha256:${createHash('sha256').update(skillContents, 'utf8').digest('hex')}`,
    });
  });
});

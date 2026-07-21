import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const productionRoot = readFileSync(
  new URL('../ProductionApp_v2.tsx', import.meta.url),
  'utf8',
);

describe('production identity isolation', () => {
  it('remounts all account-shaped in-memory UI state when auth identity changes', () => {
    expect(productionRoot).toContain('<App key={identity.profile.id} identity={{');
  });
});

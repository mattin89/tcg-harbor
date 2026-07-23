import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const hook = readFileSync(
  new URL('../services/supabase/useProductionActivityV3.ts', import.meta.url),
  'utf8',
);

describe('recent activity app wiring v3', () => {
  it('uses the owner-scoped production feed instead of the empty account seed', () => {
    expect(app).toContain(
      'const productionActivity = useProductionActivityV3(Boolean(identity), identity?.userId);',
    );
    expect(app).toContain(
      'activity={identity ? productionActivity.activities : accountSeeds.recentActivity}',
    );
    expect(app).toContain(
      'activityLoading={Boolean(identity) && productionActivity.loading}',
    );
    expect(app).toContain('activityError={identity ? productionActivity.error : null}');
  });

  it('refreshes activity after committed production collection mutations', () => {
    expect(app.match(/await onCollectionMutationCommitted\?\.\(\);/g)?.length)
      .toBeGreaterThanOrEqual(4);
    expect(app.match(
      /onCollectionMutationCommitted=\{identity \? productionActivity\.refresh : undefined\}/g,
    )?.length).toBe(3);
    expect(app).toContain("if (identity && path === '/' && previousPath !== '/')");
    expect(app).toContain('void productionActivity.refresh();');
  });

  it('clears and owner-gates activity when authentication changes', () => {
    expect(hook).toContain('activeOwnerRef.current = enabled ? ownerId ?? null : null;');
    expect(hook).toContain('setSnapshot(null);');
    expect(hook).toContain('activitiesForOwnerV3(snapshot, activeOwnerId)');
  });
});

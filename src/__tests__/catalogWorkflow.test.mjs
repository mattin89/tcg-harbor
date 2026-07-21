import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowUrl = new URL('../../.github/workflows/sync-onepiece-catalog.yml', import.meta.url);

describe('daily catalog workflow', () => {
  it('ingests only after preparing a commit and checking the default-branch base', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const prepareIndex = workflow.indexOf('name: Prepare the verified snapshot commit');
    const guardIndex = workflow.indexOf('name: Verify the default branch has not moved');
    const ingestIndex = workflow.indexOf('name: Ingest the verified snapshot into Supabase');
    const publishIndex = workflow.indexOf('name: Publish the ingested snapshot');

    expect(workflow).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflow).toContain('git push origin "HEAD:${DEFAULT_BRANCH}"');
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(prepareIndex);
    expect(ingestIndex).toBeGreaterThan(guardIndex);
    expect(publishIndex).toBeGreaterThan(ingestIndex);
    expect(workflow.slice(0, ingestIndex)).not.toContain('git push origin');
    expect(workflow.slice(guardIndex, publishIndex)).not.toContain('continue-on-error');
  });

  it('requires the encrypted Supabase environment for ingestion', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const ingestIndex = workflow.indexOf('name: Ingest the verified snapshot into Supabase');
    const ingestStep = workflow.slice(ingestIndex);

    expect(ingestStep).toContain('run: npm run sync:ingest');
    expect(ingestStep).toContain('SUPABASE_URL: ${{ secrets.SUPABASE_URL }}');
    expect(ingestStep).toContain('SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}');
  });
});

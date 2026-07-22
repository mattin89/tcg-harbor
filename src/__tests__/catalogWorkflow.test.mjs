import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowUrl = new URL('../../.github/workflows/sync-onepiece-catalog.yml', import.meta.url);

describe('daily catalog workflow', () => {
  it('ingests only after preparing a commit and checking the default-branch base', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const preflightIndex = workflow.indexOf('name: Validate publication context and secrets');
    const prepareIndex = workflow.indexOf('name: Prepare the verified snapshot commit');
    const guardIndex = workflow.indexOf('name: Verify the default branch has not moved');
    const ingestIndex = workflow.indexOf('name: Ingest the verified snapshot into Supabase');
    const finalGuardIndex = workflow.indexOf('name: Recheck the default branch before publication');
    const publishIndex = workflow.indexOf('name: Publish the ingested snapshot');

    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).toContain('uses: actions/checkout@v7');
    expect(workflow).toContain('uses: actions/setup-node@v6');
    expect(workflow).toContain("SHOULD_PUBLISH: ${{ github.event_name == 'schedule' || inputs.publish == true }}");
    expect(workflow).toContain("ref: ${{ github.event_name == 'schedule' && github.event.repository.default_branch || github.ref }}");
    expect(workflow).toContain('git push origin "HEAD:${DEFAULT_BRANCH}"');
    expect(preflightIndex).toBeGreaterThan(-1);
    expect(prepareIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(prepareIndex);
    expect(ingestIndex).toBeGreaterThan(guardIndex);
    expect(finalGuardIndex).toBeGreaterThan(ingestIndex);
    expect(publishIndex).toBeGreaterThan(finalGuardIndex);
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
    expect(workflow).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(workflow).toContain('title=Missing required Actions secrets');
  });

  it('supports a non-publishing manual verification and preserves actionable failures', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');

    expect(workflow).toMatch(/workflow_dispatch:\s+inputs:\s+publish:[\s\S]*?default: false[\s\S]*?type: boolean/);
    expect(workflow).toContain('id: refresh');
    expect(workflow).toContain('name: Record safe failure details');
    expect(workflow).toContain('if: ${{ failure() }}');
    expect(workflow).toContain('No unverified snapshot was pushed.');
    expect(workflow).not.toContain('continue-on-error');
  });
});

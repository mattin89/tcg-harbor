import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowUrl = new URL('../../.github/workflows/sync-onepiece-catalog.yml', import.meta.url);
const syncUrl = new URL('../../scripts/sync-onepiece-data-v10.mjs', import.meta.url);

const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_SHA = '249970729cb0ef3589644e2896645e5dc5ba9c38';
const UPLOAD_ARTIFACT_SHA = '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';
const DOWNLOAD_ARTIFACT_SHA = '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c';

function workflowJobs(workflow) {
  const verifyIndex = workflow.indexOf('\n  verify:');
  const ingestIndex = workflow.indexOf('\n  ingest:');
  const pushIndex = workflow.indexOf('\n  push:');
  expect(verifyIndex).toBeGreaterThan(-1);
  expect(ingestIndex).toBeGreaterThan(verifyIndex);
  expect(pushIndex).toBeGreaterThan(ingestIndex);
  return {
    verify: workflow.slice(verifyIndex, ingestIndex),
    ingest: workflow.slice(ingestIndex, pushIndex),
    push: workflow.slice(pushIndex),
  };
}

function minuteBudget(source, constantName) {
  const match = source.match(new RegExp(`const ${constantName} = (\\d+) \\* 60_000;`));
  expect(match, `Missing minute budget ${constantName}`).not.toBeNull();
  return Number(match[1]);
}

function dayBudget(source, constantName) {
  const match = source.match(new RegExp(`const ${constantName} = (\\d+) \\* 24 \\* 60 \\* 60_000;`));
  expect(match, `Missing day budget ${constantName}`).not.toBeNull();
  return Number(match[1]);
}

describe('daily catalog workflow', () => {
  it('isolates verification and ingestion from the token-only push job', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const jobs = workflowJobs(workflow);

    expect(workflow).toContain('permissions: {}');
    expect(jobs.verify).toMatch(/permissions:\s+contents: read/);
    expect(jobs.ingest).toContain('permissions: {}');
    expect(jobs.push).toMatch(/permissions:\s+contents: write/);
    expect(jobs.verify).toContain('timeout-minutes: 40');
    expect(jobs.ingest).toContain('timeout-minutes: 15');
    expect(jobs.push).toContain('timeout-minutes: 10');
    expect(jobs.ingest).toContain('needs: verify');
    expect(jobs.ingest).toContain("needs.verify.outputs.should_publish == 'true'");
    expect(jobs.push).toContain('needs: [verify, ingest]');
    expect(jobs.push).toContain("needs.ingest.outputs.changed == 'true'");

    expect(jobs.verify).toContain('run: npm run sync:data');
    expect(jobs.verify).toContain('run: npm test');
    expect(jobs.verify).toContain('run: npm run build');
    expect(jobs.ingest).toContain('run: npm ci --ignore-scripts');
    expect(jobs.ingest).not.toMatch(/^\s*run:\s*npm ci\s*$/m);
    expect([...jobs.ingest.matchAll(/^\s*run:\s*(npm ci[^\r\n]*)$/gm)].map((match) => match[1])).toEqual([
      'npm ci --ignore-scripts',
    ]);
    expect(jobs.ingest).toContain('run: npm run sync:ingest');
    expect(jobs.push).not.toMatch(/\bnpm\b/);
    expect(jobs.push).not.toMatch(/\bnode\b/);
    expect(jobs.push).not.toContain('actions/checkout@');
    expect(jobs.push).not.toContain('actions/setup-node@');
    expect([...jobs.push.matchAll(/^\s*uses:\s+(\S+)/gm)].map((match) => match[1])).toEqual([
      `actions/download-artifact@${DOWNLOAD_ARTIFACT_SHA}`,
    ]);
    expect(jobs.push).not.toMatch(/^\s*run:\s*(?:\.\/|node|npm|npx|pnpm|yarn|bun)\b/m);
    expect(jobs.verify).not.toContain('contents: write');
    expect(jobs.ingest).not.toContain('contents: write');
    expect(jobs.verify).not.toContain('GITHUB_TOKEN');
    expect(jobs.ingest).not.toContain('GITHUB_TOKEN');

    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).not.toContain('persist-credentials: true');
    expect(workflow.match(/GITHUB_TOKEN:/g)).toHaveLength(1);
    expect(workflow.match(/\$\{\{ github\.token \}\}/g)).toHaveLength(1);
    expect(jobs.push.indexOf('GITHUB_TOKEN:')).toBeGreaterThan(
      jobs.push.indexOf('name: Push the independently validated catalog commit'),
    );
  });

  it('pins every third-party action to an immutable reviewed commit', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');

    expect(workflow).toContain(`uses: actions/checkout@${CHECKOUT_SHA}`);
    expect(workflow.match(new RegExp(`uses: actions/setup-node@${SETUP_NODE_SHA}`, 'g'))).toHaveLength(2);
    expect(workflow.match(new RegExp(`uses: actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`, 'g'))).toHaveLength(2);
    expect(workflow.match(new RegExp(`uses: actions/download-artifact@${DOWNLOAD_ARTIFACT_SHA}`, 'g'))).toHaveLength(2);
    expect(workflow).not.toMatch(/uses: actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@v\d/);
  });

  it('publishes only a checksummed deterministic artifact from the verified base', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const jobs = workflowJobs(workflow);

    expect(jobs.verify).toContain('name: Package the deterministic verified catalog artifact');
    expect(jobs.verify).toContain('--sort=name');
    expect(jobs.verify).toContain("--mtime='@0'");
    expect(jobs.verify).toContain('--owner=0');
    expect(jobs.verify).toContain('--group=0');
    expect(jobs.verify).toContain('--numeric-owner');
    expect(jobs.verify).toContain('--format=ustar');
    expect(jobs.verify).toContain('ARCHIVE_SHA256="$(sha256sum "${ARCHIVE}"');
    expect(jobs.verify).toContain('src/data/generated/onepiece-market-v10.json');
    expect(jobs.verify).toContain('scripts/data/optcg-source-cache-v1.json');
    expect(jobs.verify).toContain('public/catalog/sealed/v1');
    expect(jobs.verify).toContain(`actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`);

    const downloadIndex = jobs.ingest.indexOf('name: Download the verified catalog artifact');
    const checksumIndex = jobs.ingest.indexOf('sha256sum --check verified-onepiece-catalog.tar.sha256');
    const checkoutIndex = jobs.ingest.indexOf('name: Check out the verified default-branch base without credentials');
    const applyIndex = jobs.ingest.indexOf('name: Reverify and apply only the verified catalog artifact');
    const prepareIndex = jobs.ingest.indexOf('name: Prepare the verified snapshot commit');
    expect(downloadIndex).toBeGreaterThan(-1);
    expect(checksumIndex).toBeGreaterThan(downloadIndex);
    expect(checkoutIndex).toBeGreaterThan(checksumIndex);
    expect(applyIndex).toBeGreaterThan(checkoutIndex);
    expect(prepareIndex).toBeGreaterThan(applyIndex);
    expect(jobs.ingest).toContain('git remote add origin "https://github.com/${GITHUB_REPOSITORY}.git"');
    expect(jobs.ingest).toContain('REMOTE_SHA="$(git rev-parse FETCH_HEAD)"');
    expect(jobs.ingest).toContain('if [[ "${REMOTE_SHA}" != "${BASE_SHA}" ]]');
    expect(jobs.ingest).toContain('EXPECTED_ARCHIVE_SHA256: ${{ needs.verify.outputs.archive_sha256 }}');
    expect(jobs.ingest).toContain('verified-catalog-tree-after-install');
    expect(jobs.ingest).toContain('diff --recursive --no-dereference');
  });

  it('passes a narrow one-commit bundle across the credential boundary', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const jobs = workflowJobs(workflow);
    const prepareIndex = jobs.ingest.indexOf('name: Prepare the verified snapshot commit');
    const guardIndex = jobs.ingest.indexOf('name: Verify the default branch has not moved');
    const ingestIndex = jobs.ingest.indexOf('name: Ingest the verified snapshot into Supabase');
    const integrityIndex = jobs.ingest.indexOf('name: Verify ingestion did not mutate the committed snapshot');
    const finalGuardIndex = jobs.ingest.indexOf('name: Recheck the default branch before publication');
    const packageIndex = jobs.ingest.indexOf('name: Package the ingested catalog commit');
    const uploadIndex = jobs.ingest.indexOf('name: Upload the narrow publication artifact');
    const validateIndex = jobs.push.indexOf('name: Validate the commit, tree, paths, and verified catalog payload');
    const pushIndex = jobs.push.indexOf('name: Push the independently validated catalog commit');

    expect(prepareIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(prepareIndex);
    expect(ingestIndex).toBeGreaterThan(guardIndex);
    expect(integrityIndex).toBeGreaterThan(ingestIndex);
    expect(finalGuardIndex).toBeGreaterThan(integrityIndex);
    expect(packageIndex).toBeGreaterThan(finalGuardIndex);
    expect(uploadIndex).toBeGreaterThan(packageIndex);
    expect(validateIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(validateIndex);

    expect(jobs.ingest).toContain('git bundle create "${BUNDLE}" refs/heads/catalog-publication "^${BASE_SHA}"');
    expect(jobs.ingest).toContain('catalog-publication.manifest');
    expect(jobs.ingest).toContain('base_sha: ${{ steps.package_publication.outputs.base_sha }}');
    expect(jobs.ingest).toContain('echo "base_sha=${BASE_SHA}" >> "$GITHUB_OUTPUT"');
    expect(jobs.ingest).toContain('verified_catalog_sha256=${VERIFIED_CATALOG_SHA256}');
    expect(jobs.ingest).toContain(`actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`);
    expect(jobs.push).toContain(`actions/download-artifact@${DOWNLOAD_ARTIFACT_SHA}`);

    expect(jobs.push.slice(0, pushIndex)).not.toContain('GITHUB_TOKEN:');
    expect(jobs.push.slice(0, pushIndex)).not.toContain('push "${TARGET_URL}"');
    expect(jobs.push.slice(pushIndex)).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(jobs.push.slice(pushIndex)).toContain('push "${TARGET_URL}" "${PUBLISH_SHA}:refs/heads/${DEFAULT_BRANCH}"');
    expect(jobs.push.slice(pushIndex)).toContain('-c core.hooksPath=/dev/null');
    expect(jobs.push.slice(pushIndex)).toContain('-c credential.helper=');
    expect(jobs.push.slice(pushIndex)).toContain('GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git');
    expect(jobs.ingest.slice(guardIndex)).not.toContain('continue-on-error');
    expect(jobs.push).not.toContain('continue-on-error');
  });

  it('independently validates the base, tree, allowlisted paths, and verified payload before push', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const { push } = workflowJobs(workflow);

    expect(push).toContain('sha256sum --check catalog-publication.sha256');
    expect(push).toContain('BASE_SHA: ${{ needs.ingest.outputs.base_sha }}');
    expect(push).toContain('VERIFIED_BASE_SHA: ${{ needs.verify.outputs.base_sha }}');
    expect(push).toContain('"${BASE_SHA}" != "${VERIFIED_BASE_SHA}"');
    expect(push).toContain('bundle verify "${BUNDLE}"');
    expect(push).toContain('bundle list-heads "${BUNDLE}"');
    expect(push).toContain('REMOTE_SHA="$(git rev-parse FETCH_HEAD)"');
    expect(push).toContain('"$(git rev-parse "${PUBLISH_SHA}^{tree}")" != "${PUBLISH_TREE_SHA}"');
    expect(push).toContain('"$(git rev-parse "${PUBLISH_SHA}^")" != "${BASE_SHA}"');
    expect(push).toContain('git diff --no-renames --name-only -z "${BASE_SHA}" "${PUBLISH_SHA}"');
    expect(push).toContain('src/data/generated/onepiece-market-v10.json|scripts/data/optcg-source-cache-v1.json');
    expect(push).toContain('^public/catalog/sealed/v1/[0-9]+-[0-9a-f]{12}\\.webp$');
    expect(push).toContain("${mode}\" != '100644'");
    expect(push).toContain('git archive "${PUBLISH_SHA}"');
    expect(push).toContain("--mtime='@0'");
    expect(push).toContain('Catalog payload mismatch');
    expect(push.indexOf('Catalog payload mismatch')).toBeLessThan(
      push.indexOf('name: Push the independently validated catalog commit'),
    );
  });

  it('requires the encrypted Supabase environment only for preflight and ingestion', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const jobs = workflowJobs(workflow);
    const ingestIndex = jobs.ingest.indexOf('name: Ingest the verified snapshot into Supabase');
    const ingestStep = jobs.ingest.slice(ingestIndex);

    expect(ingestStep).toContain('run: npm run sync:ingest');
    expect(ingestStep).toContain('SUPABASE_URL: ${{ secrets.SUPABASE_URL }}');
    expect(ingestStep).toContain('SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}');
    expect(workflow.match(/SUPABASE_URL: \$\{\{ secrets\.SUPABASE_URL \}\}/g)).toHaveLength(2);
    expect(workflow.match(/SUPABASE_SECRET_KEY: \$\{\{ secrets\.SUPABASE_SECRET_KEY \}\}/g)).toHaveLength(2);
    expect(workflow).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(workflow).toContain('title=Missing required Actions secrets');
  });

  it('supports non-publishing manual verification and preserves actionable failures', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const jobs = workflowJobs(workflow);

    expect(workflow).toMatch(/workflow_dispatch:\s+inputs:\s+publish:[\s\S]*?default: false[\s\S]*?type: boolean/);
    expect(jobs.verify).toContain("SHOULD_PUBLISH: ${{ github.event_name == 'schedule' || inputs.publish == true }}");
    expect(jobs.verify).toContain('id: refresh');
    expect(jobs.verify).toContain('name: Record safe verification failure details');
    expect(jobs.ingest).toContain('name: Record safe ingestion failure details');
    expect(jobs.push).toContain('name: Record safe push failure details');
    expect(workflow.match(/if: \$\{\{ failure\(\) \}\}/g)).toHaveLength(3);
    expect(workflow).toContain('No unverified snapshot was ingested or pushed.');
    expect(workflow).toContain('No unverified snapshot was pushed.');
    expect(workflow).toContain('No publication token was available and no commit was pushed.');
    expect(workflow).not.toContain('continue-on-error');
  });

  it('leaves bounded headroom for discovery retries and transient evidence grace', async () => {
    const [workflow, sync] = await Promise.all([
      readFile(workflowUrl, 'utf8'),
      readFile(syncUrl, 'utf8'),
    ]);
    const jobs = workflowJobs(workflow);
    const artworkMinutes = minuteBudget(sync, 'ARTWORK_DISCOVERY_BUDGET_MS_V9');
    const sealedMinutes = minuteBudget(sync, 'SEALED_IMAGE_DISCOVERY_BUDGET_MS_V10');
    const artworkMaxAgeDays = dayBudget(sync, 'ARTWORK_EVIDENCE_MAX_AGE_MS_V10');
    const artworkGraceDays = dayBudget(sync, 'ARTWORK_EVIDENCE_TRANSIENT_GRACE_MS_V10');
    const sealedMaxAgeDays = dayBudget(sync, 'SEALED_IMAGE_MAX_AGE_MS_V10');
    const sealedGraceDays = dayBudget(sync, 'SEALED_IMAGE_TRANSIENT_GRACE_MS_V10');
    const workflowTimeout = Number(jobs.verify.match(/timeout-minutes: (\d+)/)?.[1]);

    expect(artworkMinutes + sealedMinutes).toBe(13);
    expect(workflowTimeout).toBeGreaterThanOrEqual(artworkMinutes + sealedMinutes + 20);
    expect(sync).toContain('const ARTWORK_IMAGE_TIMEOUT_MS_V9 = 6_000;');
    expect(sync).toContain('const OFFICIAL_ARTWORK_IMAGE_TIMEOUT_MS_V10 = 30_000;');
    expect(sync).toContain('const ARTWORK_IMAGE_MAX_ATTEMPTS_V10 = 3;');
    expect(sync).toContain('attempt <= ARTWORK_IMAGE_MAX_ATTEMPTS_V10');
    expect(sync).toContain('500 * (2 ** (attempt - 1))');
    expect(artworkMaxAgeDays).toBe(14);
    expect(artworkGraceDays).toBe(21);
    expect(sealedMaxAgeDays).toBe(14);
    expect(sealedGraceDays).toBe(21);
    expect(artworkGraceDays).toBeGreaterThan(artworkMaxAgeDays);
    expect(sealedGraceDays).toBeGreaterThan(sealedMaxAgeDays);
    expect(sync).toContain('Date.now() >= artworkDiscoveryDeadlineV10');
    expect(sync).toContain('Date.now() >= sealedImageDiscoveryDeadlineV10');
    expect(sync).toContain('const IMAGE_REFRESH_BUCKETS_V10 = 7;');
  });
});

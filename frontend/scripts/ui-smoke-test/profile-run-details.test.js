// Copyright 2026 The Kubeflow Authors
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright');

const baseURL = process.env.PROFILE_UI_URL || 'http://127.0.0.1:3000';
const runId = process.env.PROFILE_RUN_ID;
const runPath = '/apis/v2beta1/runs/' + encodeURIComponent(runId);
let browser;

before(async () => {
  assert.ok(runId && process.env.PROFILE_OWNER && process.env.PROFILE_FOREIGN, 'Missing run fixture');
  assert.notEqual(process.env.PROFILE_OWNER, process.env.PROFILE_FOREIGN);
  browser = await chromium.launch();
});
after(async () => browser?.close());

async function openRun(t, identity) {
  // CI port-forwards the multi-user frontend and supplies the identity normally set by ingress.
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'kubeflow-userid': identity } });
  t.after(() => context.close());
  const page = await context.newPage();
  const [response] = await Promise.all([
    page.waitForResponse(res => new URL(res.url()).pathname === runPath && res.request().method() === 'GET'),
    page.goto('/#/runs/details/' + encodeURIComponent(runId)),
  ]);
  return { page, response };
}

test('the profile owner sees the completed producer and its live output', async t => {
  const { page, response } = await openRun(t, process.env.PROFILE_OWNER);
  assert.equal(response.status(), 200);

  // A static pipeline graph contains both names even when every metadata lookup fails.
  const liveOutput = page.getByTitle('output_gcs', { exact: true }).getByTestId('artifact-icon-live');
  const metadataError = page.getByText('Cannot get MLMD objects from Metadata store.', { exact: true });
  await liveOutput.or(metadataError).first().waitFor({ timeout: 60000 });
  assert.equal(await metadataError.isVisible(), false, 'Run Details could not load the owner’s metadata');
  await liveOutput.waitFor();

  await page.getByTitle('component1', { exact: true }).getByRole('button').click();
  await page.getByRole('button', { name: 'Task Details', exact: true }).click();
  await page.getByText('Complete', { exact: true }).waitFor();
});

test('another profile cannot open the same run', async t => {
  const { page, response } = await openRun(t, process.env.PROFILE_FOREIGN);
  assert.ok([403, 404].includes(response.status()), 'Expected a denied run read, got ' + response.status());
  const runtime = await page.request.get(runPath + '/runtime');
  assert.ok([403, 404].includes(runtime.status()), 'Expected a denied runtime read, got ' + runtime.status());
  await page.getByText('Error: failed to retrieve run: ' + runId + '.').waitFor();
  assert.equal(await page.getByTitle('output_gcs', { exact: true }).count(), 0);
});

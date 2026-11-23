// Copyright 2026 The Kubeflow Authors
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright');

const runId = process.env.PROFILE_RUN_ID;
const namespace = process.env.PROFILE_OWNER_NAMESPACE;
let context;
let browser;

before(async () => {
  assert.ok(runId && namespace && process.env.PROFILE_OWNER);
  browser = await chromium.launch();
  context = await browser.newContext({
    baseURL: 'http://127.0.0.1:3000',
    extraHTTPHeaders: { 'kubeflow-userid': process.env.PROFILE_OWNER },
  });
  // The disposable KFP installation runs outside the central dashboard.
  await context.addInitScript(selected => {
    window.centraldashboard = {
      CentralDashboardEventHandler: {
        init(register) {
          const handler = {};
          register(handler);
          handler.onNamespaceSelected(selected);
        },
      },
    };
  }, namespace);
  await context.route('**/dashboard_lib.bundle.js', route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
});

after(async () => browser?.close());

test('Run Details shows the completed producer and its live dataset', async t => {
  const page = await context.newPage();
  t.after(() => page.close());
  await page.goto('/#/runs/details/' + encodeURIComponent(runId));
  const output = page.getByTitle('output_gcs', { exact: true }).getByTestId('artifact-icon-live');
  await output.waitFor({ timeout: 60000 });
  await page.getByTitle('component1', { exact: true }).getByRole('button').click();
  await page.getByRole('button', { name: 'Task Details', exact: true }).click();
  await page.getByText('Complete', { exact: true }).waitFor();
});

test('Artifacts lists the completed run’s dataset and links to its details', async t => {
  const page = await context.newPage();
  t.after(() => page.close());
  await page.goto('/#/artifacts');
  const row = page.getByTestId('table-row').filter({ hasText: runId });
  await row.waitFor({ timeout: 60000 });
  const uri = new URL(await row.getByText(/^(?:s3|minio|gs):\/\//).innerText());
  assert.ok(uri.pathname.split('/').includes(runId));
  assert.ok(uri.pathname.endsWith('/output_gcs'));
  const artifactId = await row.getAttribute('data-row-id');
  assert.match(artifactId || '', /^[1-9]\d*$/);
  const details = row.getByRole('link', { name: 'output_gcs', exact: true });
  assert.match(await details.getAttribute('href'), new RegExp('/artifacts/' + artifactId + '$'));
});

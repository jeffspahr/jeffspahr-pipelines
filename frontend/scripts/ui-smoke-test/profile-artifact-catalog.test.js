// Copyright 2026 The Kubeflow Authors
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { chromium } = require('playwright');

test('each profile sees only its own fixture dataset in the Artifacts catalog', async t => {
  const profiles = [
    [process.env.PROFILE_OWNER, process.env.PROFILE_OWNER_NAMESPACE, process.env.PROFILE_RUN_ID],
    [process.env.PROFILE_FOREIGN, process.env.PROFILE_FOREIGN_NAMESPACE, process.env.PROFILE_FOREIGN_RUN_ID],
  ];
  for (const profile of profiles) assert.ok(profile.every(Boolean), 'Missing profile catalog fixture');
  for (let i = 0; i < 3; i++) assert.notEqual(profiles[0][i], profiles[1][i]);

  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const [identity, namespace, runId] of profiles) {
    await t.test(namespace, async () => {
      const context = await browser.newContext({
        baseURL: process.env.PROFILE_UI_URL || 'http://127.0.0.1:3000',
        extraHTTPHeaders: { 'kubeflow-userid': identity },
      });
      try {
        // The disposable cluster runs the UI without its enclosing dashboard.
        // Supply the dashboard's selected namespace independently of the identity header.
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
          route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
        );
        const page = await context.newPage();
        await page.goto('/#/artifacts');
        const rows = page.getByTestId('table-row');
        // A fixture's artifact URI contains its unique run ID. Both fixtures use output_gcs.
        const ownRow = rows.filter({ hasText: runId });
        const errorBanner = page.getByRole('link', { name: 'Troubleshooting guide' });
        const empty = page.getByText('No artifacts found.', { exact: true });
        // The catalog can clear the banner after a failed list and then render its empty message.
        // It may also briefly show its empty state on initial mount, before fetching starts.
        await ownRow.or(errorBanner).first().waitFor({ timeout: 60000 }).catch(async error => {
          if (await empty.isVisible()) throw new Error(namespace + ' catalog returned no artifacts for ' + runId);
          throw error;
        });
        if (await errorBanner.isVisible()) {
          throw new Error(namespace + ' catalog error: ' + await errorBanner.locator('../..').innerText());
        }
        const uriCell = ownRow.getByText(/^(?:s3|minio|gs):\/\//);
        const uri = new URL(await uriCell.innerText());
        assert.ok(uri.pathname.split('/').includes(runId), 'Unexpected fixture URI: ' + uri);
        assert.ok(uri.pathname.endsWith('/output_gcs'), 'Unexpected fixture output: ' + uri);
        const artifactId = await ownRow.getAttribute('data-row-id');
        assert.match(artifactId || '', /^[1-9]\d*$/);
        const details = ownRow.getByRole('link', { name: 'output_gcs', exact: true });
        assert.match(await details.getAttribute('href'), new RegExp('/artifacts/' + artifactId + '$'));
        const other = profiles.find(profile => profile[0] !== identity);
        assert.equal(await rows.filter({ hasText: other[2] }).count(), 0);
      } finally {
        await context.close();
      }
    });
  }
});

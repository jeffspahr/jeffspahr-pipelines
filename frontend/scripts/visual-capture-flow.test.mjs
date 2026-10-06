// @vitest-environment node

/*
 * Copyright 2026 The Kubeflow Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureInventory, captureScreenshots, runDiff } from './visual-compare.mjs';
import { publishCapture } from './publish-visual-capture.mjs';
import { sha256 } from './capture-manifest.mjs';

const compareScript = fileURLToPath(new NodeURL('./visual-compare.mjs', import.meta.url));
const publisherScript = fileURLToPath(new NodeURL('./publish-visual-capture.mjs', import.meta.url));
const sourceCommit = 'a'.repeat(40);
const harnessCommit = 'b'.repeat(40);
let root;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'kfp-visual-flow-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function writePng(filename, width = 8, color = 0) {
  const png = new PNG({ width, height: 8 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = color;
    png.data[index + 1] = color;
    png.data[index + 2] = color;
    png.data[index + 3] = 255;
  }
  fs.writeFileSync(filename, PNG.sync.write(png));
}

async function capture() {
  const routesPath = path.join(root, 'external-routes.json');
  const routesBytes = Buffer.from('[\n  {"name":"Runs", "path":"/runs"}\n]\n');
  fs.writeFileSync(routesPath, routesBytes);
  const rawDir = path.join(root, 'raw');
  // Exercise the real capture writer; replace only the browser transport.
  await captureScreenshots({
    baseUrl: 'http://localhost:3000',
    outDir: rawDir,
    routesPath,
    viewports: '1280x720',
    defaultWaitFor: '#root',
    defaultWaitMs: 0,
    fullPage: true,
    browserType: {
      name: () => 'chromium',
      launch: async () => ({
        version: () => 'fixture-browser',
        close: async () => {},
        newPage: async () => ({
          on: () => {},
          goto: async () => {},
          addStyleTag: async () => {},
          waitForSelector: async () => {},
          evaluate: async () => {},
          screenshot: async ({ path: filename }) => writePng(filename),
          close: async () => {},
        }),
      }),
    },
  });
  return { rawDir, routesPath, routesBytes };
}

function diff(baselineDir, currentDir, extra = []) {
  const report = path.join(root, 'report.html');
  const start = console.log.mock.calls.length;
  const status = runDiff({
    baselineDir,
    currentDir,
    diffDir: path.join(root, 'diff'),
    sideBySideDir: path.join(root, 'side-by-side'),
    reportPath: report,
    failOnDiff: extra.includes('--fail-on-diff'),
    strictInventory: extra.includes('--strict-inventory'),
    includeDiff: extra.includes('--include-diff'),
  });
  return {
    status,
    stderr: '',
    stdout: console.log.mock.calls
      .slice(start)
      .map((args) => args.join(' '))
      .join('\n'),
    report: fs.readFileSync(report, 'utf8'),
  };
}

async function publishedFixture() {
  const { rawDir } = await capture();
  const publishedDir = path.join(root, 'published');
  const published = publishCapture({
    manifest: path.join(rawDir, 'capture-results.json'),
    outDir: publishedDir,
    sourceCommit,
    harnessCommit,
  });
  return {
    rawDir,
    publishedDir,
    screenshot: path.resolve(publishedDir, published.results[0].filePath),
  };
}

it('captures, relocates, publishes, relocates again, and diffs the published root', async () => {
  const { rawDir, routesPath, routesBytes } = await capture();
  const relocatedRaw = path.join(root, 'relocated-raw');
  fs.renameSync(rawDir, relocatedRaw);
  const raw = JSON.parse(fs.readFileSync(path.join(relocatedRaw, 'capture-results.json'), 'utf8'));
  expect(path.isAbsolute(raw.results[0].filePath)).toBe(false);
  expect(raw.routesSha256).toBe(sha256(routesBytes));
  expect(fs.readFileSync(path.resolve(relocatedRaw, raw.routesPath))).toEqual(routesBytes);

  fs.writeFileSync(routesPath, '[{"name":"Changed after capture","path":"/different"}]');
  const publishedDir = path.join(root, 'published');
  const publication = spawnSync(
    process.execPath,
    [
      publisherScript,
      '--manifest',
      path.join(relocatedRaw, 'capture-results.json'),
      '--out-dir',
      publishedDir,
      '--source-commit',
      sourceCommit,
      '--harness-commit',
      harnessCommit,
    ],
    { cwd: root, encoding: 'utf8', timeout: 15000 },
  );
  expect(publication.error).toBeUndefined();
  expect(publication.status, publication.stderr).toBe(0);
  const relocatedPublished = path.join(root, 'relocated-published');
  fs.renameSync(publishedDir, relocatedPublished);
  const published = JSON.parse(
    fs.readFileSync(path.join(relocatedPublished, 'capture-results.json'), 'utf8'),
  );
  expect(published.routesSha256).toBe(sha256(routesBytes));
  expect(published.publication.publishedRoutesSha256).toBe(sha256(routesBytes));
  expect(fs.readFileSync(path.resolve(relocatedPublished, published.routesPath))).toEqual(
    routesBytes,
  );
  expect(published.results[0].filePath).toMatch(/^screenshots\//);

  const result = diff(relocatedPublished, relocatedRaw);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('0 pixels differ');
  expect(result.report).toContain('class="match"');
  expect(result.report).toContain('relocated-published/screenshots/');
  expect(result.report).not.toContain('class="error"');
  // Keep one real CLI boundary check; behavior variants above/below run in-process.
  const cli = spawnSync(
    process.execPath,
    [
      compareScript,
      'diff',
      '--baseline-dir',
      relocatedPublished,
      '--current-dir',
      relocatedRaw,
      '--diff-dir',
      path.join(root, 'cli-diff'),
      '--side-by-side-dir',
      path.join(root, 'cli-side'),
      '--report',
      path.join(root, 'cli.html'),
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  expect(cli.status, cli.stderr).toBe(0);
});

it('writes a report and exits nonzero for a missing published screenshot without --fail-on-diff', async () => {
  const { rawDir, publishedDir, screenshot } = await publishedFixture();
  fs.rmSync(screenshot);
  const result = diff(publishedDir, rawDir);
  expect(result.status).toBe(1);
  expect(result.report).toContain('class="error"');
  expect(result.report).toContain('ENOENT');
});

it('writes a report and exits nonzero for incompatible image sizes without --fail-on-diff', async () => {
  const { rawDir, publishedDir, screenshot } = await publishedFixture();
  writePng(screenshot, 9);
  const result = diff(publishedDir, rawDir);
  expect(result.status).toBe(1);
  expect(result.report).toContain('class="error"');
  expect(result.report).toMatch(/size mismatch/i);
});

it('reports pixel changes successfully unless --fail-on-diff is requested', async () => {
  const { rawDir, publishedDir, screenshot } = await publishedFixture();
  writePng(screenshot, 8, 255);
  const result = diff(publishedDir, rawDir);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('64 pixels differ');
  expect(result.report).toContain('class="diff"');
  expect(diff(publishedDir, rawDir, ['--fail-on-diff']).status).toBe(1);
});

it('escapes successful report rows, screenshot attributes, and directory headers', () => {
  const directoryName = 'baseline "quoted" & <tag>';
  const filename = 'run "quoted" & <tag>.png';
  const baselineDir = path.join(root, directoryName);
  const currentDir = path.join(root, 'current');
  fs.mkdirSync(baselineDir);
  fs.mkdirSync(currentDir);
  writePng(path.join(baselineDir, filename));
  writePng(path.join(currentDir, filename));

  const result = diff(baselineDir, currentDir);
  expect(result.status, result.stderr).toBe(0);
  const escapedDirectory = 'baseline &quot;quoted&quot; &amp; &lt;tag&gt;';
  const escapedFilename = 'run &quot;quoted&quot; &amp; &lt;tag&gt;.png';
  expect(result.report).toContain(`<p>Baseline: ${root}/${escapedDirectory}</p>`);
  expect(result.report).toContain(`<td>${escapedFilename}</td>`);
  expect(result.report).toContain(`src="${escapedDirectory}/${escapedFilename}"`);
  expect(result.report).toContain(`alt="baseline ${escapedFilename}"`);
  expect(result.report).toContain(`alt="current ${escapedFilename}"`);
  expect(result.report).toContain(`alt="diff ${escapedFilename}"`);
  expect(result.report).not.toContain('<tag>');
});

it('reports empty capture directories as errors instead of a successful comparison', () => {
  const baselineDir = path.join(root, 'empty-baseline');
  const currentDir = path.join(root, 'empty-current');
  fs.mkdirSync(baselineDir);
  fs.mkdirSync(currentDir);

  const result = diff(baselineDir, currentDir);
  expect(result.status).toBe(1);
  expect(result.report).toContain('class="error"');
  expect(result.report).toContain('Cannot read baseline captures');
  expect(result.report).toContain('Cannot read current captures');
  expect(result.report).not.toContain('class="match"');
});

it('resolves and verifies the historical evidence without decoding full-size images', () => {
  const evidenceDir = fileURLToPath(
    new NodeURL('../docs/ui-modernization/evidence/', import.meta.url),
  );
  const historical = JSON.parse(
    fs.readFileSync(path.join(evidenceDir, 'capture-results.json'), 'utf8'),
  );
  expect(sha256(fs.readFileSync(path.resolve(evidenceDir, historical.routesPath)))).toBe(
    historical.pathNormalization.routesSnapshotSha256,
  );
  expect(
    sha256(
      fs.readFileSync(path.resolve(evidenceDir, historical.pathNormalization.originalManifestPath)),
    ),
  ).toBe(historical.pathNormalization.originalManifestSha256);
  expect(captureInventory(evidenceDir).size).toBe(historical.results.length);
  expect(historical.routesSha256).toBeUndefined();
  for (const capture of historical.results) {
    expect(sha256(fs.readFileSync(path.resolve(evidenceDir, capture.filePath)))).toBe(
      capture.sha256,
    );
  }
});

it('reports a global capture failure while retaining successful route comparisons', async () => {
  const { rawDir, publishedDir } = await publishedFixture();
  const manifest = path.join(rawDir, 'capture-results.json');
  const raw = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  raw.error = 'Browser close failed after screenshots completed';
  fs.writeFileSync(manifest, JSON.stringify(raw));

  const result = diff(rawDir, publishedDir);
  expect(result.status).toBe(1);
  expect(result.report).toContain('class="error"');
  expect(result.report).toContain(raw.error);
  expect(result.report).toContain('class="match"');
  expect(result.stdout).toContain(`${path.basename(raw.results[0].filePath)}: 0 pixels differ`);
});

it('reports added captures informationally unless strict inventory is requested', async () => {
  const { rawDir, publishedDir } = await publishedFixture();
  const manifestPath = path.join(rawDir, 'capture-results.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  writePng(path.join(rawDir, 'new-route.png'));
  manifest.results.push({ filePath: 'new-route.png', status: 'ok' });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const normal = diff(publishedDir, rawDir, ['--fail-on-diff']);
  expect(normal.status, normal.stderr).toBe(0);
  expect(normal.report).toContain('class="added"');
  expect(normal.report).toContain('class="match"');
  expect(diff(publishedDir, rawDir, ['--strict-inventory']).status).toBe(1);
  // Missing expected baseline coverage remains an error.
  expect(diff(rawDir, publishedDir).status).toBe(1);
  manifest.results.at(-1).status = 'error';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const failed = diff(publishedDir, rawDir);
  expect(failed.status).toBe(1);
  expect(failed.report).toContain('Missing or failed current capture for new-route.png');
});

it('decodes each source image only once when also producing side-by-side output', async () => {
  const { rawDir, publishedDir } = await publishedFixture();
  const read = vi.spyOn(PNG.sync, 'read');
  expect(diff(publishedDir, rawDir, ['--include-diff']).status).toBe(0);
  expect(read).toHaveBeenCalledTimes(2);
});

it.each([
  ['error', 'ok'],
  ['ok', 'error'],
  ['error', 'error'],
])(
  'reports each failed side independently: baseline=%s current=%s',
  async (baselineStatus, currentStatus) => {
    const { rawDir, publishedDir } = await publishedFixture();
    for (const [directory, status] of [
      [publishedDir, baselineStatus],
      [rawDir, currentStatus],
    ]) {
      const filename = path.join(directory, 'capture-results.json');
      const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'));
      manifest.results[0].status = status;
      fs.writeFileSync(filename, JSON.stringify(manifest));
    }
    const result = diff(publishedDir, rawDir);
    expect(result.status).toBe(1);
    expect(result.report.includes('Missing or failed baseline capture')).toBe(
      baselineStatus === 'error',
    );
    expect(result.report.includes('Missing or failed current capture')).toBe(
      currentStatus === 'error',
    );
  },
);

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @vitest-environment node
import { test, vi } from 'vitest';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishCapture } from './publish-visual-capture.mjs';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=',
  'base64',
);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-capture-'));
  t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'routes.json'), '[{"name":"runs","path":"/runs"}]\n');
  fs.writeFileSync(path.join(root, 'runs.png'), png);
  const raw = {
    browser: 'recorded-version',
    routesPath: path.join(root, 'routes.json'),
    captureBatches: [{ description: 'unverified annotation' }],
    results: [
      {
        name: 'runs',
        route: '/runs',
        status: 'ok',
        filePath: path.join(root, 'runs.png'),
        repeatability: 'byte-identical',
      },
    ],
  };
  const options = {
    manifest: path.join(root, 'raw.json'),
    outDir: path.join(root, 'published'),
    sourceCommit: 'a'.repeat(40),
    harnessCommit: 'b'.repeat(40),
  };
  const save = () => fs.writeFileSync(options.manifest, JSON.stringify(raw));
  save();
  return { root, raw, options, save };
}

test('publishes portable evidence with measured hashes and no inferred repeatability', (t) => {
  const { root, options } = fixture(t);
  const result = publishCapture(options);
  assert.match(result.results[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.results[0].repeatability, undefined);
  assert.equal(result.captureBatches, undefined);
  assert.equal(result.sourceCommit, options.sourceCommit);
  assert.equal(result.harnessCommit, options.harnessCommit);
  assert.equal(result.publication.repeatability, 'not measured by this publication step');
  assert.ok(!JSON.stringify(result).includes(root));
  assert.deepEqual(fs.readFileSync(path.join(options.outDir, result.results[0].filePath)), png);
  assert.deepEqual(
    fs.readFileSync(path.join(options.outDir, result.routesPath)),
    fs.readFileSync(path.join(root, 'routes.json')),
  );
  const second = publishCapture({ ...options, outDir: path.join(root, 'second') });
  assert.deepEqual(second, result);
});

test('relative input paths resolve beside the input manifest', (t) => {
  const { raw, options, save } = fixture(t);
  raw.routesPath = 'routes.json';
  raw.results[0].filePath = 'runs.png';
  save();
  assert.equal(publishCapture(options).results.length, 1);
});

for (const [name, mutate, expected] of [
  [
    'failed capture',
    (raw) => {
      raw.results[0].status = 'error';
    },
    /did not succeed/,
  ],
  [
    'stale digest',
    (raw) => {
      raw.results[0].sha256 = '0'.repeat(64);
    },
    /digest mismatch/,
  ],
  [
    'missing screenshot',
    (raw) => {
      raw.results[0].filePath += '.missing.png';
    },
    /ENOENT/,
  ],
  [
    'duplicate destination',
    (raw) => {
      raw.results.push({ ...raw.results[0] });
    },
    /duplicate/,
  ],
  [
    'empty manifest',
    (raw) => {
      raw.results = [];
    },
    /contain results/,
  ],
]) {
  test(`rejects ${name} before creating output`, (t) => {
    const { raw, options, save } = fixture(t);
    mutate(raw);
    save();
    assert.throws(() => publishCapture(options), expected);
    assert.ok(!fs.existsSync(options.outDir));
  });
}

for (const field of ['routesPath', 'filePath']) {
  for (const value of [undefined, null, 42, '', '   ']) {
    test(`rejects invalid ${field} ${JSON.stringify(value)} with an actionable error`, (t) => {
      const { raw, options, save } = fixture(t);
      const target = field === 'routesPath' ? raw : raw.results[0];
      target[field] = value;
      save();
      const label = field === 'routesPath' ? 'routesPath' : 'results[0].filePath';
      assert.throws(
        () => publishCapture(options),
        (error) => {
          assert.ok(error.message.includes(label), error.message);
          assert.match(error.message, /nonempty string/);
          assert.match(error.message, /relative to the manifest directory/);
          return true;
        },
      );
      assert.ok(!fs.existsSync(options.outDir));
    });
  }
}

for (const value of [null, 42, []]) {
  test(`rejects malformed result ${JSON.stringify(value)} before reading its fields`, (t) => {
    const { raw, options, save } = fixture(t);
    raw.results[0] = value;
    save();
    assert.throws(() => publishCapture(options), /results\[0\] must be a capture object/);
    assert.ok(!fs.existsSync(options.outDir));
  });
}

test('rejects abbreviated provenance and existing output', (t) => {
  const { options } = fixture(t);
  assert.throws(() => publishCapture({ ...options, sourceCommit: 'abcdef' }), /full Git commit/);
  fs.mkdirSync(options.outDir);
  assert.throws(() => publishCapture(options), /must not exist/);
});

test('CLI works through a symlink and reports invalid arguments', (t) => {
  const { root, options } = fixture(t);
  const executable = path.join(root, 'publisher.mjs');
  fs.symlinkSync(
    fileURLToPath(new URL('./publish-visual-capture.mjs', import.meta.url)),
    executable,
  );
  const child = spawnSync(
    process.execPath,
    [
      executable,
      '--manifest',
      options.manifest,
      '--out-dir',
      options.outDir,
      '--source-commit',
      options.sourceCommit,
      '--harness-commit',
      options.harnessCommit,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.ok(fs.existsSync(path.join(options.outDir, 'capture-results.json')));
  assert.equal(spawnSync(process.execPath, [executable, '--unknown', 'value']).status, 1);
});

test('hashes the exact manifest bytes that were parsed even if the input changes', (t) => {
  const { options } = fixture(t);
  const originalBytes = fs.readFileSync(options.manifest);
  const readFile = fs.readFileSync.bind(fs);
  let manifestReads = 0;
  const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((filename, ...args) => {
    const bytes = readFile(filename, ...args);
    if (filename === options.manifest) {
      manifestReads += 1;
      fs.writeFileSync(options.manifest, '{"results":[]}');
    }
    return bytes;
  });
  let result;
  try {
    result = publishCapture(options);
  } finally {
    spy.mockRestore();
  }
  assert.equal(manifestReads, 1);
  assert.equal(result.results.length, 1);
  assert.equal(
    result.publication.rawManifestSha256,
    crypto.createHash('sha256').update(originalBytes).digest('hex'),
  );
});

test('CLI accepts equals-separated arguments', (t) => {
  const { options } = fixture(t);
  const child = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./publish-visual-capture.mjs', import.meta.url)),
      `--manifest=${options.manifest}`,
      `--out-dir=${options.outDir}`,
      `--source-commit=${options.sourceCommit}`,
      `--harness-commit=${options.harnessCommit}`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.ok(fs.existsSync(path.join(options.outDir, 'capture-results.json')));
});

test('CLI names every missing required argument', () => {
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./publish-visual-capture.mjs', import.meta.url))],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 1);
  for (const key of ['manifest', 'out-dir', 'source-commit', 'harness-commit']) {
    assert.ok(child.stderr.includes(`--${key}`), child.stderr);
  }
});

test('can be imported when argv[1] is not a file', () => {
  const url = new URL('./publish-visual-capture.mjs', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `process.argv[1] = '/missing-publisher-entrypoint'; await import(${JSON.stringify(url)});`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 0, child.stderr);
});

test('preserves capture-time routes integrity through publication and republication', (t) => {
  const { root, raw, options, save } = fixture(t);
  raw.routesSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(raw.routesPath))
    .digest('hex');
  save();
  const published = publishCapture(options);
  assert.equal(published.routesSha256, raw.routesSha256);
  assert.equal(
    published.publication.inputRoutesIntegrity,
    'verified against capture-time routes digest',
  );
  assert.equal(published.publication.publishedRoutesSha256, raw.routesSha256);
  assert.equal(
    published.publication.captureRoutesIntegrity,
    'verified against capture-time routes digest',
  );
  const republished = publishCapture({
    ...options,
    manifest: path.join(options.outDir, 'capture-results.json'),
    outDir: path.join(root, 'republished'),
  });
  assert.equal(republished.routesSha256, raw.routesSha256);
  assert.equal(
    republished.publication.captureRoutesIntegrity,
    published.publication.captureRoutesIntegrity,
  );
});

test('rejects routes drift after capture before creating publication output', (t) => {
  const { raw, options, save } = fixture(t);
  raw.routesSha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(raw.routesPath))
    .digest('hex');
  save();
  fs.writeFileSync(raw.routesPath, '[{"name":"changed","path":"/changed"}]');
  assert.throws(() => publishCapture(options), /Routes digest mismatch.*restore.*rerun capture/);
  assert.ok(!fs.existsSync(options.outDir));
});

for (const digest of [null, 42, '', 'abcdef']) {
  test(`rejects malformed capture-time routes digest ${JSON.stringify(digest)}`, (t) => {
    const { raw, options, save } = fixture(t);
    raw.routesSha256 = digest;
    save();
    assert.throws(() => publishCapture(options), /routesSha256.*rerun capture/);
    assert.ok(!fs.existsSync(options.outDir));
  });
}

test('marks legacy routes integrity unverified without inventing a capture-time hash', (t) => {
  const { root, options } = fixture(t);
  const published = publishCapture(options);
  assert.equal(published.routesSha256, undefined);
  assert.match(published.publication.publishedRoutesSha256, /^[a-f0-9]{64}$/);
  assert.match(published.publication.captureRoutesIntegrity, /^unverified:/);
  assert.match(published.publication.inputRoutesIntegrity, /^unverified:/);
  const republished = publishCapture({
    ...options,
    manifest: path.join(options.outDir, 'capture-results.json'),
    outDir: path.join(root, 'republished'),
  });
  assert.equal(republished.routesSha256, undefined);
  assert.match(republished.publication.captureRoutesIntegrity, /^unverified:/);
  assert.equal(
    republished.publication.inputRoutesIntegrity,
    'verified against prior publication digest',
  );
});

test('missing input errors identify the file and corrective action', (t) => {
  const { raw, options } = fixture(t);
  fs.unlinkSync(raw.routesPath);
  assert.throws(
    () => publishCapture(options),
    /Cannot read routes snapshot:.*ENOENT.*restore.*rerun capture/,
  );
  assert.ok(!fs.existsSync(options.outDir));
});

test('invalid JSON names the manifest problem and corrective action', (t) => {
  const { options } = fixture(t);
  fs.writeFileSync(options.manifest, '{');
  assert.throws(
    () => publishCapture(options),
    /manifest is not valid JSON.*restore.*rerun capture/,
  );
  assert.ok(!fs.existsSync(options.outDir));
});

test('rejects incomplete capture even when every route succeeded', (t) => {
  const { raw, options, save } = fixture(t);
  raw.error = 'Browser close failed';
  save();
  assert.throws(
    () => publishCapture(options),
    /Capture did not complete: Browser close failed.*rerun capture/,
  );
  assert.ok(!fs.existsSync(options.outDir));
});

for (const [name, relativeCwd, relativeBase] of [
  ['frontend cwd', '../', '../'],
  ['repo cwd', '../../', '../../'],
  ['npm INIT_CWD', '../', '../../'],
  ['inherited INIT_CWD outside npm', '../', '../'],
]) {
  test(`CLI resolves relative paths using ${name}`, (t) => {
    const { options } = fixture(t);
    const cwd = fileURLToPath(new URL(relativeCwd, import.meta.url));
    const base = fileURLToPath(new URL(relativeBase, import.meta.url));
    const env = { ...process.env };
    delete env.INIT_CWD;
    delete env.npm_lifecycle_event;
    if (name === 'inherited INIT_CWD outside npm') env.INIT_CWD = '/unrelated-parent-directory';
    if (name === 'npm INIT_CWD') {
      env.INIT_CWD = base;
      env.npm_lifecycle_event = 'visual:current';
    }
    const child = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./publish-visual-capture.mjs', import.meta.url)),
        '--manifest',
        path.relative(base, options.manifest),
        '--out-dir',
        path.relative(base, options.outDir),
        '--source-commit',
        options.sourceCommit,
        '--harness-commit',
        options.harnessCommit,
      ],
      { encoding: 'utf8', cwd, env },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.ok(fs.existsSync(path.join(options.outDir, 'capture-results.json')));
  });
}

test('rejects routes drift after legacy publication before creating chained output', (t) => {
  const { root, options } = fixture(t);
  publishCapture(options);
  fs.writeFileSync(path.join(options.outDir, 'routes.json'), '[{"path":"/changed"}]');
  const next = {
    ...options,
    manifest: path.join(options.outDir, 'capture-results.json'),
    outDir: path.join(root, 'republished'),
  };
  assert.throws(
    () => publishCapture(next),
    /Routes digest mismatch.*after publication.*restore.*rerun capture/,
  );
  assert.ok(!fs.existsSync(next.outDir));
});

for (const digest of [null, 42, '', 'abcdef']) {
  test(`rejects malformed prior publication digest ${JSON.stringify(digest)}`, (t) => {
    const { raw, options, save } = fixture(t);
    raw.publication = { publishedRoutesSha256: digest };
    save();
    assert.throws(
      () => publishCapture(options),
      /publication.publishedRoutesSha256.*restore.*rerun capture/,
    );
    assert.ok(!fs.existsSync(options.outDir));
  });
}

for (const field of ['sourceCommit', 'harnessCommit']) {
  test(`rejects conflicting recorded ${field}`, (t) => {
    const { raw, options, save } = fixture(t);
    raw[field] = 'c'.repeat(40);
    save();
    assert.throws(
      () => publishCapture(options),
      new RegExp(`Recorded ${field}.*use the recorded revision`),
    );
    assert.ok(!fs.existsSync(options.outDir));
    options[field] = raw[field];
    assert.equal(publishCapture(options)[field], raw[field]);
  });
}

test('preserves and verifies the original manifest through portable republication', (t) => {
  const { root, raw, options, save } = fixture(t);
  const bytes = Buffer.from('{"historical":true}');
  fs.writeFileSync(path.join(root, 'original.json'), bytes);
  raw.pathNormalization = {
    originalManifestPath: 'original.json',
    originalManifestSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    unknownPath: '/workstation/private',
  };
  raw.unknownPath = '/workstation/private';
  raw.results[0].unknownPath = '/workstation/private';
  save();
  const published = publishCapture(options);
  assert.deepEqual(
    fs.readFileSync(path.join(options.outDir, published.pathNormalization.originalManifestPath)),
    bytes,
  );
  assert.ok(!JSON.stringify(published).includes('/workstation/private'));
  const nextDir = path.join(root, 'again');
  const next = publishCapture({
    ...options,
    manifest: path.join(options.outDir, 'capture-results.json'),
    outDir: nextDir,
  });
  assert.deepEqual(
    fs.readFileSync(path.join(nextDir, next.pathNormalization.originalManifestPath)),
    bytes,
  );
  fs.writeFileSync(
    path.join(options.outDir, published.pathNormalization.originalManifestPath),
    '{}',
  );
  assert.throws(
    () =>
      publishCapture({
        ...options,
        manifest: path.join(options.outDir, 'capture-results.json'),
        outDir: path.join(root, 'bad'),
      }),
    /Original manifest digest mismatch.*restore/,
  );
});

test('rejects screenshot mutation between validation and copy and removes incomplete output', (t) => {
  const { root, options } = fixture(t);
  const screenshot = path.join(root, 'runs.png');
  const readFile = fs.readFileSync.bind(fs);
  let reads = 0;
  const spy = vi.spyOn(fs, 'readFileSync').mockImplementation((filename, ...args) => {
    const bytes = readFile(filename, ...args);
    if (filename === screenshot && ++reads === 1)
      fs.writeFileSync(screenshot, Buffer.concat([png, Buffer.from('changed')]));
    return bytes;
  });
  try {
    assert.throws(() => publishCapture(options), /Screenshot changed during publication.*retry/);
  } finally {
    spy.mockRestore();
  }
  assert.equal(reads, 2);
  assert.ok(!fs.existsSync(options.outDir));
});

test('preserves supported capture options through publication and republication', (t) => {
  const { root, raw, options, save } = fixture(t);
  const captureOptions = {
    viewport: { width: 1280, height: 720 },
    waitForSelector: '#root',
    waitForTimeoutMs: 100,
    waitForSelectors: ['#loaded'],
    fillFields: [{ label: 'Name', value: 'test run' }],
    fitGraph: true,
    failOnRequestErrors: ['/apis/'],
    failOnPageErrors: true,
  };
  Object.assign(raw.results[0], captureOptions);
  save();
  const published = publishCapture(options);
  const republished = publishCapture({
    ...options,
    manifest: path.join(options.outDir, 'capture-results.json'),
    outDir: path.join(root, 'republished'),
  });
  for (const result of [published.results[0], republished.results[0]]) {
    for (const [key, value] of Object.entries(captureOptions))
      assert.deepEqual(result[key], value, key);
  }
});

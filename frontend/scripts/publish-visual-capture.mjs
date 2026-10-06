// Publish capture evidence without launching a browser.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  resolveCliPath,
  resolveManifestPath,
  sha256,
  validateCaptureResults,
} from './capture-manifest.mjs';

function pickKeys(record, keys) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keys.includes(key)));
}

function readInput(filename, label) {
  try {
    return fs.readFileSync(filename);
  } catch (error) {
    throw new Error(
      `Cannot read ${label}: ${filename} (${error.code}); restore the referenced file or rerun capture before publishing.`,
      { cause: error },
    );
  }
}

export function publishCapture({ manifest, outDir, sourceCommit, harnessCommit }) {
  for (const [name, value] of Object.entries({ sourceCommit, harnessCommit })) {
    if (!/^[a-f0-9]{40}$/.test(value || '')) {
      throw new Error(
        `${name} must be a full Git commit SHA; supply the 40-character revision used for capture`,
      );
    }
  }
  const manifestBytes = readInput(manifest, 'capture manifest');
  let raw;
  try {
    raw = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(
      'Capture manifest is not valid JSON; restore it or rerun capture before publishing.',
      { cause: error },
    );
  }
  if (raw?.error) {
    throw new Error(
      `Capture did not complete: ${raw.error}; fix the capture error and rerun capture before publishing`,
    );
  }
  for (const [field, supplied] of Object.entries({ sourceCommit, harnessCommit })) {
    if (raw?.[field] !== undefined && raw[field] !== supplied) {
      throw new Error(
        `Recorded ${field} does not match the supplied commit; use the recorded revision or capture new evidence.`,
      );
    }
  }
  validateCaptureResults(raw?.results, 'Capture manifest');
  if (typeof raw.routesPath !== 'string' || !raw.routesPath.trim()) {
    throw new Error(
      'Capture manifest routesPath must be a nonempty string; supply an absolute path or a path relative to the manifest directory',
    );
  }
  if (fs.existsSync(outDir))
    throw new Error(
      'Output directory must not exist; choose a new --out-dir to preserve existing evidence',
    );
  const routes = readInput(resolveManifestPath(raw.routesPath, manifest), 'routes snapshot');
  const routesDigest = sha256(routes);
  const priorPublicationDigest = raw.publication?.publishedRoutesSha256;
  for (const [field, digest, phase] of [
    ['routesSha256', raw.routesSha256, 'capture'],
    ['publication.publishedRoutesSha256', priorPublicationDigest, 'publication'],
  ]) {
    if (digest === undefined) continue;
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(
        `Capture manifest ${field} must be a SHA-256 digest; restore the manifest or rerun capture to record the routes snapshot digest.`,
      );
    }
    if (digest !== routesDigest) {
      throw new Error(
        `Routes digest mismatch: the routes snapshot changed after ${phase}; restore the recorded routes bytes or rerun capture before publishing.`,
      );
    }
  }
  let originalManifestBytes;
  let pathNormalization;
  if (raw.pathNormalization !== undefined) {
    const annotation = raw.pathNormalization;
    if (
      typeof annotation?.originalManifestPath !== 'string' ||
      !annotation.originalManifestPath.trim()
    ) {
      throw new Error(
        'pathNormalization.originalManifestPath must name the original manifest; restore the referenced evidence before publishing.',
      );
    }
    originalManifestBytes = readInput(
      resolveManifestPath(annotation.originalManifestPath, manifest),
      'original manifest',
    );
    const digest = sha256(originalManifestBytes);
    if (
      annotation.originalManifestSha256 !== undefined &&
      annotation.originalManifestSha256 !== digest
    ) {
      throw new Error(
        'Original manifest digest mismatch; restore the recorded original manifest before publishing.',
      );
    }
    pathNormalization = {
      ...pickKeys(annotation, [
        'originalEvidenceRef',
        'routesSourceCommit',
        'routesSourcePath',
        'routesSnapshotSha256',
        'note',
      ]),
      originalManifestPath: 'metadata/original-capture-results.json',
      originalManifestSha256: digest,
    };
  }
  // Read and validate every input before writing any published evidence.
  const captures = raw.results.map((result, index) => {
    if (result.status !== 'ok')
      throw new Error(
        `Capture did not succeed: ${result.name}; fix the capture error and rerun capture before publishing`,
      );
    const filename = path.basename(result.filePath);
    const bytes = readInput(
      resolveManifestPath(result.filePath, manifest),
      `screenshot results[${index}].filePath`,
    );
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(
        `Not a PNG screenshot: ${filename}; restore the original PNG or rerun capture`,
      );
    }
    const screenshotDigest = sha256(bytes);
    if (result.sha256 && result.sha256 !== screenshotDigest) {
      throw new Error(
        `Screenshot digest mismatch: ${filename}; restore the captured PNG or rerun capture before publishing`,
      );
    }
    // Historical annotations are not measurements made by this publisher.
    const capture = pickKeys(result, [
      'name',
      'route',
      'viewport',
      'waitForSelector',
      'waitForTimeoutMs',
      'waitForSelectors',
      'fillFields',
      'fitGraph',
      'failOnRequestErrors',
      'failOnPageErrors',
      'status',
    ]);
    return {
      filename,
      inputPath: resolveManifestPath(result.filePath, manifest),
      result: { ...capture, filePath: `screenshots/${filename}`, sha256: screenshotDigest },
    };
  });
  // Only supported capture metadata is portable; unknown annotations may contain local paths.
  const settings = pickKeys(raw, [
    'baseUrl',
    'browser',
    'locale',
    'timezoneId',
    'colorScheme',
    'reducedMotion',
    'fixedTime',
    'fullPage',
    'capturedAt',
    'routesSha256',
  ]);
  const published = {
    ...settings,
    ...(pathNormalization ? { pathNormalization } : {}),
    sourceCommit,
    harnessCommit,
    routesPath: 'routes.json',
    results: captures.map((capture) => capture.result),
    publication: {
      schemaVersion: 1,
      rawManifestSha256: sha256(manifestBytes),
      publishedRoutesSha256: routesDigest,
      inputRoutesIntegrity:
        priorPublicationDigest !== undefined
          ? 'verified against prior publication digest'
          : raw.routesSha256 !== undefined
            ? 'verified against capture-time routes digest'
            : 'unverified: input manifest has no routes digest',
      captureRoutesIntegrity:
        raw.routesSha256 === undefined
          ? 'unverified: input manifest has no capture-time routes digest'
          : 'verified against capture-time routes digest',
      pathBase: 'directory containing capture-results.json',
      repeatability: 'not measured by this publication step',
      provenance:
        'Source and harness commits are supplied by the capture operator; publication verifies file digests, not the running application identity.',
    },
  };
  fs.mkdirSync(path.dirname(outDir), { recursive: true });
  fs.mkdirSync(outDir);
  try {
    fs.mkdirSync(path.join(outDir, 'screenshots'));
    fs.writeFileSync(path.join(outDir, 'routes.json'), routes);
    if (originalManifestBytes) {
      fs.mkdirSync(path.join(outDir, 'metadata'));
      fs.writeFileSync(
        path.join(outDir, pathNormalization.originalManifestPath),
        originalManifestBytes,
      );
    }
    for (const capture of captures) {
      const bytes = readInput(capture.inputPath, 'screenshot');
      if (sha256(bytes) !== capture.result.sha256) {
        throw new Error(
          `Screenshot changed during publication: ${capture.filename}; restore the capture and retry publication.`,
        );
      }
      fs.writeFileSync(path.join(outDir, 'screenshots', capture.filename), bytes);
    }
    // A directory is consumable only once every validated input has been copied.
    fs.writeFileSync(
      path.join(outDir, 'capture-results.json'),
      JSON.stringify(published, null, 2) + '\n',
    );
  } catch (error) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw error;
  }
  return published;
}

function main() {
  const keys = {
    manifest: 'manifest',
    'out-dir': 'outDir',
    'source-commit': 'sourceCommit',
    'harness-commit': 'harnessCommit',
  };
  const { values } = parseArgs({
    options: Object.fromEntries(Object.keys(keys).map((key) => [key, { type: 'string' }])),
  });
  const missing = Object.keys(keys).filter((key) => !values[key]);
  if (missing.length) {
    throw new Error(`Missing required arguments: ${missing.map((key) => `--${key}`).join(', ')}`);
  }
  const options = Object.fromEntries(
    Object.entries(keys).map(([key, name]) => [name, values[key]]),
  );
  options.manifest = resolveCliPath(options.manifest);
  options.outDir = resolveCliPath(options.outDir);
  publishCapture(options);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

// Capture and publication paths are relative to the containing manifest.
// Absolute paths remain readable for older raw captures.
import path from 'node:path';
import crypto from 'node:crypto';

// Only npm lifecycle commands use INIT_CWD; a stale inherited value is not a cwd override.
export const resolveCliPath = (
  filename,
  base = (process.env.npm_lifecycle_event && process.env.INIT_CWD) || process.cwd(),
) => path.resolve(base, filename);

export function validateCaptureResults(results, label) {
  if (!Array.isArray(results) || !results.length) {
    throw new Error(`${label} must contain results; rerun capture to regenerate the manifest.`);
  }
  const names = new Set();
  for (const [index, result] of results.entries()) {
    const field = `results[${index}]`;
    let reason;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      reason = `${field} must be a capture object`;
    } else if (typeof result.filePath !== 'string' || !result.filePath.trim()) {
      reason = `${field}.filePath must be a nonempty string; supply an absolute screenshot path or a path relative to the manifest directory`;
    } else {
      const filename = path.basename(result.filePath);
      if (!filename.endsWith('.png')) {
        reason = `filePath must name a PNG file (${field}.filePath)`;
      } else if (names.has(filename)) {
        reason = `duplicate filename ${filename} (${field}.filePath); use unique PNG filenames`;
      } else if (!['ok', 'error'].includes(result.status)) {
        reason = `status must be ok or error (${field}.status)`;
      }
      names.add(filename);
    }
    if (reason) {
      throw new Error(
        `${label}, entry ${index + 1}: ${reason}. Fix the manifest or rerun capture.`,
      );
    }
  }
  return results;
}

export const resolveManifestPath = (filename, manifestPath) =>
  path.resolve(path.dirname(manifestPath), filename);

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

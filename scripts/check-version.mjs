#!/usr/bin/env node
// Verifies the app version is identical everywhere it is declared:
//   - package.json           "version"
//   - src/version.ts         APP_VERSION (shown in logs and the /about output)
//   - CHANGELOG.md           the top-most "## x.y.z" heading
// A version bump has to touch all three, or they silently drift (as src/version.ts did).
// Uses only Node built-ins so it can run in CI without installing dependencies.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const pkgVersion = JSON.parse(read('package.json')).version;
const tsVersion = read('src/version.ts').match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
const changelogVersion = read('CHANGELOG.md').match(/^##\s+(\d+\.\d+\.\d+)\b/m)?.[1];

const sources = {
  'package.json': pkgVersion,
  'src/version.ts': tsVersion,
  'CHANGELOG.md (top entry)': changelogVersion,
};

const missing = Object.entries(sources).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`✖ Could not read a version from: ${missing.join(', ')}`);
  process.exit(1);
}

if (new Set(Object.values(sources)).size !== 1) {
  console.error('✖ Version mismatch across sources:');
  for (const [k, v] of Object.entries(sources)) console.error(`    ${k.padEnd(26)} ${v}`);
  console.error('\n  A version bump must update all three: package.json, src/version.ts, and a new CHANGELOG.md entry.');
  process.exit(1);
}

console.log(`✓ Version consistent everywhere: ${pkgVersion}`);

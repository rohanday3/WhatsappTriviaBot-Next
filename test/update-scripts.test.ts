import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = [
  resolve(root, 'scripts/install-systemd.sh'),
  resolve(root, 'scripts/install-updater.sh'),
  resolve(root, 'scripts/update-server.sh'),
];

test('deployment shell scripts have valid Bash syntax', () => {
  for (const script of scripts) {
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test('server updater exposes validation and force options', () => {
  const result = spawnSync('bash', [resolve(root, 'scripts/update-server.sh'), '--help'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--check/);
  assert.match(result.stdout, /--force/);
  assert.match(result.stdout, /restart/i);
});

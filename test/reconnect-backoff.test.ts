import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../src/config.js';
import {
  isHardFailureStatus,
  isTerminalStatus,
  reconnectBaseDelayMs,
} from '../src/whatsapp/transport.js';

test('a dead session is terminal and is never retried', () => {
  assert.equal(isTerminalStatus(401), true, '401 loggedOut');
  assert.equal(isTerminalStatus(403), true, '403 forbidden');
  assert.equal(isTerminalStatus(405), false, '405 is refusable but recoverable');
  assert.equal(isTerminalStatus(428), false, '428 connectionClosed is transient');
  assert.equal(isTerminalStatus(undefined), false);
});

test('server-side refusals are classified as hard failures', () => {
  assert.equal(isHardFailureStatus(405), true, 'retired client version');
  assert.equal(isHardFailureStatus(440), true, 'connectionReplaced');
  assert.equal(isHardFailureStatus(500), true, 'badSession');
  assert.equal(isHardFailureStatus(428), false, 'connectionClosed is transient');
  assert.equal(isHardFailureStatus(515), false, 'restartRequired must reconnect promptly');
  assert.equal(isHardFailureStatus(undefined), false);
});

test('transient drops still reconnect quickly and cap at the normal ceiling', () => {
  assert.equal(reconnectBaseDelayMs(1, 428), 1000);
  assert.equal(reconnectBaseDelayMs(2, 428), 2000);
  assert.equal(reconnectBaseDelayMs(4, 428), 8000);
  assert.equal(reconnectBaseDelayMs(50, 428), config.reconnectMaxDelayMs);
});

test('a 405 refusal backs off far beyond the transient ceiling', () => {
  // The incident: ~700 attempts at a 60s ceiling meant 12 hours of pointless retries.
  // At the hard-failure ceiling the same window costs under 50 attempts.
  const sustained = reconnectBaseDelayMs(700, 405);
  assert.equal(sustained, config.reconnectHardFailureDelayMs);
  assert.ok(
    sustained > config.reconnectMaxDelayMs,
    'hard failures must not retry on the transient ceiling',
  );
});

test('the backoff ladder actually reaches the hard-failure ceiling', () => {
  // A ceiling the exponent can never climb to would silently behave like the old 60s cap.
  const climbed = reconnectBaseDelayMs(11, 405);
  assert.equal(climbed, Math.min(config.reconnectHardFailureDelayMs, 1024 * 1000));
  assert.ok(climbed > config.reconnectMaxDelayMs);
});

test('a carried-over attempt count skips the fast rungs entirely', () => {
  // A restart used to reset the counter to 1 and replay 1.6s/2.5s/4.7s bursts at a server
  // that was already refusing, which is what preceded the 401 in the logged incident.
  assert.ok(reconnectBaseDelayMs(717, 405) >= config.reconnectHardFailureDelayMs);
  assert.ok(reconnectBaseDelayMs(1, 405) < 2000, 'a fresh outage still gets one prompt retry');
});

test('attempt numbers below one do not produce a negative exponent', () => {
  assert.equal(reconnectBaseDelayMs(0, 428), 1000);
});

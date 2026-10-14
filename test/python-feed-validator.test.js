'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateWithPython } = require('../python-feed-validator');

const safeWait = (result, reason) => {
  assert.equal(result.ok, false);
  assert.equal(result.reason, reason);
  assert.equal(result.signal_generation, false);
  assert.equal(result.auto_trading, false);
};

test('validator stays disabled unless explicitly enabled', async () => {
  safeWait(await validateWithPython({}), 'python_validator_disabled');
});

test('rejects invalid timeout without launching Python', async () => {
  let called = false;
  const result = await validateWithPython({}, { enabled: true, timeoutMs: 10, execFile: () => { called = true; } });
  safeWait(result, 'invalid_validator_timeout');
  assert.equal(called, false);
});

test('rejects non-serializable payload fail-closed', async () => {
  const circular = {};
  circular.self = circular;
  safeWait(await validateWithPython(circular, { enabled: true }), 'snapshot_not_serializable');
});

test('rejects payload exceeding limit before launching Python', async () => {
  let called = false;
  const result = await validateWithPython({ data: 'x'.repeat(300 * 1024) }, {
    enabled: true,
    execFile: () => { called = true; },
  });
  safeWait(result, 'snapshot_payload_too_large');
  assert.equal(called, false);
});

test('Python missing returns safe WAIT result', async () => {
  const result = await validateWithPython({}, {
    enabled: true,
    execFile: (_file, _args, _opts, callback) => {
      const error = new Error('not found');
      error.code = 'ENOENT';
      callback(error, '');
    },
  });
  safeWait(result, 'python_runtime_unavailable');
});

test('timeout returns safe WAIT result', async () => {
  const result = await validateWithPython({}, {
    enabled: true,
    execFile: (_file, _args, _opts, callback) => {
      const error = new Error('timeout');
      error.killed = true;
      callback(error, '');
    },
  });
  safeWait(result, 'python_validator_timeout');
});

test('invalid JSON response returns safe WAIT result', async () => {
  const result = await validateWithPython({}, {
    enabled: true,
    execFile: (_file, _args, _opts, callback) => callback(null, 'not json'),
  });
  safeWait(result, 'python_validator_invalid_json');
});

test('unexpected validator response is rejected', async () => {
  const result = await validateWithPython({}, {
    enabled: true,
    execFile: (_file, _args, _opts, callback) => callback(null, JSON.stringify({ ok: true, bars: [] })),
  });
  safeWait(result, 'python_validator_invalid_response');
});


test('real Python subprocess validates a fresh XAU snapshot end to end', async () => {
  const now = Date.now() / 1000;
  const bars = Array.from({ length: 50 }, (_, i) => ({
    t: now - (49 - i) * 60,
    o: 4000 + i,
    h: 4002 + i,
    l: 3999 + i,
    c: 4001 + i,
    v: 10,
  }));
  const snapshot = {
    version: 1,
    symbol: 'XAU/USD',
    timeframe: '1M',
    status: { ok: true, stale: false, symbol: 'XAU/USD', timeframe: '1M' },
    bars,
    capturedAt: now * 1000,
  };
  const result = await validateWithPython(snapshot, { enabled: true, timeoutMs: 3000 });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.symbol, 'XAU/USD');
  assert.equal(result.bar_count, 50);
  assert.equal(result.signal_generation, false);
  assert.equal(result.auto_trading, false);
});

test('valid contract response is returned without enabling signal generation', async () => {
  const expected = { ok: true, symbol: 'XAU/USD', bars: [{ t: 1 }], signal_generation: false, auto_trading: false };
  const result = await validateWithPython({ version: 1 }, {
    enabled: true,
    execFile: (_file, _args, _opts, callback) => callback(null, JSON.stringify(expected)),
  });
  assert.deepEqual(result, expected);
});

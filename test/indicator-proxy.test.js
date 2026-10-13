'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBars, validateDashboardPayload, evaluateDiagnostics } = require('../indicator-proxy');

function bars(count = 60, start = 1_800_000_000) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: start + i * 60,
    open: 2300 + i,
    high: 2302 + i,
    low: 2299 + i,
    close: 2301 + i,
    volume: 10
  }));
}

test('normalizes second and millisecond timestamps to seconds', () => {
  const normalized = normalizeBars([
    { timestamp: 1_800_000_060_000, open: 2, high: 3, low: 1, close: 2.5, volume: 1 },
    { timestamp: 1_800_000_000, open: 2, high: 3, low: 1, close: 2.5, volume: 1 }
  ]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].timestamp, 1_800_000_000);
  assert.equal(normalized[1].timestamp, 1_800_000_060);
});

test('deduplicates repeated forming candles and keeps the last valid copy', () => {
  const input = bars(60);
  input.push({ ...input[59], close: input[59].close + 0.25, high: input[59].high + 0.25 });
  const normalized = normalizeBars(input);
  assert.equal(normalized.length, 60);
  assert.equal(normalized[59].close, input[60].close);
});

test('rejects malformed OHLC and does not count invalid candles toward the 60-bar minimum', async () => {
  const input = bars(60);
  input[0] = { ...input[0], high: input[0].low - 1 };
  const payload = { symbol: 'XAU/USD', timeframe: '1m', bars: input };
  assert.equal(validateDashboardPayload(payload), null);
  const result = await evaluateDiagnostics(payload, { baseUrl: '' });
  assert.equal(result.status, 422);
  assert.equal(result.body.signal, 'WAIT');
  assert.match(result.body.reason, /Fewer than 60 valid OHLCV bars/);
  assert.equal(result.body.autoTrading, false);
});

test('requires supported XAU symbol, timeframe, and at least 60 input bars', () => {
  assert.equal(validateDashboardPayload({ symbol: 'XAU/USD', timeframe: '1m', bars: bars(60) }), null);
  assert.equal(validateDashboardPayload({ symbol: 'XAU/USD', timeframe: '2m', bars: bars(60) }), 'Unsupported timeframe');
  assert.equal(validateDashboardPayload({ symbol: 'XAU/USD', timeframe: '1m', bars: bars(59) }), 'At least 60 OHLCV bars are required');
});

test('valid normalized candles reach configuration check rather than returning 422', async () => {
  const result = await evaluateDiagnostics(
    { symbol: 'XAU/USD', timeframe: '1m', bars: bars(60) },
    { baseUrl: '' }
  );
  assert.equal(result.status, 503);
  assert.match(result.body.reason, /not configured/i);
  assert.equal(result.body.autoTrading, false);
});

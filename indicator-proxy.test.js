'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateDiagnostics, normalizeBars, normalizeSymbol, validateDashboardPayload } = require('./indicator-proxy');

function bars(count = 60) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: 1800000000 - (count - 1 - i) * 60,
    open: 2600, high: 2601, low: 2599, close: 2600.5, volume: 10
  }));
}
function payload(extra = {}) { return { symbol: 'GOLD', timeframe: '1m', bars: bars(), ...extra }; }

test('normalizes supported Gold and BTC symbols', () => {
  assert.equal(normalizeSymbol('XAU/USD'), 'XAUUSD');
  assert.equal(normalizeSymbol('GOLD'), 'XAUUSD');
  assert.equal(normalizeSymbol('BTC-USDT'), 'BTCUSD');
  assert.equal(normalizeSymbol('UNKNOWN'), null);
});

test('rejects invalid symbol, timeframe and insufficient bars', () => {
  assert.match(validateDashboardPayload(payload({ symbol: 'DOGE' })), /symbol/i);
  assert.match(validateDashboardPayload(payload({ timeframe: '2m' })), /timeframe/i);
  assert.match(validateDashboardPayload(payload({ bars: bars(59) })), /60/);
  assert.equal(validateDashboardPayload(payload()), null);
});

test('normalizes compact candles and filters invalid OHLCV ranges', () => {
  const result = normalizeBars([
    { t: 1800000000, o: 2600, h: 2601, l: 2599, c: 2600.5, v: 10 },
    { t: 1800000060, o: 2600, h: 2598, l: 2599, c: 2600.5, v: 10 }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].timestamp, 1800000000);
  assert.equal(result[0].open, 2600);
});

test('fails closed when engine URL is not configured', async () => {
  const result = await evaluateDiagnostics(payload(), { baseUrl: '' });
  assert.equal(result.status, 503);
  assert.equal(result.body.signal, 'WAIT');
  assert.equal(result.body.autoTrading, false);
});

test('forwards normalized request to configured engine and keeps auto trading off', async () => {
  let captured;
  const result = await evaluateDiagnostics(payload({ symbol: 'XAU/USD', unused: 'drop' }), {
    baseUrl: 'https://engine.example/',
    fetchImpl: async (url, init) => {
      captured = { url, body: JSON.parse(init.body), cache: init.cache };
      return { ok: true, status: 200, json: async () => ({ ok: true, signal: 'WAIT', confidence: null, autoTrading: true }) };
    }
  });
  assert.equal(captured.url, 'https://engine.example/evaluate');
  assert.equal(captured.body.symbol, 'XAUUSD');
  assert.equal(captured.body.unused, undefined);
  assert.equal(captured.cache, 'no-store');
  assert.equal(result.status, 200);
  assert.equal(result.body.autoTrading, false);
});

test('invalid engine response and network errors fail closed', async () => {
  const invalid = await evaluateDiagnostics(payload(), {
    baseUrl: 'https://engine.example',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => null })
  });
  assert.equal(invalid.status, 502);
  assert.equal(invalid.body.signal, 'WAIT');
  const down = await evaluateDiagnostics(payload(), {
    baseUrl: 'https://engine.example',
    fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.equal(down.status, 502);
  assert.equal(down.body.autoTrading, false);
});

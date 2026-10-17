'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'tools', 'engine5-snapshot-export-console.js'), 'utf8');

function runExporter({ symbol = 'XAU/USD', stale = false } = {}) {
  const now = Date.now();
  const bars = Array.from({ length: 50 }, (_, i) => {
    const c = 4000 + i;
    return { t: now - (49 - i) * 60000, o: c - 0.2, h: c + 1, l: c - 1, c, v: 10 };
  });
  const feed = { ok: true, live: true, stale: false, source: 'TEST_ONLY', symbol, timeframe: '1M', updatedAt: stale ? now - 600000 : now };
  const win = {
    RIZVI_CANONICAL_FEED_SNAPSHOT: {
      version: 1, symbol, timeframe: '1M', capturedAt: stale ? now - 600000 : now,
      status: feed, bars
    },
    RIZVI_CANONICAL_FEED_STATUS: feed,
    RIZVI_CURRENT_SYMBOL: symbol,
    RIZVI_CANDLE_TIMEFRAME: '1M',
    RIZVI_INDICATOR_CONFLUENCE: {
      symbol, timeframe: '1M', timestamp: now, action: 'WAIT', components: { RSI: { status: 'CALCULATED', bias: 0 } }
    },
    RIZVI_MULTI_ALGORITHM_REPORT: {
      symbol, timeframe: '1M', timestamp: now, algorithms: { A_TREND: { action: 'WAIT', confidence: 50 } }
    },
    RIZVI_ENGINE4_CONTEXT: {},
    prompt: (_message, value) => { win.promptValue = value; }
  };
  const logs = [];
  const context = { window: win, console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args) }, Date, JSON, Math, Number, String, Array, Object };
  const result = vm.runInNewContext(source, context);
  return { result, win, logs };
}

test('exports validated canonical Gold snapshot without network or global mutation', () => {
  const { result, win } = runExporter();
  assert.equal(result.validation.candidateUsable, true);
  assert.equal(result.bars.length, 50);
  assert.equal(result.symbol, 'XAU/USD');
  assert.equal(result.autoTrading, false);
  assert.ok(win.promptValue.includes('rizvi-engine5-shadow-snapshot-v1'));
  assert.equal(typeof win.fetch, 'undefined');
});

test('refuses to export any market data when the selected symbol is BTC', () => {
  const { result, win } = runExporter({ symbol: 'BTCUSD' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.validation.problems)), ['NOT_GOLD_SYMBOL']);
  assert.equal(Object.hasOwn(result, 'bars'), false);
  assert.equal(win.promptValue, undefined);
});

test('marks an old canonical snapshot and feed status unusable', () => {
  const { result } = runExporter({ stale: true });
  assert.equal(result.validation.candidateUsable, false);
  assert.ok(result.validation.problems.includes('CANONICAL_SNAPSHOT_MISSING_OR_STALE'));
  assert.ok(result.validation.problems.includes('FEED_STATUS_MISSING_OR_STALE'));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSnapshot } = require('../engine5-shadow-evaluator');

function snapshot(now = Date.now()) {
  const timestamp = new Date(now).toISOString();
  const start = Math.floor((now - 20 * 60000) / 1000);
  const bars = Array.from({length: 21}, (_, i) => {
    const o = 2300 + i, c = o + 0.2;
    return {t: start + i * 60, o, h: c + 0.2, l: o - 0.2, c, v: 100};
  });
  const components = {
    'EMA 9/21': {status: 'CALCULATED', bias: 1},
    'Trend (5)': {status: 'CALCULATED', bias: 1},
    'RSI-14': {status: 'CALCULATED', bias: 1},
    'VWAP Filter': {status: 'CALCULATED', bias: 1},
    'Candle Patterns / Price Action': {status: 'CALCULATED', bias: 1},
    'Market Structure': {status: 'CALCULATED', bias: 1}
  };
  const algorithms = Object.fromEntries(Array.from({length: 5}, (_, i) =>
    ['algo' + i, {action: 'BUY', confidence: 90}]));
  return {
    symbol: 'XAU/USD', timeframe: '1M', bars,
    feedStatus: {ok: true, live: true, stale: false, symbol: 'XAU/USD', timeframe: '1M'},
    confluence: {symbol: 'XAU/USD', timeframe: '1M', timestamp, action: 'BUY', components},
    algorithmReport: {symbol: 'XAU/USD', timeframe: '1M', timestamp, algorithms},
    engine4Context: {}
  };
}

test('shadow entry point returns WAIT and precise blockers for invalid snapshots', () => {
  const now = Date.now();
  const input = snapshot(now);
  input.feedStatus.stale = true;
  const result = evaluateSnapshot(input, {now});
  assert.equal(result.action, 'WAIT');
  assert.equal(result.qualified, false);
  assert.equal(result.autoTrading, false);
  assert.ok(result.blockers.includes('SNAPSHOT_VALIDATION_FAILED'));
  assert.ok(result.blockers.includes('FEED_NOT_VALIDATED_LIVE'));
});

test('valid snapshot reaches candidate evaluator in shadow-only mode', () => {
  const now = Date.now();
  const result = evaluateSnapshot(snapshot(now), {now, qualifiedRunCount: 0});
  assert.equal(result.snapshotValidation.valid, true);
  assert.equal(result.mode, 'SHADOW_CANDIDATE');
  assert.equal(result.autoTrading, false);
  assert.ok(['BUY', 'SELL', 'WAIT'].includes(result.action));
});

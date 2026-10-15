'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { captureRuntimeSnapshot } = require('../engine5-runtime-snapshot-bridge');

test('captures actual Gold runtime reports and prefers chart-aggregated bars', () => {
  const agg = [{ t: 1000, o: 1, h: 2, l: 1, c: 2 }];
  const raw = [{ t: 900, o: 1, h: 1, l: 1, c: 1 }];
  const feed = { ok: true, live: true, stale: false, symbol: 'XAU/USD', timeframe: '1M' };
  const confluence = { symbol: 'XAU/USD', timeframe: '1M', timestamp: 1000, action: 'SELL', components: { RSI: { bias: -1 } } };
  const algorithms = { symbol: 'XAU/USD', timeframe: '1M', timestamp: 1000, algorithms: { A_TREND: { action: 'SELL', confidence: 80 } } };
  const snapshot = captureRuntimeSnapshot({
    RIZVI_CURRENT_SYMBOL: 'XAU/USD',
    RIZVI_CANDLE_TIMEFRAME: '1M',
    RIZVI_AGG_BARS: agg,
    RIZVI_RAW_BARS: raw,
    RIZVI_FEED_STATUS: feed,
    RIZVI_INDICATOR_CONFLUENCE: confluence,
    RIZVI_MULTI_ALGORITHM_REPORT: algorithms,
    RIZVI_ENGINE4_CONTEXT: { session: { status: 'LIVE' } }
  });
  assert.equal(snapshot.symbol, 'XAU/USD');
  assert.equal(snapshot.timeframe, '1M');
  assert.deepEqual(snapshot.bars, agg);
  assert.equal(snapshot.feedStatus, feed);
  assert.equal(snapshot.confluence, confluence);
  assert.equal(snapshot.algorithmReport, algorithms);
  assert.equal(snapshot.sourceMeta.barSource, 'RIZVI_AGG_BARS');
  assert.equal(snapshot.sourceMeta.feedSource, 'RIZVI_FEED_STATUS');
});

test('falls back to raw bars and Gold engine feed without inventing live status', () => {
  const raw = [{ t: 1000, o: 1, h: 2, l: 1, c: 2 }];
  const feed = { symbol: 'XAU/USD', timeframe: '1M', ok: false, live: false };
  const snapshot = captureRuntimeSnapshot({
    RIZVI_RAW_BARS: raw,
    RIZVI_GOLD_ENGINE_STATUS: { feed }
  });
  assert.deepEqual(snapshot.bars, raw);
  assert.equal(snapshot.feedStatus, feed);
  assert.equal(snapshot.symbol, 'XAU/USD');
  assert.equal(snapshot.timeframe, '1M');
  assert.equal(snapshot.feedStatus.live, false);
  assert.equal(snapshot.sourceMeta.barSource, 'RIZVI_RAW_BARS');
  assert.equal(snapshot.sourceMeta.feedSource, 'RIZVI_GOLD_ENGINE_STATUS.feed');
});

test('returns explicit missing-source metadata when runtime has no data', () => {
  const snapshot = captureRuntimeSnapshot({});
  assert.equal(snapshot.symbol, 'UNKNOWN');
  assert.equal(snapshot.timeframe, 'UNKNOWN');
  assert.deepEqual(snapshot.bars, []);
  assert.equal(snapshot.feedStatus.ok, undefined);
  assert.equal(snapshot.sourceMeta.barSource, 'MISSING');
  assert.equal(snapshot.sourceMeta.feedSource, 'MISSING');
});

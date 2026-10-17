'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { captureRuntimeSnapshot } = require('../engine5-runtime-snapshot-bridge');

test('prefers validated canonical snapshot bars and status over chart buffers', () => {
  const canonicalBars = [{ t: 1000, o: 1, h: 2, l: 1, c: 2 }];
  const chartBars = [{ t: 900, o: 1, h: 1, l: 1, c: 1 }];
  const feed = { ok: true, live: true, stale: false, symbol: 'XAU/USD', timeframe: '1M' };
  const confluence = { symbol: 'XAU/USD', timeframe: '1M', timestamp: 1000, action: 'SELL', components: { RSI: { bias: -1 } } };
  const algorithms = { symbol: 'XAU/USD', timeframe: '1M', timestamp: 1000, algorithms: { A_TREND: { action: 'SELL', confidence: 80 } } };
  const canonical = {
    version: 1, symbol: 'XAU/USD', timeframe: '1M', capturedAt: 1000,
    latestBarAt: 1000, latestAgeMs: 0, status: feed, bars: canonicalBars
  };
  const snapshot = captureRuntimeSnapshot({
    RIZVI_CANONICAL_FEED_SNAPSHOT: canonical,
    RIZVI_CANONICAL_FEED_STATUS: { ok: false, live: false, symbol: 'BTCUSD', timeframe: '1M' },
    RIZVI_AGG_BARS: chartBars,
    RIZVI_RAW_BARS: chartBars,
    RIZVI_CURRENT_SYMBOL: 'XAU/USD',
    RIZVI_CANDLE_TIMEFRAME: '1M',
    RIZVI_INDICATOR_CONFLUENCE: confluence,
    RIZVI_MULTI_ALGORITHM_REPORT: algorithms,
    RIZVI_ENGINE4_CONTEXT: { session: { status: 'LIVE' } }
  });
  assert.equal(snapshot.symbol, 'XAU/USD');
  assert.equal(snapshot.timeframe, '1M');
  assert.deepEqual(snapshot.bars, canonicalBars);
  assert.equal(snapshot.feedStatus, feed);
  assert.equal(snapshot.confluence, confluence);
  assert.equal(snapshot.algorithmReport, algorithms);
  assert.equal(snapshot.snapshotMeta.capturedAt, 1000);
  assert.equal(snapshot.sourceMeta.barSource, 'RIZVI_CANONICAL_FEED_SNAPSHOT.bars');
  assert.equal(snapshot.sourceMeta.feedSource, 'RIZVI_CANONICAL_FEED_SNAPSHOT.status');
});

test('uses canonical raw bars only when canonical snapshot bars are absent', () => {
  const raw = [{ t: 1000, o: 1, h: 2, l: 1, c: 2 }];
  const chartBars = [{ t: 900, o: 1, h: 1, l: 1, c: 1 }];
  const feed = { symbol: 'XAU/USD', timeframe: '1M', ok: false, live: false };
  const snapshot = captureRuntimeSnapshot({
    RIZVI_CANONICAL_RAW_BARS: raw,
    RIZVI_RAW_BARS: chartBars,
    RIZVI_GOLD_ENGINE_STATUS: { feed }
  });
  assert.deepEqual(snapshot.bars, raw);
  assert.equal(snapshot.feedStatus, feed);
  assert.equal(snapshot.symbol, 'XAU/USD');
  assert.equal(snapshot.timeframe, '1M');
  assert.equal(snapshot.feedStatus.live, false);
  assert.equal(snapshot.sourceMeta.barSource, 'RIZVI_CANONICAL_RAW_BARS');
  assert.equal(snapshot.sourceMeta.feedSource, 'RIZVI_GOLD_ENGINE_STATUS.feed');
});

test('does not fall back to chart-only bars when canonical feed data is missing', () => {
  const snapshot = captureRuntimeSnapshot({
    RIZVI_RAW_BARS: [{ t: 1000, o: 1, h: 2, l: 1, c: 2 }],
    RIZVI_AGG_BARS: [{ t: 1000, o: 1, h: 2, l: 1, c: 2 }]
  });
  assert.equal(snapshot.symbol, 'UNKNOWN');
  assert.equal(snapshot.timeframe, 'UNKNOWN');
  assert.deepEqual(snapshot.bars, []);
  assert.equal(snapshot.feedStatus.ok, undefined);
  assert.equal(snapshot.sourceMeta.barSource, 'MISSING');
  assert.equal(snapshot.sourceMeta.feedSource, 'MISSING');
});

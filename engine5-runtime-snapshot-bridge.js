/**
 * Maps the dashboard's validated canonical feed snapshot and live reports
 * into the isolated Engine 5 shadow schema. Chart-rendering buffers are
 * deliberately not accepted as a substitute for validated canonical OHLC.
 */
'use strict';

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function captureRuntimeSnapshot(runtime = {}) {
  const canonicalSnapshot = objectOrEmpty(runtime.RIZVI_CANONICAL_FEED_SNAPSHOT);
  const goldStatus = objectOrEmpty(runtime.RIZVI_GOLD_ENGINE_STATUS);
  const feedStatus = objectOrEmpty(
    canonicalSnapshot.status ||
    runtime.RIZVI_CANONICAL_FEED_STATUS ||
    runtime.RIZVI_FEED_STATUS ||
    goldStatus.feed
  );
  const confluence = objectOrEmpty(
    runtime.RIZVI_INDICATOR_CONFLUENCE ||
    runtime.RIZVI_INDICATOR_TEST_REPORT?.master
  );
  const algorithmReport = objectOrEmpty(runtime.RIZVI_MULTI_ALGORITHM_REPORT);
  const engine4Context = objectOrEmpty(runtime.RIZVI_ENGINE4_CONTEXT);

  const snapshotBars = Array.isArray(canonicalSnapshot.bars) ? canonicalSnapshot.bars : [];
  const canonicalRaw = Array.isArray(runtime.RIZVI_CANONICAL_RAW_BARS)
    ? runtime.RIZVI_CANONICAL_RAW_BARS : [];
  const bars = snapshotBars.length ? snapshotBars : canonicalRaw;
  const barSource = snapshotBars.length ? 'RIZVI_CANONICAL_FEED_SNAPSHOT.bars'
    : canonicalRaw.length ? 'RIZVI_CANONICAL_RAW_BARS' : 'MISSING';

  return {
    symbol: canonicalSnapshot.symbol || runtime.RIZVI_CURRENT_SYMBOL ||
      feedStatus.symbol || confluence.symbol || algorithmReport.symbol || 'UNKNOWN',
    timeframe: canonicalSnapshot.timeframe || runtime.RIZVI_CANDLE_TIMEFRAME ||
      feedStatus.timeframe || confluence.timeframe || algorithmReport.timeframe || 'UNKNOWN',
    bars: bars.slice(),
    feedStatus,
    confluence,
    algorithmReport,
    engine4Context,
    snapshotMeta: {
      version: canonicalSnapshot.version ?? null,
      capturedAt: canonicalSnapshot.capturedAt ?? null,
      latestBarAt: canonicalSnapshot.latestBarAt ?? null,
      latestAgeMs: canonicalSnapshot.latestAgeMs ?? null
    },
    sourceMeta: {
      barSource,
      feedSource: canonicalSnapshot.status ? 'RIZVI_CANONICAL_FEED_SNAPSHOT.status' :
        runtime.RIZVI_CANONICAL_FEED_STATUS ? 'RIZVI_CANONICAL_FEED_STATUS' :
        runtime.RIZVI_FEED_STATUS ? 'RIZVI_FEED_STATUS' :
        goldStatus.feed ? 'RIZVI_GOLD_ENGINE_STATUS.feed' : 'MISSING'
    }
  };
}

module.exports = { captureRuntimeSnapshot };

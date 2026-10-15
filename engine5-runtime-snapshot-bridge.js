/**
 * Maps the dashboard's actual browser runtime globals into the isolated
 * Engine 5 shadow snapshot schema. No globals are read implicitly and no
 * missing feed/report values are fabricated.
 */
'use strict';

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function captureRuntimeSnapshot(runtime = {}) {
  const goldStatus = objectOrEmpty(runtime.RIZVI_GOLD_ENGINE_STATUS);
  const feedStatus = objectOrEmpty(
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
  const aggregated = Array.isArray(runtime.RIZVI_AGG_BARS) ? runtime.RIZVI_AGG_BARS : [];
  const raw = Array.isArray(runtime.RIZVI_RAW_BARS) ? runtime.RIZVI_RAW_BARS : [];
  const bars = aggregated.length ? aggregated : raw;

  return {
    symbol: runtime.RIZVI_CURRENT_SYMBOL || feedStatus.symbol ||
      confluence.symbol || algorithmReport.symbol || 'UNKNOWN',
    timeframe: runtime.RIZVI_CANDLE_TIMEFRAME || feedStatus.timeframe ||
      confluence.timeframe || algorithmReport.timeframe || 'UNKNOWN',
    bars: bars.slice(),
    feedStatus,
    confluence,
    algorithmReport,
    engine4Context,
    sourceMeta: {
      barSource: aggregated.length ? 'RIZVI_AGG_BARS' : raw.length ? 'RIZVI_RAW_BARS' : 'MISSING',
      feedSource: runtime.RIZVI_CANONICAL_FEED_STATUS ? 'RIZVI_CANONICAL_FEED_STATUS' :
        runtime.RIZVI_FEED_STATUS ? 'RIZVI_FEED_STATUS' :
        goldStatus.feed ? 'RIZVI_GOLD_ENGINE_STATUS.feed' : 'MISSING'
    }
  };
}

module.exports = { captureRuntimeSnapshot };

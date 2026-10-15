/*
 * Rizvi Dashboard V5 — read-only Engine 5 shadow snapshot exporter.
 *
 * Use ONLY in the browser console on the dashboard's non-production preview
 * or when the owner explicitly authorizes a one-time local production-page
 * diagnostic capture. This script does not send network requests, modify
 * dashboard globals, or execute trades. It exports Gold-only canonical data.
 *
 * Paste the entire file into the browser DevTools console. It prints a JSON
 * string and opens a prompt for copying it. Review the output before sharing.
 */
(function rizviEngine5SnapshotExport() {
  'use strict';
  const W = window;
  const snap = W.RIZVI_CANONICAL_FEED_SNAPSHOT;
  const feed = snap && snap.status || W.RIZVI_CANONICAL_FEED_STATUS || W.RIZVI_FEED_STATUS || {};
  const confluence = W.RIZVI_INDICATOR_CONFLUENCE || W.RIZVI_INDICATOR_TEST_REPORT?.master || {};
  const algorithms = W.RIZVI_MULTI_ALGORITHM_REPORT || {};
  const engine4 = W.RIZVI_ENGINE4_CONTEXT || {};
  const symbol = String(snap?.symbol || W.RIZVI_CURRENT_SYMBOL || feed.symbol || '').toUpperCase().replace(/\s/g, '');
  const timeframe = String(snap?.timeframe || W.RIZVI_CANDLE_TIMEFRAME || feed.timeframe || '').toUpperCase().replace(/\s/g, '');
  if (!/^XAU\\/?USD$/.test(symbol) && symbol !== 'GOLD') {
    const rejected = { schema: 'rizvi-engine5-shadow-snapshot-v1', validation: { candidateUsable: false, problems: ['NOT_GOLD_SYMBOL'] }, autoTrading: false };
    console.warn('Engine 5 shadow export refused: Gold/XAUUSD must be selected. No market data was exported.');
    return rejected;
  }
  const bars = Array.isArray(snap?.bars) ? snap.bars : [];
  const now = Date.now();
  const reportTime = value => {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(String(value));
    return Number.isFinite(d) ? d : null;
  };
  const barTime = bar => reportTime(bar?.t ?? bar?.time ?? bar?.timestamp ?? bar?.date);
  const last = bars.at(-1);
  const latestBarMs = barTime(last);
  const snapshotMs = reportTime(snap?.capturedAt);
  const feedUpdatedMs = reportTime(feed.updatedAt);
  const indicatorMs = reportTime(confluence.timestamp);
  const algorithmMs = reportTime(algorithms.timestamp);
  const problems = [];
  if (!/^XAU\/?USD$/.test(symbol) && symbol !== 'GOLD') problems.push('NOT_GOLD_SYMBOL');
  if (!snap || snap.version !== 1) problems.push('CANONICAL_SNAPSHOT_MISSING_OR_UNKNOWN_VERSION');
  if (feed.ok !== true || feed.live !== true || feed.stale === true) problems.push('FEED_NOT_VALIDATED_LIVE');
  if (String(feed.symbol || '').toUpperCase().replace(/\s/g, '') !== symbol) problems.push('FEED_SYMBOL_MISMATCH');
  if (String(feed.timeframe || '').toUpperCase().replace(/\s/g, '') !== timeframe) problems.push('FEED_TIMEFRAME_MISMATCH');
  if (bars.length < 50) problems.push('FEWER_THAN_50_CANONICAL_BARS');
  if (!Number.isFinite(snapshotMs) || snapshotMs > now + 5000 || now - snapshotMs > 180000) problems.push('CANONICAL_SNAPSHOT_MISSING_OR_STALE');
  if (!Number.isFinite(feedUpdatedMs) || feedUpdatedMs > now + 5000 || now - feedUpdatedMs > 180000) problems.push('FEED_STATUS_MISSING_OR_STALE');
  if (!Number.isFinite(latestBarMs) || latestBarMs > now + 5000 || now - latestBarMs > 180000) problems.push('LATEST_BAR_MISSING_OR_STALE');
  if (!Number.isFinite(indicatorMs) || now - indicatorMs < -5000 || now - indicatorMs > 15000) problems.push('INDICATOR_REPORT_MISSING_OR_STALE');
  if (!Number.isFinite(algorithmMs) || now - algorithmMs < -5000 || now - algorithmMs > 15000) problems.push('ALGORITHM_REPORT_MISSING_OR_STALE');
  if (Number.isFinite(indicatorMs) && Number.isFinite(algorithmMs) && Math.abs(indicatorMs - algorithmMs) > 15000) problems.push('REPORT_TIMESTAMP_SKEW');

  const output = {
    schema: 'rizvi-engine5-shadow-snapshot-v1',
    capturedAt: new Date(now).toISOString(),
    symbol: snap?.symbol || W.RIZVI_CURRENT_SYMBOL || feed.symbol || null,
    timeframe: snap?.timeframe || W.RIZVI_CANDLE_TIMEFRAME || feed.timeframe || null,
    validation: { candidateUsable: problems.length === 0, problems },
    feedStatus: {
      ok: feed.ok === true, live: feed.live === true, stale: feed.stale === true,
      source: feed.source || null, symbol: feed.symbol || null, timeframe: feed.timeframe || null,
      updatedAt: feed.updatedAt ?? null, latestBarAt: feed.latestBarAt ?? null,
      reason: feed.reason || null
    },
    snapshotMeta: {
      version: snap?.version ?? null, capturedAt: snap?.capturedAt ?? null,
      capturedAgeMs: Number.isFinite(snapshotMs) ? now - snapshotMs : null,
      latestBarAt: snap?.latestBarAt ?? null, latestAgeMs: snap?.latestAgeMs ?? null,
      canonicalBarCount: bars.length, latestBarAgeMs: Number.isFinite(latestBarMs) ? now - latestBarMs : null
    },
    bars: bars.map(b => ({
      t: b?.t ?? b?.time ?? b?.timestamp ?? b?.date ?? null,
      o: b?.o ?? b?.open ?? null, h: b?.h ?? b?.high ?? null,
      l: b?.l ?? b?.low ?? null, c: b?.c ?? b?.close ?? null,
      v: b?.v ?? b?.volume ?? null
    })),
    confluence: {
      symbol: confluence.symbol || null, timeframe: confluence.timeframe || null,
      timestamp: confluence.timestamp ?? null, action: confluence.action || null,
      score: confluence.score ?? null, agreement: confluence.agreement ?? null,
      components: confluence.components || {}
    },
    algorithmReport: {
      symbol: algorithms.symbol || null, timeframe: algorithms.timeframe || null,
      timestamp: algorithms.timestamp ?? null, algorithms: algorithms.algorithms || {},
      ranking: algorithms.ranking || null, master: algorithms.master || null
    },
    engine4Context: {
      dxy: engine4.dxy || null, usNews: engine4.usNews || null,
      session: engine4.session || null, dayHighLow: engine4.dayHighLow || null
    },
    autoTrading: false
  };
  const json = JSON.stringify(output, null, 2);
  console.log('RIZVI_ENGINE5_SHADOW_SNAPSHOT_JSON_BEGIN');
  console.log(json);
  console.log('RIZVI_ENGINE5_SHADOW_SNAPSHOT_JSON_END');
  if (typeof W.prompt === 'function') W.prompt('Copy the read-only Gold shadow snapshot JSON. Review it before sharing.', json);
  return output;
})();

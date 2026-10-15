/**
 * Adapter from the current Rizvi Dashboard V5 production reports to the
 * isolated Engine 5 regime-adaptive evaluator. Pure function; no globals,
 * network, DOM, timers, or order execution.
 */
'use strict';

function canonicalSymbol(value) {
  const s = String(value || '').toUpperCase().replace(/\s/g, '');
  if (/^(XAU\/?USD|GOLD)$/.test(s)) return 'XAUUSD';
  if (s.replace(/[^A-Z0-9]/g, '') === 'BTCUSD') return 'BTCUSD';
  return s || 'UNKNOWN';
}

function canonicalTimeframe(value) {
  const s = String(value || '1M').toUpperCase().replace(/\s/g, '');
  const aliases = { '1': '1M', '1MIN': '1M', '1MINUTE': '1M', '5': '5M',
    '5MIN': '5M', '15': '15M', '15MIN': '15M', '30': '30M', '30MIN': '30M',
    '60': '1H', '60M': '1H', '1HR': '1H', 'H1': '1H', D: '1D', D1: '1D' };
  return aliases[s] || s;
}

function normalizeBar(bar) {
  if (!bar || typeof bar !== 'object') return null;
  const tRaw = bar.t ?? bar.time ?? bar.timestamp ?? bar.date;
  let t = Number(tRaw);
  if (!Number.isFinite(t) && typeof tRaw === 'string') t = Date.parse(tRaw);
  const o = Number(bar.o ?? bar.open), h = Number(bar.h ?? bar.high);
  const l = Number(bar.l ?? bar.low), c = Number(bar.c ?? bar.close);
  const vRaw = bar.v ?? bar.volume;
  const v = vRaw == null ? null : Number(vRaw);
  if (![o, h, l, c].every(Number.isFinite) || Math.min(o, h, l, c) <= 0 ||
      h < Math.max(o, c) || l > Math.min(o, c)) return null;
  return { t: Number.isFinite(t) ? t : null, o, h, l, c,
    ...(Number.isFinite(v) && v >= 0 ? { v } : {}) };
}

function normalizeComponents(components) {
  const out = {};
  for (const [name, item] of Object.entries(components || {})) {
    if (!item || typeof item !== 'object') continue;
    const status = String(item.status || '').toUpperCase();
    const unavailable = /UNAVAILABLE|WAITING|INSUFFICIENT|NO_REAL_VOLUME|NO_REAL_ORDER_FLOW|NO_TRADE_SIDE_VOLUME|NOT_ATTACHED|BLOCKED|STALE|ERROR/.test(status);
    if (unavailable) {
      out[name] = { status: status || 'UNAVAILABLE', bias: null };
      continue;
    }
    const rawBias = item.bias;
    const bias = rawBias == null || rawBias === '' ? null : Number(rawBias);
    out[name] = {
      status: status || 'REPORTED',
      ...(Number.isFinite(bias) && bias >= -1 && bias <= 1 ? { bias } : {}),
      ...(item.direction != null ? { direction: item.direction } : {}),
      ...(item.action != null ? { action: item.action } : {}),
      ...(item.signal != null ? { signal: item.signal } : {}),
      ...(Number.isFinite(Number(item.reliability)) && item.reliability != null
        ? { reliability: Number(item.reliability) } : {})
    };
  }
  return out;
}

function buildInput(snapshot = {}) {
  const confluence = snapshot.confluence || snapshot.indicatorConfluence || {};
  const algorithmReport = snapshot.algorithmReport || snapshot.multiAlgorithmReport || {};
  const engine4 = snapshot.engine4Context || {};
  const feed = snapshot.feedStatus || snapshot.canonicalFeedStatus || {};
  const bars = (Array.isArray(snapshot.bars) ? snapshot.bars : [])
    .map(normalizeBar).filter(Boolean);
  const sourceComponents = confluence.components || confluence.master?.components ||
    snapshot.components || {};
  const sourceAlgorithms = algorithmReport.algorithms || snapshot.algorithms || {};
  const algorithms = {};
  for (const [name, item] of Object.entries(sourceAlgorithms)) {
    if (!item || typeof item !== 'object') continue;
    const action = String(item.action || 'WAIT').toUpperCase();
    algorithms[name] = {
      action: ['BUY', 'SELL', 'WAIT'].includes(action) ? action : 'WAIT',
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0
    };
  }
  const dxy = engine4.dxy || {};
  const indicatorAction = String(confluence.action || '').toUpperCase();
  const dxyConflict = dxy.status === 'LIVE' && Number(dxy.correlation) <= -0.25 &&
    String(dxy.dxyDirection || '').toUpperCase() === indicatorAction;
  return {
    symbol: canonicalSymbol(snapshot.symbol || confluence.symbol || algorithmReport.symbol || feed.symbol),
    timeframe: canonicalTimeframe(snapshot.timeframe || confluence.timeframe || algorithmReport.timeframe || feed.timeframe),
    bars,
    components: normalizeComponents(sourceComponents),
    algorithms,
    newsBlocked: engine4.usNews?.status === 'LIVE' && engine4.usNews.blocked === true,
    dxyConflict,
    sourceMeta: {
      feedStatus: feed.ok === true && feed.live === true && feed.stale !== true ? 'LIVE' : 'NOT_VALIDATED',
      indicatorTimestamp: confluence.timestamp || null,
      algorithmTimestamp: algorithmReport.timestamp || null,
      indicatorAction: ['BUY', 'SELL', 'WAIT'].includes(indicatorAction) ? indicatorAction : 'WAIT'
    }
  };
}

module.exports = { canonicalSymbol, canonicalTimeframe, normalizeBar, normalizeComponents, buildInput };

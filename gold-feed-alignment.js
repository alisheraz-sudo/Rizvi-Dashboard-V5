'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RIZVI_FEED_ALIGNMENT = api;
  if (root && root.document && typeof root.addEventListener === 'function') api.install(root);
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  const canonicalSymbol = value => {
    const s = String(value || '').toUpperCase().replace(/\s/g, '');
    if (/^(XAU\/USD|GOLD|XAUUSD)$/.test(s)) return 'XAU/USD';
    if (/^(BTCUSD|BTC\/USD|BTCUSDT|BTC\/USDT)$/.test(s)) return 'BTCUSD';
    return 'UNSUPPORTED';
  };

  const canonicalTimeframe = value => {
    const t = String(value || '1M').toUpperCase().replace(/\s/g, '');
    const aliases = {
      '1': '1M', '1MIN': '1M', '1MINUTE': '1M',
      '3': '3M', '3MIN': '3M',
      '5': '5M', '5MIN': '5M', '5MINUTE': '5M',
      '15': '15M', '15MIN': '15M', '15MINUTE': '15M',
      '30': '30M', '30MIN': '30M', '30MINUTE': '30M',
      '60': '1H', '60M': '1H', '1HR': '1H', 'H1': '1H',
      '120': '2H', '240': '4H', 'D': '1D', 'D1': '1D'
    };
    return aliases[t] || t;
  };

  function timestampMs(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return NaN;
    return n < 1e12 ? n * 1000 : n;
  }

  function buildStatus(state, now = Date.now()) {
    const symbol = canonicalSymbol(state.symbol);
    const timeframe = canonicalTimeframe(state.timeframe);
    const bars = Array.isArray(state.bars) ? state.bars : [];
    const validBars = bars.filter(b => b && [b.t ?? b.time ?? b.timestamp, b.o ?? b.open, b.h ?? b.high, b.l ?? b.low, b.c ?? b.close]
      .every(v => Number.isFinite(Number(v))));
    const last = validBars.length ? validBars.reduce((latest, b) => {
      const t = timestampMs(b.t ?? b.time ?? b.timestamp);
      return !latest || t > latest.ms ? { bar: b, ms: t } : latest;
    }, null) : null;
    const ageMs = last ? now - last.ms : Infinity;
    const latestAgeSeconds = Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 1000)) : null;
    const chartStatus = String(state.chartStatus || '').toUpperCase();
    const chartSymbol = canonicalSymbol(state.chartSymbol || state.symbol);
    const chartMatches = chartSymbol === symbol;
    const locked = state.goldMarketLocked === true && symbol === 'XAU/USD';
    const stale = state.stale === true || chartStatus === 'STALE' || chartStatus === 'CACHED' ||
      chartStatus === 'MARKET_CLOSED_LAST_AVAILABLE' || chartStatus === 'UNAVAILABLE';
    const live = chartStatus === 'LIVE' && !stale && !locked && chartMatches;
    const fresh = !!last && Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 180000;
    const ok = symbol !== 'UNSUPPORTED' && chartMatches && live && fresh && validBars.length >= 21;

    return {
      ok, symbol, timeframe, source: String(state.source || 'chart-ohlc'),
      bars: validBars.length, updatedAt: now,
      latestBarAt: last ? last.ms : null, latestAgeSeconds,
      live, stale: !live || !fresh, reason: ok ? null :
        locked ? 'Gold market polling is locked' :
        !chartMatches ? 'Chart symbol does not match selected symbol' :
        !live ? 'Chart is not confirmed LIVE' :
        validBars.length < 21 ? 'Insufficient valid OHLC bars' :
        !fresh ? 'Latest OHLC bar is stale or has an invalid timestamp' : 'Unsupported symbol'
    };
  }

  function install(win) {
    if (win.__RIZVI_FEED_ALIGNMENT_INSTALLED) return;
    win.__RIZVI_FEED_ALIGNMENT_INSTALLED = true;

    function refresh(event) {
      const detail = event && event.detail || {};
      const chart = win.RIZVI_CHART_STATUS || {};
      const symbol = win.RIZVI_CURRENT_SYMBOL || detail.symbol ||
        (win.document.getElementById('symbolSelect') || {}).value || 'XAU/USD';
      const timeframe = win.RIZVI_CANDLE_TIMEFRAME || detail.label || '1M';
      const chartStatus = chart.status || detail.status || '';
      const data = win.RIZVI_CHART_DATA && win.RIZVI_CHART_DATA[symbol];
      const state = {
        symbol,
        timeframe,
        bars: win.RIZVI_RAW_BARS,
        chartStatus,
        chartSymbol: chart.symbol || detail.symbol || symbol,
        source: (data && data.source) || (chart.source) || 'Rizvi chart OHLC',
        stale: win.RIZVI_XAU_DATA_STALE === true && canonicalSymbol(symbol) === 'XAU/USD',
        goldMarketLocked: win.RIZVI_GOLD_MARKET_LOCKED === true
      };
      win.RIZVI_FEED_STATUS = buildStatus(state);
      try {
        win.dispatchEvent(new CustomEvent('rizvi:ohlc-feed-update', { detail: win.RIZVI_FEED_STATUS }));
      } catch (_) {}
    }

    ['rizvi:candle-update', 'rizvi:chart-status', 'rizvi:timeframe-update',
     'rizvi:chart-source', 'rizvi:direct-tv-status', 'rizvi:symbol-change'].forEach(name => {
      win.addEventListener(name, refresh);
    });
    refresh();
  }

  return { canonicalSymbol, canonicalTimeframe, timestampMs, buildStatus, install };
});

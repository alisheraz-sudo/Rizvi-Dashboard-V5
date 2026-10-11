'use strict';

const SYMBOLS = new Map([
  ['XAUUSD', 'XAUUSD'], ['XAUUSDX', 'XAUUSD'], ['XAUUSDSPOT', 'XAUUSD'],
  ['GOLD', 'XAUUSD'], ['XAU', 'XAUUSD'],
  ['BTCUSD', 'BTCUSD'], ['BTCUSD', 'BTCUSD'], ['BTCUSDT', 'BTCUSD'],
  ['BTC-USD', 'BTCUSD']
]);
const TIMEFRAMES = new Set(['1m', '5m', '15m', '30m', '1h']);

function normalizeSymbol(value) {
  const key = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return SYMBOLS.get(key) || null;
}

function normalizeBars(bars) {
  return bars.map((bar) => {
    if (!bar || typeof bar !== 'object' || Array.isArray(bar)) return bar;
    return {
      timestamp: bar.timestamp ?? bar.t ?? bar.time,
      open: bar.open ?? bar.o,
      high: bar.high ?? bar.h,
      low: bar.low ?? bar.l,
      close: bar.close ?? bar.c,
      volume: bar.volume ?? bar.v ?? 0
    };
  });
}

function validateDashboardPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'JSON object required';
  if (!normalizeSymbol(payload.symbol)) return 'Unsupported symbol';
  if (!TIMEFRAMES.has(String(payload.timeframe || '').toLowerCase())) return 'Unsupported timeframe';
  if (!Array.isArray(payload.bars) || payload.bars.length < 60) return 'At least 60 OHLCV bars are required';
  if (payload.bars.length > 2000) return 'Too many bars';
  return null;
}

async function evaluateDiagnostics(payload, options = {}) {
  const error = validateDashboardPayload(payload);
  if (error) return { status: 422, body: { ok: false, signal: 'WAIT', confidence: null, reason: error, autoTrading: false } };

  const baseUrl = String(options.baseUrl ?? process.env.RIZVI_INDICATOR_ENGINE_URL ?? '').trim();
  if (!baseUrl) {
    return { status: 503, body: { ok: false, enabled: false, signal: 'WAIT', confidence: null,
      reason: 'Indicator diagnostics engine is not configured', autoTrading: false } };
  }

  let endpoint;
  try {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('invalid URL');
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/evaluate';
    parsed.search = '';
    parsed.hash = '';
    endpoint = parsed.toString();
  } catch {
    return { status: 503, body: { ok: false, enabled: false, signal: 'WAIT', confidence: null,
      reason: 'Indicator diagnostics engine URL is invalid', autoTrading: false } };
  }

  const requestBody = {
    symbol: normalizeSymbol(payload.symbol),
    timeframe: String(payload.timeframe).toLowerCase(),
    bars: normalizeBars(payload.bars),
    ...(payload.order_flow && typeof payload.order_flow === 'object' && !Array.isArray(payload.order_flow)
      ? { order_flow: payload.order_flow } : {})
  };

  try {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(options.timeoutMs || 8000),
      cache: 'no-store'
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 502, body: { ok: false, signal: 'WAIT', confidence: null,
        reason: 'Diagnostics engine returned an invalid response', autoTrading: false } };
    }
    // Fail closed even if a misconfigured/legacy engine returns a trade-like signal.
    if (body.autoTrading !== false) body.autoTrading = false;
    if (!response.ok) {
      return { status: response.status >= 400 && response.status < 600 ? response.status : 502,
        body: { ...body, ok: false, signal: 'WAIT', confidence: null, autoTrading: false } };
    }
    return { status: 200, body: { ...body, autoTrading: false } };
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { status: 502, body: { ok: false, signal: 'WAIT', confidence: null,
      reason: timeout ? 'Diagnostics engine timed out' : 'Diagnostics engine unavailable', autoTrading: false } };
  }
}

module.exports = { evaluateDiagnostics, normalizeSymbol, normalizeBars, validateDashboardPayload };

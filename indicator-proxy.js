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

function epochSeconds(value) {
  if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed / 1000 : NaN;
  }
  let stamp = Number(value);
  if (!Number.isFinite(stamp)) return NaN;
  if (stamp > 100_000_000_000_000) stamp /= 1_000_000;
  else if (stamp > 100_000_000_000) stamp /= 1000;
  return stamp;
}

function normalizeBars(bars) {
  if (!Array.isArray(bars)) return [];
  const normalized = bars.map((bar) => {
    if (!bar || typeof bar !== 'object' || Array.isArray(bar)) return null;
    const timestamp = epochSeconds(bar.timestamp ?? bar.t ?? bar.time);
    const open = Number(bar.open ?? bar.o), high = Number(bar.high ?? bar.h);
    const low = Number(bar.low ?? bar.l), close = Number(bar.close ?? bar.c);
    const volume = Number(bar.volume ?? bar.v ?? 0);
    if (![timestamp, open, high, low, close, volume].every(Number.isFinite)) return null;
    if (Math.min(open, high, low, close) <= 0 || volume < 0 ||
        high < Math.max(open, close, low) || low > Math.min(open, close, high)) return null;
    return { timestamp, open, high, low, close, volume };
  }).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);

  // Providers may repeat the currently forming candle. Keep one valid bar per
  // timestamp so the Python contract receives strictly increasing candle times.
  const unique = [];
  for (const bar of normalized) {
    if (unique.length && unique[unique.length - 1].timestamp === bar.timestamp) {
      unique[unique.length - 1] = bar;
    } else {
      unique.push(bar);
    }
  }
  return unique;
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
  if (requestBody.bars.length < 60) {
    return { status: 422, body: { ok: false, signal: 'WAIT', confidence: null,
      reason: 'Fewer than 60 valid OHLCV bars remain after candle validation', autoTrading: false } };
  }

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

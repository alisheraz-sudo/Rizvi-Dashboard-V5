'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('indicator-diagnostics-bridge.js', 'utf8');

function harness({ symbol = 'XAU/USD', chartSymbol = 'XAUUSD', timeframe = '1M', barCount = 80, responseStatus = 200 } = {}) {
  const listeners = new Map();
  const events = [];
  const requests = [];
  const timers = [];
  const now = Math.floor(Date.now() / 1000);
  const bars = Array.from({ length: barCount }, (_, i) => {
    const close = 2600 + i * 0.1;
    return { t: now - (barCount - 1 - i) * 60, o: close - 0.05, h: close + 0.1, l: close - 0.1, c: close, v: 100 + i };
  });
  const window = {
    RIZVI_CURRENT_SYMBOL: symbol,
    RIZVI_CANDLE_TIMEFRAME: timeframe,
    RIZVI_RAW_BARS: bars,
    RIZVI_AGG_BARS: bars,
    RIZVI_CHART_STATUS: { symbol: chartSymbol, status: 'LIVE' },
    addEventListener: (name, fn) => {
      const list = listeners.get(name) || [];
      list.push(fn);
      listeners.set(name, list);
    },
    dispatchEvent: event => { events.push(event); return true; }
  };
  const document = {
    visibilityState: 'visible',
    querySelector: () => null,
    getElementById: () => null
  };
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const context = {
    window, document, CustomEvent,
    fetch: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return {
        ok: responseStatus >= 200 && responseStatus < 300,
        status: responseStatus,
        json: async () => responseStatus === 503
          ? { ok: false, enabled: false, signal: 'WAIT', autoTrading: false }
          : { ok: responseStatus < 400, signal: 'WAIT', autoTrading: false }
      };
    },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    setInterval: () => 1,
    Date,
    Number, String, Array, Math, JSON, Error
  };
  vm.runInNewContext(source, context, { filename: 'indicator-diagnostics-bridge.js' });
  return { window, events, requests, timers, bars, listeners };
}

async function runInitialTick(h) {
  assert.equal(h.timers.length, 1, 'bridge should schedule one initial diagnostics tick');
  h.timers[0]();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('bridge forwards the active matching XAU symbol and 1m OHLCV bars', async () => {
  const h = harness();
  await runInitialTick(h);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/indicator-diagnostics');
  assert.equal(h.requests[0].body.symbol, 'XAUUSD');
  assert.equal(h.requests[0].body.timeframe, '1m');
  assert.equal(h.requests[0].body.bars.length, 80);
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.state, 'RESPONSE_RECEIVED');
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.autoTrading, false);
});

test('bridge fails closed when chart symbol and selected symbol differ', async () => {
  const h = harness({ symbol: 'XAU/USD', chartSymbol: 'BTCUSD' });
  await runInitialTick(h);
  assert.equal(h.requests.length, 0);
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.state, 'WAITING_FOR_SYMBOL_MATCH');
});

test('bridge does not send unsupported timeframes', async () => {
  const h = harness({ timeframe: '3M' });
  await runInitialTick(h);
  assert.equal(h.requests.length, 0);
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.state, 'WAITING_FOR_SUPPORTED_TIMEFRAME');
});

test('bridge waits until it has at least 60 bars', async () => {
  const h = harness({ barCount: 30 });
  await runInitialTick(h);
  assert.equal(h.requests.length, 0);
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.state, 'WAITING_FOR_60_BARS');
});


test('bridge forwards BTC candles only when the selected and chart symbols agree', async () => {
  const h = harness({ symbol: 'BTCUSD', chartSymbol: 'BTCUSD', timeframe: '5M' });
  await runInitialTick(h);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].body.symbol, 'BTCUSD');
  assert.equal(h.requests[0].body.timeframe, '5m');
  assert.equal(h.requests[0].body.bars.length, 80);
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.autoTrading, false);
});

test('bridge records engine failures without inventing a signal', async () => {
  const h = harness({ responseStatus: 502 });
  await runInitialTick(h);
  assert.equal(h.requests.length, 1);
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.state, 'ENGINE_ERROR');
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.autoTrading, false);
});

test('bridge clearly records an unconfigured engine response without enabling trading', async () => {
  const h = harness({ responseStatus: 503 });
  await runInitialTick(h);
  assert.equal(h.requests.length, 1);
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.state, 'ENGINE_NOT_CONFIGURED');
  assert.equal(h.window.RIZVI_PYTHON_DIAGNOSTICS.autoTrading, false);
});

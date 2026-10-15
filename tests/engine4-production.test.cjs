'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const masterEngine = fs.readFileSync('rizvi-master-engine.js', 'utf8');
const match = html.match(/<script id="rizvi-v5-indicator-confluence-v1">([\s\S]*?)<\/script>/);
assert.ok(match, 'production Engine 4 indicator script must exist in index.html');
const productionScript = match[1];

function fixtureBars(count = 260, volume = true) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const base = 2300 + i * 0.12 + Math.sin(i / 4) * 0.7;
    const open = base + Math.sin(i * 1.3) * 0.16;
    const close = base + 0.05 + Math.cos(i * 0.7) * 0.19;
    rows.push({
      time: 1790000000 + i * 60,
      open,
      high: Math.max(open, close) + 0.32,
      low: Math.min(open, close) - 0.28,
      close,
      volume: volume ? 100 + (i % 17) * 5 : 0
    });
  }
  return rows;
}

function runProduction(bars, extras = {}) {
  const sandbox = {
    console,
    Date,
    Math,
    Number,
    Array,
    Object,
    String,
    Intl,
    JSON,
    setTimeout: () => 0,
    setInterval: () => 0,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    document: { getElementById: () => ({ value: 'XAU/USD' }) },
    dispatchEvent: () => true,
    RIZVI_RAW_BARS: bars,
    RIZVI_CURRENT_SYMBOL: 'XAU/USD',
    RIZVI_CANDLE_TIMEFRAME: '1M',
    ...extras
  };
  sandbox.window = sandbox;
  vm.runInNewContext(productionScript, sandbox, { timeout: 3000, filename: 'production-engine4.js' });
  return { report: sandbox.RIZVI_RUN_INDICATOR_TESTS(), sandbox };
}

function referenceEma(values, n) {
  const k = 2 / (n + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}
function referenceRsi(values, n = 14) {
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let ag = gain / n, al = loss / n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    ag = (ag * (n - 1) + g) / n;
    al = (al * (n - 1) + l) / n;
  }
  if (ag === 0 && al === 0) return 50;
  if (al === 0) return 100;
  if (ag === 0) return 0;
  return 100 - 100 / (1 + ag / al);
}
function referenceAtr(bars, n = 14) {
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)));
  }
  let a = tr.slice(0, n).reduce((s, x) => s + x, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

const expectedNames = [
  'EMA 9/21','RSI-14','Trend (5)','VWAP Filter','Volatility Regime Filter','ATR (14)',
  'Market Structure','Structure Prediction','Candle Patterns / Price Action','Fair Value Gap (FVG)',
  'Support & Resistance','Volume Profile','Liquidity Pools / Sweeps',
  'Bullish/Bearish Divergence','Trading Sessions','Day High / Day Low',
  'DXY Inverse-Correlation Filter','High-Impact US News Filter'
];

test('Engine 4 returns the 18-indicator, four-engine roster and bounded outputs', () => {
  const bars = fixtureBars();
  const { report } = runProduction(bars);
  assert.equal(Object.keys(report.tests).length, 18);
  assert.deepEqual(Object.keys(report.tests).sort(), [...expectedNames].sort());
  for (const [name, row] of Object.entries(report.tests)) {
    assert.ok(row.score === null || (Number.isFinite(row.score) && row.score >= 0 && row.score <= 100), name + ' score range');
    assert.ok(row.bias === null || [-1, 0, 1].includes(row.bias), name + ' bias range');
    if (row.pass) assert.ok(row.hasValue, name + ' cannot pass without a value');
  }
  assert.equal(report.numericalAccuracyVerified, false, 'diagnostic run must not falsely claim market accuracy');
});

test('Engine 4 EMA, RSI and ATR agree with independent reference calculations', () => {
  const bars = fixtureBars();
  const { report } = runProduction(bars);
  const closes = bars.map(b => b.close);
  assert.ok(Math.abs(report.master.raw.ema9 - referenceEma(closes, 9)) < 1e-8, 'EMA 9');
  assert.ok(Math.abs(report.master.raw.ema21 - referenceEma(closes, 21)) < 1e-8, 'EMA 21');
  assert.ok(Math.abs(report.master.raw.rsi - referenceRsi(closes, 14)) < 1e-8, 'RSI-14');
  assert.ok(Math.abs(report.master.raw.atr - referenceAtr(bars, 14)) < 1e-8, 'ATR-14');
});

test('Engine 4 refuses to mark missing buyer/seller and external context feeds as live', () => {
  const { report } = runProduction(fixtureBars());
  const c = report.tests;
  assert.equal(Object.keys(c).length, 18);
  assert.ok(!('Delta Buy/Sell' in c));
  assert.ok(!('Order Flow / Footprint' in c));
  assert.equal(c['Trading Sessions'].pass, false);
  assert.equal(c['Day High / Day Low'].pass, false);
  assert.equal(c['DXY Inverse-Correlation Filter'].pass, false);
  assert.equal(c['High-Impact US News Filter'].pass, false);
});

test('Engine 4 omits removed components and preserves Volume Profile source validation', () => {
  const { report } = runProduction(fixtureBars(260, false));
  assert.equal(Object.keys(report.tests).length, 18);
  assert.ok(!('Delta Buy/Sell' in report.tests));
  assert.ok(!('Order Flow / Footprint' in report.tests));
  assert.equal(report.tests['VWAP Filter'].status, 'NO_REAL_VOLUME');
  assert.equal(report.tests['Volume Profile'].status, 'NO_REAL_VOLUME');
});

test('Engine 4 does not pass full combinations with insufficient history', () => {
  const { report } = runProduction(fixtureBars(5));
  assert.equal(report.bars, 5);
  assert.equal(report.combinations.C6.pass, false);
  assert.equal(report.combinations.C6.action, 'WAIT');
});


test('Engine 4 VWAP, Stochastic and Bollinger Bands match independent calculations', () => {
  const bars = fixtureBars();
  const { report } = runProduction(bars);
  const window = bars.slice(-100);
  const totalVolume = window.reduce((sum, b) => sum + b.volume, 0);
  const expectedVwap = window.reduce((sum, b) => sum + ((b.high + b.low + b.close) / 3) * b.volume, 0) / totalVolume;
  assert.ok(Math.abs(report.master.raw.vwap - expectedVwap) < 1e-8, 'VWAP');
  const closes = bars.map(b => b.close), last20 = closes.slice(-20);
  const mean = last20.reduce((sum, x) => sum + x, 0) / 20;
  const sd = Math.sqrt(last20.reduce((sum, x) => sum + (x - mean) ** 2, 0) / 20);
  assert.ok(Math.abs(report.master.raw.bollinger.mid - mean) < 1e-8, 'Bollinger mid');
  assert.ok(Math.abs(report.master.raw.bollinger.sd - sd) < 1e-8, 'Bollinger standard deviation');
  const kValues = [];
  for (let end = Math.max(13, bars.length - 5); end < bars.length; end++) {
    const slice = bars.slice(end - 13, end + 1);
    const high = Math.max(...slice.map(b => b.high)), low = Math.min(...slice.map(b => b.low));
    kValues.push(high === low ? 50 : 100 * (bars[end].close - low) / (high - low));
  }
  const expectedK = kValues.at(-1), expectedD = kValues.slice(-3).reduce((sum, x) => sum + x, 0) / Math.min(3, kValues.length);
  assert.ok(Math.abs(report.master.raw.stochastic.k - expectedK) < 1e-8, 'Stochastic %K');
  assert.ok(Math.abs(report.master.raw.stochastic.d - expectedD) < 1e-8, 'Stochastic %D');
});

test('Engine 4 identifies a known bullish FVG fixture without fabricating order flow', () => {
  const bars = fixtureBars();
  bars[bars.length - 3] = { ...bars[bars.length - 3], open: 2300, high: 2300.2, low: 2299.8, close: 2300.05, volume: 100 };
  bars[bars.length - 2] = { ...bars[bars.length - 2], open: 2300.7, high: 2301.1, low: 2300.6, close: 2301, volume: 100 };
  bars[bars.length - 1] = { ...bars[bars.length - 1], open: 2301.1, high: 2301.5, low: 2300.8, close: 2301.3, volume: 100 };
  const { report } = runProduction(bars);
  assert.match(report.tests['Fair Value Gap (FVG)'].status, /CALCULATED/);
  assert.match(report.tests['Fair Value Gap (FVG)'].hasValue ? report.tests['Fair Value Gap (FVG)'].status : '', /CALCULATED/);
  assert.match(report.master.components['Fair Value Gap (FVG)'].value, /BULLISH FVG/);
  assert.ok(!('Order Flow / Footprint' in report.tests));
});

test('Engine 4 recognizes a deterministic hammer candle fixture', () => {
  const bars = fixtureBars();
  bars[bars.length - 1] = { ...bars[bars.length - 1], open: 2300.5, high: 2300.62, low: 2300.05, close: 2300.6, volume: 100 };
  const { report } = runProduction(bars);
  assert.equal(report.master.components['Candle Patterns / Price Action'].value, 'HAMMER');
  assert.equal(report.master.components['Candle Patterns / Price Action'].bias, 1);
});


test('Engine 4 remains an 18-indicator roster when removed-feed payloads are supplied', () => {
  const context = {
    dxy: { status: 'LIVE', correlation: -0.72, dxyDirection: 'SELL', signal: 'INVERSE_CONFIRMED', source: 'synthetic test fixture' },
    usNews: { status: 'LIVE', blocked: true, activeEvent: { title: 'Test high-impact event' }, reason: 'synthetic test fixture' },
    session: { status: 'LIVE', active: ['LONDON'], source: 'synthetic test fixture' },
    dayHighLow: { status: 'LIVE', high: 2345, low: 2285, source: 'synthetic test fixture' }
  };
  const { report } = runProduction(fixtureBars(), {
    RIZVI_ENGINE4_CONTEXT: context,
    RIZVI_TRADE_DELTA: { buyVolume: 120, sellVolume: 80 },
    RIZVI_ORDER_FLOW_DEPTH: [{ bid: 120, ask: 80 }],
    RIZVI_ORDER_FLOW: { status: 'LIVE' }
  });
  assert.equal(Object.keys(report.tests).length, 18);
  assert.ok(!('Delta Buy/Sell' in report.tests));
  assert.ok(!('Order Flow / Footprint' in report.tests));
  const failed = Object.entries(report.tests).filter(([, row]) => !row.pass).map(([name]) => name);
  assert.deepEqual(failed, [], 'verified fixture inputs should activate the remaining 18 components');
  assert.match(report.master.components['High-Impact US News Filter'].value, /^BLOCK/);
  assert.equal(report.numericalAccuracyVerified, false, 'synthetic integration is not live-market accuracy');
});

test('Engine 4 rejects malformed OHLC rows from its production input', () => {
  const bars = fixtureBars();
  bars.push({ time: 1799999999, open: 2300, high: 2200, low: 2301, close: 2302, volume: 100 });
  const { report } = runProduction(bars);
  assert.equal(report.bars, 260);
});

test('Master Engine 5 has no removed scoring inputs and reports the 18-indicator design', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /version:'v5-18-indicators-4-engines'/);
  assert.doesNotMatch(html, /'Delta Buy\/Sell':missing/);
  assert.doesNotMatch(html, /'Order Flow \/ Footprint':missing/);
  assert.doesNotMatch(html, /BLOCKED_FEATURES|D_ORDERFLOW/);
  assert.match(html, /active=entries\.filter\(x=>Number\(x\?\.score\)>0/);
});


test('Master Engine 5 has no Delta/Order Flow options and reports 18 indicators across four engines', () => {
  assert.match(masterEngine, /totalIndicators:18/);
  assert.match(masterEngine, /engineCount:4/);
  assert.match(masterEngine, /weightsTotal:96/);
  assert.doesNotMatch(masterEngine, /delta|order.?flow|footprint/i);
  assert.match(html, /totalIndicators:18,engineCount:4/);
});

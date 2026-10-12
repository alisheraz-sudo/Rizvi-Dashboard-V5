'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('rizvi-engine4-filters.js', 'utf8');

function makePriceSeries(endSec, dayStart) {
  const count = Math.floor((endSec - dayStart) / 300) + 2;
  const gold = [2300], dxy = [100];
  for (let j = 1; j < count; j++) {
    const r = 0.0001 + (j % 7) * 0.00003;
    gold.push(gold[j - 1] * (1 + r));
    dxy.push(dxy[j - 1] * (1 - r));
  }
  return { gold, dxy };
}
function makeMinuteBars(dayStart, endSec) {
  const out = [], prices = makePriceSeries(endSec, dayStart).gold;
  for (let t = dayStart; t <= endSec; t += 60) {
    const j = Math.floor((t - dayStart) / 300);
    const c = prices[j];
    out.push({ t, o: c - 0.01, h: c + 0.12, l: c - 0.12, c, v: 100 + (j % 9) });
  }
  return out;
}
function makeDxyBars(dayStart, endSec) {
  const out = [], prices = makePriceSeries(endSec, dayStart).dxy;
  for (let t = dayStart; t <= endSec; t += 300) {
    const j = Math.floor((t - dayStart) / 300);
    const c = prices[j];
    out.push({ t, o: c + 0.001, h: c + 0.02, l: c - 0.02, c, v: 1 });
  }
  return out;
}
async function runContext({ bars, payload, symbol = 'XAU/USD' }) {
  const now = Date.now();
  const sandbox = {
    Date, Math, Number, String, Array, Object, Intl, JSON,
    RIZVI_AGG_BARS: bars,
    RIZVI_CURRENT_SYMBOL: symbol,
    __RIZVI_ENGINE4_FILTERS_V1: false,
    fetch: async () => ({ ok: true, json: async () => payload }),
    setInterval: () => 0,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: () => true
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { timeout: 3000, filename: 'rizvi-engine4-filters.js' });
  await new Promise(resolve => setImmediate(resolve));
  return { context: sandbox.RIZVI_ENGINE4_CONTEXT, now };
}

test('Engine 4 session context returns timezone-derived status only', async () => {
  const now = Date.now(), dayStart = Math.floor(now / 86400000) * 86400, endSec = Math.floor(now / 1000);
  const bars = makeMinuteBars(dayStart, endSec);
  const { context } = await runContext({ bars, payload: { dxy: { status: 'UNAVAILABLE' }, usNews: { status: 'UNAVAILABLE', reason: 'test fixture' } } });
  assert.equal(context.session.status, 'LIVE');
  assert.equal(context.session.source, 'IANA timezone session clock');
  assert.ok(Array.isArray(context.session.active) && context.session.active.length > 0);
});

test('Engine 4 day high/low only becomes LIVE when current UTC day coverage begins near midnight', async () => {
  const now = Date.now(), dayStart = Math.floor(now / 86400000) * 86400, endSec = Math.floor(now / 1000);
  const bars = makeMinuteBars(dayStart, endSec);
  const { context } = await runContext({ bars, payload: { dxy: { status: 'UNAVAILABLE' }, usNews: { status: 'UNAVAILABLE' } } });
  assert.equal(context.dayHighLow.status, 'LIVE');
  assert.ok(context.dayHighLow.high >= context.dayHighLow.low);
  assert.equal(context.dayHighLow.firstBarAt, dayStart);
});

test('Engine 4 day high/low refuses incomplete daily coverage', async () => {
  const now = Date.now(), dayStart = Math.floor(now / 86400000) * 86400, endSec = Math.floor(now / 1000);
  const bars = makeMinuteBars(dayStart + 3600, endSec);
  const { context } = await runContext({ bars, payload: { dxy: { status: 'UNAVAILABLE' }, usNews: { status: 'UNAVAILABLE' } } });
  assert.equal(context.dayHighLow.status, 'UNAVAILABLE');
  assert.match(context.dayHighLow.reason, /does not cover the start/);
});

test('Engine 4 DXY filter requires aligned live DXY candles and does not invent a signal', async () => {
  const now = Date.now(), dayStart = Math.floor(now / 86400000) * 86400, endSec = Math.floor(now / 1000);
  const bars = makeMinuteBars(dayStart, endSec);
  const { context } = await runContext({ bars, payload: { dxy: { status: 'UNAVAILABLE', reason: 'No DXY source' }, usNews: { status: 'UNAVAILABLE' } } });
  assert.equal(context.dxy.status, 'UNAVAILABLE');
  assert.equal(context.dxy.signal, 'WAIT');
});

test('Engine 4 DXY Pearson correlation handles a deterministic inverse series', async () => {
  const now = Date.now(), dayStart = Math.floor(now / 86400000) * 86400, endSec = Math.floor(now / 1000);
  const bars = makeMinuteBars(dayStart, endSec);
  const dxyBars = makeDxyBars(dayStart, endSec);
  const { context } = await runContext({ bars, payload: { dxy: { status: 'LIVE', bars: dxyBars, source: 'deterministic-test-fixture' }, usNews: { status: 'UNAVAILABLE' } } });
  assert.equal(context.dxy.status, 'LIVE');
  assert.ok(context.dxy.correlation <= -0.25, 'inverse fixture should meet inverse-correlation threshold');
  assert.equal(context.dxy.signal, 'INVERSE_CONFIRMED');
  assert.ok(context.dxy.pairedReturns >= 10);
});

test('Engine 4 does not apply XAU-specific DXY filter to BTC', async () => {
  const now = Date.now(), dayStart = Math.floor(now / 86400000) * 86400, endSec = Math.floor(now / 1000);
  const bars = makeMinuteBars(dayStart, endSec);
  const { context } = await runContext({ bars, symbol: 'BTCUSD', payload: { dxy: { status: 'LIVE', bars: makeDxyBars(dayStart, endSec), source: 'fixture' }, usNews: { status: 'UNAVAILABLE' } } });
  assert.equal(context.dxy.status, 'UNAVAILABLE');
  assert.equal(context.dxy.signal, 'WAIT');
});

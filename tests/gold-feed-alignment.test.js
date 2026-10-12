'use strict';
const assert = require('node:assert/strict');
const { canonicalSymbol, canonicalTimeframe, buildStatus } = require('../gold-feed-alignment');

const now = 1_800_000_000_000;
const bars = Array.from({ length: 30 }, (_, i) => ({
  t: Math.floor((now - (29 - i) * 60_000) / 1000),
  o: 2300 + i, h: 2302 + i, l: 2299 + i, c: 2301 + i, v: 1
}));

assert.equal(canonicalSymbol('gold'), 'XAU/USD');
assert.equal(canonicalSymbol('XAUUSD'), 'XAU/USD');
assert.equal(canonicalSymbol('BTC/USDT'), 'BTCUSD');
assert.equal(canonicalSymbol('ETHUSD'), 'UNSUPPORTED');
assert.equal(canonicalTimeframe('1min'), '1M');
assert.equal(canonicalTimeframe('5'), '5M');
assert.equal(canonicalTimeframe('60'), '1H');

const good = buildStatus({
  symbol: 'XAU/USD', timeframe: '1M', bars,
  chartStatus: 'LIVE', chartSymbol: 'XAUUSD', source: 'test-feed'
}, now);
assert.equal(good.ok, true);
assert.equal(good.live, true);
assert.equal(good.symbol, 'XAU/USD');
assert.equal(good.timeframe, '1M');
assert.equal(good.bars, 30);

const mismatch = buildStatus({
  symbol: 'XAU/USD', timeframe: '1M', bars,
  chartStatus: 'LIVE', chartSymbol: 'BTCUSD'
}, now);
assert.equal(mismatch.ok, false);
assert.match(mismatch.reason, /does not match/);

const cached = buildStatus({
  symbol: 'XAU/USD', timeframe: '1M', bars,
  chartStatus: 'CACHED', chartSymbol: 'XAU/USD'
}, now);
assert.equal(cached.ok, false);
assert.equal(cached.live, false);

const staleBars = bars.map((b, i) => i === bars.length - 1
  ? { ...b, t: Math.floor((now - 10 * 60_000) / 1000) } : b);
const stale = buildStatus({
  symbol: 'XAU/USD', timeframe: '1M', bars: staleBars,
  chartStatus: 'LIVE', chartSymbol: 'XAU/USD'
}, now);
assert.equal(stale.ok, false);
assert.equal(stale.stale, true);

const locked = buildStatus({
  symbol: 'XAU/USD', timeframe: '1M', bars,
  chartStatus: 'LIVE', chartSymbol: 'XAU/USD', goldMarketLocked: true
}, now);
assert.equal(locked.ok, false);
assert.match(locked.reason, /locked/);

const insufficient = buildStatus({
  symbol: 'XAU/USD', timeframe: '1M', bars: bars.slice(0, 20),
  chartStatus: 'LIVE', chartSymbol: 'XAU/USD'
}, now);
assert.equal(insufficient.ok, false);
assert.match(insufficient.reason, /Insufficient/);

console.log('Gold feed alignment tests: 7 groups passed.');

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const bridge = fs.readFileSync('rizvi-indicator-feed-bridge.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const engineStart = html.indexOf('<script id="rizvi-symbol-agnostic-engine-feed-bridge-v132">');
assert.notEqual(engineStart, -1, 'Engine 5 script must exist');
const engineEnd = html.indexOf('</script>', engineStart);
const engine = html.slice(engineStart, engineEnd);

test('canonical feed bridge publishes a single versioned snapshot', () => {
  assert.match(bridge, /function publishCanonicalSnapshot\(status,bars\)/);
  assert.match(bridge, /version:1,symbol:status\.symbol,timeframe:status\.timeframe,status,bars:rows,capturedAt:now/);
  assert.match(bridge, /window\.RIZVI_CANONICAL_FEED_SNAPSHOT=snapshot/);
});

test('feed loading, failure, stale and success paths update the canonical snapshot', () => {
  assert.match(bridge, /publishCanonicalSnapshot\(window\.RIZVI_FEED_STATUS,\[\]\)/);
  assert.match(bridge, /publishCanonicalSnapshot\(window\.RIZVI_FEED_STATUS,bars\)/);
  assert.ok((bridge.match(/publishCanonicalSnapshot\(/g) || []).length >= 5);
});

test('Engine 5 consumes bars and status from the same snapshot, not independent globals', () => {
  assert.match(engine, /const snapshot=W\.RIZVI_CANONICAL_FEED_SNAPSHOT\|\|null/);
  assert.match(engine, /feed=snapshot\?\.status/);
  assert.match(engine, /bs=Array\.isArray\(snapshot\?\.bars\)\?snapshot\.bars:\[\]/);
  assert.match(engine, /snapshot missing or internally inconsistent/);
  assert.match(engine, /Canonical feed snapshot expired/);
  assert.doesNotMatch(engine, /canonicalBars=Array\.isArray\(W\.RIZVI_CANONICAL_RAW_BARS\)/);
});

test('Engine 5 snapshot freshness follows the selected candle timeframe', () => {
  assert.match(engine, /TF_FRESHNESS_SECONDS=\{'1M':60,'5M':300,'15M':900,'30M':1800,'1H':3600,'1D':86400\}/);
  assert.match(engine, /maxFeedAgeMs=tf=>Math\.max\(180000,\(TF_FRESHNESS_SECONDS\[tf\]\|\|60\)\*3000\)/);
  assert.match(engine, /snapshotAgeMs>maxFeedAgeMs\(tf\)/);
  assert.match(engine, /candidateBarAge<=maxFeedAgeMs\(tf\)/);
});

test('OHLC bridge normalizes seconds, milliseconds, microseconds, and nanoseconds to seconds', () => {
  assert.match(bridge, /t>=1e17\)t\/=1e9/);
  assert.match(bridge, /t>=1e14\)t\/=1e6/);
  assert.match(bridge, /t>=1e11\)t\/=1e3/);
  assert.match(bridge, /Date\.parse\(raw\)\/1000/);
});

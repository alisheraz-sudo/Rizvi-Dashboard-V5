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

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function runWithCloses(closes) {
  const events = [];
  const window = {
    RIZVI_CURRENT_SYMBOL: 'XAU/USD',
    RIZVI_FEED_STATUS: { ok: true, symbol: 'XAU/USD' },
    RIZVI_AGG_BARS: closes.map((c, i) => ({
      t: 1_800_000_000 + i * 60,
      o: c, h: c + 1, l: c - 1, c, v: 10
    })),
    dispatchEvent: event => events.push(event),
    addEventListener: () => {}
  };
  const context = {
    window,
    Date,
    Math,
    Number,
    Map,
    Array,
    Object,
    String,
    CustomEvent: function(type, options) { this.type = type; this.detail = options?.detail; },
    setInterval: () => 1
  };
  vm.runInNewContext(fs.readFileSync('rizvi-master-engine.js', 'utf8'), context);
  return window.RIZVI_MASTER_CONFIRMATION;
}

const flat = runWithCloses(Array(30).fill(2300));
assert.equal(flat.rsi, 50, 'flat market RSI should be neutral, not overbought');

const rising = runWithCloses(Array.from({ length: 30 }, (_, i) => 2300 + i));
assert.equal(rising.rsi, 100, 'monotonic gains should yield RSI 100');

const falling = runWithCloses(Array.from({ length: 30 }, (_, i) => 2330 - i));
assert.equal(falling.rsi, 0, 'monotonic losses should yield RSI 0');

console.log('Master engine RSI tests: 3 cases passed.');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const bridge = fs.readFileSync('rizvi-indicator-feed-bridge.js', 'utf8');
const engine = fs.readFileSync('index.html', 'utf8');
const symbolFn = bridge.match(/function symbol\(\)\s*\{([\s\S]*?)\n\}/);
assert.ok(symbolFn, 'OHLC bridge symbol resolver must exist');
const currentAt = symbolFn[1].indexOf('window.RIZVI_CURRENT_SYMBOL');
const directAt = symbolFn[1].indexOf('window.RIZVI_DIRECT_SYMBOL');
const selectorAt = symbolFn[1].indexOf("document.getElementById('symbolSelect')");
assert.ok(currentAt >= 0 && directAt > currentAt && selectorAt > directAt,
  'OHLC bridge must prefer runtime current symbol, then direct symbol, then UI selector');

const engineAt = engine.indexOf('function symbolNow()');
assert.ok(engineAt >= 0, 'Engine 5 symbol resolver must exist');
const engineSymbolFn = engine.slice(engineAt, engineAt + 600);
const eCurrentAt = engineSymbolFn.indexOf('W.RIZVI_CURRENT_SYMBOL');
const eSelectorAt = engineSymbolFn.indexOf("document.getElementById('symbolSelect')");
const eDirectAt = engineSymbolFn.indexOf('W.RIZVI_DIRECT_SYMBOL');
assert.ok(eCurrentAt >= 0 && eSelectorAt > eCurrentAt && eDirectAt > eSelectorAt,
  'Engine 5 symbol authority order should be current symbol, UI selector, direct symbol');

console.log('OHLC bridge / Engine 5 symbol-authority regression: passed.');

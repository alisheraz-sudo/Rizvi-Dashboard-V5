const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'rizvi-tradingview-direct.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('Trade Range Box uses the candlestick series price scale', () => {
  assert.match(renderer, /candleSeries\.priceToCoordinate\(v\)/);
  assert.match(renderer, /function drawTRB\(\)/);
});

test('Trade Range Box rejects missing or invalid confidence and WAIT decisions', () => {
  assert.match(renderer, /!\['BUY','SELL'\]\.includes\(direction\)/);
  assert.match(renderer, /!Number\.isFinite\(score\)\|\|score<70/);
});

test('legacy guessed-scale overlay is hidden to prevent a second misaligned box', () => {
  assert.match(html, /display:none!important;z-index:30;pointer-events:none/);
});

test('Entry, stop loss and all three targets retain their separate labels and colors', () => {
  for (const label of ['ENTRY', 'SL', 'TP1', 'TP2', 'TP3']) {
    assert.ok(renderer.includes("'" + label + "'"), 'missing level label: ' + label);
  }
  assert.match(renderer, /#35bde9/); // Entry blue
  assert.match(renderer, /#c58af0/); // Stop loss purple
  assert.match(renderer, /#25d99a/); // Take-profit green
  assert.match(renderer, /direction==='BUY'\?'rgba\(0,217,145/); // BUY green
  assert.match(renderer, /rgba\(255,76,96/); // SELL red
});

test('manual Trade Range overlay uses indicator action even when Engine 5 final action is WAIT', () => {
  assert.match(renderer, /lv\?\.direction,decision\.engine5\?\.indicatorAction,activation\.direction,window\.RIZVI_SIGNAL_DIRECTION,decision\.direction/);
  assert.match(renderer, /lv\?\.score,activation\.confidence,decision\.engine5\?\.indicatorScore,decision\.confidence/);
  assert.match(renderer, /direction!==String\(lv\.direction\|\|''\)\.toUpperCase\(\)/);
  assert.doesNotMatch(renderer, /const direction=String\(decision\.direction\|\|lv\?\.direction\|\|'WAIT'\)/);
});

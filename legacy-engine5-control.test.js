const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const control = fs.readFileSync(path.join(__dirname, 'legacy-engine5-control.js'), 'utf8');

test('legacy Engine 5 evaluator is paused by default before doing decision work', () => {
  assert.match(html, /function tick\(\)\{\s*if\(W\.RIZVI_LEGACY_ENGINE5_ENABLED!==true\)return;/);
  assert.match(control, /window\.RIZVI_LEGACY_ENGINE5_ENABLED=false/);
});

test('preserved evaluator has a reversible enable/disable API', () => {
  assert.match(html, /RIZVI_SET_LEGACY_ENGINE5_ENABLED=function\(enabled\)/);
  assert.match(control, /RIZVI_SET_LEGACY_ENGINE5_ENABLED\(enabled\)/);
  assert.match(html, /qualifiedCandidateKey='';qualifiedCandidateCount=0/);
});

test('pause publishes WAIT rather than leaving a stale BUY/SELL decision', () => {
  assert.match(html, /status:'LEGACY_ENGINE_PAUSED'/);
  assert.match(html, /W\.RIZVI_SIGNAL_DIRECTION='WAIT'/);
  assert.match(html, /autoTrading:false/);
});

test('server loads the visible reversible switch without deleting the legacy code', () => {
  assert.match(server, /legacy-engine5-control\.js/);
  assert.match(html, /rizvi-symbol-agnostic-engine-feed-bridge-v132/);
  assert.match(server, /window\.RIZVI_AUTO_TRADING=false/);
});

test('switch control labels both paused and active states', () => {
  assert.match(control, /Legacy Decision Model: PAUSED/);
  assert.match(control, /Legacy Decision Model: ACTIVE/);
});

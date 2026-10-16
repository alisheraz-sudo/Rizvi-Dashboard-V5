const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const master = fs.readFileSync(path.join(__dirname, 'rizvi-master-engine.js'), 'utf8');
const control = fs.readFileSync(path.join(__dirname, 'legacy-engine5-control.js'), 'utf8');

test('legacy decision system defaults to paused before periodic decision work', () => {
  assert.match(html, /function tick\(\)\{\s*if\(W\.RIZVI_LEGACY_SYSTEM_ENABLED!==true\|\|W\.RIZVI_LEGACY_ENGINE5_ENABLED!==true\)return;/);
  assert.match(control, /window\.RIZVI_LEGACY_SYSTEM_ENABLED=false/);
});

test('indicator and algorithm decision calculations are gated by master pause', () => {
  assert.match(html, /function tests\(\)\{\s*if\(W\.RIZVI_LEGACY_SYSTEM_ENABLED!==true\)/);
  assert.match(html, /function test\(\)\{if\(W\.RIZVI_LEGACY_SYSTEM_ENABLED!==true\)/);
  assert.match(html, /W\.RIZVI_LEGACY_SYSTEM_ENABLED=next/);
  assert.match(master, /if\(window\.RIZVI_LEGACY_SYSTEM_ENABLED===false\)return;/);
});

test('master switch can restore legacy calculations and reset qualification counters', () => {
  assert.match(html, /RIZVI_SET_LEGACY_ENGINE5_ENABLED=function\(enabled\)/);
  assert.match(html, /W\.RIZVI_RUN_INDICATOR_TESTS\?\.\(\)/);
  assert.match(html, /W\.RIZVI_RUN_MULTI_ALGORITHM_TESTS\?\.\(\)/);
  assert.match(html, /qualifiedCandidateKey='';qualifiedCandidateCount=0/);
});

test('pause publishes WAIT, records paused state, and keeps Auto Trading OFF', () => {
  assert.match(html, /status:'LEGACY_SYSTEM_PAUSED'/);
  assert.match(html, /W\.RIZVI_SIGNAL_DIRECTION='WAIT'/);
  assert.match(html, /autoTrading:false/);
  assert.match(server, /window\.RIZVI_AUTO_TRADING=false/);
});

test('preserved legacy code and shared feed/chart are not removed', () => {
  assert.match(server, /legacy-engine5-control\.js/);
  assert.match(html, /rizvi-symbol-agnostic-engine-feed-bridge-v132/);
  assert.match(html, /RIZVI_CANONICAL_FEED_SNAPSHOT/);
});

test('visible switch labels both paused and active states', () => {
  assert.match(control, /Legacy System: PAUSED/);
  assert.match(control, /Legacy System: ACTIVE/);
});

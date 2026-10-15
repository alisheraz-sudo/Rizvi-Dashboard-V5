const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bridge = fs.readFileSync(path.join(__dirname, '..', 'rizvi-indicator-feed-bridge.js'), 'utf8');

test('canonical OHLC bridge polls immediately when a suspended dashboard resumes', () => {
  assert.match(bridge, /const onResume=\(\)=>\{if\(document\.visibilityState==='hidden'\)return;setTimeout\(poll,0\);\}/);
  assert.match(bridge, /window\.addEventListener\('pageshow',onResume\)/);
  assert.match(bridge, /window\.addEventListener\('focus',onResume\)/);
  assert.match(bridge, /document\.addEventListener\('visibilitychange',onResume\)/);
  assert.match(bridge, /window\.RIZVI_REFRESH_CANONICAL_FEED=\(\)=>\{if\(busy\)\{rerunRequested=true;return;\}poll\(\);\}/);
});

test('feed refresh does not accept stale candles as live', () => {
  assert.match(bridge, /data\?\.stale===true\|\|validated\.stale/);
  assert.match(bridge, /LAST AVAILABLE GOLD DATA ONLY/);
  assert.match(bridge, /live:false/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bridge = fs.readFileSync(path.join(__dirname, '..', 'rizvi-indicator-feed-bridge.js'), 'utf8');

test('Engine 5 snapshot recovery reads only canonical feed bars', () => {
  assert.match(bridge, /window\.RIZVI_CANONICAL_RAW_BARS\s*=\s*bars/);
  assert.match(html, /const liveBars=Array\.isArray\(W\.RIZVI_CANONICAL_RAW_BARS\)\?W\.RIZVI_CANONICAL_RAW_BARS:\[\];/);
  assert.doesNotMatch(html, /const liveBars=Array\.isArray\(W\.RIZVI_RAW_BARS\)\?W\.RIZVI_RAW_BARS:\[\];/);
  assert.match(bridge, /window\.RIZVI_REFRESH_CANONICAL_FEED=\(\)=>/);
  assert.match(html, /RIZVI_REFRESH_CANONICAL_FEED/);
  assert.match(html, /RIZVI_ENGINE5_RECOVERY_REFRESH_AT/);
});

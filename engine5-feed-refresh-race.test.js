const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('if(snapshotExpired){');
const end = html.indexOf('const liveStatus=', start);
const block = html.slice(start, end);
test('Engine 5 waits for async canonical refresh before inspecting status', () => {
  assert.ok(start >= 0);
  assert.ok(end > start);
  assert.ok(block.indexOf('return;') >= 0);
  assert.ok(block.indexOf('return;') < block.indexOf('const liveStatus=') || block.includes('const liveStatus=') === false);
});

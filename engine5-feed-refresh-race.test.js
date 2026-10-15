const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('if(snapshotExpired){');
const refreshCall = html.indexOf('W.RIZVI_REFRESH_CANONICAL_FEED();', start);
const firstReturn = html.indexOf('return;', refreshCall);
const statusRead = html.indexOf('const liveStatus=', start);
const throttleReturn = html.indexOf('if(refreshAvailable&&now-lastRefreshAt<10000)return;', start);
test('Engine 5 waits for async canonical refresh before inspecting stale status', () => {
  assert.ok(start >= 0, 'snapshot recovery block exists');
  assert.ok(refreshCall > start, 'refresh is requested');
  assert.ok(firstReturn > refreshCall && firstReturn < statusRead, 'refresh tick returns before reading status');
  assert.ok(throttleReturn > firstReturn && throttleReturn < statusRead, 'follow-up ticks wait through refresh throttle');
});

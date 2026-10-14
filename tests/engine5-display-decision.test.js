const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/function displayDecision\(m\)\s*\{[\s\S]*?\n  \}/);
assert.ok(match, 'displayDecision must exist in index.html');
const sandbox = { window: {} };
vm.runInNewContext(`${match[0]}\nwindow.RIZVI_DISPLAY_DECISION = displayDecision;`, sandbox);
const decide = sandbox.window.RIZVI_DISPLAY_DECISION;

test('final Engine 5 WAIT cannot be overridden by intermediate SELL alignment', () => {
  const result = decide({
    direction: 'WAIT',
    confidence: 78,
    qualified: false,
    feedStatus: { ok: true },
    engine5: {
      state: 'EVALUATED',
      indicatorAction: 'SELL',
      algorithmMajority: 'SELL',
      algorithmsAligned: 4,
      indicatorAgreement: 75
    },
    alignment: { algorithmMajority: 'SELL' }
  });
  assert.equal(result.direction, 'WAIT');
  assert.equal(result.band, 'WAIT');
});

test('explicit unqualified directional decision at 70–79 is labeled weak', () => {
  const result = decide({
    direction: 'SELL',
    confidence: 78,
    qualified: false,
    feedStatus: { ok: true }
  });
  assert.equal(result.direction, 'SELL');
  assert.equal(result.band, 'WEAK');
});

test('qualified decision keeps strong/high band from the final direction', () => {
  const result = decide({
    direction: 'BUY',
    confidence: 88,
    qualified: true,
    feedStatus: { ok: true }
  });
  assert.equal(result.direction, 'BUY');
  assert.equal(result.band, 'STRONG');
});

test('invalid feed always returns WAIT', () => {
  const result = decide({
    direction: 'SELL',
    confidence: 91,
    qualified: true,
    feedStatus: { ok: false }
  });
  assert.equal(result.direction, 'WAIT');
});

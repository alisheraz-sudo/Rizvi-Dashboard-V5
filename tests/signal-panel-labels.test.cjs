'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const match = html.match(/<script id="rizvi-v130-live-indicator-output">([\s\S]*?)<\/script>/);
assert.ok(match, 'signal panel output binding must exist');

const labels = ['BUY', 'SELL', 'WAIT'];
const nodes = Object.fromEntries(labels.map((label, i) => [label, {
  textContent: label,
  tagName: i === 0 ? 'B' : 'I',
  style: {}
}]));
const root = {
  querySelector(selector) {
    const m = selector.match(/data-direction="(BUY|SELL|WAIT)"/);
    return m ? nodes[m[1]] : null;
  }
};
const quality = { textContent: '—' };
const badge = { textContent: '', style: {} };
const listeners = {};
const window = {
  __RIZVI_V130_INDICATOR_BINDING: false,
  RIZVI_CURRENT_SYMBOL: 'XAU/USD',
  addEventListener: (name, fn) => { listeners[name] = fn; },
  dispatchEvent: () => {}
};
const document = {
  querySelector(selector) {
    if (selector === '.signalBlock') return root;
    if (selector === '.qualityBlock b') return quality;
    if (selector === '.qualityBlock .badge') return badge;
    return null;
  }
};
const context = { window, document, Date, Math, Number, String, CustomEvent: function(type, options) { this.type = type; this.detail = options?.detail; }, setInterval: () => 1 };
vm.runInNewContext(match[1], context);

function send(direction, confidence, qualified) {
  // Simulate another writer corrupting the visible labels before the next paint.
  nodes.BUY.textContent = direction;
  nodes.SELL.textContent = 'WAIT';
  nodes.WAIT.textContent = direction;
  listeners['rizvi:master-confirmation-update']({ detail: {
    direction, confidence, qualified, updatedAt: Date.now(), symbol: 'XAU/USD', indicatorStatus: {}
  } });
}

send('SELL', 76, false);
assert.deepEqual(labels.map(k => nodes[k].textContent), labels, 'BUY/SELL/WAIT labels must remain canonical');
assert.equal(nodes.SELL.style.opacity, '1', 'SELL should be the only active direction');
assert.equal(nodes.BUY.style.opacity, '.48');
assert.equal(nodes.WAIT.style.opacity, '.48');
assert.equal(quality.textContent, '76%');
assert.equal(badge.style.display, 'none', 'sub-80 score must not show high-quality badge');

send('BUY', 84, true);
assert.deepEqual(labels.map(k => nodes[k].textContent), labels, 'labels must stay canonical after direction changes');
assert.equal(nodes.BUY.style.opacity, '1');
assert.equal(nodes.SELL.style.opacity, '.48');
assert.equal(badge.style.display, 'inline-block');

send('INVALID', 99, true);
assert.deepEqual(labels.map(k => nodes[k].textContent), labels, 'invalid direction must fall back to WAIT without relabeling');
assert.equal(nodes.WAIT.style.opacity, '1');
assert.equal(badge.style.display, 'inline-block');

console.log('Signal panel label stability tests: 3 scenarios passed.');

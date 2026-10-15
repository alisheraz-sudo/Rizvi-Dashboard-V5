'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateIndependentEngines } = require('../engine5-independent-engines');

function fullComponents() {
  return {
    'EMA 9/21': { status: 'CALCULATED', bias: 1, score: 65 },
    'RSI-14': { status: 'CALCULATED', bias: 1, score: 62 },
    'Market Structure': { status: 'CALCULATED', bias: -1, score: 40 },
    'Structure Prediction': { status: 'CALCULATED', bias: -1, score: 45 },
    'VWAP Filter': { status: 'CALCULATED', bias: 1, score: 65 },
    'Volume Profile': { status: 'CALCULATED', bias: 1, score: 70 },
    'Bullish/Bearish Divergence': { status: 'CALCULATED', bias: -1, score: 30 },
    'DXY Inverse-Correlation Filter': { status: 'LIVE', bias: -1, score: 65 }
  };
}

test('calculates four domain engines from separate indicator partitions', () => {
  const report = evaluateIndependentEngines(fullComponents());
  assert.equal(report.independent, true);
  assert.equal(report.method, 'DOMAIN_PARTITIONED_INDICATOR_EVALUATION_V1');
  assert.deepEqual(report.engines.map(x => x.engine), ['ENGINE_1', 'ENGINE_2', 'ENGINE_3', 'ENGINE_4']);
  assert.deepEqual(report.engines.map(x => x.action), ['BUY', 'SELL', 'BUY', 'SELL']);
  const used = report.diagnostics.flatMap(x => x.inputs);
  assert.equal(new Set(used).size, used.length, 'one component must not be counted in multiple engines');
});

test('does not invent an independent engine when a domain has fewer than two directional inputs', () => {
  const components = fullComponents();
  delete components['DXY Inverse-Correlation Filter'];
  const report = evaluateIndependentEngines(components);
  assert.equal(report.engines.some(x => x.engine === 'ENGINE_4'), false);
  const missing = report.diagnostics.find(x => x.engine === 'ENGINE_4');
  assert.equal(missing.reportAvailable, false);
  assert.equal(missing.action, 'NOT_REPORTED');
});

test('unavailable components cannot create an engine vote', () => {
  const components = fullComponents();
  components['DXY Inverse-Correlation Filter'] = { status: 'UNAVAILABLE', bias: -1, score: 90 };
  const report = evaluateIndependentEngines(components);
  assert.equal(report.engines.some(x => x.engine === 'ENGINE_4'), false);
});

test('WAIT-only or neutral inputs do not count as directional alignment', () => {
  const report = evaluateIndependentEngines({
    'Bullish/Bearish Divergence': { status: 'CALCULATED', bias: 0, score: 50 },
    'DXY Inverse-Correlation Filter': { status: 'LIVE', bias: 0, score: 50 }
  });
  assert.equal(report.engines.some(x => x.engine === 'ENGINE_4'), false);
});

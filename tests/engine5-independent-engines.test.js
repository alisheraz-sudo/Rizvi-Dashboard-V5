'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateIndicatorDomainDiagnostics } = require('../engine5-independent-engines');

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

test('indicator domain partitions are diagnostic only and never independent engine votes', () => {
  const report = evaluateIndicatorDomainDiagnostics(fullComponents());
  assert.equal(report.independent, false);
  assert.equal(report.method, 'INDICATOR_DOMAIN_DIAGNOSTICS_ONLY_V1');
  assert.deepEqual(report.engines, []);
  assert.deepEqual(report.diagnostics.map(x => x.domainId), ['ENGINE_1', 'ENGINE_2', 'ENGINE_3', 'ENGINE_4']);
  assert.deepEqual(report.diagnostics.map(x => x.action), ['BUY', 'SELL', 'BUY', 'SELL']);
  const used = report.diagnostics.flatMap(x => x.inputs);
  assert.equal(new Set(used).size, used.length, 'one component must not be counted in multiple diagnostic domains');
});

test('diagnostics show when a domain lacks enough directional inputs', () => {
  const components = fullComponents();
  delete components['DXY Inverse-Correlation Filter'];
  const report = evaluateIndicatorDomainDiagnostics(components);
  const missing = report.diagnostics.find(x => x.domainId === 'ENGINE_4');
  assert.equal(missing.reportAvailable, false);
  assert.equal(missing.action, 'NOT_REPORTED');
});

test('unavailable components cannot create a directional diagnostic', () => {
  const components = fullComponents();
  components['DXY Inverse-Correlation Filter'] = { status: 'UNAVAILABLE', bias: -1, score: 90 };
  const report = evaluateIndicatorDomainDiagnostics(components);
  assert.equal(report.diagnostics.find(x => x.domainId === 'ENGINE_4').reportAvailable, false);
});

test('WAIT-only or neutral inputs do not count as directional diagnostic inputs', () => {
  const report = evaluateIndicatorDomainDiagnostics({
    'Bullish/Bearish Divergence': { status: 'CALCULATED', bias: 0, score: 50 },
    'DXY Inverse-Correlation Filter': { status: 'LIVE', bias: 0, score: 50 }
  });
  assert.equal(report.diagnostics.find(x => x.domainId === 'ENGINE_4').reportAvailable, false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInput, canonicalSymbol, canonicalTimeframe, normalizeBar } = require('../engine5-production-adapter');

test('maps current dashboard symbols and timeframe aliases', () => {
  assert.equal(canonicalSymbol('XAU/USD'), 'XAUUSD');
  assert.equal(canonicalSymbol('Gold'), 'XAUUSD');
  assert.equal(canonicalSymbol('BTCUSD'), 'BTCUSD');
  assert.equal(canonicalTimeframe('60'), '1H');
  assert.equal(canonicalTimeframe('15min'), '15M');
});

test('normalizes production OHLC bar keys and rejects malformed candles', () => {
  assert.deepEqual(normalizeBar({t: 1700000000, o: 2300, h: 2302, l: 2299, c: 2301, v: 10}),
    {t: 1700000000, o: 2300, h: 2302, l: 2299, c: 2301, v: 10});
  assert.equal(normalizeBar({o: 2300, h: 2290, l: 2280, c: 2301}), null);
});

test('maps production components and algorithm votes without inventing missing bias', () => {
  const input = buildInput({
    symbol: 'XAU/USD', timeframe: '1M',
    confluence: {action: 'BUY', timestamp: new Date().toISOString(), components: {
      'EMA 9/21': {status: 'CALCULATED', score: 75, bias: 1},
      'Delta Buy/Sell': {status: 'NO_REAL_ORDER_FLOW', score: 0, bias: 0},
      'No Bias': {status: 'CALCULATED', score: 50}
    }},
    algorithmReport: {algorithms: {
      trend: {action: 'BUY', confidence: 84},
      momentum: {action: 'WAIT', confidence: 65},
      malformed: {action: 'MAYBE', confidence: 40}
    }},
    bars: [{t: 1700000000, o: 2300, h: 2302, l: 2299, c: 2301}]
  });
  assert.equal(input.symbol, 'XAUUSD');
  assert.equal(input.components['EMA 9/21'].bias, 1);
  assert.equal(input.components['No Bias'].bias, undefined);
  assert.equal(input.components['Delta Buy/Sell'].status, 'NO_REAL_ORDER_FLOW');
  assert.equal(input.algorithms.trend.action, 'BUY');
  assert.equal(input.algorithms.momentum.action, 'WAIT');
  assert.equal(input.algorithms.malformed.action, 'WAIT');
  assert.equal(input.bars.length, 1);
});

test('maps Engine 4 safety blockers and does not mark an unvalidated feed live', () => {
  const input = buildInput({
    symbol: 'XAU/USD', feedStatus: {ok: false, live: false, stale: true},
    engine4Context: {
      usNews: {status: 'LIVE', blocked: true},
      dxy: {status: 'LIVE', correlation: -0.4, dxyDirection: 'BUY'}
    },
    confluence: {action: 'BUY', components: {'EMA': {status: 'LIVE', bias: 1}}}
  });
  assert.equal(input.newsBlocked, true);
  assert.equal(input.dxyConflict, true);
  assert.equal(input.sourceMeta.feedStatus, 'NOT_VALIDATED');
});

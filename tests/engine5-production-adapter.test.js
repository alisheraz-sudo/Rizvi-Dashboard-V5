const test = require('node:test');
const assert = require('node:assert/strict');
const { buildInput, canonicalSymbol, canonicalTimeframe, normalizeBar, validateSnapshot } = require('../engine5-production-adapter');

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
  assert.equal(input.components['EMA 9/21'].score, 75);
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

function validSnapshot(now = Date.now()) {
  const timestamp = new Date(now).toISOString();
  const start = Math.floor((now - 20 * 60000) / 1000);
  const bars = Array.from({length: 21}, (_, i) => {
    const o = 2300 + i, c = o + 0.2;
    return {t: start + i * 60, o, h: c + 0.2, l: o - 0.2, c, v: 100};
  });
  return {
    symbol: 'XAU/USD', timeframe: '1M', bars,
    feedStatus: {ok: true, live: true, stale: false, symbol: 'XAU/USD', timeframe: '1M'},
    confluence: {symbol: 'XAU/USD', timeframe: '1M', timestamp, action: 'BUY', components: {}},
    algorithmReport: {symbol: 'XAU/USD', timeframe: '1M', timestamp, algorithms: {}}
  };
}

test('accepts only a fresh, same-symbol/timeframe, aligned snapshot', () => {
  const now = Date.now();
  const result = validateSnapshot(validSnapshot(now), {now});
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
});

test('rejects stale feed and mismatched or stale engine reports', () => {
  const now = Date.now();
  const snapshot = validSnapshot(now);
  snapshot.feedStatus.stale = true;
  snapshot.algorithmReport.symbol = 'BTCUSD';
  snapshot.confluence.timestamp = new Date(now - 60000).toISOString();
  const result = validateSnapshot(snapshot, {now});
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('FEED_NOT_VALIDATED_LIVE'));
  assert.ok(result.blockers.includes('ALGORITHM_SYMBOL_MISMATCH'));
  assert.ok(result.blockers.includes('INDICATOR_REPORT_STALE_OR_MISSING'));
});

test('only explicitly independent engine reports can enter the 3-of-4 gate',()=>{const base={symbol:'XAU/USD',independentEngineReport:{independent:false,engines:[{engine:'ENGINE_1',action:'BUY'}]}};assert.deepEqual(buildInput(base).engines,[]);const accepted=buildInput({symbol:'XAU/USD',independentEngineReport:{independent:true,engines:[{engine:'ENGINE_1',action:'BUY'},{engine:'ENGINE_2',action:'BUY'},{engine:'ENGINE_3',action:'SELL'},{engine:'ENGINE_4',action:'WAIT'},{engine:'ENGINE_5',action:'BUY'}]}});assert.deepEqual(accepted.engines,[{engine:'ENGINE_1',action:'BUY'},{engine:'ENGINE_2',action:'BUY'},{engine:'ENGINE_3',action:'SELL'},{engine:'ENGINE_4',action:'WAIT'}]);});

test('derives domain-engine reports from indicator components, not confluence groups', () => {
  const input = buildInput({
    symbol: 'XAU/USD',
    confluence: { components: {
      'EMA 9/21': {status:'CALCULATED',bias:1,score:60},
      'RSI-14': {status:'CALCULATED',bias:1,score:60},
      'Market Structure': {status:'CALCULATED',bias:-1,score:40},
      'Structure Prediction': {status:'CALCULATED',bias:-1,score:40},
      'VWAP Filter': {status:'CALCULATED',bias:1,score:65},
      'Volume Profile': {status:'CALCULATED',bias:1,score:65},
      'Bullish/Bearish Divergence': {status:'CALCULATED',bias:-1,score:35},
      'DXY Inverse-Correlation Filter': {status:'LIVE',bias:-1,score:65}
    }}
  });
  assert.deepEqual(input.engines, [
    {engine:'ENGINE_1',action:'BUY'},
    {engine:'ENGINE_2',action:'SELL'},
    {engine:'ENGINE_3',action:'BUY'},
    {engine:'ENGINE_4',action:'SELL'}
  ]);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {evaluate} = require('./engine5-regime-adaptive-v2');

function fixture(overrides={}) {
  const nowMs=Date.now();
  const bars=Array.from({length:40},(_,i)=>{
    const close=4000+i*2;
    return {timestamp:nowMs-(39-i)*60_000,open:close-0.5,high:close+1,low:close-1,close};
  });
  const families=['trend','momentum','value','structure','volume','volatility'];
  const indicators=families.map((family,i)=>({id:'I'+i,family,action:'BUY',reliability:1,available:true}));
  const algorithms=Array.from({length:5},(_,i)=>({id:'ALGORITHM_'+(i+1),action:'BUY',confidence:90}));
  const engines=Array.from({length:4},(_,i)=>({id:'ENGINE_'+(i+1),independent:true,action:'BUY'}));
  return {nowMs,bars,indicators,algorithms,engines,previousQualifiedRuns:2,...overrides};
}

test('qualifies only with fresh OHLC, six indicator families, five algorithms and four independent engines',()=>{
  const result=evaluate(fixture());
  assert.equal(result.qualified,true);
  assert.equal(result.action,'BUY');
  assert.equal(result.qualifiedRuns,3);
  assert.equal(result.autoTrading,false);
});

test('derived/non-independent groups cannot satisfy the engine gate',()=>{
  const input=fixture({engines:fixture().engines.map(x=>({...x,independent:false}))});
  const result=evaluate(input);
  assert.equal(result.qualified,false);
  assert.equal(result.action,'WAIT');
  assert.ok(result.blockers.includes('MISSING_GENUINE_INDEPENDENT_ENGINE_OUTPUTS'));
});

test('stale OHLC fails closed',()=>{
  const input=fixture();
  input.bars=input.bars.map(b=>({...b,timestamp:b.timestamp-600_000}));
  const result=evaluate(input);
  assert.equal(result.qualified,false);
  assert.ok(result.blockers.includes('STALE_OR_FUTURE_OHLC'));
});

test('correlated indicators in one family count as one family vote',()=>{
  const input=fixture();
  input.indicators=[...input.indicators,...Array.from({length:8},(_,i)=>({
    id:'EXTRA_TREND_'+i,family:'trend',action:'BUY',reliability:1
  }))];
  const result=evaluate(input);
  assert.equal(result.indicatorFamilies,6);
  assert.equal(result.qualified,true);
});

test('qualification resets when the previous run is not already qualified twice',()=>{
  const result=evaluate(fixture({previousQualifiedRuns:0}));
  assert.equal(result.qualified,false);
  assert.equal(result.action,'WAIT');
  assert.ok(result.blockers.includes('CONSECUTIVE_QUALIFICATION_NOT_MET'));
});

test('missing indicators fail closed',()=>{
  const result=evaluate(fixture({indicators:[]}));
  assert.equal(result.qualified,false);
  assert.equal(result.action,'WAIT');
  assert.ok(result.blockers.includes('INSUFFICIENT_ACTIVE_INDICATORS'));
});

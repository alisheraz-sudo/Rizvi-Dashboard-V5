'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {INDICATORS,ENGINE_DEFS,adaptiveWeights,adaptiveThresholds,evaluate}=require('./engine5-unified-regime-adaptive-v3');

function fixture(now=1_800_000_000_000) {
  const bars=[];
  for(let i=0;i<50;i++) {
    const close=4000+i*2, timestamp=now-(49-i)*60_000;
    bars.push({timestamp,open:close-0.4,high:close+1,low:close-1,close});
  }
  const indicators=INDICATORS.filter(x=>!x.requiresApi).map(x=>({id:x.id,action:'BUY',available:true,reliability:1,timestamp:now}));
  const algorithms=Array.from({length:5},(_,i)=>({id:'ALGORITHM_'+(i+1),action:'BUY',available:true}));
  return {now,bars,indicators,algorithms};
}

test('registry retains exactly 17 indicators and excludes news',()=>{
  assert.equal(INDICATORS.length,17);
  assert.equal(INDICATORS.some(x=>/news/i.test(x.id+' '+x.name)),false);
});
test('four subengines have a stable simple contract for master alignment',()=>{
  assert.deepEqual(ENGINE_DEFS.map(x=>x.id),['ENGINE_1','ENGINE_2','ENGINE_3','ENGINE_4']);
  assert.ok(ENGINE_DEFS.every(x=>x.indicators.length>0));
});

test('weights and decision thresholds change with detected regime',()=>{
  const trending={name:'TRENDING_UP',metrics:{spread:0.9,consistency:0.7,volRatio:1.1}};
  const ranging={name:'RANGING',metrics:{spread:0.05,consistency:0.0,volRatio:0.9}};
  const wt=adaptiveWeights(trending,{});
  const wr=adaptiveWeights(ranging,{});
  assert.notDeepEqual(wt,wr);
  assert.ok(wt.trend>wr.trend);
  assert.ok(wr.structure>wt.structure);
  assert.notDeepEqual(adaptiveThresholds(trending),adaptiveThresholds(ranging));
});
test('outcome feedback gradually influences weights but is bounded',()=>{
  const regime={name:'TRENDING_UP',metrics:{spread:0.9,consistency:0.7,volRatio:1.1}};
  const neutral=adaptiveWeights(regime,{});
  const feedback=adaptiveWeights(regime,{enginePerformance:{trend:{hitRate:0.8,samples:100},structure:{hitRate:0.3,samples:100}}});
  assert.notDeepEqual(neutral,feedback);
  for(const w of Object.values(feedback)) assert.ok(w>=0.08 && w<=0.48);
  assert.ok(Math.abs(Object.values(feedback).reduce((a,b)=>a+b,0)-1)<0.001);
});

test('adaptive master qualifies only after three distinct fresh bars',()=>{
  const f=fixture();
  let state={};
  const first=evaluate({bars:f.bars,indicators:f.indicators,algorithms:f.algorithms,nowMs:f.now},state);
  assert.equal(first.qualified,false);
  assert.ok(first.blockers.includes('WAITING_FOR_3_DISTINCT_QUALIFIED_BARS'));
  state=first.nextState;
  const repeated=evaluate({bars:f.bars,indicators:f.indicators,algorithms:f.algorithms,nowMs:f.now},state);
  assert.equal(repeated.qualified,false);
  assert.ok(repeated.blockers.includes('WAITING_FOR_NEXT_DISTINCT_BAR'));
  f.now+=60_000; f.bars.push({timestamp:f.now,open:4097.6,high:4099,low:4097,close:4098});
  f.indicators=f.indicators.map(x=>({...x,timestamp:f.now}));
  let second=evaluate({bars:f.bars,indicators:f.indicators,algorithms:f.algorithms,nowMs:f.now},state);
  state=second.nextState;
  f.now+=60_000; f.bars.push({timestamp:f.now,open:4099.6,high:4101,low:4099,close:4100});
  f.indicators=f.indicators.map(x=>({...x,timestamp:f.now}));
  const third=evaluate({bars:f.bars,indicators:f.indicators,algorithms:f.algorithms,nowMs:f.now},state);
  assert.equal(third.qualified,true);
  assert.equal(third.direction,'BUY');
  assert.equal(third.autoTrading,false);
});
test('missing API-only delta/orderflow do not fabricate data or block candidate by themselves',()=>{
  const f=fixture();
  const r=evaluate({bars:f.bars,indicators:f.indicators,algorithms:f.algorithms,nowMs:f.now},{});
  assert.equal(r.activeIndicatorIds.includes('delta_buy_sell'),false);
  assert.equal(r.activeIndicatorIds.includes('order_flow'),false);
  assert.equal(r.autoTrading,false);
});
test('stale gold bars fail closed',()=>{
  const f=fixture();
  const r=evaluate({bars:f.bars,indicators:f.indicators,algorithms:f.algorithms,nowMs:f.now+300_000},{});
  assert.equal(r.qualified,false);
  assert.ok(r.blockers.includes('STALE_OR_FUTURE_OHLC'));
});
test('out-of-order OHLC is rejected instead of silently sorted',()=>{
  const f=fixture();
  [f.bars[5],f.bars[6]]=[f.bars[6],f.bars[5]];
  const r=evaluate({bars:f.bars,indicators:f.indicators,algorithms:f.algorithms,nowMs:f.now},{});
  assert.equal(r.qualified,false);
  assert.ok(r.blockers.includes('INSUFFICIENT_OR_INVALID_OHLC'));
});

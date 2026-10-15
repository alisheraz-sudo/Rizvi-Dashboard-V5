'use strict';
// Candidate safety regression coverage: epoch timestamps and verified-volume quality gates.

const test=require('node:test');
const assert=require('node:assert/strict');
const {INDICATORS,ENGINES,adaptiveWeights,adaptiveThresholds,evaluate}=require('./engine5-layered-adaptive-v4');

function fixture(now=1800000000000) {
  const bars=[];
  for(let i=0;i<50;i++) {
    const close=4000+i*2, timestamp=now-(49-i)*60000;
    bars.push({timestamp,open:close-.4,high:close+1,low:close-1,close});
  }
  const indicators=INDICATORS.filter(x=>!x.requiresApi).map(x=>({id:x.id,action:'BUY',available:true,reliability:1,timestamp:now}));
  return {now,bars,indicators};
}
test('approved 17-indicator registry excludes Delta, Order Flow and News while retaining Volume Profile and context',()=>{
  assert.equal(INDICATORS.length,17);
  const ids=INDICATORS.map(x=>x.id);
  assert.equal(new Set(ids).size,17);
  for(const excluded of ['delta_buy_sell','order_flow','high_impact_us_news','news_filter']) assert.equal(ids.includes(excluded),false,excluded+' must be excluded');
  for(const required of ['volume_profile','dxy_inverse_correlation','day_high_low','trading_sessions']) assert.equal(ids.includes(required),true,required+' must be retained');
});
test('four independent sub-engines are present and have non-overlapping contracts',()=>{
  assert.deepEqual(ENGINES.map(x=>x.id),['ENGINE_1','ENGINE_2','ENGINE_3','ENGINE_4']);
  assert.ok(ENGINES.every(x=>x.indicators.length>0));
});
test('weights adapt by regime, remain bounded, and sum to one',()=>{
  const trend={name:'TRENDING_UP',metrics:{spread:.9,consistency:.7,volRatio:1.1}};
  const range={name:'RANGING',metrics:{spread:.05,consistency:0,volRatio:.9}};
  const a=adaptiveWeights(trend,{}),b=adaptiveWeights(range,{});
  assert.notDeepEqual(a,b);
  for(const w of Object.values(a)) assert.ok(w>=.1&&w<=.4);
  assert.ok(Math.abs(Object.values(a).reduce((x,y)=>x+y,0)-1)<.002);
  assert.ok(a.trend>b.trend&&b.structure>a.structure);
});
test('outcome feedback is ignored before minimum samples and applied afterwards',()=>{
  const regime={name:'TRENDING_UP',metrics:{spread:.9,consistency:.7,volRatio:1.1}};
  const neutral=adaptiveWeights(regime,{});
  const low=adaptiveWeights(regime,{enginePerformance:{trend:{hitRate:.95,samples:5}}});
  const learned=adaptiveWeights(regime,{enginePerformance:{trend:{hitRate:.95,samples:100},structure:{hitRate:.2,samples:100}}});
  assert.deepEqual(neutral,low);
  assert.notDeepEqual(neutral,learned);
});
test('thresholds change with volatility/trend conditions',()=>{
  assert.notDeepEqual(adaptiveThresholds({metrics:{spread:.1,volRatio:.8}}),adaptiveThresholds({metrics:{spread:1,volRatio:2.2}}));
});
test('candidate waits for three distinct qualified bars and remains signal-only',()=>{
  const f=fixture(); let state={};
  let r=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now},state);
  assert.equal(r.qualified,false); assert.ok(r.blockers.includes('WAITING_FOR_3_DISTINCT_QUALIFIED_BARS')); state=r.nextState;
  r=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now},state);
  assert.equal(r.qualified,false); assert.ok(r.blockers.includes('WAITING_FOR_NEXT_DISTINCT_BAR'));
  for(let n=1;n<=2;n++) {
    f.now+=60000; const p=f.bars[f.bars.length-1].close, close=p+2;
    f.bars.push({timestamp:f.now,open:close-.4,high:close+1,low:close-1,close});
    f.indicators=f.indicators.map(x=>({...x,timestamp:f.now}));
    r=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now},state); state=r.nextState;
  }
  assert.equal(r.qualified,true); assert.equal(r.direction,'BUY'); assert.equal(r.autoTrading,false);
});
test('missing API-only data is not fabricated and absent engine evidence blocks qualification',()=>{
  const f=fixture();
  const r=evaluate({bars:f.bars,indicators:f.indicators.filter(x=>x.id!=='vwap'&&x.id!=='volume_profile'&&x.id!=='liquidity_sweeps'),nowMs:f.now},{});
  assert.equal(r.activeIndicatorIds.includes('delta_buy_sell'),false);
  assert.equal(r.activeIndicatorIds.includes('order_flow'),false);
  assert.ok(r.blockers.includes('FOUR_ENGINE_EVIDENCE_INCOMPLETE'));
});
test('OHLC epoch-second timestamps are normalized to milliseconds',()=>{
  const now=1800000000000;
  const seconds=Array.from({length:50},(_,i)=>{const close=4000+i;const timestamp=(now-(49-i)*60000)/1000;return {t:timestamp,o:close-.4,h:close+1,l:close-1,c:close};});
  const normalized=require('./engine5-layered-adaptive-v4').normalizeBars(seconds);
  assert.equal(normalized.length,50);
  assert.equal(normalized.at(-1).timestamp,now);
});

test('stale and out-of-order OHLC fail closed',()=>{
  const f=fixture();
  const stale=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now+300000},{});
  assert.ok(stale.blockers.includes('STALE_OR_FUTURE_OHLC'));
  [f.bars[4],f.bars[5]]=[f.bars[5],f.bars[4]];
  const order=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now},{});
  assert.ok(order.blockers.includes('INSUFFICIENT_OR_INVALID_OHLC'));
});

test('adaptive weighted score sets master direction; engine majority does not veto it',()=>{
  const f=fixture();
  f.indicators=f.indicators.map(x=>{
    const engine=INDICATORS.find(d=>d.id===x.id).engine;
    return engine==='trend'?{...x,action:'BUY',reliability:1}:
      {...x,action:'SELL',reliability:.15};
  });
  const r=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now},{});
  assert.equal(r.engines.filter(e=>e.action==='SELL').length,3);
  assert.equal(r.engines.filter(e=>e.action==='BUY').length,1);
  assert.equal(r.candidateDirection,'BUY');
  assert.equal(r.blockers.includes('MASTER_DIRECTION_CONFLICTS_WITH_ENGINE_MAJORITY'),false);
  // Independent confidence/agreement safety gates may still return WAIT; majority cannot rewrite the score.
  assert.equal(r.direction,'WAIT');
  assert.ok(r.blockers.some(x=>x==='REGIME_ADAPTIVE_CONFIDENCE_BELOW_THRESHOLD'||x==='REGIME_ADAPTIVE_AGREEMENT_BELOW_THRESHOLD'));
});
test('missing Engine 4 evidence is reported as incomplete rather than silently treated as alignment',()=>{
  const f=fixture();
  f.indicators=f.indicators.filter(x=>x.id!=='atr_volatility'&&x.id!=='divergence'&&x.id!=='dxy_inverse_correlation');
  const r=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now},{});
  assert.equal(r.engines.find(e=>e.id==='ENGINE_4').hasEvidence,false);
  assert.ok(r.blockers.includes('FOUR_ENGINE_EVIDENCE_INCOMPLETE'));
  assert.equal(r.qualified,false);
});
test('missing optional DXY context does not create a hard blocker when Engine 4 has other evidence',()=>{
  const f=fixture();
  f.indicators=f.indicators.filter(x=>x.id!=='dxy_inverse_correlation');
  const r=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now},{});
  assert.equal(r.activeIndicatorIds.includes('dxy_inverse_correlation'),false);
  assert.equal(r.engines.find(e=>e.id==='ENGINE_4').hasEvidence,true);
  assert.equal(r.blockers.includes('FOUR_ENGINE_EVIDENCE_INCOMPLETE'),false);
});
test('unverified Volume Profile is retained only as low-confidence evidence',()=>{
  const {normalizeBars}=require('./engine5-layered-adaptive-v4');
  const f=fixture();
  const raw=f.indicators.find(x=>x.id==='volume_profile');
  const low=require('./engine5-layered-adaptive-v4').normalizeIndicators([raw],f.now)[0];
  assert.equal(low.reliability,0.25);
  assert.equal(low.quality,'LOW_CONFIDENCE_VOLUME_UNVERIFIED');
  const verified=require('./engine5-layered-adaptive-v4').normalizeIndicators([{...raw,realVolumeVerified:true}],f.now)[0];
  assert.equal(verified.reliability,1);
  assert.equal(verified.quality,'VERIFIED_REAL_VOLUME');
});

test('stale indicator readings are excluded from active evidence',()=>{
  const f=fixture();
  f.indicators=f.indicators.map(x=>({...x,timestamp:f.now-600000}));
  const r=evaluate({bars:f.bars,indicators:f.indicators,nowMs:f.now},{});
  assert.equal(r.activeIndicators,0);
  assert.ok(r.blockers.includes('INSUFFICIENT_ACTIVE_INDICATORS'));
  assert.equal(r.qualified,false);
});

'use strict';

/**
 * Rizvi Dashboard V5 — Engine 5 Layered Regime-Adaptive Candidate V4
 * Isolated pure decision module. Signal-only; no network, UI, order or deployment side effects.
 * Confidence is decision strength, NOT a calibrated win probability.
 *
 * Layer 1: infer market regime from fresh chronological OHLC; expose diagnostics.
 * Layer 2: score four evidence engines independently, then adapt their weights by
 *           regime affinity and optional outcome feedback with shrinkage + bounds.
 * Layer 3: master decision uses evidence coverage, alignment, regime quality,
 *           adaptive thresholds and persistent distinct-bar confirmation.
 */
const CONFIG = Object.freeze({
  minBars: 30, maxBarAgeMs: 120000, maxInputAgeMs: 180000,
  minActiveIndicators: 6, minEnginesWithEvidence: 4,
  minAlignedEngines: 3, requiredQualifiedBars: 3,
  minEngineWeight: 0.10, maxEngineWeight: 0.40,
  minConfidence: 68, maxConfidence: 92,
  minAgreement: 60, maxAgreement: 90,
  minDeadband: 0.08, maxDeadband: 0.28,
  feedbackMinSamples: 20, regimeHysteresisBars: 2
});

const INDICATORS = Object.freeze([
  {id:'ema_9_21',engine:'trend',family:'trend'},
  {id:'rsi_14',engine:'trend',family:'momentum'},
  {id:'macd',engine:'trend',family:'momentum'},
  {id:'trend_strength',engine:'trend',family:'trend_strength'},
  {id:'market_structure',engine:'structure',family:'structure'},
  {id:'structure_prediction',engine:'structure',family:'prediction'},
  {id:'candle_price_action',engine:'structure',family:'price_action'},
  {id:'fvg',engine:'structure',family:'imbalance'},
  {id:'support_resistance',engine:'structure',family:'levels'},
  {id:'day_high_low',engine:'structure',family:'daily_levels'},
  {id:'trading_sessions',engine:'structure',family:'session_context'},
  {id:'vwap',engine:'flow',family:'value'},
  {id:'volume_profile',engine:'flow',family:'volume'},
  {id:'liquidity_sweeps',engine:'flow',family:'liquidity'},

  {id:'atr_volatility',engine:'regime',family:'volatility'},
  {id:'divergence',engine:'regime',family:'reversal'},
  {id:'dxy_inverse_correlation',engine:'regime',family:'macro_context'}
]);
const ENGINES = Object.freeze([
  {id:'ENGINE_1',key:'trend',name:'Trend & Momentum',indicators:['ema_9_21','rsi_14','macd','trend_strength']},
  {id:'ENGINE_2',key:'structure',name:'Structure & Price Action',indicators:['market_structure','structure_prediction','candle_price_action','fvg','support_resistance','day_high_low','trading_sessions']},
  {id:'ENGINE_3',key:'flow',name:'Volume & Liquidity',indicators:['vwap','volume_profile','liquidity_sweeps']},
  {id:'ENGINE_4',key:'regime',name:'Volatility & Reversal',indicators:['atr_volatility','divergence','dxy_inverse_correlation']}
]);
const BASE_WEIGHTS = Object.freeze({trend:.25,structure:.25,flow:.25,regime:.25});
const AFFINITY = Object.freeze({
  TRENDING_UP:{trend:1.45,structure:1.05,flow:.95,regime:.65},
  TRENDING_DOWN:{trend:1.45,structure:1.05,flow:.95,regime:.65},
  RANGING:{trend:.60,structure:1.45,flow:1.10,regime:1.20},
  HIGH_VOLATILITY:{trend:.80,structure:.95,flow:.90,regime:1.55},
  TRANSITION:{trend:.80,structure:1.15,flow:.90,regime:1.25},
  MIXED:{trend:1,structure:1,flow:1,regime:1}
});
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const timeMs=v=>{ if(typeof v==='number'&&Number.isFinite(v)) return Math.abs(v)<1e12?v*1000:v; const parsed=Date.parse(v); return parsed; };
function dir(v) {
  if(typeof v==='number'&&Number.isFinite(v)) return clamp(v,-1,1);
  const s=String(v??'').trim().toUpperCase();
  if(['BUY','BULLISH','UP','LONG'].includes(s)) return 1;
  if(['SELL','BEARISH','DOWN','SHORT'].includes(s)) return -1;
  if(['WAIT','NEUTRAL','FLAT'].includes(s)) return 0;
  return null;
}
function normalizeBars(rows) {
  if(!Array.isArray(rows)) return [];
  const out=[];
  for(const r of rows) {
    if(!r||typeof r!=='object') continue;
    const timestamp=timeMs(r.timestamp??r.time??r.t);
    const open=Number(r.open??r.o),high=Number(r.high??r.h),low=Number(r.low??r.l),close=Number(r.close??r.c);
    if(![timestamp,open,high,low,close].every(Number.isFinite)||Math.min(open,high,low,close)<=0||
       high<Math.max(open,close)||low>Math.min(open,close)||high<low) continue;
    out.push({timestamp,open,high,low,close});
  }
  for(let i=1;i<out.length;i++) if(out[i].timestamp<=out[i-1].timestamp) return [];
  return out;
}
function ema(values,n) {
  if(!values.length) return 0;
  const k=2/(n+1); let e=values[0];
  for(let i=1;i<values.length;i++) e=values[i]*k+e*(1-k);
  return e;
}
function detectRegime(bars, previousState={}) {
  const closes=bars.map(b=>b.close), ranges=bars.map(b=>b.high-b.low);
  const recent=closes.slice(-11), meanRange=avg(ranges.slice(-14)), priorRange=avg(ranges.slice(-28,-14));
  const spread=(ema(closes.slice(-20),9)-ema(closes,21))/Math.max(meanRange,1e-9);
  const signs=[];
  for(let i=1;i<recent.length;i++) signs.push(Math.sign(recent[i]-recent[i-1]));
  const consistency=avg(signs), volRatio=priorRange>0?meanRange/priorRange:1;
  let name='TRANSITION';
  if(volRatio>=1.8) name='HIGH_VOLATILITY';
  else if(spread>=.45&&consistency>.2) name='TRENDING_UP';
  else if(spread<=-.45&&consistency<-.2) name='TRENDING_DOWN';
  else if(Math.abs(spread)<.25&&volRatio<1.5) name='RANGING';
  // Hysteresis: require the candidate regime on two distinct bars before switching.
  const prior=previousState.regimeState||{};
  const sameCandidate=prior.candidate===name;
  const candidateCount=sameCandidate?(Number(prior.candidateCount)||0)+1:1;
  const activeName=prior.active&&prior.active!==name&&candidateCount<CONFIG.regimeHysteresisBars?prior.active:name;
  const quality=clamp(0.45+Math.min(1,Math.abs(spread))*.25+Math.min(1,Math.abs(consistency))*.15+
    Math.min(1,Math.abs(volRatio-1))*.15,0,1);
  return {name:activeName,candidate:name,quality:Number(quality.toFixed(3)),
    metrics:{spread:Number(spread.toFixed(4)),consistency:Number(consistency.toFixed(3)),volRatio:Number(volRatio.toFixed(3))},
    qualityLabel:'HEURISTIC_PENDING_WALK_FORWARD_VALIDATION',
    nextState:{active:activeName,candidate:name,candidateCount}};
}
function normalizeIndicators(rows,now) {
  const byId=new Map();
  for(const r of Array.isArray(rows)?rows:[]) {
    if(!r||typeof r.id!=='string'||byId.has(r.id)||r.available===false) continue;
    const def=INDICATORS.find(x=>x.id===r.id), d=dir(r.action);
    if(!def||d===null) continue;
    if(r.timestamp!=null) { const t=timeMs(r.timestamp); if(!Number.isFinite(t)||now-t>CONFIG.maxInputAgeMs||t-now>5000) continue; }
    let reliability=r.reliability==null?1:Number(r.reliability);
    if(!Number.isFinite(reliability)||reliability<0||reliability>1) continue;
    // Volume Profile is only full-confidence evidence when the upstream feed explicitly verifies real traded volume.
    // Never infer volume validity from an OHLC bar or silently synthesize it.
    if(r.id==='volume_profile' && r.realVolumeVerified!==true) reliability=Math.min(reliability,0.25);
    byId.set(r.id,{...def,dir:d,reliability,quality:r.id==='volume_profile'?(r.realVolumeVerified===true?'VERIFIED_REAL_VOLUME':'LOW_CONFIDENCE_VOLUME_UNVERIFIED'):'NORMAL'});
  }
  return [...byId.values()];
}
function boundedWeights(raw) {
  // Projection onto a bounded simplex: all weights remain within bounds and sum to 1.
  const keys=Object.keys(raw), out={}; let free=new Set(keys), remaining=1;
  for(let pass=0;pass<keys.length+2;pass++) {
    const total=[...free].reduce((s,k)=>s+Math.max(0,raw[k]),0);
    if(!free.size||total<=0) break;
    let changed=false;
    for(const k of [...free]) {
      const proposed=remaining*Math.max(0,raw[k])/total;
      if(proposed<CONFIG.minEngineWeight) { out[k]=CONFIG.minEngineWeight; remaining-=out[k]; free.delete(k); changed=true; }
      else if(proposed>CONFIG.maxEngineWeight) { out[k]=CONFIG.maxEngineWeight; remaining-=out[k]; free.delete(k); changed=true; }
    }
    if(!changed) { const t=[...free].reduce((s,k)=>s+Math.max(0,raw[k]),0)||1; for(const k of free) out[k]=remaining*Math.max(0,raw[k])/t; free.clear(); }
  }
  for(const k of keys) if(out[k]==null) out[k]=1/keys.length;
  return Object.fromEntries(keys.map(k=>[k,Number(out[k].toFixed(4))]));
}
function adaptiveWeights(regime,state={}) {
  const affinity=AFFINITY[regime.name]||AFFINITY.MIXED, perf=state.enginePerformance||{}, raw={};
  for(const e of ENGINES) {
    const p=perf[e.key]||{}, samples=Math.max(0,Number(p.samples)||0);
    const hit=clamp(Number(p.hitRate??.5),0,1);
    // No meaningful learning until minimum sample count; then shrink toward neutral.
    const feedback=samples<CONFIG.feedbackMinSamples?0:(hit-.5)*(samples/(samples+40));
    const learned=clamp(1+feedback,.80,1.20);
    raw[e.key]=BASE_WEIGHTS[e.key]*affinity[e.key]*learned;
  }
  const sum=Object.values(raw).reduce((s,x)=>s+x,0)||1;
  return boundedWeights(Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,v/sum])));
}
function adaptiveThresholds(regime) {
  const m=regime.metrics||{}, vol=clamp(Number(m.volRatio)||1,.5,3), trend=clamp(Math.abs(Number(m.spread)||0),0,2);
  return {
    deadband:Number(clamp(.10+Math.max(0,vol-1)*.07-Math.min(trend,1)*.025,CONFIG.minDeadband,CONFIG.maxDeadband).toFixed(3)),
    confidence:Math.round(clamp(72+Math.max(0,vol-1)*9-Math.min(trend,1)*4,CONFIG.minConfidence,CONFIG.maxConfidence)),
    agreement:Math.round(clamp(64+Math.max(0,vol-1)*8-Math.min(trend,1)*4,CONFIG.minAgreement,CONFIG.maxAgreement))
  };
}
function runEngine(def,active,thresholds) {
  const rows=active.filter(x=>def.indicators.includes(x.id)), families=new Map();
  for(const x of rows) {
    const v=x.dir*x.reliability, old=families.get(x.family);
    if(!old||Math.abs(v)>Math.abs(old)) families.set(x.family,{vote:v,indicator:x.id});
  }
  const familyVotes=[...families.values()].map(x=>x.vote), strength=avg(familyVotes);
  const action=strength>=thresholds.deadband?'BUY':strength<=-thresholds.deadband?'SELL':'WAIT';
  return {id:def.id,key:def.key,name:def.name,action,strength:Number(strength.toFixed(4)),
    confidence:Math.round(Math.abs(strength)*100),activeIndicators:rows.length,
    evidenceFamilies:families.size,indicatorIds:rows.map(x=>x.id),hasEvidence:families.size>0};
}
function evaluate(input={},state={}) {
  const now=Number.isFinite(input.nowMs)?input.nowMs:Date.now(), bars=normalizeBars(input.bars);
  const fail=(reason)=>({symbol:'XAU/USD',direction:'WAIT',candidateDirection:'WAIT',confidence:0,displayConfidence:0,confidenceSource:'MASTER_DECISION',qualified:false,autoTrading:false,
    blockers:[reason],activeIndicators:0,engines:[],nextState:{...state,consecutiveQualifiedBars:0}});
  if(bars.length<CONFIG.minBars) return fail('INSUFFICIENT_OR_INVALID_OHLC');
  const last=bars[bars.length-1];
  if(now-last.timestamp>CONFIG.maxBarAgeMs||last.timestamp-now>5000) return fail('STALE_OR_FUTURE_OHLC');
  const active=normalizeIndicators(input.indicators,now);
  const regime=detectRegime(bars,state), thresholds=adaptiveThresholds(regime), weights=adaptiveWeights(regime,state);
  const engines=ENGINES.map(e=>runEngine(e,active,thresholds)), present=engines.filter(e=>e.hasEvidence);
  const weightedTotal=present.reduce((s,e)=>s+weights[e.key],0);
  const score=weightedTotal?present.reduce((s,e)=>s+e.strength*weights[e.key],0)/weightedTotal:0;
  const buy=present.filter(e=>e.action==='BUY').length, sell=present.filter(e=>e.action==='SELL').length;
  const aligned=Math.max(buy,sell), agreement=present.length?100*aligned/present.length:0;
  const candidateDirection=score>=thresholds.deadband?'BUY':score<=-thresholds.deadband?'SELL':'WAIT';
  // Adaptive weighted score is the sole directional decision source. Engine agreement
  // remains a separate qualification/confidence diagnostic; majority never vetoes score.
  // Confidence is transparent decision strength from score, agreement, evidence coverage and regime quality.
  const coverage=engines.length?present.length/engines.length:0;
  const confidence=Math.round(clamp(Math.abs(score)*45+agreement*.30+coverage*10+regime.quality*15,0,100));
  const blockers=[];
  if(active.length<CONFIG.minActiveIndicators) blockers.push('INSUFFICIENT_ACTIVE_INDICATORS');
  if(present.length<CONFIG.minEnginesWithEvidence) blockers.push('FOUR_ENGINE_EVIDENCE_INCOMPLETE');
  if(aligned<CONFIG.minAlignedEngines) blockers.push('ENGINE_ALIGNMENT_BELOW_3_OF_4');
  if(agreement<thresholds.agreement) blockers.push('REGIME_ADAPTIVE_AGREEMENT_BELOW_THRESHOLD');
  if(confidence<thresholds.confidence) blockers.push('REGIME_ADAPTIVE_CONFIDENCE_BELOW_THRESHOLD');
  if(candidateDirection==='WAIT') blockers.push('MASTER_SCORE_WITHIN_ADAPTIVE_DEADBAND');
  const rawQualified=blockers.length===0, priorCount=Number.isInteger(state.consecutiveQualifiedBars)?state.consecutiveQualifiedBars:0;
  const priorTs=Number.isFinite(state.lastQualifiedBarTimestamp)?state.lastQualifiedBarTimestamp:null;
  const isNewBar=priorTs===null||last.timestamp>priorTs;
  const consecutive=rawQualified?(isNewBar?priorCount+1:priorCount):0;
  if(rawQualified&&!isNewBar) blockers.push('WAITING_FOR_NEXT_DISTINCT_BAR');
  if(consecutive<CONFIG.requiredQualifiedBars) blockers.push('WAITING_FOR_3_DISTINCT_QUALIFIED_BARS');
  const qualified=rawQualified&&isNewBar&&consecutive>=CONFIG.requiredQualifiedBars;
  return {symbol:'XAU/USD',direction:qualified?candidateDirection:'WAIT',candidateDirection,qualified,autoTrading:false,
    score:Number(score.toFixed(4)),confidence,displayConfidence:confidence,confidenceSource:'MASTER_DECISION',agreement:Math.round(agreement),alignedEngines:aligned,totalEngines:present.length,
    activeIndicators:active.length,activeIndicatorIds:active.map(x=>x.id),engines,regime,adaptiveWeights:weights,
    adaptiveThresholds:thresholds,blockers,
    nextState:{...state,regimeState:regime.nextState,consecutiveQualifiedBars:rawQualified?consecutive:0,
      lastQualifiedBarTimestamp:rawQualified&&isNewBar?last.timestamp:priorTs},
    notes:['Confidence is not win probability.','Regime detector is heuristic pending walk-forward validation.',
      'Outcome feedback only adapts when real, timestamped outcome statistics are supplied in enginePerformance.',
      'Delta, Order Flow and News are excluded from this approved 17-indicator candidate; missing optional context data is never synthesized.']};
}
module.exports={CONFIG,INDICATORS,ENGINES,BASE_WEIGHTS,AFFINITY,normalizeBars,normalizeIndicators,detectRegime,adaptiveWeights,adaptiveThresholds,evaluate};

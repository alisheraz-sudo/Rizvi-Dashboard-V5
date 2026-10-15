'use strict';

/**
 * Rizvi Engine 5 Outcome-Aware Regime-Adaptive V4 (JavaScript candidate).
 * Pure decision module: no fetch, DOM, network, order or deployment side effects.
 * Signal-only. Confidence is decision strength, NOT a win probability.
 * The 17 indicator definitions are a registry/contract; indicators that need
 * unavailable APIs remain inactive and never receive fabricated values.
 */
const CONFIG = Object.freeze({
  minBars: 30, maxBarAgeMs: 120000, maxInputAgeMs: 180000,
  minActiveIndicators: 6, minAlignedEngines: 3, minEngines: 4,
  minAlignedAlgorithms: 4, minAlgorithms: 5, requiredQualifiedBars: 3,
  minEngineWeight: 0.08, maxEngineWeight: 0.48,
  minDecisionConfidence: 68, maxDecisionConfidence: 92,
  minDecisionAgreement: 60, maxDecisionAgreement: 90,
  minEngineDeadband: 0.08, maxEngineDeadband: 0.28
});

const INDICATORS = Object.freeze([
  { id:'ema_9_21', name:'EMA 9/21', engine:'trend', family:'trend' },
  { id:'rsi_14', name:'RSI-14', engine:'trend', family:'momentum' },
  { id:'macd', name:'MACD', engine:'trend', family:'momentum' },
  { id:'trend_strength', name:'Trend Strength', engine:'trend', family:'trend' },
  { id:'market_structure', name:'Market Structure', engine:'structure', family:'structure' },
  { id:'structure_prediction', name:'Structure Prediction', engine:'structure', family:'structure' },
  { id:'candle_price_action', name:'Candle / Price Action', engine:'structure', family:'price_action' },
  { id:'fvg', name:'Fair Value Gap', engine:'structure', family:'imbalance' },
  { id:'support_resistance', name:'Support / Resistance', engine:'structure', family:'levels' },
  { id:'range_levels', name:'Range Levels', engine:'structure', family:'levels' },
  { id:'vwap', name:'VWAP', engine:'flow', family:'value' },
  { id:'volume_profile', name:'Volume Profile', engine:'flow', family:'volume' },
  { id:'liquidity_sweeps', name:'Liquidity Pools / Sweeps', engine:'flow', family:'liquidity' },
  { id:'delta_buy_sell', name:'Delta Buy / Sell', engine:'flow', family:'orderflow', requiresApi:true },
  { id:'order_flow', name:'Order Flow', engine:'flow', family:'orderflow', requiresApi:true },
  { id:'atr_volatility', name:'ATR / Volatility', engine:'regime', family:'volatility' },
  { id:'divergence', name:'Divergence', engine:'regime', family:'reversal' }
]);

const ENGINE_DEFS = Object.freeze([
  { id:'ENGINE_1', name:'Trend & Momentum', engine:'trend', indicators:['ema_9_21','rsi_14','macd','trend_strength'] },
  { id:'ENGINE_2', name:'Structure & Price Action', engine:'structure', indicators:['market_structure','structure_prediction','candle_price_action','fvg','support_resistance','range_levels'] },
  { id:'ENGINE_3', name:'Volume & Liquidity', engine:'flow', indicators:['vwap','volume_profile','liquidity_sweeps','delta_buy_sell','order_flow'] },
  { id:'ENGINE_4', name:'Volatility & Reversal', engine:'regime', indicators:['atr_volatility','divergence'] }
]);

// Priors only: final weights are recalculated for each regime and feedback state.
const BASE_WEIGHTS = Object.freeze({ trend:0.25, structure:0.25, flow:0.25, regime:0.25 });
const REGIME_AFFINITY = Object.freeze({
  TRENDING_UP:    { trend:1.45, structure:1.05, flow:0.95, regime:0.65 },
  TRENDING_DOWN:  { trend:1.45, structure:1.05, flow:0.95, regime:0.65 },
  RANGING:        { trend:0.60, structure:1.45, flow:1.10, regime:1.20 },
  HIGH_VOLATILITY:{ trend:0.80, structure:0.95, flow:0.90, regime:1.55 },
  TRANSITION:     { trend:0.80, structure:1.15, flow:0.90, regime:1.25 },
  MIXED:          { trend:1, structure:1, flow:1, regime:1 }
});

const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const avg = xs => xs.length ? xs.reduce((s,x)=>s+x,0)/xs.length : 0;
const timeMs = v => typeof v === 'number' && Number.isFinite(v) ? v : Date.parse(v);
function direction(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return clamp(value,-1,1);
  const s = String(value ?? '').trim().toUpperCase();
  if (['BUY','BULLISH','UP','LONG'].includes(s)) return 1;
  if (['SELL','BEARISH','DOWN','SHORT'].includes(s)) return -1;
  if (['WAIT','NEUTRAL','FLAT'].includes(s)) return 0;
  return null;
}
function normalizeBars(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const timestamp = timeMs(raw.timestamp ?? raw.time ?? raw.t);
    const open = Number(raw.open ?? raw.o), high = Number(raw.high ?? raw.h);
    const low = Number(raw.low ?? raw.l), close = Number(raw.close ?? raw.c);
    if (![timestamp,open,high,low,close].every(Number.isFinite)) continue;
    if (Math.min(open,high,low,close) <= 0 || high < Math.max(open,close) ||
        low > Math.min(open,close) || high < low) continue;
    out.push({timestamp,open,high,low,close});
  }
  // Require source order to be chronological; don't silently sort bad feed data.
  for (let i=1;i<out.length;i++) if (out[i].timestamp <= out[i-1].timestamp) return [];
  return out;
}
function detectRegime(bars) {
  const c = bars.map(b=>b.close), ranges = bars.map(b=>b.high-b.low);
  const meanRange = avg(ranges.slice(-14)), oldRange = avg(ranges.slice(-28,-14));
  const ema = (a,n) => { let e=a[0], k=2/(n+1); for(let i=1;i<a.length;i++) e=a[i]*k+e*(1-k); return e; };
  const eFast = ema(c.slice(-Math.min(c.length,20)),Math.min(9,c.length));
  const eSlow = ema(c,Math.min(21,c.length));
  const spread = (eFast-eSlow)/Math.max(meanRange,1e-9);
  const recentReturns = c.slice(-11).slice(1).map((v,i)=>Math.sign(v-c.slice(-11)[i]));
  const consistency = avg(recentReturns);
  const volRatio = oldRange>0 ? meanRange/oldRange : 1;
  if (volRatio>=1.8) return {name:'HIGH_VOLATILITY',quality:'HEURISTIC_NOT_VALIDATED',metrics:{spread,consistency,volRatio}};
  if (spread>=0.45 && consistency>0.2) return {name:'TRENDING_UP',quality:'HEURISTIC_NOT_VALIDATED',metrics:{spread,consistency,volRatio}};
  if (spread<=-0.45 && consistency< -0.2) return {name:'TRENDING_DOWN',quality:'HEURISTIC_NOT_VALIDATED',metrics:{spread,consistency,volRatio}};
  if (Math.abs(spread)<0.25 && volRatio<1.5) return {name:'RANGING',quality:'HEURISTIC_NOT_VALIDATED',metrics:{spread,consistency,volRatio}};
  return {name:'TRANSITION',quality:'HEURISTIC_NOT_VALIDATED',metrics:{spread,consistency,volRatio}};
}
function normalizeIndicators(rows, now, maxAge) {
  const byId = new Map();
  for (const row of Array.isArray(rows)?rows:[]) {
    if (!row || typeof row.id!=='string' || byId.has(row.id) || row.available===false) continue;
    const def = INDICATORS.find(x=>x.id===row.id);
    const dir = direction(row.action);
    if (!def || dir===null) continue;
    if (row.timestamp != null) {
      const t=timeMs(row.timestamp);
      if (!Number.isFinite(t) || now-t>maxAge || t-now>5000) continue;
    }
    const reliability = row.reliability==null?1:Number(row.reliability);
    if (!Number.isFinite(reliability) || reliability<0 || reliability>1) continue;
    byId.set(row.id,{...def,dir,reliability,score:row.score==null?null:Number(row.score)});
  }
  return [...byId.values()];
}
function adaptiveThresholds(regime) {
  const m=regime.metrics||{};
  const vol=clamp(Number(m.volRatio)||1,0.5,3);
  const trend=clamp(Math.abs(Number(m.spread)||0),0,2);
  // Thresholds move with measured conditions; bounds prevent runaway behavior.
  const engineDeadband=clamp(0.10 + Math.max(0,vol-1)*0.07 - Math.min(trend,1)*0.025,
    CONFIG.minEngineDeadband,CONFIG.maxEngineDeadband);
  const confidence=clamp(72 + Math.max(0,vol-1)*9 - Math.min(trend,1)*4,
    CONFIG.minDecisionConfidence,CONFIG.maxDecisionConfidence);
  const agreement=clamp(64 + Math.max(0,vol-1)*8 - Math.min(trend,1)*4,
    CONFIG.minDecisionAgreement,CONFIG.maxDecisionAgreement);
  return {engineDeadband:Number(engineDeadband.toFixed(3)),
    confidence:Math.round(confidence),agreement:Math.round(agreement)};
}
function adaptiveWeights(regime, state) {
  const affinity=REGIME_AFFINITY[regime.name]||REGIME_AFFINITY.MIXED;
  const performance=state.enginePerformance&&typeof state.enginePerformance==='object'?state.enginePerformance:{};
  const raw={};
  for(const def of ENGINE_DEFS) {
    const key=def.engine, p=performance[key]||{};
    const samples=Math.max(0,Number(p.samples)||0);
    const hitRate=clamp(Number(p.hitRate??0.5),0,1);
    // Small samples are shrunk toward neutral; feedback influence grows gradually.
    const feedback=(hitRate-0.5)*(samples/(samples+20));
    const learned=clamp(1+feedback,0.75,1.25);
    raw[key]=(BASE_WEIGHTS[key]||0.25)*(affinity[key]||1)*learned;
  }
  const total=Object.values(raw).reduce((s,x)=>s+x,0)||1;
  const normalized={};
  for(const key of Object.keys(raw)) normalized[key]=raw[key]/total;
  // Keep every engine represented while allowing market- and outcome-based variation.
  const bounded={};
  for(const key of Object.keys(normalized)) bounded[key]=clamp(normalized[key],CONFIG.minEngineWeight,CONFIG.maxEngineWeight);
  const sum=Object.values(bounded).reduce((s,x)=>s+x,0)||1;
  for(const key of Object.keys(bounded)) bounded[key]=Number((bounded[key]/sum).toFixed(4));
  return bounded;
}
function runSubEngine(def, active, thresholds) {
  const rows=active.filter(x=>def.indicators.includes(x.id));
  const families=new Map();
  for(const x of rows) {
    const prior=families.get(x.family);
    const vote=x.dir*x.reliability;
    if(!prior || Math.abs(vote)>Math.abs(prior.vote)) families.set(x.family,{vote,id:x.id});
  }
  const votes=[...families.values()].map(x=>x.vote);
  const strength=avg(votes);
  const action=strength>=thresholds.engineDeadband?'BUY':strength<=-thresholds.engineDeadband?'SELL':'WAIT';
  return {id:def.id,name:def.name,action,strength:Number(strength.toFixed(4)),
    confidence:Math.round(Math.abs(strength)*100),activeIndicators:rows.length,
    evidenceFamilies:families.size,indicatorIds:rows.map(x=>x.id),independent:true};
}
function runMaster(engines, regime, activeCount, state, lastBarTs) {
  const weights=adaptiveWeights(regime,state);
  const thresholds=adaptiveThresholds(regime);
  const present=engines.filter(e=>e.evidenceFamilies>0);
  const totalWeight=present.reduce((s,e)=>s+(weights[ENGINE_DEFS.find(d=>d.id===e.id).engine]||0),0);
  const score=totalWeight ? present.reduce((s,e)=>s+e.strength*(weights[ENGINE_DEFS.find(d=>d.id===e.id).engine]||0),0)/totalWeight : 0;
  const buy=present.filter(e=>e.action==='BUY').length, sell=present.filter(e=>e.action==='SELL').length;
  const aligned=Math.max(buy,sell), directionName=score>=thresholds.engineDeadband?'BUY':score<=-thresholds.engineDeadband?'SELL':'WAIT';
  const agreement=present.length?100*aligned/present.length:0;
  const confidence=Math.round(clamp(Math.abs(score)*70+agreement*0.30,0,100));
  const blockers=[];
  if(activeCount<CONFIG.minActiveIndicators) blockers.push('INSUFFICIENT_ACTIVE_INDICATORS');
  if(present.length<CONFIG.minEngines) blockers.push('FOUR_ENGINE_EVIDENCE_INCOMPLETE');
  if(aligned<CONFIG.minAlignedEngines) blockers.push('ENGINE_ALIGNMENT_BELOW_3_OF_4');
  if(agreement<thresholds.agreement) blockers.push('REGIME_ADAPTIVE_AGREEMENT_BELOW_THRESHOLD');
  if(confidence<thresholds.confidence) blockers.push('REGIME_ADAPTIVE_CONFIDENCE_BELOW_THRESHOLD');
  const alignedAlgorithms=Array.isArray(state.algorithms)
    ? state.algorithms.filter(x=>x && x.available!==false && direction(x.action)===direction(directionName) && directionName!=='WAIT').length : 0;
  if(alignedAlgorithms<CONFIG.minAlignedAlgorithms) blockers.push('ALGORITHM_CONFIRMATION_BELOW_4_OF_5');
  if((Array.isArray(state.algorithms)?state.algorithms.filter(x=>x&&x.available!==false).length:0)<CONFIG.minAlgorithms) blockers.push('ALGORITHM_INPUTS_INCOMPLETE');
  const rawQualified=blockers.length===0 && directionName!=='WAIT';
  const previousCount=Number.isInteger(state.consecutiveQualifiedBars)?state.consecutiveQualifiedBars:0;
  const previousTs=Number.isFinite(state.lastQualifiedBarTimestamp)?state.lastQualifiedBarTimestamp:null;
  const isNewBar=previousTs===null || lastBarTs>previousTs;
  const consecutive=rawQualified ? (isNewBar?previousCount+1:previousCount) : 0;
  if(rawQualified && !isNewBar) blockers.push('WAITING_FOR_NEXT_DISTINCT_BAR');
  if(consecutive<CONFIG.requiredQualifiedBars) blockers.push('WAITING_FOR_3_DISTINCT_QUALIFIED_BARS');
  const qualified=rawQualified && isNewBar && consecutive>=CONFIG.requiredQualifiedBars;
  return {
    symbol:'XAU/USD',direction:qualified?directionName:'WAIT',candidateDirection:directionName,
    confidence,agreement:Math.round(agreement),alignedEngines:aligned,totalEngines:present.length,
    activeIndicators:activeCount,regime,adaptiveWeights:weights,adaptiveThresholds:thresholds,
    qualified,autoTrading:false,blockers,score:Number(score.toFixed(4)),
    nextState:{consecutiveQualifiedBars:rawQualified?consecutive:0,
      lastQualifiedBarTimestamp:rawQualified && isNewBar?lastBarTs:previousTs}
  };
}
function evaluate(input={}, state={}) {
  const now=Number.isFinite(input.nowMs)?input.nowMs:Date.now();
  const bars=normalizeBars(input.bars);
  if(bars.length<CONFIG.minBars) return {direction:'WAIT',qualified:false,autoTrading:false,blockers:['INSUFFICIENT_OR_INVALID_OHLC'],activeIndicators:0,engines:[],nextState:{consecutiveQualifiedBars:0,lastQualifiedBarTimestamp:state.lastQualifiedBarTimestamp??null}};
  const last=bars[bars.length-1];
  if(now-last.timestamp>CONFIG.maxBarAgeMs || last.timestamp-now>5000)
    return {direction:'WAIT',qualified:false,autoTrading:false,blockers:['STALE_OR_FUTURE_OHLC'],activeIndicators:0,engines:[],nextState:{consecutiveQualifiedBars:0,lastQualifiedBarTimestamp:state.lastQualifiedBarTimestamp??null}};
  const active=normalizeIndicators(input.indicators,now,CONFIG.maxInputAgeMs);
  const regime=detectRegime(bars);
  const thresholds=adaptiveThresholds(regime);
  const engines=ENGINE_DEFS.map(def=>runSubEngine(def,active,thresholds));
  const master=runMaster(engines,regime,active.length,{...state,algorithms:input.algorithms},last.timestamp);
  return {...master,engines,activeIndicatorIds:active.map(x=>x.id),indicatorRegistry:INDICATORS,
    source:'caller-supplied validated XAU/USD OHLC + indicator payload',
    regimeNote:'Heuristic regime detector; requires live validation and walk-forward evaluation'};
}
module.exports={CONFIG,INDICATORS,ENGINE_DEFS,BASE_WEIGHTS,REGIME_AFFINITY,normalizeBars,detectRegime,adaptiveWeights,adaptiveThresholds,evaluate};

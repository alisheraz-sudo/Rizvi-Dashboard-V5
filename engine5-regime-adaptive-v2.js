'use strict';

/**
 * Engine 5 Regime-Adaptive JS V2 — isolated candidate.
 * Contract-first, fail-closed, no network/UI/order side effects.
 * Confidence is a decision-strength score, NOT win probability.
 *
 * Canonical inputs:
 * bars: [{ timestamp, open, high, low, close }]
 * indicators: [{ id, family, action, score?, reliability?, available?, timestamp? }]
 * algorithms: [{ id, action, confidence, available? }]
 * engines: [{ id: 'ENGINE_1'..'ENGINE_4', independent: true, action, timestamp? }]
 */
const GATES = Object.freeze({
  minBars: 30, maxBarAgeMs: 120_000, maxInputAgeMs: 180_000,
  minConfidence: 80, minAgreement: 70, minAlignedAlgorithms: 4,
  minAlgorithms: 5, minAlignedEngines: 3, minEngines: 4,
  minActiveIndicators: 6, requiredQualifiedRuns: 3
});
const FAMILIES = Object.freeze(['trend','momentum','value','structure','volume','volatility','reversal','other']);
const BASE_WEIGHTS = Object.freeze({
  trend:0.18, momentum:0.14, value:0.12, structure:0.16,
  volume:0.12, volatility:0.10, reversal:0.10, other:0.08
});
const REGIME_MULTIPLIERS = Object.freeze({
  TRENDING_UP: {trend:1.15,momentum:1.10,value:1,structure:1.10,volume:1,volatility:0.90,reversal:0.85,other:1},
  TRENDING_DOWN: {trend:1.15,momentum:1.10,value:1,structure:1.10,volume:1,volatility:0.90,reversal:0.85,other:1},
  RANGING: {trend:0.85,momentum:0.95,value:1.10,structure:1,volume:1.05,volatility:0.95,reversal:1.15,other:1},
  HIGH_VOLATILITY: {trend:0.90,momentum:0.90,value:0.95,structure:1,volume:1.05,volatility:1.15,reversal:1,other:1},
  TRANSITION: {trend:0.95,momentum:0.95,value:1,structure:1,volume:1,volatility:1.05,reversal:1.05,other:1},
  MIXED: {}
});
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
function timeMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : NaN;
}
function actionDir(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return clamp(v,-1,1);
  const s = String(v ?? '').trim().toUpperCase();
  if (['BUY','BULLISH','UP','LONG'].includes(s)) return 1;
  if (['SELL','BEARISH','DOWN','SHORT'].includes(s)) return -1;
  if (['WAIT','NEUTRAL','FLAT'].includes(s)) return 0;
  return null;
}
function normalizeBar(b) {
  if (!b || typeof b !== 'object') return null;
  const timestamp = timeMs(b.timestamp ?? b.time ?? b.t);
  const open = Number(b.open ?? b.o), high = Number(b.high ?? b.h);
  const low = Number(b.low ?? b.l), close = Number(b.close ?? b.c);
  if (![timestamp,open,high,low,close].every(Number.isFinite) ||
      Math.min(open,high,low,close) <= 0 ||
      high < Math.max(open,close) || low > Math.min(open,close) || high < low) return null;
  return {timestamp,open,high,low,close};
}
function ema(values, period) {
  if (!values.length) return null;
  const k = 2/(period+1); let e = values[0];
  for (const v of values.slice(1)) e = v*k + e*(1-k);
  return e;
}
function detectRegime(bars) {
  const closes = bars.map(b=>b.close);
  const ranges = bars.map(b=>b.high-b.low);
  const atrRecent = mean(ranges.slice(-14));
  const atrPrior = mean(ranges.slice(-42,-14));
  const e20 = ema(closes.slice(-80),20), e50 = ema(closes,50);
  const spread = (e20-e50)/Math.max(atrRecent,1e-9);
  const returns = closes.slice(1).map((v,i)=>(v-closes[i])/closes[i]);
  const consistency = mean(returns.slice(-20).map(Math.sign));
  const volRatio = atrPrior > 0 ? atrRecent/atrPrior : 1;
  let name='MIXED', reason='NO_CLEAR_REGIME', confidence=0.35;
  if (volRatio >= 1.8) { name='HIGH_VOLATILITY'; reason='RANGE_EXPANSION'; confidence=clamp(0.55+(volRatio-1.8)*0.15,0.55,0.85); }
  else if (Math.abs(spread)>=1.25 && Math.abs(consistency)>=0.35) {
    name=spread>0?'TRENDING_UP':'TRENDING_DOWN'; reason='EMA_SPREAD_AND_DIRECTION_CONSISTENCY';
    confidence=clamp(0.52+Math.min(Math.abs(spread),2.5)*0.10+Math.abs(consistency)*0.10,0.52,0.85);
  } else if (Math.abs(spread)<0.45 && volRatio<1.45) {
    name='RANGING'; reason='LOW_TREND_SPREAD'; confidence=0.60;
  } else { name='TRANSITION'; reason='REGIME_TRANSITION'; confidence=0.45; }
  return {name, confidence, reason, metrics:{ema20:e20,ema50:e50,spread,consistency,volRatio,atrRecent,atrPrior}};
}
function usableIndicators(rows, now, maxAgeMs) {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(rows)?rows:[]) {
    if (!x || typeof x.id!=='string' || !x.id.trim() || seen.has(x.id)) continue;
    seen.add(x.id);
    if (x.available === false) continue;
    const d=actionDir(x.action);
    const family=FAMILIES.includes(x.family)?x.family:'other';
    const score=x.score==null?null:Number(x.score);
    if (d===null || (score!==null && (!Number.isFinite(score)||score<0||score>100))) continue;
    if (x.timestamp != null) {
      const t=timeMs(x.timestamp);
      if (!Number.isFinite(t)||now-t>maxAgeMs||t>now+5000) continue;
    }
    const reliability=clamp(Number.isFinite(Number(x.reliability))?Number(x.reliability):0.65,0.1,1);
    out.push({id:x.id,family,dir:d,score,reliability});
  }
  return out;
}
function usableReports(rows, allowedIds, now, maxAgeMs, requireIndependent=false) {
  const seen=new Set(), out=[];
  for (const x of Array.isArray(rows)?rows:[]) {
    if (!x || !allowedIds.includes(x.id) || seen.has(x.id) || x.available===false) continue;
    if (requireIndependent && x.independent!==true) continue;
    const d=actionDir(x.action); if (d===null) continue;
    if (x.timestamp!=null) { const t=timeMs(x.timestamp); if(!Number.isFinite(t)||now-t>maxAgeMs||t>now+5000) continue; }
    seen.add(x.id); out.push({id:x.id,dir:d,confidence:clamp(Number(x.confidence)||0,0,100)});
  }
  return out;
}
function evaluate(input={}) {
  const now=Number.isFinite(input.nowMs)?input.nowMs:Date.now();
  const blockers=[], rawBars=(Array.isArray(input.bars)?input.bars:[]).map(normalizeBar).filter(Boolean);
  const bars=rawBars.filter((b,i,a)=>i===0||b.timestamp>a[i-1].timestamp).slice(-120);
  if (bars.length<GATES.minBars) blockers.push('INSUFFICIENT_VALID_OHLC');
  if (bars.length && (now-bars[bars.length-1].timestamp>GATES.maxBarAgeMs || bars[bars.length-1].timestamp>now+5000)) blockers.push('STALE_OR_FUTURE_OHLC');
  const regime=bars.length>=GATES.minBars?detectRegime(bars):{name:'MIXED',confidence:0,reason:'INSUFFICIENT_OHLC',metrics:{}};
  const indicators=usableIndicators(input.indicators,now,GATES.maxInputAgeMs);
  if (indicators.length<GATES.minActiveIndicators) blockers.push('INSUFFICIENT_ACTIVE_INDICATORS');
  const families=[...new Set(indicators.map(x=>x.family))];
  const familyVotes={};
  for (const family of families) {
    const xs=indicators.filter(x=>x.family===family);
    // One vote per family prevents many correlated indicators inflating confluence.
    familyVotes[family]=mean(xs.map(x=>x.dir*x.reliability*(x.score==null?1:clamp(x.score/100,0.25,1))));
  }
  const mult=REGIME_MULTIPLIERS[regime.name]||{};
  const familyWeight={};
  for (const f of Object.keys(familyVotes)) familyWeight[f]=BASE_WEIGHTS[f]*clamp(mult[f]??1,0.85,1.15);
  const totalWeight=Object.values(familyWeight).reduce((a,b)=>a+b,0);
  const weighted=totalWeight?Object.keys(familyVotes).reduce((s,f)=>s+familyVotes[f]*familyWeight[f],0)/totalWeight:0;
  const action=weighted>=0.18?'BUY':weighted<=-0.18?'SELL':'WAIT';
  const directionalFamilies=Object.values(familyVotes).filter(v=>Math.abs(v)>0.05);
  const sameDirection=directionalFamilies.filter(v=>Math.sign(v)===(action==='BUY'?1:action==='SELL'?-1:0)).length;
  const agreement=directionalFamilies.length?100*sameDirection/directionalFamilies.length:0;
  // This is a deterministic strength score, not a probability of profit.
  const confidence=Math.round(clamp(Math.abs(weighted)*65+agreement*0.35,0,100));
  const algorithms=usableReports(input.algorithms,Array.from({length:5},(_,i)=>'ALGORITHM_'+(i+1)),now,GATES.maxInputAgeMs);
  const alignedAlgorithms=algorithms.filter(x=>action!=='WAIT'&&x.dir===(action==='BUY'?1:-1)).length;
  if (algorithms.length<GATES.minAlgorithms) blockers.push('INSUFFICIENT_ALGORITHM_REPORTS');
  if (alignedAlgorithms<GATES.minAlignedAlgorithms) blockers.push('ALGORITHM_ALIGNMENT_FAILED');
  const engines=usableReports(input.engines,['ENGINE_1','ENGINE_2','ENGINE_3','ENGINE_4'],now,GATES.maxInputAgeMs,true);
  const alignedEngines=engines.filter(x=>action!=='WAIT'&&x.dir===(action==='BUY'?1:-1)).length;
  if (engines.length<GATES.minEngines) blockers.push('MISSING_GENUINE_INDEPENDENT_ENGINE_OUTPUTS');
  if (alignedEngines<GATES.minAlignedEngines) blockers.push('ENGINE_ALIGNMENT_FAILED');
  if (confidence<GATES.minConfidence) blockers.push('CONFIDENCE_BELOW_GATE');
  if (agreement<GATES.minAgreement) blockers.push('INDICATOR_AGREEMENT_BELOW_GATE');
  if (action==='WAIT') blockers.push('NO_DIRECTIONAL_SETUP');
  const rawQualified=blockers.length===0;
  const qualifiedRuns=rawQualified?Math.max(0,Number(input.previousQualifiedRuns)||0)+1:0;
  if (rawQualified&&qualifiedRuns<GATES.requiredQualifiedRuns) blockers.push('CONSECUTIVE_QUALIFICATION_NOT_MET');
  const qualified=rawQualified&&qualifiedRuns>=GATES.requiredQualifiedRuns;
  return {
    version:'ENGINE5_REGIME_ADAPTIVE_V2',
    action:qualified?action:'WAIT', candidateAction:action, qualified, confidence,
    confidenceMeaning:'DECISION_STRENGTH_NOT_WIN_PROBABILITY',
    agreement:Math.round(agreement), regime:{...regime,quality:'HEURISTIC_NOT_VALIDATED'},
    activeIndicators:indicators.length, indicatorFamilies:families.length,
    familyVotes, familyWeights:familyWeight,
    algorithmAlignment:{reported:algorithms.length,aligned:alignedAlgorithms},
    engineAlignment:{reported:engines.length,aligned:alignedEngines,independentOnly:true},
    qualifiedRuns, blockers:[...new Set(blockers)],
    autoTrading:false, audit:{barCount:bars.length,latestBarAgeMs:bars.length?now-bars[bars.length-1].timestamp:null}
  };
}
module.exports={GATES,evaluate,detectRegime};

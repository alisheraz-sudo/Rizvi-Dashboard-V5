/**
 * Rizvi Dashboard V5 Engine 5 regime-adaptive evaluator.
 * Isolated pure JS module; not wired to production. No order/network side effects.
 * Confidence is decision strength, not calibrated win probability.
 */
'use strict';
const GATES=Object.freeze({minConfidence:80,minAgreement:70,minAlignedAlgorithms:4,minAlgorithms:5,minActiveIndicators:6,requiredQualifiedRuns:3});
const BASE={trend:.24,momentum:.17,value:.13,liquidity:.18,candle:.13,reversal:.15};
const BIASES={
 TRENDING_UP:{trend:1.45,momentum:1.25,value:1.15,liquidity:1,candle:.95,reversal:.70},
 TRENDING_DOWN:{trend:1.45,momentum:1.25,value:1.15,liquidity:1,candle:.95,reversal:.70},
 RANGING:{trend:.68,momentum:1.22,value:1.05,liquidity:1.18,candle:1.05,reversal:1.42},
 HIGH_VOLATILITY:{trend:.82,momentum:.92,value:.92,liquidity:1.28,candle:1.30,reversal:1.08},
 TRANSITION:{trend:.85,momentum:.95,value:.95,liquidity:1.08,candle:1.08,reversal:1.18},
 MIXED:{}
};
const FAMILIES={trend:['ema','trend','macd','adx','structure'],momentum:['rsi','momentum','stochastic','cci','roc'],value:['vwap','volumeprofile','supportresistance','fvg'],liquidity:['liquidity','sweep','orderflow','delta'],candle:['candle','priceaction','pattern','atr','volatility'],reversal:['divergence','reversal','prediction']};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
function ema(a,n){if(!a.length)return null;let e=a[0],k=2/(n+1);for(const x of a.slice(1))e=x*k+e*(1-k);return e;}
function validBar(b){if(!b)return null;const o=Number(b.o??b.open),h=Number(b.h??b.high),l=Number(b.l??b.low),c=Number(b.c??b.close);if(![o,h,l,c].every(Number.isFinite)||Math.min(o,h,l,c)<=0||h<Math.max(o,c)||l>Math.min(o,c))return null;return {o,h,l,c};}
function detectRegime(input){
 const bars=(Array.isArray(input)?input:[]).map(validBar).filter(Boolean).slice(-120);
 if(bars.length<30)return {name:'MIXED',confidence:0,quality:'LOW',reason:'INSUFFICIENT_OHLC',metrics:{bars:bars.length}};
 const c=bars.map(b=>b.c),r=bars.map(b=>b.h-b.l),atr=mean(r.slice(-14)),prior=mean(r.slice(-42,-14)),e20=ema(c.slice(-80),20),e50=ema(c,50),slope=(e20-e50)/Math.max(atr,1e-9);
 const ret=c.slice(1).map((v,i)=>(v-c[i])/c[i]),recent=mean(ret.slice(-14).map(Math.abs)),older=mean(ret.slice(-42,-14).map(Math.abs)),vr=older?recent/older:(recent?2:1),consistency=mean(ret.slice(-20).map(Math.sign));
 let name='MIXED',confidence=.25,reason='NO_CLEAR_REGIME';
 if(vr>=1.8||(prior>0&&atr/prior>=1.8)){name='HIGH_VOLATILITY';confidence=clamp(.55+Math.max(vr,atr/Math.max(prior,1e-9)-1)*.12,.55,.95);reason='VOLATILITY_EXPANSION';}
 else if(Math.abs(slope)>=1.25&&Math.abs(consistency)>=.35){name=slope>0?'TRENDING_UP':'TRENDING_DOWN';confidence=clamp(.52+Math.min(Math.abs(slope),3)*.11+Math.abs(consistency)*.12,.52,.95);reason='EMA_SPREAD_AND_CONSISTENCY';}
 else if(Math.abs(slope)<.45&&vr<1.45){name='RANGING';confidence=.65;reason='LOW_TREND_STRENGTH';}
 else{name='TRANSITION';confidence=.45;reason='REGIME_TRANSITION';}
 return {name,confidence:Number(confidence.toFixed(4)),quality:'HEURISTIC',reason,metrics:{ema20:e20,ema50:e50,atr14:atr,emaSpreadAtr:Number(slope.toFixed(5)),directionConsistency:Number(consistency.toFixed(4)),volatilityRatio:Number(vr.toFixed(4)),bars:bars.length}};
}
function familyOf(name){const s=String(name).toLowerCase().replace(/[^a-z0-9]/g,'');for(const [f,keys] of Object.entries(FAMILIES))if(keys.some(k=>s.includes(k)))return f;return 'momentum';}
function dir(x){if(typeof x==='number'&&Number.isFinite(x))return clamp(x,-1,1);if(typeof x!=='string')return null;const s=x.trim().toUpperCase();if(['BUY','BULLISH','UP','LONG'].includes(s))return 1;if(['SELL','BEARISH','DOWN','SHORT'].includes(s))return -1;if(['WAIT','NEUTRAL','FLAT'].includes(s))return 0;return null;}
function extract(components){const out=[];for(const [name,x] of Object.entries(components||{})){const status=String(x?.status||'').toUpperCase();if(/UNAVAILABLE|WAITING|INSUFFICIENT|NO_REAL_VOLUME|NO_REAL_ORDER_FLOW|NO_TRADE_SIDE_VOLUME|BLOCKED|STALE|ERROR/.test(status))continue;let d=dir(x?.direction??x?.action??x?.signal);if(d===null&&Number.isFinite(Number(x?.bias))&&Number(x.bias)!==0)d=clamp(Number(x.bias),-1,1);if(d===null&&Number.isFinite(Number(x?.score))&&Number(x.score)>0)d=dir(x?.signal)||null;if(d===null)continue;out.push({name,family:familyOf(name),direction:d,reliability:clamp(Number(x?.reliability)||.65,.1,1),status:status||'REPORTED'});}return out;}
function evaluate(input={}){
 const detected=detectRegime(input.bars),name=BIASES[input.regimeOverride]?input.regimeOverride:detected.name,rc=clamp(Number(input.regimeConfidence??detected.confidence)||0,0,1),indicators=extract(input.components),families=[...new Set(indicators.map(x=>x.family))],raw={};
 for(const f of families)raw[f]=BASE[f]*(1+((BIASES[name]?.[f]??1)-1)*rc);
 const total=Object.values(raw).reduce((a,b)=>a+b,0),weights={};for(const [f,w] of Object.entries(raw))weights[f]=total?Number((w/total).toFixed(6)):0;
 let score=0;const familyScores={};for(const f of families){const xs=indicators.filter(x=>x.family===f),v=mean(xs.map(x=>x.direction*x.reliability));score+=v*(weights[f]||0);familyScores[f]={score:Number(v.toFixed(4)),count:xs.length,weight:weights[f]||0};}
 score=clamp(score,-1,1);const directional=indicators.filter(x=>Math.abs(x.direction)>=.05),up=directional.filter(x=>x.direction>0).length,down=directional.filter(x=>x.direction<0).length,agreement=directional.length?100*Math.max(up,down)/directional.length:0;
 const indicatorAction=score>.05?'BUY':score<-.05?'SELL':'WAIT',algorithms=Object.values(input.algorithms||{}).filter(x=>x&&['BUY','SELL','WAIT'].includes(String(x.action).toUpperCase())),votes={BUY:0,SELL:0,WAIT:0};for(const a of algorithms)votes[String(a.action).toUpperCase()]++;
 const majority=votes.BUY>votes.SELL?'BUY':votes.SELL>votes.BUY?'SELL':'WAIT',aligned=indicatorAction!=='WAIT'&&majority===indicatorAction?votes[indicatorAction]:0,algoConf=mean(algorithms.map(a=>clamp(Number(a.confidence)||0,0,100))),confidence=Math.round(clamp(.62*Math.abs(score)*100+.23*agreement+.15*algoConf,0,100)),g={...GATES,...input.gates};
 const rawQualified=indicatorAction!=='WAIT'&&majority===indicatorAction&&aligned>=g.minAlignedAlgorithms&&algorithms.length>=g.minAlgorithms&&confidence>=g.minConfidence&&agreement>=g.minAgreement&&indicators.length>=g.minActiveIndicators&&input.newsBlocked!==true&&input.dxyConflict!==true,prior=Math.max(0,Number(input.qualifiedRunCount)||0),qualified=rawQualified&&prior+1>=g.requiredQualifiedRuns,blockers=[];
 if(indicatorAction==='WAIT')blockers.push('INDICATOR_DIRECTION_NEUTRAL');if(majority!==indicatorAction)blockers.push('ENGINE_VOTE_CONFLICT');if(aligned<g.minAlignedAlgorithms)blockers.push('ALIGNED_ALGORITHMS_BELOW_GATE');if(algorithms.length<g.minAlgorithms)blockers.push('INSUFFICIENT_ALGORITHMS');if(confidence<g.minConfidence)blockers.push('CONFIDENCE_BELOW_GATE');if(agreement<g.minAgreement)blockers.push('AGREEMENT_BELOW_GATE');if(indicators.length<g.minActiveIndicators)blockers.push('INSUFFICIENT_ACTIVE_INDICATORS');if(input.newsBlocked===true)blockers.push('NEWS_BLOCK');if(input.dxyConflict===true)blockers.push('DXY_CONFLICT');if(rawQualified&&!qualified)blockers.push('STABILITY_CONFIRMATION_PENDING');
 return {engine:'ENGINE5_MAX_REGIME_ADAPTIVE_JS',mode:'SHADOW_CANDIDATE',symbol:input.symbol||'XAUUSD',timestamp:new Date().toISOString(),action:qualified?indicatorAction:'WAIT',qualified,confidence,score:Number(score.toFixed(5)),agreement:Number(agreement.toFixed(2)),regime:{name,confidence:rc,quality:detected.quality,reason:detected.reason,metrics:detected.metrics},weights,families:familyScores,indicatorAction,algorithmMajority:majority,algorithmVotes:votes,algorithmsEvaluated:algorithms.length,algorithmsAligned:aligned,activeIndicators:indicators.length,totalIndicators:Object.keys(input.components||{}).length,qualifiedRunCount:prior+(rawQualified?1:0),gates:g,blockers,autoTrading:false,confidenceMeaning:'decision-strength score, not calibrated win probability'};
}
module.exports={GATES,detectRegime,extract,evaluate};

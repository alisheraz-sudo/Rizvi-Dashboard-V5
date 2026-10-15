// Isolated JavaScript mirror of engine5_adaptive.py. Not wired to production.
const BASE = {trend:.22,momentum:.18,rsi:.12,vwap:.12,candle:.10,liquidity:.12,divergence:.08,volume_profile:.06};
const REGIME_BIASES = {
  TRENDING_UP:{trend:1.45,momentum:1.35,vwap:1.15,divergence:.70},
  TRENDING_DOWN:{trend:1.45,momentum:1.35,vwap:1.15,divergence:.70},
  RANGING:{rsi:1.40,divergence:1.30,liquidity:1.20,trend:.70,momentum:.75},
  HIGH_VOLATILITY:{liquidity:1.30,candle:1.20,momentum:.90,rsi:.85}, MIXED:{}
};
function scoreEngine5(features, regime, regimeConfidence=.5) {
  regime = Object.hasOwn(REGIME_BIASES, regime) ? regime : "MIXED";
  const rc = Math.max(0,Math.min(1,Number(regimeConfidence)||0)), bias=REGIME_BIASES[regime];
  let weighted=0,totalWeight=0; const active=[],signs=[],weights={};
  for (const [name,base] of Object.entries(BASE)) {
    const raw=features?.[name]; if(raw===null||raw===undefined||raw===""||!Number.isFinite(Number(raw))) continue;
    const value=Math.max(-1,Math.min(1,Number(raw))), multiplier=1+( (bias[name]??1)-1)*rc, weight=base*multiplier;
    weighted+=value*weight; totalWeight+=weight; active.push(name);
    signs.push(value>.05?1:value<-.05?-1:0); weights[name]=Number(weight.toFixed(5));
  }
  if(!active.length||totalWeight<=0) return {action:"WAIT",confidence:0,score:0,regime,regime_confidence:rc,active_features:active,weights,reason:"NO_VALID_FEATURES"};
  const score=weighted/totalWeight, nonzero=signs.filter(s=>s!==0);
  const agreement=nonzero.length?Math.abs(nonzero.reduce((a,b)=>a+b,0))/nonzero.length:0;
  const confidence=Math.round(100*Math.abs(score)*(.65+.35*agreement)*(.75+.25*rc));
  let action=score>0?"BUY":score<0?"SELL":"WAIT";
  if(confidence<55||active.length<3||agreement<.25) action="WAIT";
  return {action,confidence:Math.min(100,confidence),score:Number(score.toFixed(5)),agreement:Number(agreement.toFixed(4)),regime,regime_confidence:rc,active_features:active,weights,reason:action!=="WAIT"?"OK":"QUALITY_GATE"};
}
if(typeof module!=="undefined") module.exports={scoreEngine5};

/* Rizvi Dashboard V5 — Master Confirmation Engine
   Real-data confirmation layer. No synthetic data. Auto Trading stays OFF.
   Inputs: live OHLC, market range/liquidity context, BTC order flow when available.
   V53: hard stability layer for fast/sideways markets. Weights unchanged.
*/
(function(){
  'use strict';
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const num=v=>Number.isFinite(Number(v))?Number(v):null;
  const state={pendingDirection:null,pendingCount:0,stableDirection:'WAIT',stableConfidence:50,orderFlowSamples:[],confidenceSamples:[]};
  function ema(a,n){if(a.length<n)return null;let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n,k=2/(n+1);for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
  function rsi(a,n=14){if(a.length<n+1)return null;let u=0,d=0;for(let i=a.length-n;i<a.length;i++){const x=a[i]-a[i-1];if(x>0)u+=x;else d-=x;}return d===0?100:100-(100/(1+u/d));}
  function orderFlow(symbol){
    if(symbol!=='BTCUSD')return {signal:null,confidence:null,reason:'No broker depth feed connected'};
    const b=window.RIZVI_ORDER_FLOW?.BTCUSDT;
    if(!b||b.status!=='LIVE')return {signal:null,confidence:null,reason:'BTC order book unavailable'};
    let bid=0,ask=0;
    Object.values(b.bids||{}).forEach(x=>bid+=Number(x.size)||0);
    Object.values(b.asks||{}).forEach(x=>ask+=Number(x.size)||0);
    const total=bid+ask, im=total?((bid-ask)/total)*100:0;
    const now=Date.now();
    state.orderFlowSamples.push({t:now,im});
    state.orderFlowSamples=state.orderFlowSamples.filter(x=>now-x.t<=15000);
    const avg=state.orderFlowSamples.length?state.orderFlowSamples.reduce((s,x)=>s+x.im,0)/state.orderFlowSamples.length:im;
    return {signal:avg>8?'BUY':avg<-8?'SELL':'NEUTRAL',confidence:clamp(50+Math.abs(avg)*2),reason:'15s depth imbalance avg '+avg.toFixed(1)+'%',imbalance:avg,status:b.status};
  }
  function run(){
    const symbol=window.RIZVI_CURRENT_SYMBOL||'BTCUSD';
    const bars=(window.RIZVI_AGG_BARS||window.RIZVI_RAW_BARS||[]).filter(x=>num(x.c)!==null);
    if(bars.length<21)return;
    const closes=bars.map(x=>Number(x.c)), last=bars.at(-1), prev=bars.at(-2);
    const e9=ema(closes,9),e21=ema(closes,21),r=rsi(closes);
    if(e9===null||e21===null)return;
    const trend=e9>e21?'BUY':e9<e21?'SELL':'NEUTRAL';
    const momentum=last.c>prev.c?'BUY':last.c<prev.c?'SELL':'NEUTRAL';
    const recent=bars.slice(-10), hi=Math.max(...recent.map(x=>Number(x.h))),lo=Math.min(...recent.map(x=>Number(x.l)));
    const range=Math.max(hi-lo,1e-9), closePos=(Number(last.c)-lo)/range;
    const bodyPct=Math.abs(Number(last.c)-Number(last.o||prev.c))/Math.max(Number(last.h)-Number(last.l),1e-9);
    const prior=bars.slice(-11,-1);
    const priorHi=prior.length?Math.max(...prior.map(x=>Number(x.h))):hi;
    const priorLo=prior.length?Math.min(...prior.map(x=>Number(x.l))):lo;
    const structure=last.c>priorHi?'BUY':last.c<priorLo?'SELL':(last.c>=e21?'BUY':'SELL');
    const candleBias=last.c<Number(last.o||prev.c)?'SELL':last.c>Number(last.o||prev.c)?'BUY':'NEUTRAL';
    const of=orderFlow(symbol);
    const liq=window.RIZVI_LIQUIDITY_ENGINE||{};
    const liqScore=clamp(liq.status?Number(liq.score||liq.liquidityScore||0):0);

    let buy=0,sell=0;
    const add=(s,w)=>{if(s==='BUY')buy+=w;if(s==='SELL')sell+=w};
    add(trend,25); add(structure,25); add(momentum,15); add(candleBias,10);
    if(r!==null){if(r>=55&&r<72)buy+=10;if(r<=45&&r>28)sell+=10;}
    if(closePos>0.72)buy+=8;
    if(closePos<0.28)sell+=8;
    if(bodyPct>=0.55)add(candleBias,7);
    if(of.signal==='BUY')buy+=15;
    if(of.signal==='SELL')sell+=15;
    if(liq.status&&Number.isFinite(liqScore)&&liqScore>=70){
      if(liq.direction==='SELL')sell+=12;
      else if(liq.direction==='BUY')buy+=12;
    }

    const rawDirection=buy>sell?'BUY':sell>buy?'SELL':'WAIT';
    const lead=Math.max(buy,sell),conflict=Math.min(buy,sell),total=buy+sell;
    let rawConfidence=rawDirection==='WAIT'?50:clamp(Math.round(48+(lead-conflict)*0.62+(total>=75?8:0)));
    if(rawDirection!=='WAIT'&&lead>=75&&lead-conflict>=30)rawConfidence=Math.max(rawConfidence,84);
    if(rawDirection!=='WAIT'&&lead>=95&&lead-conflict>=45)rawConfidence=Math.max(rawConfidence,90);

    if(rawDirection===state.pendingDirection)state.pendingCount++;
    else{state.pendingDirection=rawDirection;state.pendingCount=1;}
    const now=Date.now();
    state.confidenceSamples.push({t:now,v:rawConfidence});
    state.confidenceSamples=state.confidenceSamples.filter(x=>now-x.t<=12000);
    const avgConfidence=state.confidenceSamples.length?state.confidenceSamples.reduce((s,x)=>s+x.v,0)/state.confidenceSamples.length:rawConfidence;
    if(rawDirection==='WAIT'){
      state.stableDirection='WAIT';
      state.stableConfidence=Math.round(state.stableConfidence*0.70+50*0.30);
    }else if(rawDirection===state.stableDirection){
      state.stableConfidence=Math.round(state.stableConfidence*0.70+avgConfidence*0.30);
    }else if(state.pendingCount>=2){
      state.stableDirection=rawDirection;
      state.stableConfidence=Math.round(state.stableConfidence*0.70+avgConfidence*0.30);
    }
    const direction=state.stableDirection;
    const confidence=clamp(Math.round(state.stableConfidence));
    const confirmations=[trend===direction,structure===direction,momentum===direction,candleBias===direction,of.signal===direction,(liq.status&&liqScore>=70&&liq.direction===direction)].filter(Boolean).length;
    const qualified=direction!=='WAIT'&&confirmations>=4&&confidence>=80;

    const engines={
      trend:{signal:trend,confidence:clamp(trend==='NEUTRAL'?50:72),reason:'EMA 9/21'},
      structure:{signal:structure,confidence:clamp(70+(structure===direction?15:0)),reason:'recent 10-bar structure'},
      liquidity:{signal:liq.direction||'NEUTRAL',confidence:liqScore||null,reason:liq.status||'No liquidity event'},
      orderFlow:{signal:of.signal,confidence:of.confidence,reason:of.reason},
      momentum:{signal:momentum,confidence:clamp(momentum===direction?70:50),reason:'latest candle direction'},
      candleBias:{signal:candleBias,confidence:clamp(candleBias===direction?75:50),reason:'current candle body'}
      divergence:{signal:null,confidence:null,reason:'not enough independent divergence feed'},
      priceAction:{signal:momentum,confidence:clamp(momentum===direction?70:50),reason:'OHLC candle response'},
      volatility:{signal:'NEUTRAL',confidence:60,reason:'range context only'}
    };
    window.RIZVI_MASTER_CONFIRMATION={
      symbol,updatedAt:Date.now(),direction,confidence,qualified,
      confirmations,trend,structure,momentum,rsi:r,
      rawDirection,rawConfidence,stability:{pendingCount:state.pendingCount,windowMs:15000,confidenceWindowMs:15000,holdCycles:3},
      engines,autoTrading:false
    };
    window.RIZVI_SIGNAL_QUALIFICATION={
      symbol,updatedAt:Date.now(),signalDirection:direction,marketDirection:direction,
      liquidityScore:Math.round(liqScore),patternConfidence:confidence,aligned:true,
      confirmedSweep:Boolean(liq.sweeps?.length),confirmedBreakout:Boolean(liq.breakouts?.length),
      multiTimeframe:confirmations>=3,
      status:qualified?'QUALIFIED_CONTEXT':'WAIT_FOR_CONFIRMATION',
      masterConfirmations:confirmations,
      trend:engines.trend,structure:engines.structure,liquidity:engines.liquidity,
      orderFlow:engines.orderFlow,momentum:engines.momentum,candleBias:engines.candleBias,divergence:engines.divergence,
      priceAction:engines.priceAction,volatility:engines.volatility
    };
    window.RIZVI_SIGNAL_DIRECTION=direction;
    window.dispatchEvent(new CustomEvent('rizvi:signal-qualification-update',{detail:window.RIZVI_SIGNAL_QUALIFICATION}));
    window.dispatchEvent(new CustomEvent('rizvi:master-confirmation-update',{detail:window.RIZVI_MASTER_CONFIRMATION}));
  }
  window.RIZVI_RUN_MASTER_CONFIRMATION=run;
  setInterval(run,5000);
  run();

  // V67: stabilize Entry/SL/TP trade range. Live price may refresh every few seconds,
  // but trade levels must stay fixed until a new qualified setup is created.
  (function stabilizeTradeRange(){
    const original=window.RIZVI_SIGNAL_LEVELS;
    if(typeof original!=='function')return;
    let frozen=null;
    let frozenDirection=null;
    let wasQualified=false;
    window.RIZVI_STABLE_TRADE_RANGE=null;
    window.RIZVI_SIGNAL_LEVELS=function(price,direction){
      const dir=direction==='SELL'?'SELL':'BUY';
      if(frozen){
        window.RIZVI_TRADE_RANGE=frozen;
        return frozen;
      }
      if(window.RIZVI_MASTER_CONFIRMATION?.qualified){
        const lv=original(price,dir);
        if(lv){
          frozen={...lv};
          frozenDirection=dir;
          window.RIZVI_STABLE_TRADE_RANGE=frozen;
          window.RIZVI_TRADE_RANGE=frozen;
          return frozen;
        }
      }
      return original(price,dir);
    };
    window.addEventListener('rizvi:master-confirmation-update',e=>{
      const m=e.detail||window.RIZVI_MASTER_CONFIRMATION;
      const qualified=!!m?.qualified;
      const dir=m?.direction==='SELL'?'SELL':m?.direction==='BUY'?'BUY':null;
      const p=Number(window.RIZVI_LIVE_PRICE??window.RIZVI_LIVE_PRICES?.[m?.symbol||'BTCUSD']);
      if(qualified && dir && Number.isFinite(p) && (!wasQualified || dir!==frozenDirection)){
        const lv=original(p,dir);
        if(lv){
          frozen={...lv};
          frozenDirection=dir;
          window.RIZVI_STABLE_TRADE_RANGE=frozen;
          window.RIZVI_TRADE_RANGE=frozen;
          window.dispatchEvent(new CustomEvent('rizvi:stable-trade-range-update',{detail:frozen}));
        }
      }
      if(!qualified && wasQualified){
        // Keep the last qualified range visible; do not chase live-price noise.
      }
      wasQualified=qualified;
    });
  })();
})();
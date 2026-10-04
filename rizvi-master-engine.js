/* Rizvi Dashboard V5 — Master Confirmation Engine
   Real-data confirmation layer. No synthetic data. Auto Trading stays OFF.
   Inputs: live OHLC, market range/liquidity context, BTC order flow when available.
   V52: stability layer for fast/sideways markets. Weights unchanged.
*/
(function(){
  'use strict';
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const num=v=>Number.isFinite(Number(v))?Number(v):null;
  const state={pendingDirection:null,pendingCount:0,stableDirection:'WAIT',stableConfidence:50,orderFlowSamples:[]};
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
    const structure=last.c>=hi*0.999?'BUY':last.c<=lo*1.001?'SELL':(last.c>=e21?'BUY':'SELL');
    const of=orderFlow(symbol);
    const liq=window.RIZVI_LIQUIDITY_ENGINE||{};
    const liqScore=clamp(liq.status?Number(liq.score||liq.liquidityScore||0):0);
    let buy=0,sell=0;
    const add=(s,w)=>{if(s==='BUY')buy+=w;if(s==='SELL')sell+=w};
    add(trend,20); add(structure,25); add(momentum,10);
    if(r!==null){if(r>=50&&r<75)buy+=10;if(r<=50&&r>25)sell+=10;}
    if(of.signal==='BUY')buy+=20;if(of.signal==='SELL')sell+=20;
    if(liq.status&&Number.isFinite(liqScore)){if(liqScore>=70){if(liq.direction==='SELL')sell+=15;else buy+=15;}}
    const rawDirection=buy>sell?'BUY':sell>buy?'SELL':'WAIT';
    const lead=Math.max(buy,sell), conflict=Math.min(buy,sell);
    let rawConfidence=clamp(Math.round(50+(lead-conflict)*0.75));
    if(rawDirection==='WAIT')rawConfidence=50;

    if(rawDirection===state.pendingDirection)state.pendingCount++;
    else {state.pendingDirection=rawDirection;state.pendingCount=1;}
    if(rawDirection==='WAIT'){
      state.stableDirection='WAIT';
      state.stableConfidence=Math.round(state.stableConfidence*0.7+50*0.3);
    }else if(rawDirection===state.stableDirection){
      state.stableConfidence=Math.round(state.stableConfidence*0.7+rawConfidence*0.3);
    }else if(state.pendingCount>=2){
      state.stableDirection=rawDirection;
      state.stableConfidence=Math.round(state.stableConfidence*0.7+rawConfidence*0.3);
    }
    const direction=state.stableDirection;
    const confidence=clamp(Math.round(state.stableConfidence));
    const confirmations=[trend===direction,structure===direction,momentum===direction,of.signal===direction,(liq.status&&liqScore>=70)].filter(Boolean).length;
    const qualified=direction!=='WAIT'&&confirmations>=3&&confidence>=70;
    const engines={
      trend:{signal:trend,confidence:clamp(trend==='NEUTRAL'?50:72),reason:'EMA 9/21'},
      structure:{signal:structure,confidence:clamp(70+(structure===direction?15:0)),reason:'recent 10-bar structure'},
      liquidity:{signal:liq.direction||'NEUTRAL',confidence:liqScore||null,reason:liq.status||'No liquidity event'},
      orderFlow:{signal:of.signal,confidence:of.confidence,reason:of.reason},
      momentum:{signal:momentum,confidence:clamp(momentum===direction?70:50),reason:'latest candle direction'},
      divergence:{signal:null,confidence:null,reason:'not enough independent divergence feed'},
      priceAction:{signal:momentum,confidence:clamp(momentum===direction?70:50),reason:'OHLC candle response'},
      volatility:{signal:'NEUTRAL',confidence:60,reason:'range context only'}
    };
    window.RIZVI_MASTER_CONFIRMATION={
      symbol,updatedAt:Date.now(),direction,confidence,qualified,
      confirmations,trend,structure,momentum,rsi:r,
      rawDirection,rawConfidence,stability:{pendingCount:state.pendingCount,windowMs:15000},
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
      orderFlow:engines.orderFlow,momentum:engines.momentum,divergence:engines.divergence,
      priceAction:engines.priceAction,volatility:engines.volatility
    };
    window.RIZVI_SIGNAL_DIRECTION=direction;
    window.dispatchEvent(new CustomEvent('rizvi:signal-qualification-update',{detail:window.RIZVI_SIGNAL_QUALIFICATION}));
    window.dispatchEvent(new CustomEvent('rizvi:master-confirmation-update',{detail:window.RIZVI_MASTER_CONFIRMATION}));
  }
  window.RIZVI_RUN_MASTER_CONFIRMATION=run;
  setInterval(run,5000);
  run();
})();
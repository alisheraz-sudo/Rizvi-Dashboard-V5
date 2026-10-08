/* Rizvi Dashboard V5 — Master Confirmation Engine
   Real-data confirmation layer. No synthetic data. Auto Trading stays OFF.
   Inputs: live OHLC, market range/liquidity context, BTC order flow when available.
   V53: hard stability layer for fast/sideways markets. Weights unchanged.
*/
(function(){
  'use strict';
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const num=v=>Number.isFinite(Number(v))?Number(v):null;
  const state={pendingDirection:null,pendingCount:0,stableDirection:'WAIT',stableConfidence:50,lastDirectionChange:0,waitCount:0,orderFlowSamples:[],confidenceSamples:[],scoreSamples:[],scoreAverage:50};
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

    // V103 indicator bridge: calculate independent evidence from the same live OHLC feed.
    const vols=bars.map(x=>Number(x.v??x.volume)).filter(Number.isFinite);
    const hasVolume=bars.some(x=>Number.isFinite(Number(x.v??x.volume))&&Number(x.v??x.volume)>0);
    const typical=bars.map(x=>(Number(x.h)+Number(x.l)+Number(x.c))/3);
    let vwap=null;
    if(hasVolume){
      let pv=0,vv=0; for(const x of bars.slice(-240)){const v=Number(x.v??x.volume); if(Number.isFinite(v)&&v>0){pv+=((Number(x.h)+Number(x.l)+Number(x.c))/3)*v;vv+=v;}}
      if(vv>0)vwap=pv/vv;
    }
    let volumeProfile=null;
    if(hasVolume){
      const bins=new Map(), sample=bars.slice(-240); let minP=Infinity,maxP=-Infinity;
      sample.forEach(x=>{minP=Math.min(minP,Number(x.l));maxP=Math.max(maxP,Number(x.h));});
      const step=Math.max((maxP-minP)/24,1e-9);
      sample.forEach(x=>{const v=Number(x.v??x.volume);if(!Number.isFinite(v)||v<=0)return;const k=Math.floor(((Number(x.h)+Number(x.l)+Number(x.c))/3-minP)/step);bins.set(k,(bins.get(k)||0)+v);});
      let pk=null,pv=0;for(const [k,v] of bins)if(v>pv){pv=v;pk=k;} if(pk!==null)volumeProfile={poc:minP+(pk+.5)*step,totalVolume:[...bins.values()].reduce((a,b)=>a+b,0)};
    }
    const vwapSignal=vwap===null?'WAIT':last.c>vwap?'BUY':last.c<vwap?'SELL':'NEUTRAL';
    const vpSignal=volumeProfile===null?'WAIT':last.c>=volumeProfile.poc?'BUY':'SELL';
    const delta=of.status==='LIVE'?of.imbalance:null;
    const deltaSignal=delta===null?'WAIT':delta>8?'BUY':delta<-8?'SELL':'NEUTRAL';
    const prev8=bars.slice(-16,-8),last8=bars.slice(-8);
    const prevHigh=prev8.length?Math.max(...prev8.map(x=>Number(x.h))):null,lastHigh=last8.length?Math.max(...last8.map(x=>Number(x.h))):null;
    const prevLow=prev8.length?Math.min(...prev8.map(x=>Number(x.l))):null,lastLow=last8.length?Math.min(...last8.map(x=>Number(x.l))):null;
    const prevCloses=prev8.map(x=>Number(x.c)),lastCloses=last8.map(x=>Number(x.c));
    const prevRsi=prevCloses.length>=2?rsi(prevCloses):null,lastRsi=r;
    const bearishDiv=prevHigh!==null&&lastHigh!==null&&lastHigh>prevHigh&&prevRsi!==null&&lastRsi!==null&&lastRsi<prevRsi;
    const bullishDiv=prevLow!==null&&lastLow!==null&&lastLow<prevLow&&prevRsi!==null&&lastRsi!==null&&lastRsi>prevRsi;
    const divergence=bullishDiv?'BUY':bearishDiv?'SELL':'NEUTRAL';
    const prev=bars.at(-2), prevPrev=bars.at(-3);
    const bullishEngulf=prev&&prevPrev&&prev.c>prev.o&&prevPrev.c<prevPrev.o&&prev.c>=prevPrev.o&&prev.o<=prevPrev.c;
    const bearishEngulf=prev&&prevPrev&&prev.c<prev.o&&prevPrev.c>prevPrev.o&&prev.c<=prevPrev.o&&prev.o>=prevPrev.c;
    const candlePattern=bullishEngulf?'BUY':bearishEngulf?'SELL':candleBias;
    const rangeLevels=window.RIZVI_MARKET_RANGE||{};
    const rangeSignals={};
    ['dayHigh','h4High','h1High','m30High','m15High'].forEach(k=>{if(Number.isFinite(Number(rangeLevels[k])))rangeSignals[k]=last.c>Number(rangeLevels[k])?'BUY':'NEUTRAL';});
    ['dayLow','h4Low','h1Low','m30Low','m15Low'].forEach(k=>{if(Number.isFinite(Number(rangeLevels[k])))rangeSignals[k]=last.c<Number(rangeLevels[k])?'SELL':'NEUTRAL';});

    // V106 FVG engine: detect the latest 3-candle Fair Value Gap from live OHLC.\n    // Bullish FVG: current low > candle two bars back high.\n    // Bearish FVG: current high < candle two bars back low.\n    const fvgLookback=Math.min(80,bars.length);\n    let fvg={signal:'NEUTRAL',confidence:50,type:null,top:null,bottom:null,filled:false,reason:'No active FVG'};\n    for(let i=bars.length-1;i>=Math.max(2,bars.length-fvgLookback);i--){\n      const a=bars[i-2], mid=bars[i-1], b=bars[i];\n      const ah=Number(a.h), al=Number(a.l), bh=Number(b.h), bl=Number(b.l);\n      if([ah,al,bh,bl].every(Number.isFinite)){\n        if(bl>ah){\n          const top=bl,bottom=ah;\n          const filled=Number(last.l)<=bottom;\n          if(!filled){fvg={signal:'BUY',confidence:76,type:'BULLISH',top,bottom,filled:false,reason:'Bullish 3-candle imbalance'};break;}\n        }\n        if(bh<al){\n          const top=al,bottom=bh;\n          const filled=Number(last.h)>=top;\n          if(!filled){fvg={signal:'SELL',confidence:76,type:'BEARISH',top,bottom,filled:false,reason:'Bearish 3-candle imbalance'};break;}\n        }\n      }\n    }\n    const fvgSignal=fvg.signal;\n\n    // Prop-style weighted confirmation: avoid double-counting correlated evidence.
    // Total active weight = 100. Price Action/Volatility remain context engines, not extra votes.
    const WEIGHTS={
      trend:15, structure:13, liquidity:11, orderFlow:11, momentum:8,
      rsi:7, divergence:7, vwap:7, volumeProfile:5, delta:4,
      candlePattern:4, candleBias:3, fvg:5
    };
    const votes={
      trend,structure,liquidity:(liq.status&&liqScore>=70)?(liq.direction||'NEUTRAL'):'WAIT',
      orderFlow:of.signal,momentum,rsi:(r===null?'WAIT':r>=55&&r<72?'BUY':r<=45&&r>28?'SELL':'NEUTRAL'),
      divergence,vwap:vwapSignal,volumeProfile:vpSignal,delta:deltaSignal,
      candlePattern,candleBias
    };
    let buy=0,sell=0,activeWeight=0;
    const contribution={};
    const add=(key,s,w,active=true)=>{
      if(!active||s==='WAIT'||s===null)return;
      activeWeight+=w;
      if(s==='BUY')buy+=w;
      if(s==='SELL')sell+=w;
      contribution[key]={signal:s,weight:w,points:s==='BUY'||s==='SELL'?w:0,active:true};
    };
    add('trend',trend,WEIGHTS.trend);
    add('structure',structure,WEIGHTS.structure);
    add('liquidity',votes.liquidity,WEIGHTS.liquidity,liq.status&&liqScore>=70);
    add('orderFlow',of.signal,WEIGHTS.orderFlow,of.status==='LIVE');
    add('momentum',momentum,WEIGHTS.momentum);
    add('rsi',votes.rsi,WEIGHTS.rsi,r!==null);
    add('divergence',divergence,WEIGHTS.divergence,true);
    add('vwap',vwapSignal,WEIGHTS.vwap,vwap!==null);
    add('volumeProfile',vpSignal,WEIGHTS.volumeProfile,volumeProfile!==null);
    add('delta',deltaSignal,WEIGHTS.delta,delta!==null);
    add('candlePattern',candlePattern,WEIGHTS.candlePattern,true);
    add('candleBias',candleBias,WEIGHTS.candleBias,true);

    const rawDirection=buy>sell?'BUY':sell>buy?'SELL':'WAIT';
    const lead=Math.max(buy,sell),conflict=Math.min(buy,sell),total=buy+sell;
    const weightedScore=activeWeight?clamp((lead/activeWeight)*100):0;
    const directionalMargin=activeWeight?clamp(((lead-conflict)/activeWeight)*100):0;
    // V129: rolling score average over the latest 30 engine runs smooths noisy candle-to-candle swings.
    state.scoreSamples.push(weightedScore);
    if(state.scoreSamples.length>30)state.scoreSamples.shift();
    state.scoreAverage=state.scoreSamples.length?state.scoreSamples.reduce((a,b)=>a+b,0)/state.scoreSamples.length:weightedScore;
    const settledScore=state.scoreAverage;
    // 95 = strict confluence/compatibility quality, NOT 95% probability of profit.
    const rawConfidence=rawDirection==='WAIT'?50:
      clamp(Math.round(45+settledScore*0.38+directionalMargin*0.32+(total>=activeWeight*0.75?8:0)));
    const activeIndicators=Object.keys(contribution).length;
    const alignedIndicators=Object.values(contribution).filter(x=>x.signal===rawDirection).length;
    const compatibility95=rawDirection!=='WAIT'&&weightedScore>=95&&directionalMargin>=70&&activeIndicators>=8&&alignedIndicators>=7;
    const algoRunReport={
      timestamp:Date.now(),symbol,
      threshold:95,score:Math.round(weightedScore),scoreAverage:Math.round(settledScore),confidence:Math.round(rawConfidence),
      direction:rawDirection,activeWeight,activeIndicators,alignedIndicators,
      directionalMargin:Math.round(directionalMargin),compatibility95,
      weights:WEIGHTS,contributions:contribution,
      note:'95 is confluence compatibility, not win probability.'
    };

    // V105: signal hysteresis. Indicators may recalculate every tick, but the
    // visible/master direction only changes after persistence; WAIT is also held
    // so transient indicator disagreement cannot create BUY/SELL/WAIT flicker.
    const now=Date.now();
    const FLIP_CONFIRM=6;
    const WAIT_CONFIRM=6;
    const HOLD_MS=30000;
    const SCORE_ALPHA=0.08;
    if(rawDirection===state.pendingDirection)state.pendingCount++;
    else{state.pendingDirection=rawDirection;state.pendingCount=1;}

    if(rawDirection===state.stableDirection){
      state.waitCount=0;
      state.stableConfidence=state.stableConfidence*(1-SCORE_ALPHA)+rawConfidence*SCORE_ALPHA;
    }else if(rawDirection==='WAIT'){
      state.waitCount++;
      if(state.stableDirection==='WAIT'){
        state.stableConfidence=state.stableConfidence*(1-SCORE_ALPHA)+50*SCORE_ALPHA;
      }else if(state.waitCount>=WAIT_CONFIRM && now-state.lastDirectionChange>=HOLD_MS){
        state.stableDirection='WAIT';
        state.lastDirectionChange=now;
        state.stableConfidence=50;
      }
    }else{
      state.waitCount=0;
      if(state.pendingCount>=FLIP_CONFIRM && now-state.lastDirectionChange>=HOLD_MS){
        state.stableDirection=rawDirection;
        state.lastDirectionChange=now;
        state.stableConfidence=rawConfidence;
      }else{
        state.stableConfidence=state.stableConfidence*(1-SCORE_ALPHA)+rawConfidence*SCORE_ALPHA;
      }
    }

    const direction=state.stableDirection;
    const confidence=Math.round(clamp(Math.round(state.stableConfidence/2)*2));
    const confirmations=Object.values(contribution).filter(x=>x.signal===direction).length;
    const qualified=direction!=='WAIT'&&confirmations>=7&&confidence>=95&&compatibility95;
    // V129: directional BUY/SELL visibility is independent of the stricter High Quality Setup gate.
    const visibleSignal=direction!=='WAIT'?direction:'WAIT';

    const engines={
      trend:{signal:trend,confidence:clamp(trend==='NEUTRAL'?50:72),reason:'EMA 9/21'},
      structure:{signal:structure,confidence:clamp(70+(structure===direction?15:0)),reason:'recent 10-bar structure'},
      liquidity:{signal:liq.direction||'NEUTRAL',confidence:liqScore||null,reason:liq.status||'No liquidity event'},
      orderFlow:{signal:of.signal,confidence:of.confidence,reason:of.reason},
      momentum:{signal:momentum,confidence:clamp(momentum===direction?70:50),reason:'latest candle direction'},
      candleBias:{signal:candleBias,confidence:clamp(candleBias===direction?75:50),reason:'current candle body'},
      divergence:{signal:divergence,confidence:divergence==='NEUTRAL'?50:72,reason:'price/RSI divergence'},
      priceAction:{signal:momentum,confidence:clamp(momentum===direction?70:50),reason:'OHLC candle response'},
      volatility:{signal:'NEUTRAL',confidence:60,reason:'range context'},
      vwap:{signal:vwapSignal,confidence:vwap===null?null:70,reason:vwap===null?'volume data unavailable':'price vs session VWAP',value:vwap},
      volumeProfile:{signal:vpSignal,confidence:volumeProfile===null?null:68,reason:volumeProfile===null?'volume data unavailable':'POC context',poc:volumeProfile?.poc??null},
      delta:{signal:deltaSignal,confidence:delta===null?null:of.confidence,reason:delta===null?'L2 unavailable':'L2 bid/ask imbalance',imbalance:delta},
      candlePattern:{signal:candlePattern,confidence:bullishEngulf||bearishEngulf?78:60,reason:bullishEngulf||bearishEngulf?'engulfing pattern':'candle body'},\n      fvg:{signal:fvg.signal,confidence:fvg.confidence,reason:fvg.reason,type:fvg.type,top:fvg.top,bottom:fvg.bottom,filled:fvg.filled},
      rangeLevels:{signal:liq.direction||'NEUTRAL',confidence:liqScore||null,reason:'Day/4H/1H/30M/15M high-low context',levels:rangeLevels}
    };
    window.RIZVI_MASTER_CONFIRMATION={
      symbol,updatedAt:Date.now(),direction,confidence,qualified,
      confirmations,trend,structure,momentum,rsi:r,
      rawDirection,rawConfidence,stability:{pendingCount:state.pendingCount,waitCount:state.waitCount,windowMs:15000,confidenceWindowMs:15000,holdMs:HOLD_MS,flipConfirm:FLIP_CONFIRM,waitConfirm:WAIT_CONFIRM,holdCycles:3},
      engines,autoTrading:false,
      settings:{emaFast:9,emaSlow:21,rsi:14,orderFlowWindowMs:15000,minConfirmations:7,minConfidence:95,compatibilityThreshold:95,scoreAverageWindow:30,weightsTotal:100,weights:WEIGHTS},
      contributions:{trend:trend,structure:structure,momentum:momentum,fvg:fvgSignal,rsi:r!==null?(r>=55&&r<72?'BUY':r<=45&&r>28?'SELL':'NEUTRAL'):'WAIT',vwap:vwapSignal,volumeProfile:vpSignal,delta:deltaSignal,divergence,candlePattern,orderFlow:of.signal,liquidity:liq.direction||'NEUTRAL',rangeLevels:liq.direction||'NEUTRAL'},
      indicatorStatus:{ema:true,fvg:true,rsi:r!==null,vwap:vwap!==null,volumeProfile:volumeProfile!==null,delta:delta!==null,divergence:true,candlePattern:true,orderFlow:of.status==='LIVE',liquidity:!!liq.status,rangeLevels:Object.keys(rangeLevels).length>=4,fvg:true},
      algoRunReport
    };
    window.RIZVI_SIGNAL_QUALIFICATION={
      symbol,updatedAt:Date.now(),signalDirection:visibleSignal,marketDirection:visibleSignal,
      liquidityScore:Math.round(liqScore),patternConfidence:confidence,aligned:true,
      confirmedSweep:Boolean(liq.sweeps?.length),confirmedBreakout:Boolean(liq.breakouts?.length),
      multiTimeframe:confirmations>=3,
      status:qualified?'QUALIFIED_CONTEXT':'WAIT_FOR_CONFIRMATION',
      masterConfirmations:confirmations,
      trend:engines.trend,structure:engines.structure,liquidity:engines.liquidity,
      orderFlow:engines.orderFlow,momentum:engines.momentum,candleBias:engines.candleBias,divergence:engines.divergence,
      priceAction:engines.priceAction,volatility:engines.volatility
    };
    window.RIZVI_SIGNAL_DIRECTION=visibleSignal;
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
/* Rizvi Dashboard V5 — Master Confirmation Engine
   Real-data confirmation layer. No synthetic data. Auto Trading stays OFF.
   Inputs: live OHLC, market range/liquidity context, BTC order flow when available.
   V53: hard stability layer for fast/sideways markets. Weights unchanged.
*/
(function(){
  'use strict';
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const num=v=>Number.isFinite(Number(v))?Number(v):null;
  const OUTCOME_STORAGE_KEY='rizvi.v5.engine5.outcomes.v1';
  function loadOutcomes(){
    try{
      const raw=window.localStorage?.getItem(OUTCOME_STORAGE_KEY);
      if(!raw)return {};
      const parsed=JSON.parse(raw);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
      const clean={};
      Object.keys(DEFAULT_ENGINE5_SETTINGS.baseWeights).forEach(k=>{
        const p=parsed[k];
        if(p&&Number.isFinite(Number(p.n))&&Number(p.n)>=0&&Number.isFinite(Number(p.correct))&&Number(p.correct)>=0){
          clean[k]={n:Math.floor(Number(p.n)),correct:Math.min(Math.floor(Number(p.n)),Math.floor(Number(p.correct)))};
        }
      });
      return clean;
    }catch(_){return {};}
  }
  const state={pendingDirection:null,pendingCount:0,stableDirection:'WAIT',stableConfidence:50,lastDirectionChange:0,waitCount:0,orderFlowSamples:[],confidenceSamples:[],scoreSamples:[],scoreAverage:50,outcomes:{}};
  function saveOutcomes(){
    try{window.localStorage?.setItem(OUTCOME_STORAGE_KEY,JSON.stringify(state.outcomes));return true;}
    catch(_){return false;}
  }
  const DEFAULT_ENGINE5_SETTINGS={
    baseWeights:{trend:17,structure:15,liquidity:13,momentum:10,rsi:8,divergence:7,vwap:7,volumeProfile:5,delta:4,candlePattern:4,candleBias:5,fvg:5},
    minOutcomeSamples:5,
    minConfirmations:7,
    minConfidence:80,
    weakSignalFloor:70,
    strongSignalFloor:80,
    compatibilityThreshold:95,
    compatibilityMargin:70,
    compatibilityMinIndicators:8,
    compatibilityMinAligned:7,
    qualifiedMinScore:80,
    qualifiedMinMargin:50,
    qualifiedMinActiveIndicators:8,
    qualifiedMinAlignedIndicators:6,
    scoreAverageWindow:30,
    flipConfirm:6,
    waitConfirm:6,
    holdMs:30000,
    scoreAlpha:0.08,
    orderFlowFreshnessMs:15000,
    orderFlowImbalanceThreshold:8
  };
  const suppliedSettings=window.RIZVI_ENGINE5_CONFIG&&typeof window.RIZVI_ENGINE5_CONFIG==='object'?window.RIZVI_ENGINE5_CONFIG:{};
  const suppliedWeights=suppliedSettings.baseWeights&&typeof suppliedSettings.baseWeights==='object'?suppliedSettings.baseWeights:{};
  const BASE_WEIGHTS={...DEFAULT_ENGINE5_SETTINGS.baseWeights,...suppliedWeights};
  const sumBaseWeights=Object.values(BASE_WEIGHTS).reduce((a,b)=>a+(Number(b)||0),0);
  if(Object.values(BASE_WEIGHTS).some(v=>!Number.isFinite(Number(v))||Number(v)<0)||sumBaseWeights<=0){
    Object.assign(BASE_WEIGHTS,DEFAULT_ENGINE5_SETTINGS.baseWeights);
  }
  const ENGINE5_SETTINGS={...DEFAULT_ENGINE5_SETTINGS,...suppliedSettings,baseWeights:BASE_WEIGHTS};
  state.outcomes=loadOutcomes();
  function recordOutcome(e){
    const d=e&&e.detail||e;
    if(!d||!['WIN','LOSS'].includes(String(d.outcome||'').toUpperCase())||!['BUY','SELL'].includes(String(d.direction||'').toUpperCase())||!d.indicatorSignals)return;
    const dir=String(d.direction).toUpperCase(),win=String(d.outcome).toUpperCase()==='WIN';
    Object.keys(BASE_WEIGHTS).forEach(k=>{
      const s=String(d.indicatorSignals[k]||'').toUpperCase();
      if(!['BUY','SELL'].includes(s))return;
      const p=state.outcomes[k]||(state.outcomes[k]={n:0,correct:0});
      p.n++;if((win&&s===dir)||(!win&&s!==dir))p.correct++;
    });
    saveOutcomes();
  }
  window.addEventListener('rizvi:trade-outcome',recordOutcome);
  window.RIZVI_RECORD_TRADE_OUTCOME=recordOutcome;
  window.RIZVI_ENGINE5_OUTCOME_STORAGE={key:OUTCOME_STORAGE_KEY,save:saveOutcomes,load:loadOutcomes};
  function getWeights(){
    const raw={};
    Object.keys(BASE_WEIGHTS).forEach(k=>{
      const p=state.outcomes[k];
      const factor=p&&p.n>=ENGINE5_SETTINGS.minOutcomeSamples?Math.max(0.5,Math.min(1.5,0.5+(p.correct+1)/(p.n+2))):1;
      raw[k]=BASE_WEIGHTS[k]*factor;
    });
    const sum=Object.values(raw).reduce((a,b)=>a+b,0),out={};let assigned=0;const keys=Object.keys(raw);
    keys.forEach((k,i)=>{out[k]=i===keys.length-1?100-assigned:Math.round(raw[k]/sum*100);assigned+=out[k];});
    return out;
  }
  function ema(a,n){if(a.length<n)return null;let e=a.slice(0,n).reduce((x,y)=>x+y,0)/n,k=2/(n+1);for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k);return e;}
  function rsi(a,n=14){if(a.length<n+1)return null;let u=0,d=0;for(let i=a.length-n;i<a.length;i++){const x=a[i]-a[i-1];if(x>0)u+=x;else d-=x;}if(u===0&&d===0)return 50;return d===0?100:100-(100/(1+u/d));}
  function orderFlow(symbol){
    // Consume the actual cTrader Level-2 payload; never synthesize depth from OHLC.
    const wanted=String(symbol||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const b=window.RIZVI_CTRADER_ORDER_FLOW;
    const got=String(b?.symbol||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!b||b.connected!==true||b.source!=='CTRADER_LEVEL2'||!Array.isArray(b.levels))
      return {signal:null,confidence:null,reason:'cTrader Level-2 depth feed unavailable'};
    if(!((wanted==='XAUUSD'&&got==='XAUUSD')||(wanted==='BTCUSD'&&(got==='BTCUSD'||got==='BTCUSDT'))))
      return {signal:null,confidence:null,reason:'cTrader depth symbol mismatch'};
    const age=Date.now()-Number(b.updatedAt||0);
    if(!Number.isFinite(age)||age<0||age>ENGINE5_SETTINGS.orderFlowFreshnessMs)
      return {signal:null,confidence:null,reason:'cTrader depth is stale'};
    let bid=0,ask=0;
    for(const level of b.levels){
      bid+=Math.max(0,Number(level.bid)||0);
      ask+=Math.max(0,Number(level.ask)||0);
      if(!(Number(level.bid)>0)&&!(Number(level.ask)>0)&&Number(level.size)>0){
        // A size without a bid/ask side cannot establish buyer/seller imbalance.
        continue;
      }
    }
    const total=bid+ask;
    if(!total)return {signal:null,confidence:null,reason:'cTrader depth has no usable bid/ask sizes'};
    const im=((bid-ask)/total)*100,now=Date.now();
    state.orderFlowSamples.push({t:now,im});
    state.orderFlowSamples=state.orderFlowSamples.filter(x=>now-x.t<=15000);
    const avg=state.orderFlowSamples.length?state.orderFlowSamples.reduce((sum,x)=>sum+x.im,0)/state.orderFlowSamples.length:im;
    return {signal:avg>ENGINE5_SETTINGS.orderFlowImbalanceThreshold?'BUY':avg<-ENGINE5_SETTINGS.orderFlowImbalanceThreshold?'SELL':'NEUTRAL',confidence:clamp(50+Math.abs(avg)*2),reason:'15s cTrader depth imbalance avg '+avg.toFixed(1)+'%',imbalance:avg,status:'LIVE',source:'CTRADER_LEVEL2',symbol:got};
  }
  window.RIZVI_ENGINE5_SETTINGS=ENGINE5_SETTINGS;
  window.RIZVI_SET_ENGINE5_SETTINGS=function(patch){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))return {ok:false,reason:'Settings patch must be an object'};
    const allowed=['minOutcomeSamples','minConfirmations','minConfidence','weakSignalFloor','strongSignalFloor','compatibilityThreshold','compatibilityMargin','compatibilityMinIndicators','compatibilityMinAligned','qualifiedMinScore','qualifiedMinMargin','qualifiedMinActiveIndicators','qualifiedMinAlignedIndicators','scoreAverageWindow','flipConfirm','waitConfirm','holdMs','scoreAlpha','orderFlowFreshnessMs','orderFlowImbalanceThreshold'];
    for(const key of Object.keys(patch)){
      if(key==='baseWeights'){
        const weights=patch.baseWeights;
        if(!weights||typeof weights!=='object'||Object.keys(BASE_WEIGHTS).some(k=>!Number.isFinite(Number(weights[k]))||Number(weights[k])<0)||Object.keys(weights).some(k=>!(k in BASE_WEIGHTS))){
          return {ok:false,reason:'baseWeights must contain every known indicator with non-negative numeric weights'};
        }
        const sum=Object.values(weights).reduce((a,b)=>a+Number(b),0);
        if(Math.abs(sum-100)>0.001)return {ok:false,reason:'baseWeights must sum to 100'};
      }else if(!allowed.includes(key))return {ok:false,reason:'Unknown Engine 5 setting: '+key};
      else if(!Number.isFinite(Number(patch[key])))return {ok:false,reason:'Setting must be numeric: '+key};
    }
    if(patch.minConfidence!==undefined&&(patch.minConfidence<0||patch.minConfidence>100))return {ok:false,reason:'minConfidence must be 0–100'};
    if(patch.weakSignalFloor!==undefined&&patch.strongSignalFloor!==undefined&&patch.weakSignalFloor>patch.strongSignalFloor)return {ok:false,reason:'weakSignalFloor cannot exceed strongSignalFloor'};
    if(patch.scoreAlpha!==undefined&&(patch.scoreAlpha<=0||patch.scoreAlpha>1))return {ok:false,reason:'scoreAlpha must be >0 and <=1'};
    if(patch.baseWeights)Object.assign(BASE_WEIGHTS,Object.fromEntries(Object.entries(patch.baseWeights).map(([k,v])=>[k,Number(v)])));
    Object.keys(patch).filter(k=>k!=='baseWeights').forEach(k=>ENGINE5_SETTINGS[k]=Number(patch[k]));
    ENGINE5_SETTINGS.baseWeights=BASE_WEIGHTS;
    window.RIZVI_ENGINE5_SETTINGS=ENGINE5_SETTINGS;
    run();
    return {ok:true,settings:ENGINE5_SETTINGS};
  };
  function run(){
    /* Engine 5 is the sole final signal writer once the symbol-alignment bridge is loaded. */
    if(window.__RIZVI_V132_SYMBOL_BRIDGE)return;
    const symbol=window.RIZVI_CURRENT_SYMBOL||'XAU/USD';
    const feed=window.RIZVI_FEED_STATUS;
    if(!feed||feed.ok!==true||feed.symbol!==symbol){
      const wait={symbol,updatedAt:Date.now(),direction:'WAIT',confidence:50,qualified:false,confirmations:0,autoTrading:false,feedStatus:feed||{ok:false,reason:'Waiting for validated live OHLC feed'}};
      window.RIZVI_MASTER_CONFIRMATION=wait;
      window.RIZVI_SIGNAL_DIRECTION='WAIT';
      window.RIZVI_SIGNAL_QUALIFICATION={symbol,updatedAt:wait.updatedAt,signalDirection:'WAIT',marketDirection:'WAIT',patternConfidence:50,liquidityScore:0,aligned:false,status:'WAIT_FOR_LIVE_FEED',masterConfirmations:0};
      window.dispatchEvent(new CustomEvent('rizvi:master-confirmation-update',{detail:wait}));
      window.dispatchEvent(new CustomEvent('rizvi:signal-qualification-update',{detail:window.RIZVI_SIGNAL_QUALIFICATION}));
      return;
    }
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
    const engine4=window.RIZVI_ENGINE4_CONTEXT||{};
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
    const deltaSignal=delta===null?'WAIT':delta>ENGINE5_SETTINGS.orderFlowImbalanceThreshold?'BUY':delta<-ENGINE5_SETTINGS.orderFlowImbalanceThreshold?'SELL':'NEUTRAL';
    const prev8=bars.slice(-16,-8),last8=bars.slice(-8);
    const prevHigh=prev8.length?Math.max(...prev8.map(x=>Number(x.h))):null,lastHigh=last8.length?Math.max(...last8.map(x=>Number(x.h))):null;
    const prevLow=prev8.length?Math.min(...prev8.map(x=>Number(x.l))):null,lastLow=last8.length?Math.min(...last8.map(x=>Number(x.l))):null;
    const prevRsi=rsi(closes.slice(0,-8)),lastRsi=r;
    const bearishDiv=prevHigh!==null&&lastHigh!==null&&lastHigh>prevHigh&&prevRsi!==null&&lastRsi!==null&&lastRsi<prevRsi;
    const bullishDiv=prevLow!==null&&lastLow!==null&&lastLow<prevLow&&prevRsi!==null&&lastRsi!==null&&lastRsi>prevRsi;
    const divergence=bullishDiv?'BUY':bearishDiv?'SELL':'NEUTRAL';
    const prevCandle=bars.at(-2), prevPrev=bars.at(-3);
    const bullishEngulf=prevCandle&&prevPrev&&prevCandle.c>prevCandle.o&&prevPrev.c<prevPrev.o&&prevCandle.c>=prevPrev.o&&prevCandle.o<=prevPrev.c;
    const bearishEngulf=prevCandle&&prevPrev&&prevCandle.c<prevCandle.o&&prevPrev.c>prevPrev.o&&prevCandle.c<=prevPrev.o&&prevCandle.o>=prevPrev.c;
    const candlePattern=bullishEngulf?'BUY':bearishEngulf?'SELL':candleBias;
    const rangeLevels=window.RIZVI_MARKET_RANGE||{};
    const rangeSignals={};
    ['dayHigh','h4High','h1High','m30High','m15High'].forEach(k=>{if(Number.isFinite(Number(rangeLevels[k])))rangeSignals[k]=last.c>Number(rangeLevels[k])?'BUY':'NEUTRAL';});
    ['dayLow','h4Low','h1Low','m30Low','m15Low'].forEach(k=>{if(Number.isFinite(Number(rangeLevels[k])))rangeSignals[k]=last.c<Number(rangeLevels[k])?'SELL':'NEUTRAL';});

    // V106 FVG engine: detect the latest 3-candle Fair Value Gap from live OHLC.
    // Bullish FVG: current low > candle two bars back high.
    // Bearish FVG: current high < candle two bars back low.
    const fvgLookback=Math.min(80,bars.length);
    let fvg={signal:'NEUTRAL',confidence:50,type:null,top:null,bottom:null,filled:false,reason:'No active FVG'};
    for(let i=bars.length-1;i>=Math.max(2,bars.length-fvgLookback);i--){
      const a=bars[i-2], mid=bars[i-1], b=bars[i];
      const ah=Number(a.h), al=Number(a.l), bh=Number(b.h), bl=Number(b.l);
      if([ah,al,bh,bl].every(Number.isFinite)){
        if(bl>ah){
          const top=bl,bottom=ah;
          // Check every candle after formation: the latest candle alone cannot
          // tell us whether an older gap was already fully mitigated.
          let filled=false;
          for(let j=i+1;j<bars.length;j++){
            if(Number(bars[j].l)<=bottom){filled=true;break;}
          }
          if(!filled){fvg={signal:'BUY',confidence:76,type:'BULLISH',top,bottom,filled:false,reason:'Bullish 3-candle imbalance'};break;}
        }
        if(bh<al){
          const top=al,bottom=bh;
          let filled=false;
          for(let j=i+1;j<bars.length;j++){
            if(Number(bars[j].h)>=top){filled=true;break;}
          }
          if(!filled){fvg={signal:'SELL',confidence:76,type:'BEARISH',top,bottom,filled:false,reason:'Bearish 3-candle imbalance'};break;}
        }
      }
    }
    const fvgSignal=fvg.signal;

    // Prop-style weighted confirmation: avoid double-counting correlated evidence.
    // Total active weight = 100. Price Action/Volatility remain context engines, not extra votes.
    const WEIGHTS=getWeights();
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
    // Order flow is an optional add-on; it is deliberately excluded from core scoring.
    add('momentum',momentum,WEIGHTS.momentum);
    add('rsi',votes.rsi,WEIGHTS.rsi,r!==null);
    add('divergence',divergence,WEIGHTS.divergence,true);
    add('vwap',vwapSignal,WEIGHTS.vwap,vwap!==null);
    add('volumeProfile',vpSignal,WEIGHTS.volumeProfile,volumeProfile!==null);
    add('delta',deltaSignal,WEIGHTS.delta,delta!==null);
    add('candlePattern',candlePattern,WEIGHTS.candlePattern,true);
    add('candleBias',candleBias,WEIGHTS.candleBias,true);
    // FVG has a reserved 5-point weight; include its live signal in the actual vote total.
    add('fvg',fvgSignal,WEIGHTS.fvg,true);

    const rawDirection=buy>sell?'BUY':sell>buy?'SELL':'WAIT';
    const engine4NewsBlocked=engine4.usNews?.status==='LIVE'&&engine4.usNews.blocked===true;
    const lead=Math.max(buy,sell),conflict=Math.min(buy,sell),total=buy+sell;
    // Use the full 100-point model as the denominator. Missing indicators must not inflate scores.
    const weightedScore=clamp(lead);
    const directionalMargin=clamp(lead-conflict);
    // V129: rolling score average over the latest 30 engine runs smooths noisy candle-to-candle swings.
    state.scoreSamples.push(weightedScore);
    if(state.scoreSamples.length>ENGINE5_SETTINGS.scoreAverageWindow)state.scoreSamples.shift();
    state.scoreAverage=state.scoreSamples.length?state.scoreSamples.reduce((a,b)=>a+b,0)/state.scoreSamples.length:weightedScore;
    const settledScore=state.scoreAverage;
    // 95 = strict confluence/compatibility quality, NOT 95% probability of profit.
    const rawConfidence=rawDirection==='WAIT'?50:
      clamp(Math.round(45+settledScore*0.38+directionalMargin*0.32+(total>=activeWeight*0.75?8:0)));
    const activeIndicators=Object.keys(contribution).length;
    const alignedIndicators=Object.values(contribution).filter(x=>x.signal===rawDirection).length;
    const compatibility95=rawDirection!=='WAIT'&&weightedScore>=95&&directionalMargin>=ENGINE5_SETTINGS.compatibilityMargin&&activeIndicators>=ENGINE5_SETTINGS.compatibilityMinIndicators&&alignedIndicators>=ENGINE5_SETTINGS.compatibilityMinAligned;
    const algoRunReport={
      timestamp:Date.now(),symbol,
      threshold:ENGINE5_SETTINGS.compatibilityThreshold,score:Math.round(weightedScore),scoreAverage:Math.round(settledScore),confidence:Math.round(rawConfidence),
      direction:rawDirection,activeWeight,activeIndicators,alignedIndicators,
      directionalMargin:Math.round(directionalMargin),compatibility95,
      weights:WEIGHTS,baseWeights:BASE_WEIGHTS,contributions:contribution,adaptiveCalibration:{indicatorOutcomes:state.outcomes,minSamplesPerIndicator:5},
      note:'95 is confluence compatibility, not win probability.'
    };

    // V105: signal hysteresis. Indicators may recalculate every tick, but the
    // visible/master direction only changes after persistence; WAIT is also held
    // so transient indicator disagreement cannot create BUY/SELL/WAIT flicker.
    const now=Date.now();
    const FLIP_CONFIRM=ENGINE5_SETTINGS.flipConfirm;
    const WAIT_CONFIRM=ENGINE5_SETTINGS.waitConfirm;
    const HOLD_MS=ENGINE5_SETTINGS.holdMs;
    const SCORE_ALPHA=ENGINE5_SETTINGS.scoreAlpha;
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

    const confidence=Math.round(clamp(Math.round(state.stableConfidence/2)*2));
    // Respect the requested thresholds: below 70 = WAIT, 70–79 = weak, 80+ = strong only with confirmation.
    const engine4DxyConflict=engine4.dxy?.status==='LIVE'&&engine4.dxy.correlation<=-0.25&&engine4.dxy.dxyDirection===state.stableDirection;
    const direction=confidence<ENGINE5_SETTINGS.weakSignalFloor||engine4NewsBlocked||engine4DxyConflict?'WAIT':state.stableDirection;
    const confirmations=Object.values(contribution).filter(x=>x.signal===direction).length;
    // Keep the 95-point compatibility metric as a stricter research flag, not a blocker for every 80+ confirmed setup.
    const qualified=direction!=='WAIT'&&confirmations>=ENGINE5_SETTINGS.minConfirmations&&confidence>=ENGINE5_SETTINGS.minConfidence&&weightedScore>=ENGINE5_SETTINGS.qualifiedMinScore&&directionalMargin>=ENGINE5_SETTINGS.qualifiedMinMargin&&activeIndicators>=ENGINE5_SETTINGS.qualifiedMinActiveIndicators&&alignedIndicators>=ENGINE5_SETTINGS.qualifiedMinAlignedIndicators;
    const visibleSignal=direction!=='WAIT'?direction:'WAIT';

    const engines={
      trend:{signal:trend,confidence:clamp(trend==='NEUTRAL'?50:72),reason:'EMA 9/21'},
      structure:{signal:structure,confidence:clamp(70+(structure===direction?15:0)),reason:'recent 10-bar structure'},
      liquidity:{signal:liq.direction||'NEUTRAL',confidence:liqScore||null,reason:liq.status||'No liquidity event'},
      orderFlow:{signal:'DISABLED',confidence:null,reason:'Optional feed disabled; core signals do not depend on it'}, 
      momentum:{signal:momentum,confidence:clamp(momentum===direction?70:50),reason:'latest candle direction'},
      candleBias:{signal:candleBias,confidence:clamp(candleBias===direction?75:50),reason:'current candle body'},
      divergence:{signal:divergence,confidence:divergence==='NEUTRAL'?50:72,reason:'price/RSI divergence'},
      priceAction:{signal:momentum,confidence:clamp(momentum===direction?70:50),reason:'OHLC candle response'},
      volatility:{signal:'NEUTRAL',confidence:60,reason:'range context'},
      vwap:{signal:vwapSignal,confidence:vwap===null?null:70,reason:vwap===null?'volume data unavailable':'price vs session VWAP',value:vwap},
      volumeProfile:{signal:vpSignal,confidence:volumeProfile===null?null:68,reason:volumeProfile===null?'volume data unavailable':'POC context',poc:volumeProfile?.poc??null},
      delta:{signal:deltaSignal,confidence:delta===null?null:of.confidence,reason:delta===null?'L2 unavailable':'L2 bid/ask imbalance',imbalance:delta},
      candlePattern:{signal:candlePattern,confidence:bullishEngulf||bearishEngulf?78:60,reason:bullishEngulf||bearishEngulf?'engulfing pattern':'candle body'},
      fvg:{signal:fvg.signal,confidence:fvg.confidence,reason:fvg.reason,type:fvg.type,top:fvg.top,bottom:fvg.bottom,filled:fvg.filled},
      rangeLevels:{signal:liq.direction||'NEUTRAL',confidence:liqScore||null,reason:'Day/4H/1H/30M/15M high-low context',levels:rangeLevels},
      dxyInverseCorrelation:{signal:engine4.dxy?.signal||'UNAVAILABLE',confidence:engine4.dxy?.correlation==null?null:Math.round(Math.abs(engine4.dxy.correlation)*100),reason:engine4.dxy?.reason||'DXY data unavailable',correlation:engine4.dxy?.correlation??null},
      highImpactUSNews:{signal:engine4.usNews?.status==='LIVE'?(engine4.usNews.blocked?'BLOCK':'CLEAR'):'UNAVAILABLE',confidence:engine4.usNews?.status==='LIVE'?100:null,reason:engine4.usNews?.activeEvent?.title||(engine4.usNews?.reason||'No validated news status'),nextEvent:engine4.usNews?.nextEvent||null},
      tradingSessions:{signal:engine4.session?.active?.join(' + ')||'UNAVAILABLE',confidence:engine4.session?.status==='LIVE'?100:null,reason:engine4.session?.source||'Session clock unavailable'},
      dayHighLow:{signal:engine4.dayHighLow?.status==='LIVE'?'LIVE':'UNAVAILABLE',confidence:engine4.dayHighLow?.status==='LIVE'?100:null,reason:engine4.dayHighLow?.reason||engine4.dayHighLow?.source||'Day range unavailable',high:engine4.dayHighLow?.high??null,low:engine4.dayHighLow?.low??null}
    };
    window.RIZVI_MASTER_CONFIRMATION={
      symbol,updatedAt:Date.now(),direction,confidence,qualified,
      confirmations,trend,structure,momentum,rsi:r,
      rawDirection,rawConfidence,stability:{pendingCount:state.pendingCount,waitCount:state.waitCount,windowMs:15000,confidenceWindowMs:15000,holdMs:HOLD_MS,flipConfirm:FLIP_CONFIRM,waitConfirm:WAIT_CONFIRM,holdCycles:3},
      engines,autoTrading:false,
      settings:{...ENGINE5_SETTINGS,emaFast:9,emaSlow:21,rsi:14,weightsTotal:100,weights:WEIGHTS},
      contributions:{trend:trend,structure:structure,momentum:momentum,fvg:fvgSignal,rsi:r!==null?(r>=55&&r<72?'BUY':r<=45&&r>28?'SELL':'NEUTRAL'):'WAIT',vwap:vwapSignal,volumeProfile:vpSignal,delta:deltaSignal,divergence,candlePattern,liquidity:liq.direction||'NEUTRAL',rangeLevels:liq.direction||'NEUTRAL',dxyInverseCorrelation:engine4.dxy?.signal||'UNAVAILABLE',highImpactUSNews:engine4.usNews?.blocked?'BLOCK':'CLEAR',tradingSessions:engine4.session?.active||[],dayHighLow:engine4.dayHighLow?.status==='LIVE'?'LIVE':'UNAVAILABLE'},
      indicatorStatus:{ema:true,fvg:true,rsi:r!==null,vwap:vwap!==null,volumeProfile:volumeProfile!==null,delta:delta!==null,divergence:true,candlePattern:true,orderFlow:false,liquidity:!!liq.status,rangeLevels:Object.keys(rangeLevels).length>=4,dxyInverseCorrelation:engine4.dxy?.status==='LIVE',highImpactUSNews:engine4.usNews?.status==='LIVE',tradingSessions:engine4.session?.status==='LIVE',dayHighLow:engine4.dayHighLow?.status==='LIVE'},
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
      momentum:engines.momentum,candleBias:engines.candleBias,divergence:engines.divergence,
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
      const p=Number(window.RIZVI_LIVE_PRICE??window.RIZVI_LIVE_PRICES?.[m?.symbol||'XAUUSD']);
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
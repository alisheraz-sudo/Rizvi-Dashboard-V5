(function(){
  'use strict';
  if(window.__RIZVI_PYTHON_DIAGNOSTICS_BRIDGE)return;
  window.__RIZVI_PYTHON_DIAGNOSTICS_BRIDGE=true;
  const W=window;
  const TF_MAP={'1M':'1m','5M':'5m','15M':'15m','30M':'30m','1H':'1h'};
  let inFlight=false,lastKey='',lastAttempt=0;
  const normSymbol=x=>{
    const s=String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(['XAUUSD','GOLD','XAU'].includes(s))return 'XAUUSD';
    if(['BTCUSD','BTCUSDT','BTC'].includes(s))return 'BTCUSD';
    return null;
  };
  const timestamp=b=>{let t=Number(b?.t??b?.time??b?.timestamp??b?.date);if(!Number.isFinite(t)&&typeof (b?.time??b?.date)==='string')t=Date.parse(b.time??b.date);return Number.isFinite(t)?t:null;};
  function publish(state,detail={}){
    W.RIZVI_PYTHON_DIAGNOSTICS={state,updatedAt:Date.now(),autoTrading:false,...detail};
    W.dispatchEvent(new CustomEvent('rizvi:python-diagnostics-update',{detail:W.RIZVI_PYTHON_DIAGNOSTICS}));
  }
  function activeTf(){
    const raw=String(W.RIZVI_CANDLE_TIMEFRAME||document.querySelector('.tf .sel')?.textContent||'1M').trim().toUpperCase();
    return TF_MAP[raw]||null;
  }
  function activeBars(){
    const raw=Array.isArray(W.RIZVI_RAW_BARS)?W.RIZVI_RAW_BARS:[];
    const agg=Array.isArray(W.RIZVI_AGG_BARS)?W.RIZVI_AGG_BARS:[];
    return (agg.length?agg:raw).map(b=>({
      timestamp:timestamp(b),open:Number(b?.o??b?.open),high:Number(b?.h??b?.high),
      low:Number(b?.l??b?.low),close:Number(b?.c??b?.close),volume:Number(b?.v??b?.volume??0)
    })).filter(b=>b.timestamp!==null&&[b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite))
      .sort((a,b)=>a.timestamp-b.timestamp);
  }
  async function tick(force){
    if(inFlight||document.visibilityState==='hidden')return;
    const symbol=normSymbol(W.RIZVI_CURRENT_SYMBOL||W.RIZVI_DIRECT_SYMBOL||document.getElementById('symbolSelect')?.value);
    if(!symbol){publish('WAITING_FOR_SUPPORTED_SYMBOL');return;}
    // Respect the user's Gold market-closed lock: do not send historical candles
    // to Python as if they were live diagnostics.
    if(symbol==='XAUUSD'&&W.RIZVI_GOLD_MARKET_LOCKED===true){
      publish('MARKET_CLOSED_WAIT',{symbol,reason:'Gold market closed; live-only diagnostics paused',autoTrading:false});
      return;
    }
    const chartSymbol=normSymbol(W.RIZVI_CHART_STATUS?.symbol||W.RIZVI_DIRECT_TV?.symbol);
    if(!chartSymbol){publish('WAITING_FOR_CHART_SYMBOL',{symbol,chartStatus:W.RIZVI_CHART_STATUS?.status||W.RIZVI_DIRECT_TV?.status||null});return;}
    if(chartSymbol!==symbol){publish('WAITING_FOR_SYMBOL_MATCH',{symbol,chartSymbol});return;}
    const timeframe=activeTf();
    if(!timeframe){publish('WAITING_FOR_SUPPORTED_TIMEFRAME',{symbol,displayTimeframe:W.RIZVI_CANDLE_TIMEFRAME||null});return;}
    const bars=activeBars();
    if(bars.length<60){publish('WAITING_FOR_60_BARS',{symbol,timeframe,bars:bars.length});return;}
    const recent=bars.slice(-500);
    const last=recent[recent.length-1];
    // Browser chart timestamps can be seconds or milliseconds; compare in seconds,
    // using the same timeframe freshness limit as the Python API contract.
    const lastSeconds=last.timestamp>100000000000?last.timestamp/1000:last.timestamp;
    const timeframeSeconds={ '1m':60,'5m':300,'15m':900,'30m':1800,'1h':3600 }[timeframe];
    const maxAgeSeconds=Math.max(180,timeframeSeconds*3);
    const ageSeconds=Date.now()/1000-lastSeconds;
    if(!Number.isFinite(ageSeconds)||ageSeconds < -60 || ageSeconds > maxAgeSeconds){
      publish('STALE_FEED_WAIT',{symbol,timeframe,bars:recent.length,lastBarTime:last.timestamp,
        latestAgeSeconds:Math.round(ageSeconds),maxAgeSeconds,reason:'Latest candle is outside the live freshness window; diagnostics request skipped',autoTrading:false});
      return;
    }
    const key=[symbol,timeframe,recent.length,last.timestamp,last.close].join(':');
    if(!force&&key===lastKey&&Date.now()-lastAttempt<60000)return;
    if(Date.now()-lastAttempt<10000&&!force)return;
    lastKey=key;lastAttempt=Date.now();inFlight=true;
    publish('REQUESTING_DIAGNOSTICS',{symbol,timeframe,bars:recent.length,lastBarTime:last.timestamp,lastPrice:last.close,lastAttemptAt:lastAttempt});
    try{
      const response=await fetch('/api/indicator-diagnostics',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({symbol,timeframe,bars:recent})
      });
      let body=null;try{body=await response.json();}catch(_){}
      if(!body||typeof body!=='object')throw new Error('Invalid diagnostics response');
      const state=response.ok&&body.enabled!==false?'RESPONSE_RECEIVED':response.status===503?'ENGINE_NOT_CONFIGURED':response.status===422?'FEED_OR_REQUEST_REJECTED':'ENGINE_ERROR';
      publish(state,{httpStatus:response.status,symbol,timeframe,bars:recent.length,lastBarTime:last.timestamp,lastPrice:last.close,response:body,receivedAt:Date.now(),lastAttemptAt:lastAttempt});
    }catch(error){
      publish('REQUEST_FAILED',{symbol,timeframe,bars:recent.length,lastAttemptAt:lastAttempt,error:String(error?.message||error)});
    }finally{inFlight=false;}
  }
  W.RIZVI_REQUEST_PYTHON_DIAGNOSTICS=()=>tick(true);
  W.addEventListener('rizvi:candle-update',()=>tick(false));
  W.addEventListener('rizvi:timeframe-update',()=>{lastKey='';tick(true);});
  W.addEventListener('rizvi:symbol-change',()=>{lastKey='';tick(true);});
  W.addEventListener('rizvi:chart-status',()=>tick(false));
  setTimeout(()=>tick(true),3500);
  setInterval(()=>tick(false),15000);
})();
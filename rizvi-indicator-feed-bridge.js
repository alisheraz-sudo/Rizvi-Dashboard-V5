/* Rizvi V5 OHLC-to-indicator bridge. Keeps the existing TradingView chart renderer untouched. */
(function(){
'use strict';
if(window.__RIZVI_OHLC_BRIDGE_V1)return;
window.__RIZVI_OHLC_BRIDGE_V1=true;
const TF_SECONDS={'1M':60,'5M':300,'15M':900,'30M':1800,'1H':3600,'1D':86400};
let busy=false,rerunRequested=false,lastKey='',lastGoodAt=0,requestSeq=0;
function symbol(){
 const s=String(window.RIZVI_CURRENT_SYMBOL||window.RIZVI_DIRECT_SYMBOL||document.getElementById('symbolSelect')?.value||'XAU/USD').toUpperCase();
 return /^(XAU\/USD|XAUUSD|GOLD)$/.test(s)?'XAU/USD':s.replace(/[^A-Z0-9]/g,'')==='BTCUSD'?'BTCUSD':'UNSUPPORTED';
}
function timeframe(){const t=String(window.RIZVI_CANDLE_TIMEFRAME||'1M').toUpperCase();return TF_SECONDS[t]?t:'1M';}
async function fetchJsonWithTimeout(url,options={},timeoutMs=12000){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetch(url,{...options,signal:controller.signal});
  const data=await response.json();
  return {response,data};
 }catch(e){
  if(controller.signal.aborted)throw new Error('OHLC request timed out after '+timeoutMs+'ms ('+url+')');
  throw e;
 }finally{clearTimeout(timer);}
}
function normalize(rows){
 const now=Math.floor(Date.now()/1000);
 return (Array.isArray(rows)?rows:[]).map(x=>{
  const raw=x.t??x.time??x.timestamp??x.date;
  let t;
  if(typeof raw==='string'&&raw.trim()!==''&&!Number.isFinite(Number(raw.trim())))t=Date.parse(raw)/1000;
  else t=Number(raw);
  if(!Number.isFinite(t)||t<=0)t=NaN;
  else if(t>=1e17)t/=1e9;       // epoch nanoseconds -> seconds
  else if(t>=1e14)t/=1e6;       // epoch microseconds -> seconds
  else if(t>=1e11)t/=1e3;       // epoch milliseconds -> seconds
  t=Math.floor(t);
  return {t,o:Number(x.o??x.open),h:Number(x.h??x.high),l:Number(x.l??x.low),c:Number(x.c??x.close),v:Number(x.v??x.volume??0)};
 })
 // The bridge uses epoch seconds internally; discard invalid/future bars before sorting or age checks.
 .filter(x=>Number.isFinite(x.t)&&x.t>0&&x.t<=now+5&&[x.o,x.h,x.l,x.c].every(Number.isFinite))
 .sort((a,b)=>a.t-b.t);
}
function aggregate(rows,seconds){
 const out=[];
 for(const b of rows){
  const bucket=Math.floor(b.t/seconds)*seconds,prev=out[out.length-1];
  if(prev&&prev.t===bucket){prev.h=Math.max(prev.h,b.h);prev.l=Math.min(prev.l,b.l);prev.c=b.c;prev.v+=Math.max(0,b.v||0);}
  else out.push({t:bucket,o:b.o,h:b.h,l:b.l,c:b.c,v:Math.max(0,b.v||0)});
 }
 return out;
}
function publishCanonicalSnapshot(status,bars){
 const now=Date.now(),rows=Array.isArray(bars)?bars:[],latest=rows.length?rows[rows.length-1]:null;
 const snapshot={version:1,symbol:status.symbol,timeframe:status.timeframe,status,bars:rows,capturedAt:now,latestBarAt:latest?latest.t:null,latestAgeMs:latest?Math.max(0,now-(latest.t<1e12?latest.t*1000:latest.t)):null};
 window.RIZVI_CANONICAL_FEED_SNAPSHOT=snapshot;
 window.RIZVI_CANONICAL_FEED_STATUS=status;
 window.RIZVI_CANONICAL_RAW_BARS=rows;
 return snapshot;
}
function fail(sym,reason){
 try{fetch('/internal/feed-diagnostic',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:true,body:JSON.stringify({sessionId:window.__RIZVI_DIAG_SESSION_ID||(window.__RIZVI_DIAG_SESSION_ID=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)),symbol:sym,timeframe:timeframe(),reason:String(reason||'').slice(0,220)})}).catch(()=>{});}catch(_){}
 window.RIZVI_FEED_STATUS={ok:false,live:false,stale:true,symbol:sym,timeframe:timeframe(),source:sym==='BTCUSD'?'BTC OHLC endpoint':'XAUS-OHLC',updatedAt:Date.now(),reason};
 publishCanonicalSnapshot(window.RIZVI_FEED_STATUS,[]);
 window.RIZVI_MASTER_CONFIRMATION={symbol:sym,updatedAt:Date.now(),direction:'WAIT',confidence:50,qualified:false,confirmations:0,autoTrading:false,indicatorStatus:{ema:false,fvg:false,rsi:false,vwap:false,volumeProfile:false,delta:false,divergence:false,candlePattern:false,orderFlow:false,liquidity:false,rangeLevels:false},feedStatus:window.RIZVI_FEED_STATUS};
 window.RIZVI_SIGNAL_DIRECTION='WAIT';
 window.dispatchEvent(new CustomEvent('rizvi:master-confirmation-update',{detail:window.RIZVI_MASTER_CONFIRMATION}));
}
async function poll(){
 // Do not invalidate an in-flight request when a duplicate event/interval arrives.
 // Coalesce overlapping triggers and run one fresh poll after the current one settles.
 if(busy){rerunRequested=true;return;}
 busy=true;
 const seq=++requestSeq;
 const sym=symbol(),tf=timeframe(),key=sym+'|'+tf;
 const goldLocked=sym==='XAU/USD'&&window.RIZVI_GOLD_MARKET_LOCKED===true;
 if(key!==lastKey){window.RIZVI_FEED_STATUS={ok:null,symbol:sym,timeframe:tf,source:sym==='BTCUSD'?'BTC OHLC endpoint':'XAUS-OHLC',updatedAt:Date.now(),reason:'Loading fresh '+sym+' OHLC feed'};publishCanonicalSnapshot(window.RIZVI_FEED_STATUS,[]);}
 function validateRows(rows,label,allowStale=false){
  const bars=aggregate(normalize(rows),TF_SECONDS[tf]);
  if(bars.length<21)throw new Error(label+' history insufficient ('+bars.length+' bars)');
  const now=Math.floor(Date.now()/1000),latest=bars[bars.length-1],age=now-latest.t;
  if(age < -5||(age>Math.max(TF_SECONDS[tf]*3,180)&&!allowStale))throw new Error(label+' stale (latest bar age '+age+'s)');
  return {bars,latest,age,stale:age>Math.max(TF_SECONDS[tf]*3,180)};
 }
 try{
  if(sym==='UNSUPPORTED'){fail(sym,'No OHLC endpoint configured for this symbol');return;}
  let data=null,validated=null,primaryError='';
  if(sym==='BTCUSD'){
   const result=await fetchJsonWithTimeout('/market/btc/intraday?granularity='+TF_SECONDS[tf],{cache:'no-store',credentials:'same-origin'});
   const response=result.response;data=result.data;
   if(!response.ok||!data?.ok||!Array.isArray(data.bars))throw new Error(data?.error||('HTTP '+response.status));
   validated=validateRows(data.bars,data.source||'BTC OHLC endpoint');
  }else{
   try{
    const result=await fetchJsonWithTimeout('/market/xau/intraday?allowStale=1',{cache:'no-store',credentials:'same-origin'});
    const response=result.response;data=result.data;
    if(!response.ok||!data?.ok||!Array.isArray(data.bars))throw new Error(data?.error||('HTTP '+response.status));
    validated=validateRows(data.bars,data.source||'XAUS-OHLC',data.stale===true);
   }catch(e){
    primaryError=String(e?.message||e);
    // Use cTrader only when it is actually connected, authorized, and returns fresh real OHLC.
    // No spot-price fabrication: if neither provider has valid candles, keep signals at WAIT.
    const result=await fetchJsonWithTimeout('/market/ctrader?symbol=XAUUSD',{cache:'no-store',credentials:'same-origin'});
    const response=result.response,backup=result.data;
    if(!response.ok||!backup?.ok||backup.connected!==true||backup.authorized!==true||!Array.isArray(backup.bars)||!backup.bars.length){
     throw new Error('XAUS failed: '+primaryError+'; cTrader fallback unavailable'+(backup?.error?': '+backup.error:'')+' (connected='+!!backup?.connected+', authorized='+!!backup?.authorized+', bars='+(backup?.bars?.length||0)+')');
    }
    data=backup;
    try{validated=validateRows(backup.bars,'cTrader OHLC');}
    catch(e2){throw new Error('XAUS failed: '+primaryError+'; cTrader fallback failed: '+String(e2?.message||e2));}
   }
  }
  if(seq!==requestSeq||key!==symbol()+'|'+timeframe())return;
  const bars=validated.bars,latest=validated.latest;
  window.RIZVI_DIRECT_SYMBOL=sym;
  window.RIZVI_CANONICAL_RAW_BARS=bars;
   window.RIZVI_RAW_BARS=bars;window.RIZVI_AGG_BARS=bars;
  const latestAgeSeconds=Math.max(0,Math.floor(Date.now()/1000)-latest.t);
  if(sym==='XAU/USD'&&(data?.stale===true||validated.stale)){
   const reason='LAST AVAILABLE GOLD DATA ONLY — candles are stale ('+latestAgeSeconds+'s); indicator values are historical, Engine 5 must WAIT';
   window.RIZVI_FEED_STATUS={ok:false,stale:true,live:false,symbol:sym,timeframe:tf,source:data.source||'last available OHLC',bars:bars.length,latestBarAt:latest.t,latestAgeSeconds,updatedAt:Date.now(),key,reason};
    publishCanonicalSnapshot(window.RIZVI_FEED_STATUS,bars);
   window.RIZVI_MASTER_CONFIRMATION={symbol:sym,updatedAt:Date.now(),direction:'WAIT',confidence:50,qualified:false,confirmations:0,autoTrading:false,reason,feedStatus:window.RIZVI_FEED_STATUS};
   window.RIZVI_SIGNAL_DIRECTION='WAIT';
   window.dispatchEvent(new CustomEvent('rizvi:master-confirmation-update',{detail:window.RIZVI_MASTER_CONFIRMATION}));
   try{fetch('/internal/feed-diagnostic',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:true,body:JSON.stringify({sessionId:window.__RIZVI_DIAG_SESSION_ID||(window.__RIZVI_DIAG_SESSION_ID=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)),symbol:sym,timeframe:tf,reason})}).catch(()=>{});}catch(_){}
   lastGoodAt=Date.now();lastKey=key;
   window.dispatchEvent(new CustomEvent('rizvi:ohlc-feed-update',{detail:window.RIZVI_FEED_STATUS}));
   return;
  }
  window.RIZVI_FEED_STATUS={ok:true,stale:false,live:true,symbol:sym,timeframe:tf,source:data.source||'backend OHLC',bars:bars.length,latestBarAt:latest.t,latestAgeSeconds,updatedAt:Date.now(),key};
   publishCanonicalSnapshot(window.RIZVI_FEED_STATUS,bars);
  try{fetch('/internal/feed-diagnostic',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:true,body:JSON.stringify({sessionId:window.__RIZVI_DIAG_SESSION_ID||(window.__RIZVI_DIAG_SESSION_ID=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)),symbol:sym,timeframe:tf,reason:'OK source='+(data.source||'backend OHLC')+' bars='+bars.length+' latestAgeSeconds='+latestAgeSeconds})}).catch(()=>{});}catch(_){}
  lastGoodAt=Date.now();lastKey=key;
  window.dispatchEvent(new CustomEvent('rizvi:ohlc-feed-update',{detail:window.RIZVI_FEED_STATUS}));
 }catch(e){if(seq===requestSeq&&sym===symbol()&&tf===timeframe())fail(sym,String(e?.message||e));}
 finally{busy=false;if(rerunRequested){rerunRequested=false;setTimeout(poll,50);}}
}
function start(){poll();setInterval(poll,15000);const onSymbolChange=()=>setTimeout(poll,0);window.addEventListener('rizvi:symbol-change',onSymbolChange);document.addEventListener('rizvi:symbol-change',onSymbolChange);document.getElementById('symbolSelect')?.addEventListener('change',onSymbolChange);window.addEventListener('rizvi:direct-tv-status',onSymbolChange);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
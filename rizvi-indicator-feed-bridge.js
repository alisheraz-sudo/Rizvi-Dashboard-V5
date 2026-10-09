/* Rizvi V5 OHLC-to-indicator bridge. Keeps the existing TradingView chart renderer untouched. */
(function(){
'use strict';
if(window.__RIZVI_OHLC_BRIDGE_V1)return;
window.__RIZVI_OHLC_BRIDGE_V1=true;
const TF_SECONDS={'1M':60,'5M':300,'15M':900,'30M':1800,'1H':3600,'1D':86400};
let busy=false,rerunRequested=false,lastKey='',lastGoodAt=0;
function symbol(){
 const s=String(document.getElementById('symbolSelect')?.value||window.RIZVI_CURRENT_SYMBOL||window.RIZVI_DIRECT_SYMBOL||'XAUUSD').toUpperCase();
 return /^(XAU\/USD|XAUUSD|GOLD)$/.test(s)?'XAU/USD':s.replace(/[^A-Z0-9]/g,'')==='BTCUSD'?'BTCUSD':'UNSUPPORTED';
}
function timeframe(){const t=String(window.RIZVI_CANDLE_TIMEFRAME||'1M').toUpperCase();return TF_SECONDS[t]?t:'1M';}
function normalize(rows){
 return (Array.isArray(rows)?rows:[]).map(x=>{
  let t=Number(x.t??x.time??x.timestamp);
  if(t>1e12)t=Math.floor(t/1000);
  return {t,o:Number(x.o??x.open),h:Number(x.h??x.high),l:Number(x.l??x.low),c:Number(x.c??x.close),v:Number(x.v??x.volume??0)};
 }).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t);
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
function fail(sym,reason){
 try{fetch('/internal/feed-diagnostic',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',keepalive:true,body:JSON.stringify({symbol:sym,timeframe:timeframe(),reason:String(reason||'').slice(0,220)})}).catch(()=>{});}catch(_){}
 window.RIZVI_FEED_STATUS={ok:false,symbol:sym,source:sym==='BTCUSD'?'Coinbase':'XAUS-OHLC',updatedAt:Date.now(),reason};
 window.RIZVI_MASTER_CONFIRMATION={symbol:sym,updatedAt:Date.now(),direction:'WAIT',confidence:50,qualified:false,confirmations:0,autoTrading:false,indicatorStatus:{ema:false,fvg:false,rsi:false,vwap:false,volumeProfile:false,delta:false,divergence:false,candlePattern:false,orderFlow:false,liquidity:false,rangeLevels:false},feedStatus:window.RIZVI_FEED_STATUS};
 window.RIZVI_SIGNAL_DIRECTION='WAIT';
 window.dispatchEvent(new CustomEvent('rizvi:master-confirmation-update',{detail:window.RIZVI_MASTER_CONFIRMATION}));
}
async function poll(){
 if(busy){rerunRequested=true;return;}busy=true;
 const sym=symbol(),tf=timeframe(),key=sym+'|'+tf;
 if(key!==lastKey){window.RIZVI_FEED_STATUS={ok:null,symbol:sym,source:sym==='BTCUSD'?'Coinbase':'XAUS-OHLC',updatedAt:Date.now(),reason:'Loading fresh '+sym+' OHLC feed'};}
 function validateRows(rows,label){
  const bars=aggregate(normalize(rows),TF_SECONDS[tf]);
  if(bars.length<21)throw new Error(label+' history insufficient ('+bars.length+' bars)');
  const now=Math.floor(Date.now()/1000),latest=bars[bars.length-1],age=now-latest.t;
  if(age<0||age>Math.max(TF_SECONDS[tf]*3,180))throw new Error(label+' stale (latest bar age '+age+'s)');
  return {bars,latest};
 }
 try{
  if(sym==='UNSUPPORTED'){fail(sym,'No OHLC endpoint configured for this symbol');return;}
  let data=null,validated=null,primaryError='';
  if(sym==='BTCUSD'){
   const response=await fetch('/market/btc/intraday?granularity='+TF_SECONDS[tf],{cache:'no-store',credentials:'same-origin'});
   data=await response.json();
   if(!response.ok||!data?.ok||!Array.isArray(data.bars))throw new Error(data?.error||('HTTP '+response.status));
   validated=validateRows(data.bars,data.source||'Coinbase');
  }else{
   try{
    const response=await fetch('/market/xau/intraday',{cache:'no-store',credentials:'same-origin'});
    data=await response.json();
    if(!response.ok||!data?.ok||!Array.isArray(data.bars))throw new Error(data?.error||('HTTP '+response.status));
    validated=validateRows(data.bars,data.source||'XAUS-OHLC');
   }catch(e){
    primaryError=String(e?.message||e);
    // Use cTrader only when it is actually connected, authorized, and returns fresh real OHLC.
    // No spot-price fabrication: if neither provider has valid candles, keep signals at WAIT.
    const response=await fetch('/market/ctrader?symbol=XAUUSD',{cache:'no-store',credentials:'same-origin'});
    const backup=await response.json();
    if(!response.ok||!backup?.ok||backup.connected!==true||backup.authorized!==true||!Array.isArray(backup.bars)||!backup.bars.length){
     throw new Error('XAUS failed: '+primaryError+'; cTrader fallback unavailable'+(backup?.error?': '+backup.error:'')+' (connected='+!!backup?.connected+', authorized='+!!backup?.authorized+', bars='+(backup?.bars?.length||0)+')');
    }
    data=backup;
    try{validated=validateRows(backup.bars,'cTrader OHLC');}
    catch(e2){throw new Error('XAUS failed: '+primaryError+'; cTrader fallback failed: '+String(e2?.message||e2));}
   }
  }
  const bars=validated.bars,latest=validated.latest;
  window.RIZVI_DIRECT_SYMBOL=sym;window.RIZVI_CURRENT_SYMBOL=sym;
  window.RIZVI_RAW_BARS=bars;window.RIZVI_AGG_BARS=bars;
  window.RIZVI_FEED_STATUS={ok:true,symbol:sym,timeframe:tf,source:data.source||'backend OHLC',bars:bars.length,latestBarAt:latest.t,updatedAt:Date.now(),key};
  lastGoodAt=Date.now();lastKey=key;
  window.dispatchEvent(new CustomEvent('rizvi:ohlc-feed-update',{detail:window.RIZVI_FEED_STATUS}));
 }catch(e){fail(sym,String(e?.message||e));}
 finally{busy=false;if(rerunRequested){rerunRequested=false;setTimeout(poll,50);}}
}
function start(){poll();setInterval(poll,15000);const onSymbolChange=()=>setTimeout(poll,0);window.addEventListener('rizvi:symbol-change',onSymbolChange);document.addEventListener('rizvi:symbol-change',onSymbolChange);document.getElementById('symbolSelect')?.addEventListener('change',onSymbolChange);window.addEventListener('rizvi:direct-tv-status',onSymbolChange);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
/* Rizvi V5 OHLC-to-indicator bridge. Keeps the existing TradingView chart renderer untouched. */
(function(){
'use strict';
if(window.__RIZVI_OHLC_BRIDGE_V1)return;
window.__RIZVI_OHLC_BRIDGE_V1=true;
const TF_SECONDS={'1M':60,'5M':300,'15M':900,'30M':1800,'1H':3600,'1D':86400};
let busy=false,lastKey='',lastGoodAt=0;
function symbol(){
 const s=String(window.RIZVI_DIRECT_SYMBOL||window.RIZVI_CURRENT_SYMBOL||document.getElementById('symbolSelect')?.value||'XAUUSD').toUpperCase();
 return /^(XAU\/USD|XAUUSD|GOLD)$/.test(s)?'XAUUSD':s.replace(/[^A-Z0-9]/g,'')==='BTCUSD'?'BTCUSD':'UNSUPPORTED';
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
 window.RIZVI_FEED_STATUS={ok:false,symbol:sym,source:sym==='BTCUSD'?'Coinbase':'XAUS-OHLC',updatedAt:Date.now(),reason};
 window.RIZVI_RAW_BARS=[];window.RIZVI_AGG_BARS=[];
 window.RIZVI_MASTER_CONFIRMATION={symbol:sym,updatedAt:Date.now(),direction:'WAIT',confidence:50,qualified:false,confirmations:0,autoTrading:false,indicatorStatus:{ema:false,fvg:false,rsi:false,vwap:false,volumeProfile:false,delta:false,divergence:false,candlePattern:false,orderFlow:false,liquidity:false,rangeLevels:false},feedStatus:window.RIZVI_FEED_STATUS};
 window.dispatchEvent(new CustomEvent('rizvi:master-confirmation-update',{detail:window.RIZVI_MASTER_CONFIRMATION}));
}
async function poll(){
 if(busy)return;busy=true;
 const sym=symbol(),tf=timeframe(),key=sym+'|'+tf;
 try{
  if(sym==='UNSUPPORTED'){fail(sym,'No OHLC endpoint configured for this symbol');return;}
  const url=sym==='BTCUSD'?('/market/btc/intraday?granularity='+TF_SECONDS[tf]):'/market/xau/intraday';
  const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
  const data=await response.json();
  if(!response.ok||!data?.ok||!Array.isArray(data.bars))throw new Error(data?.error||('HTTP '+response.status));
  const base=normalize(data.bars),bars=aggregate(base,TF_SECONDS[tf]);
  const now=Math.floor(Date.now()/1000),fresh=bars.filter(b=>now-b.t<=Math.max(TF_SECONDS[tf]*3,180));
  if(fresh.length<21)throw new Error('Insufficient fresh OHLC bars: '+fresh.length);
  const latest=fresh[fresh.length-1];
  if(now-latest.t>Math.max(TF_SECONDS[tf]*3,180))throw new Error('OHLC feed is stale');
  window.RIZVI_DIRECT_SYMBOL=sym;window.RIZVI_CURRENT_SYMBOL=sym;
  window.RIZVI_RAW_BARS=fresh;window.RIZVI_AGG_BARS=fresh;
  window.RIZVI_FEED_STATUS={ok:true,symbol:sym,timeframe:tf,source:data.source||'backend OHLC',bars:fresh.length,latestBarAt:latest.t,updatedAt:Date.now(),key};
  lastGoodAt=Date.now();lastKey=key;
  window.dispatchEvent(new CustomEvent('rizvi:ohlc-feed-update',{detail:window.RIZVI_FEED_STATUS}));
 }catch(e){fail(sym,String(e?.message||e));}
 finally{busy=false;}
}
function start(){poll();setInterval(poll,15000);window.addEventListener('rizvi:symbol-change',()=>setTimeout(poll,0));document.getElementById('symbolSelect')?.addEventListener('change',()=>setTimeout(poll,0));window.addEventListener('rizvi:direct-tv-status',()=>setTimeout(poll,0));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
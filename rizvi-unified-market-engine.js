/* Rizvi V5 V126 — Unified Market Authority
   One canonical OHLC/price state for BTCUSD + XAU/USD.
   TradingView remains the visible chart source; all local engines consume this same canonical state.
   Legacy writers are ignored after this authority locks.
*/
(function(){
'use strict';
if(window.__RIZVI_UNIFIED_MARKET_AUTHORITY_V126)return;
window.__RIZVI_UNIFIED_MARKET_AUTHORITY_V126=true;
const TF={ '1M':60,'5M':300,'15M':900,'30M':1800,'1H':3600,'1D':86400 };
let bars=[],rawBars=[],price=null,priceMap={},updatedAt=null;
let locked=false,timer=null,requestId=0;

function symbol(){
 const s=String(window.RIZVI_CURRENT_SYMBOL||window.RIZVI_DIRECT_SYMBOL||document.getElementById('symbolSelect')?.value||'BTCUSD').toUpperCase();
 return (s==='XAUUSD'||s==='XAU/USD'||s==='GOLD'||s==='XAU')?'XAU/USD':'BTCUSD';
}
function tf(){const x=String(window.RIZVI_CANDLE_TIMEFRAME||'1M').toUpperCase();return TF[x]?x:'1M';}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function clean(a){
 const out=[],seen=new Map();
 for(const x of Array.isArray(a)?a:[]){
  const t=n(x.t??x.time??x.timestamp),o=n(x.o??x.open),h=n(x.h??x.high),l=n(x.l??x.low),c=n(x.c??x.close),v=n(x.v??x.volume)??0;
  if(!t||![o,h,l,c].every(Number.isFinite))continue;
  const b={time:t>1e12?Math.floor(t/1000):Math.floor(t),open:o,high:h,low:l,close:c,volume:v};
  seen.set(b.time,b);
 }
 return [...seen.values()].sort((a,b)=>a.time-b.time);
}
function aggregate(a,sec){
 if(sec===60)return a.slice();
 const out=[];
 for(const b of a){
  const t=Math.floor(b.time/sec)*sec, x=out.at(-1);
  if(!x||x.time!==t)out.push({time:t,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume});
  else{x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=(b.volume||0);}
 }
 return out;
}
function defineLocked(name,getter,setter){
 try{Object.defineProperty(window,name,{configurable:true,enumerable:false,get:getter,set:setter});}catch{}
}
function installGuards(){
 locked=true;
 defineLocked('RIZVI_RAW_BARS',()=>rawBars,v=>{if(!locked)rawBars=Array.isArray(v)?v:[];});
 defineLocked('RIZVI_AGG_BARS',()=>bars,v=>{if(!locked)bars=Array.isArray(v)?v:[];});
 defineLocked('RIZVI_LIVE_PRICE',()=>price,v=>{if(!locked&&Number.isFinite(Number(v)))price=Number(v);});
 defineLocked('RIZVI_LIVE_PRICES',()=>priceMap,v=>{if(!locked&&v&&typeof v==='object')priceMap=v;});
}
function publish(j){
 const s=symbol(), view=aggregate(rawBars,TF[tf()]||60);
 bars=view;price=n(j.price)??view.at(-1)?.close??null;updatedAt=n(j.updatedAt)??Date.now();
 priceMap={...(priceMap||{}),[s]:price};
 window.RIZVI_MARKET_AUTHORITY={version:'V126',owner:'UNIFIED_MARKET_AUTHORITY',symbol:s,timeframe:tf(),source:j.source||'unified',price,updatedAt,bars:view.length,live:true};
 window.dispatchEvent(new CustomEvent('rizvi:canonical-market-update',{detail:{symbol:s,timeframe:tf(),source:j.source||'unified',price,updatedAt,bars:view}}));
 window.dispatchEvent(new CustomEvent('rizvi:candle-update',{detail:view.at(-1)||null}));
 window.dispatchEvent(new CustomEvent('rizvi:price-update',{detail:{symbol:s,price,updatedAt}}));
 window.RIZVI_OPERATIONAL_STATUS=Object.assign({},window.RIZVI_OPERATIONAL_STATUS,{livePrice:Number.isFinite(price),candles:view.length>0,canonicalFeed:true,updatedAt});
}
async function load(){
 const my=++requestId,s=symbol(),t=tf();
 try{
  const r=await fetch('/market/unified?symbol='+encodeURIComponent(s)+'&tf='+encodeURIComponent(t)+'&fresh='+Date.now(),{cache:'no-store',credentials:'same-origin'});
  if(!r.ok)throw Error('unified feed HTTP '+r.status);
  const j=await r.json();
  if(my!==requestId||s!==symbol())return;
  if(!j.ok)throw Error(j.error||'unified feed unavailable');
  const rows=clean(j.bars);
  if(!rows.length)throw Error('unified feed returned no candles');
  rawBars=rows;publish(j);
  window.RIZVI_CANONICAL_FEED_STATUS={status:'LIVE',source:j.source||'unified',symbol:s,timeframe:t,updatedAt:updatedAt,bars:bars.length,error:null};
 }catch(e){
  if(my!==requestId)return;
  window.RIZVI_CANONICAL_FEED_STATUS={...(window.RIZVI_CANONICAL_FEED_STATUS||{}),status:'ERROR',symbol:s,timeframe:t,error:String(e.message||e),updatedAt:Date.now()};
  window.dispatchEvent(new CustomEvent('rizvi:canonical-market-error',{detail:window.RIZVI_CANONICAL_FEED_STATUS}));
 }
}
function boot(){
 installGuards();
 window.RIZVI_CANDLE_TIMEFRAME=window.RIZVI_CANDLE_TIMEFRAME||'1M';
 clearInterval(timer);load();timer=setInterval(load,5000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

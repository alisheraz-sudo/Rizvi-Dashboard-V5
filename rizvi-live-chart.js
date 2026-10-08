/* Rizvi V5 — deterministic live chart bridge V2
   Single visible Lightweight Charts owner.
   Canonical backend candles are loaded once; realtime refresh updates only
   the affected candle instead of replacing the whole series.
*/
(function(){
'use strict';
if(window.__RIZVI_LIVE_CHART_BRIDGE_V2)return;
window.__RIZVI_LIVE_CHART_BRIDGE_V2=true;

const TF={ '1M':60, '5M':300, '15M':900, '30M':1800, '1H':3600, '1D':86400 };
let chart=null, series=null, timer=null, loading=false;
let baseBars=[], activeTF='1M', chartSymbol=null, generation=0, lastRenderedKey='';
let resizeObserver=null;

function sym(){
 const raw=String(window.RIZVI_CURRENT_SYMBOL||document.getElementById('symbolSelect')?.value||'XAUUSD').toUpperCase().trim();
 if(raw==='XAUUSD'||raw==='XAU/USD'||raw==='GOLD'||raw==='XAU')return 'XAU/USD';
 if(raw==='BTCUSD'||raw==='BTC/USD'||raw==='BTC')return 'BTCUSD';
 return raw;
}
function host(){return document.getElementById('rizviTvChartV55')}
function normTime(v){let n=Number(v);if(!Number.isFinite(n))return null;if(n>1e12)n=Math.floor(n/1000);return Math.floor(n)}
function cleanBars(rows){
 const sorted=(Array.isArray(rows)?rows:[]).map(x=>({
  time:normTime(x.t??x.time??x.timestamp),
  open:Number(x.o??x.open),high:Number(x.h??x.high),
  low:Number(x.l??x.low),close:Number(x.c??x.close),
  volume:Number(x.v??x.volume??0)
 })).filter(x=>x.time&&[x.open,x.high,x.low,x.close].every(Number.isFinite))
   .sort((a,b)=>a.time-b.time);
 const out=[];
 for(const b of sorted){
  const prev=out[out.length-1];
  if(!prev||prev.time!==b.time)out.push(b);
  else out[out.length-1]=b;
 }
 return out;
}
function aggregate(rows,sec){
 if(sec===60)return rows.slice();
 const out=[];
 for(const b of rows){
  const t=Math.floor(b.time/sec)*sec;
  let x=out[out.length-1];
  if(!x||x.time!==t){
   x={time:t,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume||0};
   out.push(x);
  }else{
   x.high=Math.max(x.high,b.high);
   x.low=Math.min(x.low,b.low);
   x.close=b.close;
   x.volume+=(b.volume||0);
  }
 }
 return out;
}
function ensureChart(){
 const el=host(); if(!el||!window.LightweightCharts)return false;
 if(chart&&series)return true;
 el.innerHTML='';
 chart=LightweightCharts.createChart(el,{
  layout:{background:{color:'#031421'},textColor:'#9fb1c0'},
  grid:{vertLines:{color:'#0b2539'},horzLines:{color:'#0b2539'}},
  rightPriceScale:{borderColor:'#1d4666',autoScale:true},
  timeScale:{borderColor:'#1d4666',timeVisible:true,secondsVisible:false,shiftVisible:true},
  crosshair:{mode:1},
  handleScroll:true,handleScale:true
 });
 const opts={
  upColor:'#19d6c0',downColor:'#ff4755',
  borderUpColor:'#19d6c0',borderDownColor:'#ff4755',
  wickUpColor:'#19d6c0',wickDownColor:'#ff4755',
  priceLineVisible:true,priceLineWidth:1,priceLineColor:'#f0ca67',
  lastValueVisible:true
 };
 if(typeof chart.addCandlestickSeries==='function')series=chart.addCandlestickSeries(opts);
 else series=chart.addSeries(LightweightCharts.CandlestickSeries,opts);
 window.RIZVI_LIVE_CHART={owner:'BACKEND_LIVE_FEED_V2',status:'INITIALIZING',symbol:sym(),timeframe:activeTF,updatedAt:null,bars:0};
 resizeObserver=new ResizeObserver(()=>{try{chart.resize(el.clientWidth,el.clientHeight)}catch{}});
 resizeObserver.observe(el);
 return true;
}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v}
function fmt(v){return Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function updateUI(bars,price,updated){
 const s=sym(), p=Number(price??bars.at(-1)?.close);
 if(Number.isFinite(p)){setText('quotePrice',fmt(p));setText('chartClose',fmt(p));setText('chartPriceTag',fmt(p))}
 setText('quoteSymbol',s);
 const qlive=document.getElementById('quoteLive');
 if(qlive){qlive.textContent='● Live';qlive.className='green'}
 const clk=document.getElementById('liveClock');
 if(clk){
  const d=new Date(Number(updated)||Date.now());
  clk.innerHTML=d.toLocaleDateString('en-GB')+'<br>'+d.toLocaleTimeString('en-GB',{hour12:false});
 }
 const h=document.querySelector('.chart .head>div:first-child');
 if(h){const b=h.querySelector('b');if(b)b.textContent=activeTF.toLowerCase()}
}
function viewData(){return aggregate(baseBars,TF[activeTF]||60)}
function renderFull(view,fit){
 if(!series)return;
 series.setData(view.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
 const b=view.at(-1);
 lastRenderedKey=b?[b.time,b.open,b.high,b.low,b.close].join('|'):'';
 if(fit)try{chart.timeScale().fitContent()}catch{}
}
function updateLastOnly(view){
 if(!series||!view.length)return;
 const b=view.at(-1);
 const key=[b.time,b.open,b.high,b.low,b.close].join('|');
 if(key===lastRenderedKey)return;
 series.update({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close});
 lastRenderedKey=key;
}
async function fetchBars(){
 if(loading)return;
 loading=true;
 const myGen=++generation;
 const requestedSymbol=sym();
 try{
  const url=requestedSymbol==='XAU/USD'
   ?'/market/xau/intraday?fresh='+Date.now()
   :'/market/btc/intraday?granularity=60&fresh='+Date.now();
  const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});
  if(!r.ok)throw Error('feed HTTP '+r.status);
  const j=await r.json();
  if(myGen!==generation||requestedSymbol!==sym())return;
  if(!j.ok)throw Error(j.error||'feed unavailable');
  const rows=cleanBars(j.bars);
  if(!rows.length)throw Error('empty candle feed');

  const symbolChanged=chartSymbol!==requestedSymbol;
  baseBars=rows;
  chartSymbol=requestedSymbol;
  if(!ensureChart())throw Error('chart library unavailable');

  const view=viewData();
  if(!view.length)throw Error('empty chart view');

  if(symbolChanged||lastRenderedKey==='')renderFull(view,true);
  else updateLastOnly(view);

  const last=view.at(-1);
  const p=Number(j.price);
  const price=Number.isFinite(p)?p:Number(last?.close);
  updateUI(view,price,j.updatedAt||Date.now());

  window.RIZVI_CHART_STATUS={
   status:'LIVE',owner:'BACKEND_LIVE_FEED_V2',symbol:requestedSymbol,
   timeframe:activeTF,bars:view.length,updatedAt:Date.now(),source:j.source||'backend'
  };
  window.RIZVI_LIVE_FEED={
   source:j.source||'backend',symbol:requestedSymbol,price,
   updatedAt:Number(j.updatedAt)||Date.now(),stale:false
  };
  window.dispatchEvent(new CustomEvent('rizvi:chart-status',{detail:window.RIZVI_CHART_STATUS}));
  window.dispatchEvent(new CustomEvent('rizvi:candle-update',{detail:last}));
 }catch(e){
  if(myGen!==generation)return;
  window.RIZVI_CHART_STATUS={
   ...(window.RIZVI_CHART_STATUS||{}),status:'ERROR',
   owner:'BACKEND_LIVE_FEED_V2',error:e.message,updatedAt:Date.now()
  };
  window.dispatchEvent(new CustomEvent('rizvi:chart-status',{detail:window.RIZVI_CHART_STATUS}));
 }finally{
  if(myGen===generation)loading=false;
 }
}
function wireTF(){
 document.querySelectorAll('.tf span').forEach(el=>{
  el.addEventListener('click',()=>{
   const x=el.textContent.trim().toUpperCase();
   if(!TF[x])return;
   activeTF=x;
   document.querySelectorAll('.tf span').forEach(a=>a.classList.remove('sel'));
   el.classList.add('sel');
   if(baseBars.length&&series)renderFull(viewData(),true);
   fetchBars();
  });
 });
}
function wireSymbol(){
 const sel=document.getElementById('symbolSelect');
 const change=()=>{
  generation++;
  loading=false;
  baseBars=[];
  chartSymbol=null;
  lastRenderedKey='';
  if(series)series.setData([]);
  fetchBars();
 };
 if(sel)sel.addEventListener('change',change);
 window.addEventListener('rizvi:symbol-change',change);
}
function boot(){
 if(!host())return setTimeout(boot,300);
 wireTF();wireSymbol();ensureChart();fetchBars();
 clearInterval(timer);
 timer=setInterval(fetchBars,5000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
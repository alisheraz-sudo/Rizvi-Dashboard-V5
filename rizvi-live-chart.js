/* Rizvi V5 — deterministic live chart bridge V1
   Backend market endpoints are the sole data source.
   One visible Lightweight Charts owner; no legacy canvas/SVG writers.
*/
(function(){
'use strict';
if(window.__RIZVI_LIVE_CHART_BRIDGE_V1)return;
window.__RIZVI_LIVE_CHART_BRIDGE_V1=true;

const TF={ '1M':60, '5M':300, '15M':900, '30M':1800, '1H':3600, '2H':7200, '4H':14400, '1D':86400 };
let chart=null, series=null, timer=null, loading=false;
let baseBars=[], lastPrice=null, activeTF='1M';

function sym(){
 const raw=String(window.RIZVI_CURRENT_SYMBOL||document.getElementById('symbolSelect')?.value||'XAUUSD').toUpperCase().trim();
 if(raw==='XAUUSD'||raw==='XAU/USD'||raw==='GOLD'||raw==='XAU')return 'XAU/USD';
 if(raw==='BTCUSD'||raw==='BTC/USD'||raw==='BTC')return 'BTCUSD';
 return raw;
}
function host(){return document.getElementById('rizviTvChartV55')}
function normTime(v){let n=Number(v);if(!Number.isFinite(n))return null;if(n>1e12)n=Math.floor(n/1000);return Math.floor(n)}
function cleanBars(rows){
 return (Array.isArray(rows)?rows:[]).map(x=>({
  time:normTime(x.t??x.time??x.timestamp),
  open:Number(x.o??x.open),high:Number(x.h??x.high),
  low:Number(x.l??x.low),close:Number(x.c??x.close),
  volume:Number(x.v??x.volume??0)
 })).filter(x=>x.time&&[x.open,x.high,x.low,x.close].every(Number.isFinite))
 .sort((a,b)=>a.time-b.time)
 .filter((x,i,a)=>i===0||x.time!==a[i-1].time);
}
function aggregate(rows,sec){
 if(sec===60)return rows.slice();
 const out=[];
 for(const b of rows){
  const t=Math.floor(b.time/sec)*sec;
  let x=out[out.length-1];
  if(!x||x.time!==t)x={time:t,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume||0};
  else{x.high=Math.max(x.high,b.high);x.low=Math.min(x.low,b.low);x.close=b.close;x.volume+=(b.volume||0)}
  if(!x||x===out[out.length-1]){if(out[out.length-1]!==x)out.push(x)}
  else out.push(x);
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
  rightPriceScale:{borderColor:'#1d4666'},
  timeScale:{borderColor:'#1d4666',timeVisible:true,secondsVisible:false},
  crosshair:{mode:1},
  handleScroll:true,handleScale:true
 });
 const opts={upColor:'#19d6c0',downColor:'#ff4755',borderUpColor:'#19d6c0',borderDownColor:'#ff4755',wickUpColor:'#19d6c0',wickDownColor:'#ff4755'};
 if(typeof chart.addCandlestickSeries==='function')series=chart.addCandlestickSeries(opts);
 else series=chart.addSeries(LightweightCharts.CandlestickSeries,opts);
 window.RIZVI_LIVE_CHART={owner:'BACKEND_LIVE_FEED_V1',status:'INITIALIZING',symbol:sym(),timeframe:activeTF,updatedAt:null,bars:0};
 new ResizeObserver(()=>{try{chart.resize(el.clientWidth,el.clientHeight)}catch{}}).observe(el);
 return true;
}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v}
function fmt(v){return Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function updateUI(bars,price,updated){
 const s=sym(), p=Number(price??bars.at(-1)?.close);
 if(Number.isFinite(p)){lastPrice=p;setText('quotePrice',fmt(p));setText('chartClose',fmt(p));setText('chartPriceTag',fmt(p))}
 setText('quoteSymbol',s);
 const qlive=document.getElementById('quoteLive');if(qlive){qlive.textContent='● Live';qlive.className='green'}
 const clk=document.getElementById('liveClock');if(clk){const d=new Date(Number(updated)||Date.now());clk.innerHTML=d.toLocaleDateString('en-GB')+'<br>'+d.toLocaleTimeString('en-GB',{hour12:false})}
 const h=document.querySelector('.chart .head>div:first-child');
 if(h){const b=h.querySelector('b');if(b)b.textContent=activeTF.toLowerCase()}
}
async function fetchBars(){
 if(loading)return; loading=true;
 try{
  const s=sym(), url=s==='XAU/USD'?'/market/xau/intraday?fresh='+Date.now():'/market/btc/intraday?granularity=60&fresh='+Date.now();
  const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});
  if(!r.ok)throw Error('feed HTTP '+r.status);
  const j=await r.json(); if(!j.ok)throw Error(j.error||'feed unavailable');
  const rows=cleanBars(j.bars); if(!rows.length)throw Error('empty candle feed');
  baseBars=rows;
  if(!ensureChart())throw Error('chart library unavailable');
  const view=aggregate(baseBars,TF[activeTF]||60);
  series.setData(view.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));
  if(Number.isFinite(Number(j.price)))lastPrice=Number(j.price);
  else if(Number.isFinite(view.at(-1)?.close))lastPrice=view.at(-1).close;
  updateUI(view,lastPrice,j.updatedAt||Date.now());
  window.RIZVI_CHART_STATUS={status:'LIVE',owner:'BACKEND_LIVE_FEED_V1',symbol:s,timeframe:activeTF,bars:view.length,updatedAt:Date.now(),source:j.source||'backend'};
  window.RIZVI_LIVE_FEED={source:j.source||'backend',symbol:s,price:lastPrice,updatedAt:Date.now(),stale:false};
  window.dispatchEvent(new CustomEvent('rizvi:chart-status',{detail:window.RIZVI_CHART_STATUS}));
  window.dispatchEvent(new CustomEvent('rizvi:candle-update',{detail:view.at(-1)}));
 }catch(e){
  window.RIZVI_CHART_STATUS={...(window.RIZVI_CHART_STATUS||{}),status:'ERROR',owner:'BACKEND_LIVE_FEED_V1',error:e.message,updatedAt:Date.now()};
  window.dispatchEvent(new CustomEvent('rizvi:chart-status',{detail:window.RIZVI_CHART_STATUS}));
 }finally{loading=false}
}
function wireTF(){
 document.querySelectorAll('.tf span').forEach(el=>{
  el.addEventListener('click',()=>{
   const x=el.textContent.trim().toUpperCase(); if(!TF[x])return;
   activeTF=x;document.querySelectorAll('.tf span').forEach(a=>a.classList.remove('sel'));el.classList.add('sel');
   if(baseBars.length&&series){const view=aggregate(baseBars,TF[activeTF]);series.setData(view.map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close})));try{chart.timeScale().fitContent()}catch{}}
   fetchBars();
  });
 });
}
function wireSymbol(){
 const sel=document.getElementById('symbolSelect');
 if(sel)sel.addEventListener('change',()=>{setTimeout(()=>{baseBars=[];fetchBars()},50)});
 window.addEventListener('rizvi:symbol-change',()=>setTimeout(()=>{baseBars=[];fetchBars()},50));
}
function boot(){
 if(!host())return setTimeout(boot,300);
 wireTF();wireSymbol();ensureChart();fetchBars();
 clearInterval(timer);timer=setInterval(fetchBars,5000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
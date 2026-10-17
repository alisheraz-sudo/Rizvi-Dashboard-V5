/* Rizvi Dashboard V5 — TradingView Lightweight Charts renderer.
   Uses the dashboard's existing live OHLC globals/events. TRB levels use the
   same candlestick series price scale via priceToCoordinate(), never a guessed scale.
   Signal-only: Auto Trading stays OFF; this file does not change Engine 5 logic.
*/
(function(){
'use strict';
if(window.__RIZVI_DIRECT_TV_SOURCE_V3)return;
window.__RIZVI_DIRECT_TV_SOURCE_V3=true;
const TF={'1M':1,'5M':5,'15M':15,'30M':30,'1H':60,'1D':1440};
let currentTF='1M',chartApi=null,candleSeries=null,overlay=null,overlayCtx=null,root=null,host=null,lastBars=[],resizeObserver=null,booted=false,fitNext=true;
const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'--';
function activeSymbol(){return String(window.RIZVI_CURRENT_SYMBOL||window.RIZVI_DIRECT_SYMBOL||'XAU/USD').trim().toUpperCase();}
function getHost(){return document.querySelector('.chart');}
function ensureUI(){
 host=getHost();if(!host)return false;
 host.style.position='relative';host.style.overflow='hidden';
 let head=document.getElementById('rizviChartToolbar')||host.querySelector('.head');
 if(!head){
  head=document.createElement('div');head.id='rizviChartToolbar';head.className='head';
  head.style.cssText='position:absolute;left:0;right:0;top:0;height:47px;z-index:30;display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#031421;border-bottom:1px solid #173650;color:#dce8ef;font:12px Arial,sans-serif;';
  const label=document.createElement('div');label.id='rizviChartSymbolLabel';label.style.cssText='font-weight:800;white-space:nowrap;';head.appendChild(label);
  const bar=document.createElement('div');bar.id='rizviChartTimeframes';bar.style.cssText='display:flex;align-items:center;gap:9px;';
  [['1M','1m'],['5M','5m'],['15M','15m'],['30M','30m'],['1H','1h'],['1D','1d']].forEach(([v,t])=>{const b=document.createElement('button');b.type='button';b.dataset.tf=v;b.textContent=t;b.style.cssText='border:0;background:transparent;color:#91a9ba;padding:8px 4px;font:700 12px Arial,sans-serif;cursor:pointer;';b.addEventListener('click',()=>setTf(v));bar.appendChild(b);});
  head.appendChild(bar);host.insertBefore(head,host.firstChild);
 }
 root=document.getElementById('rizviTvChartV55');
 if(!root){root=document.createElement('div');root.id='rizviTvChartV55';host.appendChild(root);}
 if(!root.parentElement||root.parentElement!==host)host.appendChild(root);
 root.style.cssText='position:absolute!important;left:0!important;right:0!important;top:47px!important;bottom:0!important;width:100%!important;height:calc(100% - 47px)!important;z-index:4!important;background:#031421!important;';
 let old=document.getElementById('rizviLevelsCanvasV67');if(old)old.style.setProperty('display','none','important');
 return true;
}
function setHeader(){
 const label=document.getElementById('rizviChartSymbolLabel');if(label)label.textContent=activeSymbol()+' · '+({ '1M':'1m','5M':'5m','15M':'15m','30M':'30m','1H':'1h','1D':'1d'}[currentTF]||'1m');
 document.querySelectorAll('#rizviChartTimeframes button').forEach(b=>{const on=b.dataset.tf===currentTF;b.style.color=on?'#fff':'#91a9ba';b.style.borderBottom=on?'2px solid #1689ff':'2px solid transparent';});
}
function chartLib(){return window.LightweightCharts||null;}
function createChart(){
 if(!root||!chartLib())return false;
 if(chartApi){try{chartApi.remove();}catch(e){}}
 root.innerHTML='';
 const L=chartLib();
 chartApi=L.createChart(root,{autoSize:true,layout:{background:{type:'solid',color:'#031421'},textColor:'#9db0c0',fontFamily:'Arial'},grid:{vertLines:{color:'rgba(31,55,77,.35)'},horzLines:{color:'rgba(31,55,77,.35)'}},rightPriceScale:{borderColor:'#23445b',scaleMargins:{top:.08,bottom:.08}},timeScale:{borderColor:'#23445b',timeVisible:true,secondsVisible:false,rightOffset:4},crosshair:{vertLine:{color:'#5b7e98'},horzLine:{color:'#5b7e98'}}});
 const opts={upColor:'#19d6c0',downColor:'#ff4755',borderUpColor:'#19d6c0',borderDownColor:'#ff4755',wickUpColor:'#19d6c0',wickDownColor:'#ff4755',priceLineVisible:true,lastValueVisible:true};
 if(typeof chartApi.addCandlestickSeries==='function')candleSeries=chartApi.addCandlestickSeries(opts);
 else if(typeof chartApi.addSeries==='function'&&L.CandlestickSeries)candleSeries=chartApi.addSeries(L.CandlestickSeries,opts);
 else {root.innerHTML='<div style="padding:18px;color:#ff6b78">Chart library API unavailable</div>';return false;}
 overlay=document.createElement('canvas');overlay.id='rizviTrbCoordinateOverlay';overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:12;pointer-events:none;';root.appendChild(overlay);overlayCtx=overlay.getContext('2d');
 chartApi.timeScale().subscribeVisibleTimeRangeChange(drawTRB);
 chartApi.subscribeCrosshairMove(drawTRB);
 if(resizeObserver)resizeObserver.disconnect();
 if(window.ResizeObserver){resizeObserver=new ResizeObserver(()=>{resizeCanvas();drawTRB();});resizeObserver.observe(root);}
 setHeader();window.RIZVI_DIRECT_TV={source:'TradingView Lightweight Charts + Rizvi live OHLC',symbol:activeSymbol(),timeframe:currentTF,status:'READY_FOR_FEED',updatedAt:Date.now()};
 window.dispatchEvent(new CustomEvent('rizvi:direct-tv-status',{detail:window.RIZVI_DIRECT_TV}));
 return true;
}
function normalTime(v){
 let n=typeof v==='number'?v:Number(v);
 if(!Number.isFinite(n))n=Date.parse(v);
 if(!Number.isFinite(n))return null;
 if(n>1e12)n=Math.floor(n/1000);
 return Math.floor(n);
}
function normalizeBars(input){
 if(!Array.isArray(input))return [];
 return input.map(b=>{
  if(Array.isArray(b))return {time:normalTime(b[0]),open:+b[1],high:+b[2],low:+b[3],close:+b[4]};
  return {time:normalTime(b.t??b.time??b.timestamp??b.ts),open:+(b.o??b.open),high:+(b.h??b.high),low:+(b.l??b.low),close:+(b.c??b.close)};
 }).filter(b=>Number.isFinite(b.time)&&[b.open,b.high,b.low,b.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time).filter((b,i,a)=>i===0||b.time>a[i-1].time);
}
function sourceBars(){
 const symbol=activeSymbol();
 const normalized=symbol==='XAUUSD'||symbol==='GOLD'?'XAU/USD':symbol;
 const candidates=[window.RIZVI_AGG_BARS,window.RIZVI_RAW_BARS,window.RIZVI_CANDLES,window.RIZVI_OHLC,window.RIZVI_CHART_DATA?.[normalized]?.bars,window.RIZVI_CHART_DATA?.[symbol]?.bars,window.RIZVI_RAW_BARS_BY_SYMBOL?.[normalized],window.RIZVI_RAW_BARS_BY_SYMBOL?.[symbol],window.RIZVI_CHART_DATA?.bars];
 for(const x of candidates){const n=normalizeBars(Array.isArray(x)?x:x?.bars);if(n.length)return n;}
 return [];
}
function aggregateBars(raw,label){
 const m=TF[label]||1;if(m===1)return raw;
 const out=[];let bucket=null;
 raw.forEach(b=>{const start=Math.floor(b.time/(m*60))*(m*60);if(!bucket||bucket.time!==start){bucket={time:start,open:b.open,high:b.high,low:b.low,close:b.close};out.push(bucket);}else{bucket.high=Math.max(bucket.high,b.high);bucket.low=Math.min(bucket.low,b.low);bucket.close=b.close;}});
 return out;
}
function refreshBars(incoming){
 if(!candleSeries)return;
 const raw=normalizeBars(incoming||sourceBars()),data=aggregateBars(raw,currentTF);
 if(!data.length){
  window.RIZVI_DIRECT_TV={source:'TradingView Lightweight Charts + Rizvi live OHLC',symbol:activeSymbol(),timeframe:currentTF,status:'WAITING_FOR_LIVE_OHLC',bars:0,updatedAt:Date.now()};
  window.dispatchEvent(new CustomEvent('rizvi:direct-tv-status',{detail:window.RIZVI_DIRECT_TV}));return;
 }
 lastBars=data;
 try{candleSeries.setData(data);if(fitNext){chartApi.timeScale().fitContent();fitNext=false;}}catch(e){return;}
 const sym=activeSymbol(),isGold=['XAU/USD','XAUUSD','GOLD'].includes(sym);
 const price=Number(isGold?(window.RIZVI_LIVE_PRICES?.['XAU/USD']??window.RIZVI_GOLD_FEED?.price??window.RIZVI_LIVE_PRICE):window.RIZVI_LIVE_PRICES?.[sym]??window.RIZVI_LIVE_PRICE);
 if(Number.isFinite(price)&&price>0){try{candleSeries.update({time:data[data.length-1].time,open:data[data.length-1].open,high:Math.max(data[data.length-1].high,price),low:Math.min(data[data.length-1].low,price),close:price});}catch(e){}}
 window.RIZVI_DIRECT_TV={source:'TradingView Lightweight Charts + Rizvi live OHLC',symbol:activeSymbol(),timeframe:currentTF,status:'LIVE_OHLC_RENDERED',bars:data.length,lastBarTime:data[data.length-1].time,updatedAt:Date.now()};
 window.dispatchEvent(new CustomEvent('rizvi:direct-tv-status',{detail:window.RIZVI_DIRECT_TV}));resizeCanvas();drawTRB();
}
function resizeCanvas(){
 if(!overlay||!root)return;const r=root.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,2);
 overlay.width=Math.max(1,Math.round(r.width*d));overlay.height=Math.max(1,Math.round(r.height*d));
 overlay.style.width=r.width+'px';overlay.style.height=r.height+'px';overlayCtx.setTransform(d,0,0,d,0,0);
}
function drawTRB(){
 if(!overlayCtx||!overlay||!root||!candleSeries)return;
 const r=root.getBoundingClientRect(),W=r.width,H=r.height,d=Math.min(window.devicePixelRatio||1,2);
 if(overlay.width!==Math.round(W*d)||overlay.height!==Math.round(H*d))resizeCanvas();
 const ctx=overlayCtx;ctx.clearRect(0,0,W,H);
 const lv=window.RIZVI_TRADE_RANGE||window.RIZVI_SIGNAL_LEVELS_STATE;
 const decision=window.RIZVI_MASTER_CONFIRMATION||{};
 const direction=String(decision.direction||lv?.direction||'WAIT').toUpperCase();
 const scoreRaw=decision.confidence!==null&&decision.confidence!==undefined&&String(decision.confidence).trim()!==''?decision.confidence:lv?.score;
 const score=Number(scoreRaw);
 if(!lv||!['BUY','SELL'].includes(direction)||direction!==String(lv.direction||'').toUpperCase()||!Number.isFinite(score)||score<70)return;
 const vals=[lv.entry,lv.sl,lv.tp1,lv.tp2,lv.tp3].map(Number);
 if(!vals.every(Number.isFinite))return;
 const ys=vals.map(v=>candleSeries.priceToCoordinate(v));if(!ys.every(Number.isFinite))return;
 const boxW=Math.min(104,Math.max(82,W*.22)),rightPad=76,x=Math.max(8,Math.min(W-rightPad-boxW-8,W*.66)),right=x+boxW;
 const [entryY,slY,tp1Y,tp2Y,tp3Y]=ys;
 const top=Math.max(2,Math.min(entryY,tp3Y)),tpH=Math.max(2,Math.abs(entryY-tp3Y)),slTop=Math.min(entryY,slY),slH=Math.max(2,Math.abs(entryY-slY));
 ctx.save();ctx.fillStyle='rgba(0,190,115,.14)';ctx.fillRect(x,top,boxW,tpH);ctx.strokeStyle=direction==='BUY'?'rgba(0,217,145,.95)':'rgba(255,76,96,.95)';ctx.lineWidth=1.5;ctx.strokeRect(x,top,boxW,tpH);ctx.fillStyle='rgba(142,52,176,.20)';ctx.fillRect(x,slTop,boxW,slH);ctx.strokeStyle='rgba(142,52,176,.98)';ctx.lineWidth=1;ctx.strokeRect(x,slTop,boxW,slH);
 const items=[['ENTRY',vals[0],entryY,'#35bde9'],['SL',vals[1],slY,'#c58af0'],['TP1',vals[2],tp1Y,'#25d99a'],['TP2',vals[3],tp2Y,'#25d99a'],['TP3',vals[4],tp3Y,'#25d99a']];
 ctx.font='bold 11px Arial,sans-serif';ctx.lineWidth=1;
 items.forEach(([name,value,y,color])=>{ctx.strokeStyle=color;ctx.setLineDash(name==='ENTRY'||name==='SL'?[]:[4,3]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(right,y);ctx.stroke();ctx.setLineDash([]);const label=name+' '+fmt(value),tw=ctx.measureText(label).width,ly=Math.max(13,Math.min(H-6,y-4)),lx=Math.max(4,x-tw-7);ctx.fillStyle='rgba(3,16,28,.94)';ctx.fillRect(lx-3,ly-10,tw+6,13);ctx.fillStyle=color;ctx.fillText(label,lx,ly);});
 ctx.restore();
}
function setTf(label){
 label=String(label||'').toUpperCase();if(!TF[label])return;currentTF=label;window.RIZVI_CANDLE_TIMEFRAME=label;setHeader();
 fitNext=true;if(createChart())refreshBars(sourceBars());
 window.dispatchEvent(new CustomEvent('rizvi:timeframe-update',{detail:{timeframe:currentTF,symbol:activeSymbol()}}));
}
function wire(){
 const sel=document.getElementById('symbolSelect');if(sel)sel.addEventListener('change',()=>{window.RIZVI_DIRECT_SYMBOL=sel.value;setHeader();refreshBars(sourceBars());});
 window.addEventListener('rizvi:symbol-change',e=>{if(e.detail?.symbol)window.RIZVI_DIRECT_SYMBOL=e.detail.symbol;fitNext=true;setHeader();refreshBars(sourceBars());});
 window.addEventListener('rizvi:candle-update',e=>refreshBars(Array.isArray(e.detail?.bars)?e.detail.bars:sourceBars()));
 window.addEventListener('rizvi:chart-source',e=>refreshBars(Array.isArray(e.detail?.bars)?e.detail.bars:sourceBars()));
 window.addEventListener('rizvi:timeframe-update',()=>refreshBars(sourceBars()));
 window.addEventListener('rizvi:price-update',e=>{
  if(e.detail?.symbol&&String(e.detail.symbol).toUpperCase()!==activeSymbol())return;
  const p=Number(e.detail?.price),last=lastBars[lastBars.length-1];if(!candleSeries||!last||!Number.isFinite(p))return;
  try{candleSeries.update({time:last.time,open:last.open,high:Math.max(last.high,p),low:Math.min(last.low,p),close:p});}catch(err){}
  drawTRB();
 });
 window.addEventListener('rizvi:master-confirmation-update',drawTRB);
 window.addEventListener('rizvi:signal-levels-update',drawTRB);
 window.addEventListener('resize',()=>{resizeCanvas();drawTRB();});
 document.querySelectorAll('.tf span').forEach(x=>x.addEventListener('click',()=>setTf(x.textContent.trim().toUpperCase())));
}
function boot(){
 if(booted)return;if(!ensureUI()||!chartLib()){setTimeout(boot,250);return;}booted=true;
 currentTF=TF[String(window.RIZVI_CANDLE_TIMEFRAME||'1M').toUpperCase()]?String(window.RIZVI_CANDLE_TIMEFRAME||'1M').toUpperCase():'1M';
 createChart();wire();refreshBars(sourceBars());
 window.RIZVI_DIRECT_TV={source:'TradingView Lightweight Charts + Rizvi live OHLC',symbol:activeSymbol(),timeframe:currentTF,status:'INITIALIZED',updatedAt:Date.now()};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

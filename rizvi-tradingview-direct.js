/* Rizvi V5 — direct TradingView Advanced Chart source.
   This chart is owned by TradingView's official embeddable Advanced Chart widget.
   No local candle renderer/feed writes into the chart.
*/
(function(){
'use strict';
if(window.__RIZVI_DIRECT_TV_SOURCE)return;
window.__RIZVI_DIRECT_TV_SOURCE=true;

const MAP={
  'XAU/USD':'OANDA:XAUUSD',
  'XAUUSD':'OANDA:XAUUSD',
  'BTCUSD':'COINBASE:BTCUSD'
};
const TF={'1M':'1','5M':'5','15M':'15','30M':'30','1H':'60','1D':'D'};
let currentSymbol='', currentTF='1M', rebuildTimer=null;

function host(){return document.getElementById('rizviTvChartV55')}
function selectedSymbol(){
 const raw=String(window.RIZVI_CURRENT_SYMBOL||document.getElementById('symbolSelect')?.value||'BTCUSD').toUpperCase();
 return MAP[raw]?raw:'BTCUSD';
}
function interval(){
 const tf=String(window.RIZVI_CANDLE_TIMEFRAME||currentTF||'1M').toUpperCase();
 return TF[tf]||'1';
}
function tvSymbol(){return MAP[selectedSymbol()]||MAP.BTCUSD}

function setHeader(tf,symbol){
 const head=document.querySelector('.chart .head>div:first-child');
 if(head){
  const b=head.querySelector('b'); if(b)b.textContent=tf.toLowerCase();
  const text=head.firstChild; if(text)text.textContent=selectedSymbol()+' · ';
 }
 const qs=document.getElementById('quoteSymbol'); if(qs)qs.textContent=selectedSymbol();
}
function build(){
 const el=host(); if(!el)return;
 const s=selectedSymbol(), tf=String(window.RIZVI_CANDLE_TIMEFRAME||currentTF||'1M').toUpperCase();
 currentSymbol=s;currentTF=tf;setHeader(tf,s);
 el.innerHTML='';
 const wrap=document.createElement('div');
 wrap.className='tradingview-widget-container';
 wrap.style.cssText='height:100%;width:100%;position:absolute;inset:0;';
 const widget=document.createElement('div');
 widget.className='tradingview-widget-container__widget';
 widget.style.cssText='height:100%;width:100%;';
 wrap.appendChild(widget);
 const script=document.createElement('script');
 script.type='text/javascript';
 script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
 script.async=true;
 script.text=JSON.stringify({
   autosize:true,
   width:'100%',height:'100%',
   symbol:tvSymbol(),
   interval:TF[tf]||'1',
   timezone:'Asia/Karachi',
   theme:'dark',
   style:'1',
   locale:'en',
   allow_symbol_change:true,
   withdateranges:true,
   hide_top_toolbar:false,
   hide_side_toolbar:false,
   hide_legend:false,
   hide_volume:false,
   details:false,
   hotlist:false,
   calendar:false,
   save_image:false,
   enable_publishing:false,
   backgroundColor:'#031421',
   gridColor:'rgba(31,55,77,0.35)',
   studies:[],
   support_host:'https://www.tradingview.com'
 });
 wrap.appendChild(script);
 el.appendChild(wrap);
 window.RIZVI_DIRECT_TV={
   source:'TradingView Advanced Chart Widget',
   symbol:s,
   tradingViewSymbol:tvSymbol(),
   timeframe:tf,
   interval:TF[tf]||'1',
   timezone:'Asia/Karachi',
   status:'LOADING',
   updatedAt:Date.now()
 };
 window.dispatchEvent(new CustomEvent('rizvi:direct-tv-status',{detail:window.RIZVI_DIRECT_TV}));
}
function setTf(tf){
 tf=String(tf||'').toUpperCase();
 if(!TF[tf])return;
 currentTF=tf;
 window.RIZVI_CANDLE_TIMEFRAME=tf;
 document.querySelectorAll('.tf span').forEach(x=>x.classList.toggle('sel',x.textContent.trim().toUpperCase()===tf));
 build();
}
function wire(){
 const sel=document.getElementById('symbolSelect');
 if(sel)sel.addEventListener('change',()=>{
   window.RIZVI_CURRENT_SYMBOL=sel.value;
   build();
 });
 document.querySelectorAll('.tf span').forEach(x=>{
   x.addEventListener('click',()=>setTf(x.textContent.trim()));
 });
 window.addEventListener('rizvi:symbol-change',build);
}
function boot(){
 const el=host();
 if(!el)return setTimeout(boot,300);
 wire();
 setTf(String(window.RIZVI_CANDLE_TIMEFRAME||'1M'));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
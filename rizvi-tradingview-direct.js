/* Rizvi V5 — repaired direct TradingView chart source.
   Single visible chart owner: TradingView Advanced Chart widget.
   Auto-trading remains OFF; this file only renders market charts.
*/
(function(){
'use strict';
if(window.__RIZVI_DIRECT_TV_SOURCE_V2)return;
window.__RIZVI_DIRECT_TV_SOURCE_V2=true;

const MAP={'XAU/USD':'OANDA:XAUUSD','XAUUSD':'OANDA:XAUUSD','GOLD':'OANDA:XAUUSD','BTCUSD':'COINBASE:BTCUSD'};
const TF={'1M':'1','5M':'5','15M':'15','30M':'30','1H':'60','1D':'D'};
let currentTF='1M', wired=false, buildSeq=0;

function chart(){return document.querySelector('.chart');}
function ensureUI(){
 const c=chart(); if(!c)return null;
 c.style.position='relative'; c.style.overflow='hidden';
 let head=c.querySelector('.head');
 if(!head){
   head=document.createElement('div'); head.className='head'; head.id='rizviChartToolbar';
   head.style.cssText='position:absolute;left:0;right:0;top:0;height:47px;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#031421;border-bottom:1px solid #173650;color:#dce8ef;font:12px Arial,sans-serif;';
   const label=document.createElement('div'); label.id='rizviChartSymbolLabel';
   label.style.cssText='font-weight:800;white-space:nowrap;';
   head.appendChild(label);
   const tfbar=document.createElement('div'); tfbar.className='tf'; tfbar.id='rizviChartTimeframes';
   tfbar.style.cssText='display:flex;align-items:center;gap:9px;';
   [['1M','1m'],['5M','5m'],['15M','15m'],['30M','30m'],['1H','1h'],['1D','1d']].forEach(([value,labelText])=>{
     const b=document.createElement('button'); b.type='button'; b.dataset.tf=value; b.textContent=labelText;
     b.style.cssText='border:0;background:transparent;color:#91a9ba;padding:8px 4px;font:700 12px Arial,sans-serif;cursor:pointer;';
     b.addEventListener('click',()=>setTf(value));
     tfbar.appendChild(b);
   });
   head.appendChild(tfbar); c.insertBefore(head,c.firstChild);
 }
 let el=document.getElementById('rizviTvChartV55');
 if(!el){
   el=document.createElement('div');el.id='rizviTvChartV55';
   el.style.cssText='position:absolute;left:0;right:0;top:47px;bottom:0;width:100%;height:calc(100% - 47px);z-index:4;background:#031421;';
   c.appendChild(el);
 } else {
   el.style.cssText='position:absolute;left:0;right:0;top:47px;bottom:0;width:100%;height:calc(100% - 47px);z-index:4;background:#031421;';
 }
 return el;
}
function selectedSymbol(){
 const raw=String(window.RIZVI_DIRECT_SYMBOL||window.RIZVI_CURRENT_SYMBOL||document.getElementById('symbolSelect')?.value||'XAUUSD').trim().toUpperCase();
 return raw||'BTCUSD';
}
function tvSymbol(){const raw=selectedSymbol();return MAP[raw]||raw;}
function setHeader(tf){
 const label=document.getElementById('rizviChartSymbolLabel');
 if(label)label.textContent=selectedSymbol()+'  ·  '+({'1M':'1m','5M':'5m','15M':'15m','30M':'30m','1H':'1h','1D':'1d'}[tf]||'1m');
 document.querySelectorAll('#rizviChartTimeframes button').forEach(b=>{
   const active=b.dataset.tf===tf;b.style.color=active?'#ffffff':'#91a9ba';b.style.borderBottom=active?'2px solid #1689ff':'2px solid transparent';
 });
 const qs=document.getElementById('quoteSymbol');if(qs)qs.textContent=selectedSymbol();
}
function build(){
 const el=ensureUI();if(!el)return;
 const s=selectedSymbol(),tf=String(window.RIZVI_CANDLE_TIMEFRAME||currentTF||'1M').toUpperCase();
 currentTF=TF[tf]?tf:'1M';window.RIZVI_CANDLE_TIMEFRAME=currentTF;setHeader(currentTF);
 const seq=++buildSeq;el.innerHTML='';
 el.style.setProperty('position','absolute','important');el.style.setProperty('left','0','important');el.style.setProperty('right','0','important');el.style.setProperty('top','47px','important');el.style.setProperty('bottom','0','important');el.style.setProperty('width','100%','important');el.style.setProperty('height','calc(100% - 47px)','important');el.style.setProperty('z-index','4','important');
 const wrap=document.createElement('div');wrap.className='tradingview-widget-container';
 wrap.style.cssText='position:absolute;inset:0;width:100%;height:100%;';
 const widget=document.createElement('div');widget.className='tradingview-widget-container__widget';
 widget.style.cssText='width:100%;height:100%;';wrap.appendChild(widget);
 const script=document.createElement('script');script.type='text/javascript';script.async=true;
 script.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
 script.text=JSON.stringify({
   autosize:true,width:'100%',height:'100%',symbol:tvSymbol(),interval:TF[currentTF],
   timezone:'Asia/Karachi',theme:'dark',style:'1',locale:'en',allow_symbol_change:true,
   withdateranges:true,hide_top_toolbar:false,hide_side_toolbar:false,hide_legend:false,
   hide_volume:false,details:false,hotlist:false,calendar:false,save_image:false,
   enable_publishing:false,backgroundColor:'#031421',gridColor:'rgba(31,55,77,0.35)',
   studies:[],support_host:'https://www.tradingview.com'
 });
 script.onerror=()=>{if(seq===buildSeq){window.RIZVI_DIRECT_TV={source:'TradingView Advanced Chart Widget',symbol:s,tradingViewSymbol:tvSymbol(),timeframe:currentTF,status:'ERROR_LOADING_WIDGET',updatedAt:Date.now()};window.dispatchEvent(new CustomEvent('rizvi:direct-tv-status',{detail:window.RIZVI_DIRECT_TV}));}};
 el.appendChild(wrap);wrap.appendChild(script);
 window.RIZVI_DIRECT_TV={source:'TradingView Advanced Chart Widget',symbol:s,tradingViewSymbol:tvSymbol(),timeframe:currentTF,interval:TF[currentTF],timezone:'Asia/Karachi',status:'LOADING',updatedAt:Date.now()};
 window.dispatchEvent(new CustomEvent('rizvi:direct-tv-status',{detail:window.RIZVI_DIRECT_TV}));
}
function setTf(tf){
 tf=String(tf||'').toUpperCase();if(!TF[tf])return;
 currentTF=tf;window.RIZVI_CANDLE_TIMEFRAME=tf;setHeader(tf);build();
}
function wire(){
 if(wired)return;wired=true;
 const sel=document.getElementById('symbolSelect');
 if(sel)sel.addEventListener('change',()=>{window.RIZVI_DIRECT_SYMBOL=sel.value;build();});
 window.addEventListener('rizvi:symbol-change',e=>{if(e.detail?.symbol)window.RIZVI_DIRECT_SYMBOL=e.detail.symbol;build();});
 document.querySelectorAll('.tf span').forEach(x=>x.addEventListener('click',()=>setTf(x.textContent.trim().toUpperCase())));
}
function boot(){if(!chart())return setTimeout(boot,300);ensureUI();wire();setTf(String(window.RIZVI_CANDLE_TIMEFRAME||'1M'));}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
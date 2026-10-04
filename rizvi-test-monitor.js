/* Rizvi Dashboard V5 — combined live testing monitor.
   Read-only diagnostics. Does not alter trading logic or enable auto trading. */
(function(){
  'use strict';
  const checks=[
    ['BTCUSD live price',()=>Number.isFinite(Number(window.RIZVI_LIVE_PRICES?.BTCUSD||window.RIZVI_LIVE_PRICE))],
    ['XAU/USD live price',()=>Number.isFinite(Number(window.RIZVI_LIVE_PRICES?.['XAU/USD']))],
    ['Live candles',()=>Array.isArray(window.RIZVI_AGG_BARS)&&window.RIZVI_AGG_BARS.length>0],
    ['Market range',()=>!!window.RIZVI_MARKET_RANGE&&!window.RIZVI_MARKET_RANGE.status],
    ['Liquidity engine',()=>!!window.RIZVI_LIQUIDITY_ENGINE],
    ['Signal qualification',()=>!!window.RIZVI_SIGNAL_QUALIFICATION],
    ['BTC order book',()=>window.RIZVI_ORDER_FLOW?.BTCUSDT?.status==='LIVE'],
    ['Learning journal',()=>!!window.RIZVI_SIGNAL_JOURNAL],
    ['Auto Trading OFF',()=>window.RIZVI_AUTO_TRADING===false]
  ];
  function mount(){
    if(document.getElementById('rizviTestPanel'))return;
    const b=document.createElement('button');b.id='rizviTestBtn';b.textContent='🧪 TEST STATUS';
    b.style.cssText='position:fixed;right:12px;bottom:12px;z-index:9997;background:#10283a;color:#dcecf7;border:1px solid #31526b;border-radius:9px;padding:8px 11px;font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 24px #0008';
    const p=document.createElement('div');p.id='rizviTestPanel';
    p.style.cssText='position:fixed;right:12px;bottom:55px;width:min(390px,calc(100vw - 24px));max-height:70vh;overflow:auto;background:#07111b;color:#eaf2f8;border:1px solid #29465d;border-radius:14px;box-shadow:0 18px 60px #000b;z-index:9998;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:13px;display:none';
    p.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">Rizvi Testing Status</b><span id="rizviTestSummary"></span></div><div id="rizviTestRows" style="margin-top:10px"></div><div style="margin-top:10px;color:#71889a;font-size:10px">Diagnostics only • approved layout unchanged • Auto Trading remains OFF.</div>';
    document.body.appendChild(b);document.body.appendChild(p);b.onclick=()=>{p.style.display=p.style.display==='none'?'block':'none';render()};
  }
  function render(){
    const rows=document.getElementById('rizviTestRows'),sum=document.getElementById('rizviTestSummary');if(!rows)return;
    const data=checks.map(([name,fn])=>{let ok=false;try{ok=!!fn()}catch{}return {name,ok}});
    const pass=data.filter(x=>x.ok).length;
    if(sum)sum.textContent=pass+'/'+data.length+' PASS';
    rows.innerHTML=data.map(x=>'<div style="display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid #203548"><span>'+x.name+'</span><b style="color:'+(x.ok?'#62dda7':'#d7ae57')+'">'+(x.ok?'PASS':'WAIT')+'</b></div>').join('');
  }
  window.RIZVI_TEST_MONITOR={render,checks};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  setInterval(()=>{render()},2000);
})();
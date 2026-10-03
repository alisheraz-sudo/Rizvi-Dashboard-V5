/* Rizvi Dashboard V5 — live order-flow book, staged only.
   BTC uses public Binance depth; broker symbols use cTrader depth events.
   Read-only: no order placement. */
(function(){
'use strict';
if(window.__RIZVI_ORDERBOOK_V62)return; window.__RIZVI_ORDERBOOK_V62=true;
const MAX=10;
const css=`
#rzOrderBook{margin:10px 0;background:#07121d;border:1px solid #1b4258;border-radius:10px;overflow:hidden;font-size:11px}
#rzOrderBook .ofHead{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #17364b}
#rzOrderBook .ofTitle{font-weight:900;font-size:13px;letter-spacing:.04em}
#rzOrderBook .ofStatus{font-size:9px;padding:4px 7px;border-radius:5px;background:#1b170d;color:#e5b95e;border:1px solid #5d4920}
#rzOrderBook .ofStatus.ok{background:#0b241a;color:#5fe0a6;border-color:#287b5a}
#rzOrderBook .ofGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px}
#rzOrderBook .ofCol{min-width:0}
#rzOrderBook .ofLabel{font-size:9px;color:#71899c;padding:3px 5px}
#rzOrderBook .ofRow{display:grid;grid-template-columns:1fr 1fr 58px;gap:4px;padding:4px 5px;border-top:1px solid #10293b;font-variant-numeric:tabular-nums}
#rzOrderBook .ofPx{text-align:right;color:#dce8f1}
#rzOrderBook .ofSz{text-align:right;color:#8ea6b9}
#rzOrderBook .ofBar{height:4px;border-radius:2px;background:#193b52;align-self:center;overflow:hidden}
#rzOrderBook .ofBar i{display:block;height:100%;background:#35cfa0}
#rzOrderBook .asks .ofBar i{background:#e65d72}
#rzOrderBook .ofMid{margin:0 8px;padding:7px;text-align:center;border-top:1px solid #1b3b52;border-bottom:1px solid #1b3b52;color:#7fa0b6}
#rzOrderBook .ofStats{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:8px}
#rzOrderBook .ofStat{background:#081925;border:1px solid #16364b;border-radius:5px;padding:6px;text-align:center}
#rzOrderBook .ofStat small{display:block;color:#6f8598;font-size:8px}
#rzOrderBook .ofStat b{display:block;margin-top:2px;color:#dfeaf3;font-size:10px}
#rzOrderBook .ofFlow{margin:0 8px 8px;padding:8px;border-radius:6px;background:#0a1824;border:1px solid #17364b}
#rzOrderBook .ofFlow b{font-size:10px}
#rzOrderBook .ofFlow small{display:block;color:#71899c;margin-top:3px;line-height:1.35}
#rzOrderBook .buy{color:#53dda2!important}.sell{color:#ef6578!important}.wait{color:#dfbd61!important}
@media(max-width:600px){#rzOrderBook .ofGrid{gap:5px;padding:5px}#rzOrderBook .ofStats{grid-template-columns:1fr 1fr}.ofRow{grid-template-columns:1fr 1fr 38px!important}}
`;
function install(){
 if(document.getElementById('rzOrderBook'))return;
 const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
 const host=document.querySelector('.right .signalbox')||document.querySelector('.right')||document.querySelector('.main');
 if(!host)return setTimeout(install,500);
 const box=document.createElement('section');box.id='rzOrderBook';
 box.innerHTML=`<div class="ofHead"><span class="ofTitle">ORDER FLOW BOOK</span><span id="rzOfStatus" class="ofStatus">WAIT</span></div>
 <div class="ofGrid"><div class="ofCol asks"><div class="ofLabel">ASK / SELL LIQUIDITY</div><div id="rzOfAsks"></div></div><div class="ofCol bids"><div class="ofLabel">BID / BUY LIQUIDITY</div><div id="rzOfBids"></div></div></div>
 <div id="rzOfMid" class="ofMid">MID —</div>
 <div class="ofStats"><div class="ofStat"><small>ASK TOTAL</small><b id="rzOfAskTotal">—</b></div><div class="ofStat"><small>BID TOTAL</small><b id="rzOfBidTotal">—</b></div><div class="ofStat"><small>IMBALANCE</small><b id="rzOfImbalance">—</b></div><div class="ofStat"><small>SPREAD</small><b id="rzOfSpread">—</b></div></div>
 <div class="ofFlow"><b id="rzOfFlow" class="wait">FLOW: WAIT</b><small id="rzOfReason">Waiting for live market depth. No synthetic order-book values are generated.</small></div>`;
 host.prepend(box);
}
function fmt(n){return Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:2}):'—'}
function normalize(levels,desc){
 return Object.values(levels||{}).map(x=>({price:Number(x.price),size:Number(x.size)})).filter(x=>Number.isFinite(x.price)&&Number.isFinite(x.size)&&x.size>0).sort((a,b)=>desc?b.price-a.price:a.price-b.price).slice(0,MAX);
}
function render(bids,asks,status,source){
 const b=normalize(bids,false).sort((a,b)=>b.price-a.price), a=normalize(asks,true);
 const bestBid=b[0]?.price,bestAsk=a[0]?.price,mid=bestBid&&bestAsk?(bestBid+bestAsk)/2:(bestBid||bestAsk);
 const bt=b.reduce((s,x)=>s+x.size,0),at=a.reduce((s,x)=>s+x.size,0),tot=bt+at;
 const imb=tot?(bt-at)/tot*100:NaN,spread=bestBid&&bestAsk?bestAsk-bestBid:NaN;
 const maxB=Math.max(1,...b.map(x=>x.size)),maxA=Math.max(1,...a.map(x=>x.size));
 const rows=(arr,max)=>arr.map(x=>`<div class="ofRow"><span class="ofPx">${fmt(x.price)}</span><span class="ofSz">${fmt(x.size)}</span><span class="ofBar"><i style="width:${Math.min(100,x.size/max*100)}%"></i></span></div>`).join('');
 document.getElementById('rzOfAsks').innerHTML=rows(a,maxA)||'<div class="ofLabel">NO DEPTH</div>';
 document.getElementById('rzOfBids').innerHTML=rows(b,maxB)||'<div class="ofLabel">NO DEPTH</div>';
 document.getElementById('rzOfMid').textContent='MID '+fmt(mid)+(source?' • '+source:'');
 document.getElementById('rzOfAskTotal').textContent=fmt(at);document.getElementById('rzOfBidTotal').textContent=fmt(bt);
 document.getElementById('rzOfImbalance').textContent=Number.isFinite(imb)?(imb>=0?'+':'')+imb.toFixed(1)+'%':'—';
 document.getElementById('rzOfSpread').textContent=Number.isFinite(spread)?fmt(spread):'—';
 const flow=imb>12?'BUY PRESSURE':imb<-12?'SELL PRESSURE':'BALANCED';
 const fe=document.getElementById('rzOfFlow');fe.textContent='FLOW: '+flow;fe.className=imb>12?'buy':imb<-12?'sell':'wait';
 const reason=flow==='BUY PRESSURE'?'Bid depth exceeds ask depth near the book.':flow==='SELL PRESSURE'?'Ask depth exceeds bid depth near the book.':'Bid/ask depth is relatively balanced.';
 document.getElementById('rzOfReason').textContent=reason+' Order flow is confirmation context, not a breakout by itself.';
 const se=document.getElementById('rzOfStatus');se.textContent=status;se.className='ofStatus '+(status==='LIVE'?'ok':'');
 window.RIZVI_ORDER_BOOK={status,source,bids:b,asks:a,bidTotal:bt,askTotal:at,imbalancePct:imb,spread,mid,updatedAt:Date.now(),flow};
}
function fromCTrader(e){const d=e.detail||{};if(d.type!=='depth'||!d.depth)return;render(d.depth.bids,d.depth.asks,'LIVE','cTrader depth')}
function btc(){
 if(!String(window.state?.symbol||'BTC/USD').toUpperCase().replace(/[^A-Z]/g,'').startsWith('BTC'))return;
 let ws;try{ws=new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@depth10@100ms')}catch{return}
 ws.onmessage=e=>{try{const j=JSON.parse(e.data);const bids={};const asks={};(j.b||[]).forEach(x=>bids[x[0]]={price:Number(x[0]),size:Number(x[1])});(j.a||[]).forEach(x=>asks[x[0]]={price:Number(x[0]),size:Number(x[1])});render(bids,asks,'LIVE','Binance BTCUSDT depth')}catch{}};
 ws.onerror=()=>render({}, {},'WAIT','depth unavailable');
 ws.onclose=()=>setTimeout(btc,3000);
 window.__RIZVI_ORDERBOOK_WS=ws;
}
window.addEventListener('rizvi:ctrader',fromCTrader);
window.addEventListener('change',()=>setTimeout(()=>{if(String(window.state?.symbol||'').toUpperCase().replace(/[^A-Z]/g,'').startsWith('BTC')){if(!window.__RIZVI_ORDERBOOK_WS)btc();}},300));
document.addEventListener('DOMContentLoaded',()=>{install();setTimeout(btc,1200)});
setTimeout(install,1000);
})();
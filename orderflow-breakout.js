/* Order-flow breakout confirmation bridge — staged V62.
   Uses live order-book state only; does not create synthetic depth.
   This is an analysis gate, not an execution engine. */
(function(){
'use strict';
if(window.__RIZVI_OF_BREAKOUT_V62)return;window.__RIZVI_OF_BREAKOUT_V62=true;
const ABS=12,WALL=2.0;
function analyze(){
 const b=window.RIZVI_ORDER_BOOK||{},imb=Number(b.imbalancePct),bid=Number(b.bidTotal),ask=Number(b.askTotal);
 const valid=Number.isFinite(imb)&&bid>0&&ask>0;
 let flow='WAIT',score=0;
 if(valid){if(imb>=ABS){flow='BUY';score=Math.min(100,50+imb)}else if(imb<=-ABS){flow='SELL';score=Math.min(100,50+Math.abs(imb))}else{flow='BALANCED';score=50}}
 const asks=(b.asks||[]).map(x=>Number(x.size)).filter(Number.isFinite),bids=(b.bids||[]).map(x=>Number(x.size)).filter(Number.isFinite);
 const med=x=>{if(!x.length)return NaN;const y=x.slice().sort((a,b)=>a-b);return y[Math.floor(y.length/2)]};
 const am=med(asks),bm=med(bids);
 const askWall=Number.isFinite(am)&&asks.length?Math.max(...asks)>=am*WALL:false;
 const bidWall=Number.isFinite(bm)&&bids.length?Math.max(...bids)>=bm*WALL:false;
 let absorption='NONE';
 if(flow==='BUY'&&askWall)absorption='SELL ABSORPTION / ASK WALL';
 if(flow==='SELL'&&bidWall)absorption='BUY ABSORPTION / BID WALL';
 let breakout='WAIT';
 const h=window.RIZVI_HTF_LEVELS&&window.RIZVI_HTF_LEVELS.levels||{},price=Number(window.state&&window.state.price);
 const levels=[h.d,h.h4,h.h1,h.m15].flatMap(x=>x?[Number(x.h),Number(x.l)]:[]).filter(Number.isFinite);
 if(Number.isFinite(price)&&levels.length){
   const near=levels.reduce((best,l)=>Math.abs(price-l)<Math.abs(price-best)?l:best,levels[0]);
   const dist=Math.abs(price-near),step=Number(window.state&&window.state.step)||0,threshold=Math.max(Math.abs(price)*0.0005,step*3);
   if(dist<=threshold)breakout=flow==='BUY'?'BUY TEST':flow==='SELL'?'SELL TEST':'LIQUIDITY TEST';
 }
 const result={updatedAt:Date.now(),flow,imbalancePct:imb,score,askWall,bidWall,absorption,breakout,source:b.source||'none',live:valid};
 window.RIZVI_ORDERFLOW_CONFIRMATION=result;
 const el=document.getElementById('rzOfReason');
 if(el&&valid)el.textContent=flow+' flow • '+absorption+(breakout!=='WAIT'?' • '+breakout:'')+'. Order flow confirms context; candle/liquidity structure must still confirm breakout.';
 window.dispatchEvent(new CustomEvent('rizvi:orderflow-confirmation',{detail:result}));
}
let last=0;
setInterval(()=>{const x=window.RIZVI_ORDER_BOOK;if(x&&x.updatedAt!==last){last=x.updatedAt;analyze()}},250);
})();
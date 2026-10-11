/* Rizvi V5 Engine 4 live context: DXY inverse correlation, US news, session and daily range. No synthetic market values. */
(function(){
'use strict';
if(window.__RIZVI_ENGINE4_FILTERS_V1)return;
window.__RIZVI_ENGINE4_FILTERS_V1=true;
const norm=x=>String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const num=x=>Number.isFinite(Number(x))?Number(x):null;
function localHour(tz,now){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now));const h=Number(parts.find(x=>x.type==='hour')?.value),m=Number(parts.find(x=>x.type==='minute')?.value);return h*60+m;}
function session(now){
 const london=localHour('Europe/London',now),ny=localHour('America/New_York',now),tokyo=localHour('Asia/Tokyo',now);
 const active=[];if(london>=480&&london<1020)active.push('LONDON');if(ny>=480&&ny<1020)active.push('NEW_YORK');if(tokyo>=540&&tokyo<1080)active.push('TOKYO');
 return {status:'LIVE',active:active.length?active:['OFF_SESSION'],londonMinute:london,newYorkMinute:ny,tokyoMinute:tokyo,updatedAt:now,source:'IANA timezone session clock'};
}
function corr(xs,ys){if(xs.length<10||xs.length!==ys.length)return null;const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;let n=0,dx=0,dy=0;for(let i=0;i<xs.length;i++){const a=xs[i]-mx,b=ys[i]-my;n+=a*b;dx+=a*a;dy+=b*b;}return dx&&dy?n/Math.sqrt(dx*dy):null;}
function calcDxy(payload,bars){
 const d=payload?.dxy;if(!d||d.status!=='LIVE'||!Array.isArray(d.bars))return {status:'UNAVAILABLE',signal:'WAIT',reason:d?.reason||'DXY data unavailable'};
 const xau=new Map();for(const b of bars){const t=Number(b.t),c=num(b.c);if(!Number.isFinite(t)||c===null)continue;xau.set(Math.floor(t/300)*300,c);}
 const dx=new Map();for(const b of d.bars){if(Number.isFinite(Number(b.t))&&num(b.c)!==null)dx.set(Math.floor(Number(b.t)/300)*300,Number(b.c));}
 const keys=[...xau.keys()].filter(k=>dx.has(k)).sort((a,b)=>a-b),gx=[],gd=[];
 for(let i=1;i<keys.length;i++){const k=keys[i],p=keys[i-1];if(k-p>600)continue;const ax=xau.get(p),ay=xau.get(k),bx=dx.get(p),by=dx.get(k);if(ax&&ay&&bx&&by){gx.push((ay-ax)/ax);gd.push((by-bx)/bx);}}
 const correlation=corr(gx.slice(-48),gd.slice(-48)),lastKeys=keys.slice(-4);
 const dxyDirection=lastKeys.length>=2?(dx.get(lastKeys.at(-1))>dx.get(lastKeys[0])?'BUY':dx.get(lastKeys.at(-1))<dx.get(lastKeys[0])?'SELL':'NEUTRAL'):'WAIT';
 if(correlation===null)return {status:'UNAVAILABLE',signal:'WAIT',reason:'Not enough aligned XAU/DXY candles for correlation',source:d.source};
 return {status:'LIVE',signal:correlation<=-0.25?'INVERSE_CONFIRMED':correlation>=0.25?'CORRELATION_CONFLICT':'WEAK_CORRELATION',correlation:Number(correlation.toFixed(3)),dxyDirection,source:d.source,pairedReturns:gx.length,updatedAt:Date.now(),reason:'Pearson correlation of aligned 5-minute XAU/DXY returns'};
}
function dayRange(bars,now){
 const dayStart=Math.floor(now/86400000)*86400,rows=bars.filter(b=>Number(b.t)>=dayStart&&Number(b.t)<=Math.floor(now/1000)&&[b.h,b.l].every(v=>num(v)!==null));
 if(!rows.length)return {status:'UNAVAILABLE',reason:'No XAU candles for current UTC day'};
 const first=Math.min(...rows.map(b=>Number(b.t))),latest=Math.max(...rows.map(b=>Number(b.t)));
 if(first>dayStart+600)return {status:'UNAVAILABLE',reason:'XAU feed does not cover the start of the current UTC day; daily extremes may be incomplete'};
 return {status:'LIVE',high:Math.max(...rows.map(b=>Number(b.h))),low:Math.min(...rows.map(b=>Number(b.l))),source:'Validated XAU OHLC from UTC day start',updatedAt:now,firstBarAt:first,lastBarAt:latest};
}
async function poll(){
 const now=Date.now(),bars=window.RIZVI_AGG_BARS||window.RIZVI_RAW_BARS||[];
 let payload={dxy:{status:'UNAVAILABLE',reason:'Loading DXY'},usNews:{status:'UNAVAILABLE',reason:'Loading US news calendar'}};
 try{const r=await fetch('/market/engine4-context?_'+now,{cache:'no-store',credentials:'same-origin'});if(!r.ok)throw new Error('Engine 4 context HTTP '+r.status);payload=await r.json();}catch(e){payload={dxy:{status:'UNAVAILABLE',reason:String(e.message||e)},usNews:{status:'UNAVAILABLE',reason:'Calendar endpoint unavailable'}};}
 const dxy=calcDxy(payload,bars),usNews=payload.usNews||{status:'UNAVAILABLE',reason:'No calendar status'};
 const sym=norm(window.RIZVI_CURRENT_SYMBOL||'XAUUSD'),isGold=sym==='XAUUSD'||sym==='GOLD';
 const range=isGold?dayRange(bars,now):{status:'UNAVAILABLE',reason:'Day High/Low module is scoped to XAUUSD'};
 const sessionStatus=session(now);
 window.RIZVI_ENGINE4_CONTEXT={updatedAt:now,dxy,usNews,session:sessionStatus,dayHighLow:range,symbol:window.RIZVI_CURRENT_SYMBOL||'XAU/USD',autoTrading:false};
 window.dispatchEvent(new CustomEvent('rizvi:engine4-context-update',{detail:window.RIZVI_ENGINE4_CONTEXT}));
}
poll();setInterval(poll,60000);
})();
/* Rizvi V5 live candle engine — reference-price candles, no synthetic prices */
(function(){
  'use strict';
  const TF={'1M':1,'5M':5,'15M':15,'30M':30,'1H':60};
  const feed=()=>window.RIZVI_REAL_FEED||{};
  const state=()=>window.state;
  const barsByTf={};
  let lastFeedTs=null;

  function tfMin(){return TF[state()?.tf]||1}
  function bucket(ts,min){const ms=min*60000;return Math.floor(ts/ms)*ms}

  function seedFromPoints(points){
    const st=state();if(!st||st.symbol!=='XAU/USD'||!Array.isArray(points))return;
    const min=tfMin(),ms=min*60000,groups=new Map();
    points.forEach(p=>{
      const t=Date.parse(p?.t),px=Number(p?.p);
      if(!Number.isFinite(t)||!Number.isFinite(px))return;
      const k=Math.floor(t/ms)*ms;
      let g=groups.get(k);if(!g){g={t:k,o:px,h:px,l:px,c:px,closed:true,source:'XAUS sampled reference price'};groups.set(k,g)}
      else{g.h=Math.max(g.h,px);g.l=Math.min(g.l,px);g.c=px}
    });
    const arr=[...groups.values()].sort((a,b)=>a.t-b.t).slice(-260);
    if(arr.length){arr.at(-1).closed=false;barsByTf[min]=arr;window.RIZVI_LIVE_BARS=arr;
      window.RIZVI_LIVE_CANDLE_STATE={timeframe:st.tf,source:'XAUS sampled reference price',trueOHLC:false,lastClosedAt:arr.filter(x=>x.closed).at(-1)?.t||null,current:arr.at(-1)};
      if(arr.length>=12){st.history=arr.map(x=>x.c).slice(-260)}
      renderStatus();
    }
  }

  function ingest(){
    const st=state(),f=feed();
    if(!st||st.symbol!=='XAU/USD'||!Number.isFinite(Number(f.price))||f.stale)return;
    const px=Number(f.price),ts=Date.parse(f.updatedAt||new Date().toISOString());
    if(!Number.isFinite(ts)||ts===lastFeedTs)return;
    lastFeedTs=ts;
    const min=tfMin(),key=bucket(ts,min);
    let arr=barsByTf[min]||(barsByTf[min]=[]);
    let b=arr.at(-1);
    if(!b||b.t!==key){
      if(b)b.closed=true;
      b={t:key,o:px,h:px,l:px,c:px,closed:false,source:'XAUS reference price'};
      arr.push(b);
    }else{
      b.h=Math.max(b.h,px);b.l=Math.min(b.l,px);b.c=px;
    }
    arr=arr.slice(-260);barsByTf[min]=arr;
    window.RIZVI_LIVE_BARS=arr;
    window.RIZVI_LIVE_CANDLE_STATE={
      timeframe:st.tf,source:'XAUS sampled reference price',trueOHLC:false,
      lastClosedAt:arr.filter(x=>x.closed).at(-1)?.t||null,current:arr.at(-1)
    };
    /* Do not replace the existing history until enough real reference bars exist.
       This prevents a timeframe switch from wiping the signal warm-up history. */
    if(arr.length>=12){
      st.history=arr.map(x=>x.c).slice(-260);
      st.price=px;
    }
    renderStatus();
  }

  function renderStatus(){
    const e=document.getElementById('feedStatus'),st=state();
    if(!e||!st||st.symbol!=='XAU/USD')return;
    e.textContent='● REAL XAU/USD • '+st.tf+' REFERENCE CANDLES';
    e.style.color='#62dda7';
  }

  function draw(){
    const host=document.getElementById('chartArea'),st=state(),arr=window.RIZVI_LIVE_BARS;
    if(!host||!st||!Array.isArray(arr)||arr.length<2)return;
    const v=arr.slice(-70),hi=Math.max(...v.map(x=>x.h)),lo=Math.min(...v.map(x=>x.l)),span=Math.max(hi-lo,0.01);
    host.innerHTML='';
    v.forEach((b,i)=>{
      const x=document.createElement('div');x.className='candle '+(b.c>=b.o?'up':'dn');
      const left=(i/(v.length-1))*98,top=100-((Math.max(b.o,b.c)-lo)/span)*92,height=Math.max(2,Math.abs(b.c-b.o)/span*92);
      x.style.left=left+'%';x.style.top=top+'%';x.style.height=height+'%';
      x.title=new Date(b.t).toISOString()+' O '+b.o.toFixed(2)+' H '+b.h.toFixed(2)+' L '+b.l.toFixed(2)+' C '+b.c.toFixed(2);
      const w=document.createElement('div');w.className='wick';w.style.left='3px';
      w.style.top=((Math.max(b.o,b.c)-b.h)/span*92)+'%';w.style.height=Math.max(1,(b.h-b.l)/span*92)+'%';
      x.appendChild(w);host.appendChild(x);
    });
  }

  function engineHook(){
    const orig=window.V5SignalEngine;
    if(typeof orig!=='function'||orig.__rizviLiveWrapped)return;
    const wrapped=function(bars,idx){
      const st=state();
      if(st&&st.symbol==='XAU/USD'&&!feed().stale&&Array.isArray(window.RIZVI_LIVE_BARS)&&window.RIZVI_LIVE_BARS.length>=12){
        const a=window.RIZVI_LIVE_BARS;
        return orig.call(this,a,a.length-1);
      }
      return orig.apply(this,arguments);
    };
    wrapped.__rizviLiveWrapped=true;wrapped.__rizviOriginal=orig;window.V5SignalEngine=wrapped;
  }

  function candleCloseGate(){
    const st=state(),arr=window.RIZVI_LIVE_BARS;
    if(!st||st.symbol!=='XAU/USD'||!Array.isArray(arr)||arr.length<2)return;
    const last=arr.filter(x=>x.closed).at(-1);
    if(!last)return;
    const g=window.__RIZVI_LIVE_GATE;
    if(g&&g.lastClosedBarTime!==last.t){
      g.lastClosedBarTime=last.t;
      g.closedBarsSeen=(g.closedBarsSeen||0)+1;
    }
  }

  function boot(){ingest();engineHook();candleCloseGate()}
  setInterval(ingest,1000);
  setInterval(()=>{engineHook();candleCloseGate()},1200);
  setTimeout(boot,1200);
  window.RIZVI_LIVE_CANDLE_ENGINE={ingest,draw,seedFromPoints,getBars:()=>window.RIZVI_LIVE_BARS||[],getState:()=>window.RIZVI_LIVE_CANDLE_STATE||{}};
})();
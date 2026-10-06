/* Rizvi Dashboard V5 — real order-flow monitor.
   BTCUSD: Coinbase Exchange level2 WebSocket (same venue as the BTC price/candle engine).
   XAU/USD + US Oil: cTrader depth events from the existing read-only adapter.
   No synthetic/fake order-book values are generated. */
(function(){
  'use strict';
  const state={btc:{status:'CONNECTING',bids:{},asks:{},updatedAt:null},broker:{status:'WAITING',symbol:null,bids:{},asks:{},updatedAt:null}};
  const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  function levels(obj,limit=8){return Object.values(obj||{}).filter(x=>Number.isFinite(Number(x.price))&&Number(x.size)>0).sort((a,b)=>Number(b.price)-Number(a.price)).slice(0,limit)}
  function metrics(bids,asks){
    const b=Object.values(bids||{}).reduce((s,x)=>s+Number(x.size||0),0),a=Object.values(asks||{}).reduce((s,x)=>s+Number(x.size||0),0),t=b+a;
    return {bidSize:b,askSize:a,imbalance:t?((b-a)/t)*100:0};
  }
  function mount(){
    if(document.getElementById('rizviOrderFlowPanel'))return;
    const p=document.createElement('div');p.id='rizviOrderFlowPanel';
    p.style.cssText='position:fixed;right:12px;bottom:12px;width:min(380px,calc(100vw - 24px));max-height:58vh;overflow:auto;background:#07111b;color:#eaf2f8;border:1px solid #29465d;border-radius:14px;box-shadow:0 18px 60px #000b;z-index:9998;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:13px;display:none';
    p.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">Order Flow / Book</b><button id="rofClose" style="background:#122131;border:1px solid #29465d;color:#cbd8e4;border-radius:7px;padding:4px 8px">✕</button></div><div id="rofBody" style="margin-top:10px"></div>';
    document.body.appendChild(p);document.getElementById('rofClose').onclick=()=>p.style.display='none';
    window.RizviOrderFlowUI={open:()=>{p.style.display='block';render()},state};
    const gear=document.querySelector('.gear'); if(gear&&!gear.dataset.rofBound){gear.dataset.rofBound='1';gear.addEventListener('dblclick',()=>p.style.display=p.style.display==='none'?'block':'none')}
  }
  function book(title,s){
    const m=metrics(s.bids,s.asks),bs=levels(s.bids),as=levels(s.asks);
    return '<div style="margin-top:12px;border-top:1px solid #203548;padding-top:10px"><div style="display:flex;justify-content:space-between"><b>'+title+'</b><span style="color:'+(s.status==='LIVE'?'#62dda7':'#d7ae57')+'">● '+s.status+'</span></div>'+
      '<div style="color:#7890a5;margin:4px 0">Bid '+m.bidSize.toFixed(2)+' • Ask '+m.askSize.toFixed(2)+' • Imbalance '+m.imbalance.toFixed(1)+'%</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><div style="color:#6f9bb5;margin-bottom:3px">BIDS</div>'+bs.map(x=>'<div style="display:flex;justify-content:space-between"><span>'+Number(x.price).toFixed(5)+'</span><span>'+Number(x.size).toFixed(2)+'</span></div>').join('')+'</div><div><div style="color:#a77b7b;margin-bottom:3px">ASKS</div>'+as.map(x=>'<div style="display:flex;justify-content:space-between"><span>'+Number(x.price).toFixed(5)+'</span><span>'+Number(x.size).toFixed(2)+'</span></div>').join('')+'</div></div></div>';
  }
  function render(){
    const b=document.getElementById('rofBody');if(!b)return;
    b.innerHTML=book('BTCUSD • Coinbase L2',state.btc)+book((state.broker.symbol||'Broker')+' • cTrader',state.broker)+'<div style="margin-top:10px;color:#657d90;font-size:10px">Read-only market data. Order flow is confirmation only; Auto Trading remains OFF.</div>';
  }
  function connectCoinbase(){
    let ws;try{ws=new WebSocket('wss://ws-feed.exchange.coinbase.com')}catch(e){state.btc.status='UNAVAILABLE';render();setTimeout(connectCoinbase,3000);return}
    ws.onopen=()=>{
      state.btc.status='LIVE';
      ws.send(JSON.stringify({type:'subscribe',product_ids:['BTC-USD'],channels:['level2']}));
      render();
    };
    ws.onmessage=e=>{try{
      const d=JSON.parse(e.data);
      if(d.type==='snapshot'){
        const bids={},asks={};
        (d.bids||[]).forEach(x=>{const price=String(x[0]),size=Number(x[1]);if(Number.isFinite(size)&&size>0)bids[price]={price:Number(price),size};});
        (d.asks||[]).forEach(x=>{const price=String(x[0]),size=Number(x[1]);if(Number.isFinite(size)&&size>0)asks[price]={price:Number(price),size};});
        state.btc={status:'LIVE',bids,asks,updatedAt:Date.now()};
      } else if(d.type==='l2update'){
        for(const x of (d.changes||[])){
          const side=x[0],price=String(x[1]),size=Number(x[2]);
          const book=side==='buy'?state.btc.bids:state.btc.asks;
          if(!book)continue;
          if(Number.isFinite(size)&&size>0)book[price]={price:Number(price),size}; else delete book[price];
        }
        state.btc.status='LIVE';state.btc.updatedAt=Date.now();
      }
      if(d.type==='snapshot'||d.type==='l2update'){
        window.RIZVI_ORDER_FLOW={...(window.RIZVI_ORDER_FLOW||{}),BTCUSDT:state.btc};
        render();
      }
    }catch{}};
    ws.onerror=()=>{state.btc.status='UNAVAILABLE';render()};
    ws.onclose=()=>{state.btc.status='RECONNECTING';render();setTimeout(connectCoinbase,3000)};
  }
  window.addEventListener('rizvi:ctrader',e=>{const d=e.detail||{};if(d.type==='depth'&&d.depth){state.broker={status:'LIVE',symbol:(window.__RIZVI_ACTIVE_SYMBOL||'XAU/USD'),bids:d.depth.bids||{},asks:d.depth.asks||{},updatedAt:d.depth.updatedAt||Date.now()};render()}else if(d.type==='status'&&d.status){if(!/AUTHORIZED|CONNECTED|REAL BROKER/.test(d.status))state.broker.status=d.status;render()}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{mount();connectCoinbase()});else{mount();connectBinance()}
})();
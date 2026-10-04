/* Rizvi Dashboard V5 — two-week signal learning journal.
   Captures qualified setups, engine snapshots and outcomes locally.
   Week 1 = first 7 days after the first recorded setup; Week 2 = days 8-14.
   No auto-trading and no external storage. */
(function(){
  'use strict';
  const KEY='RIZVI_SIGNAL_JOURNAL_V1';
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{"version":1,"startedAt":null,"trades":[]}')}catch{return {version:1,startedAt:null,trades:[]}}};
  const save=x=>localStorage.setItem(KEY,JSON.stringify(x));
  const clamp=(n,a=0,b=100)=>Math.max(a,Math.min(b,Number(n)||0));
  const pct=(n)=>Number.isFinite(Number(n))?Number(n).toFixed(0)+'%':'—';
  function engineSnapshot(){
    const q=window.RIZVI_SIGNAL_QUALIFICATION||{};
    const v=window.RIZVI_VISIBLE_SIGNAL_STATE||{};
    const l=window.RIZVI_LIQUIDITY_ENGINE||{};
    const of=window.RIZVI_ORDER_FLOW||{};
    const btc=of.BTCUSDT;
    let ofm=null;
    if(btc){
      const bid=Object.values(btc.bids||{}).reduce((s,x)=>s+Number(x.size||0),0);
      const ask=Object.values(btc.asks||{}).reduce((s,x)=>s+Number(x.size||0),0);
      const total=bid+ask;
      ofm={status:btc.status,imbalance:total?((bid-ask)/total)*100:0};
    }
    return {
      trend:q.trend||q.marketTrend||q.htfTrend||null,
      structure:q.structure||q.marketStructure||null,
      liquidity:q.liquidity||q.liquidityContext||l.status||null,
      orderFlow:ofm,
      momentum:q.momentum||null,
      divergence:q.divergence||null,
      priceAction:q.priceAction||null,
      volatility:q.volatility||null,
      qualificationStatus:q.status||v.status||null,
      confidence:clamp(q.patternConfidence??v.confidence),
      direction:q.marketDirection||v.direction||window.RIZVI_SIGNAL_DIRECTION||'WAIT'
    };
  }
  function currentPrice(symbol){
    if(symbol==='XAU/USD') return Number(window.RIZVI_LIVE_PRICES?.['XAU/USD']);
    if(symbol==='BTCUSD') return Number(window.RIZVI_LIVE_PRICES?.BTCUSD||window.RIZVI_LIVE_PRICE);
    return Number(window.RIZVI_LIVE_PRICE);
  }
  function mount(){
    if(document.getElementById('rizviLearningPanel'))return;
    const btn=document.createElement('button');
    btn.id='rizviLearningBtn';btn.textContent='📊 2-WEEK LEARNING';
    btn.style.cssText='position:fixed;left:12px;bottom:12px;z-index:9997;background:#10283a;color:#dcecf7;border:1px solid #31526b;border-radius:9px;padding:8px 11px;font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 24px #0008';
    const p=document.createElement('div');p.id='rizviLearningPanel';
    p.style.cssText='position:fixed;left:12px;bottom:55px;width:min(760px,calc(100vw - 24px));max-height:72vh;overflow:auto;background:#07111b;color:#eaf2f8;border:1px solid #29465d;border-radius:14px;box-shadow:0 18px 60px #000b;z-index:9998;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:13px;display:none';
    p.innerHTML='<div id="rizviLearningBody"></div>';
    document.body.appendChild(btn);document.body.appendChild(p);btn.onclick=()=>{p.style.display=p.style.display==='none'?'block':'none';render()};
  }
  function bucket(t,started){
    if(!started)return null;
    const d=t-started;
    if(d<0||d>=14*86400000)return null;
    return d<7*86400000?'Week 1':'Week 2';
  }
  function rows(trades){
    const names=['trend','structure','liquidity','orderFlow','momentum','divergence','priceAction','volatility'];
    return names.map(n=>{
      const a=trades.filter(t=>t.outcome&&t.outcome!=='INVALID'&&t.engines?.[n]&&t.engines[n].correct!==null);
      const correct=a.filter(t=>t.engines[n].correct===true).length;
      const accuracy=a.length?correct/a.length*100:null;
      return '<tr><td>'+n+'</td><td>'+a.length+'</td><td>'+(accuracy==null?'—':accuracy.toFixed(1)+'%')+'</td></tr>';
    }).join('');
  }
  function summary(trades,label){
    const r=trades.filter(t=>t.outcome&&t.outcome!=='INVALID');
    const wins=r.filter(t=>t.outcome==='WIN').length;
    return '<div style="padding:8px 10px;border:1px solid #203548;border-radius:9px;margin-top:8px"><b>'+label+'</b> • setups '+trades.length+' • resolved '+r.length+' • wins '+wins+' • win rate '+(r.length?(wins/r.length*100).toFixed(1)+'%':'—')+'</div>';
  }
  function render(){
    const b=document.getElementById('rizviLearningBody');if(!b)return;
    const d=load(),now=Date.now(),w1=d.trades.filter(t=>bucket(t.ts,d.startedAt)==='Week 1'),w2=d.trades.filter(t=>bucket(t.ts,d.startedAt)==='Week 2');
    b.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><div><b style="font-size:15px">Rizvi Signal Learning</b><div style="color:#7890a5;margin-top:3px">Week 1 vs Week 2 engine performance</div></div><button id="rizviResetLearning" style="background:#24191b;border:1px solid #5b343a;color:#e6c7ca;border-radius:7px;padding:5px 8px">Reset</button></div>'+
      '<div style="margin-top:9px;color:#91a8b9">Started: '+(d.startedAt?new Date(d.startedAt).toLocaleString():'No setup recorded yet')+' • '+d.trades.length+' setups logged</div>'+
      summary(w1,'WEEK 1')+summary(w2,'WEEK 2')+
      '<div style="margin-top:12px;overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">Engine</th><th>W1 n</th><th>W1 acc.</th><th>W2 n</th><th>W2 acc.</th></tr></thead><tbody>'+
      ['trend','structure','liquidity','orderFlow','momentum','divergence','priceAction','volatility'].map(n=>{
        const cell=w=>{const a=w.filter(t=>t.outcome&&t.outcome!=='INVALID'&&t.engines?.[n]&&t.engines[n].correct!==null);const c=a.filter(t=>t.engines[n].correct===true).length;return '<td style="text-align:center">'+a.length+'</td><td style="text-align:center">'+(a.length?(c/a.length*100).toFixed(1)+'%':'—')+'</td>'};
        return '<tr><td>'+n+'</td>'+cell(w1)+cell(w2)+'</tr>';
      }).join('')+'</tbody></table></div>'+
      '<div style="margin-top:10px;color:#71889a">Each qualified setup is saved with the engine snapshot. Mark outcomes after the market move; only resolved WIN/LOSS records count toward engine accuracy.</div>'+
      '<div style="margin-top:12px">'+d.trades.slice(-10).reverse().map((t,i)=>'<div style="padding:8px;border-top:1px solid #203548"><b>'+t.symbol+' '+t.direction+'</b> • '+pct(t.confidence)+' • '+new Date(t.ts).toLocaleString()+' • '+(t.outcome||('AUTO '+(t.evaluation?.autoOutcome||'PENDING')))+
      ' <button data-win="'+t.id+'" style="margin-left:7px">WIN</button><button data-loss="'+t.id+'">LOSS</button><button data-invalid="'+t.id+'">INVALID</button></div>').join('')+'</div>';
    document.getElementById('rizviResetLearning').onclick=()=>{if(confirm('Reset the Rizvi 2-week learning journal?')){localStorage.removeItem(KEY);render()}};
    b.querySelectorAll('[data-win]').forEach(x=>x.onclick=()=>setOutcome(x.dataset.win,'WIN'));
    b.querySelectorAll('[data-loss]').forEach(x=>x.onclick=()=>setOutcome(x.dataset.loss,'LOSS'));
    b.querySelectorAll('[data-invalid]').forEach(x=>x.onclick=()=>setOutcome(x.dataset.invalid,'INVALID'));
  }
  function normalizeEngine(raw){
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)){
      const signal=String(raw.signal||raw.direction||raw.bias||raw.status||'').toUpperCase();
      const confidence=Number(raw.confidence??raw.score??raw.strength);
      return {signal:signal||null,confidence:Number.isFinite(confidence)?clamp(confidence):null,reason:raw.reason||raw.context||null,timestamp:Date.now()};
    }
    if(typeof raw==='string') return {signal:raw.toUpperCase(),confidence:null,reason:null,timestamp:Date.now()};
    return {signal:null,confidence:null,reason:null,timestamp:Date.now()};
  }
  function standardizeEngines(snap){
    const out={};
    ['trend','structure','liquidity','orderFlow','momentum','divergence','priceAction','volatility'].forEach(k=>{
      const e=normalizeEngine(snap[k]);
      if(k==='orderFlow'&&snap[k]&&typeof snap[k]==='object'&&Number.isFinite(Number(snap[k].imbalance)))e.reason='imbalance '+Number(snap[k].imbalance).toFixed(1)+'% • '+(snap[k].status||'UNKNOWN');
      e.correct=null;out[k]=e;
    });
    return out;
  }
  function evaluateForward(){
    const d=load(),now=Date.now(),prices=window.RIZVI_LIVE_PRICES||{};let changed=false;
    d.trades.forEach(t=>{
      if(t.outcome||!Number.isFinite(Number(t.entry)))return;
      const p=Number(prices[t.symbol]);if(!Number.isFinite(p))return;
      const age=now-t.ts,move=(p-Number(t.entry))*(t.direction==='SELL'?-1:1);
      t.evaluation=t.evaluation||{};
      if(age>=15*60000&&!t.evaluation.m15){t.evaluation.m15={price:p,move,hit:move>0};changed=true}
      if(age>=60*60000&&!t.evaluation.h1){t.evaluation.h1={price:p,move,hit:move>0};changed=true}
      if(age>=240*60000&&!t.evaluation.h4){t.evaluation.h4={price:p,move,hit:move>0};changed=true}
      t.evaluation.mfe=Math.max(Number(t.evaluation.mfe)||0,move);
      t.evaluation.mae=Math.min(Number(t.evaluation.mae)||0,move);
      if(age>=60*60000&&!t.evaluation.autoOutcome){t.evaluation.autoOutcome=move>0?'WIN':move<0?'LOSS':'FLAT';t.evaluation.autoResolvedAt=now;changed=true}
    });
    if(changed)save(d);
  }
  function setOutcome(id,outcome){
    const d=load(),t=d.trades.find(x=>x.id===id);if(!t)return;
    t.outcome=outcome;t.resolvedAt=Date.now();
    Object.keys(t.engines||{}).forEach(k=>{const e=t.engines[k];if(!e)return;if(typeof e.signal==='string'&&/^(BUY|SELL)$/.test(e.signal))e.correct=e.signal===t.direction;else e.correct=null;});
    save(d);render();
  }
  function capture(){
    const q=window.RIZVI_SIGNAL_QUALIFICATION||{},v=window.RIZVI_VISIBLE_SIGNAL_STATE||{};
    const direction=q.marketDirection||v.direction||window.RIZVI_SIGNAL_DIRECTION||'WAIT';
    const qualified=q.status==='QUALIFIED_CONTEXT'&&/^(BUY|SELL)$/.test(direction);
    if(!qualified)return;
    const d=load(),symbol=window.RIZVI_CURRENT_SYMBOL||'BTCUSD',p=currentPrice(symbol),now=Date.now();
    const last=d.trades[d.trades.length-1];
    if(last&&now-last.ts<120000)return;
    if(!d.startedAt)d.startedAt=now;
    const snap=engineSnapshot();
    const engines=standardizeEngines(snap);
    d.trades.push({id:String(now)+'-'+Math.random().toString(36).slice(2,7),ts:now,symbol,direction,entry:Number.isFinite(p)?p:null,confidence:snap.confidence,engines,qualificationStatus:snap.qualificationStatus});
    save(d);render();
  }
  window.RIZVI_SIGNAL_JOURNAL={capture,render,load,evaluateForward};
  document.addEventListener('rizvi:signal-qualification-update',()=>setTimeout(capture,50));
  document.addEventListener('rizvi:price-update',()=>{});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  setInterval(()=>{capture();evaluateForward();},5000);
})();
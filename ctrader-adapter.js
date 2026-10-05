/* Rizvi Dashboard V5 — cTrader Open API read-only market-data adapter.
   Trading remains OFF. This adapter only authenticates, discovers symbols,
   receives quotes/trendbars and feeds the existing dashboard state. */
(function(){
  'use strict';
  const P={APP_AUTH_REQ:2100,APP_AUTH_RES:2101,ACCOUNT_AUTH_REQ:2102,ACCOUNT_AUTH_RES:2103,
    SYMBOLS_LIST_REQ:2114,SYMBOLS_LIST_RES:2115,SUB_SPOTS_REQ:2127,SUB_SPOTS_RES:2128,
    SPOT_EVENT:2131,SUB_TB_REQ:2135,SUB_TB_RES:2165,GET_TB_REQ:2137,GET_TB_RES:2138,
    DEPTH_EVENT:2155,SUB_DEPTH_REQ:2156,SUB_DEPTH_RES:2157,
    ACCOUNTS_REQ:2149,ACCOUNTS_RES:2150,ERROR_RES:2142,HEARTBEAT:51};
  const PERIOD={M1:1,M2:2,M3:3,M4:4,M5:5,M10:6,M15:7,M30:8,H1:9,H4:10,H12:11,D1:12,W1:13,MN1:14};
  const CFG={clientId:'',clientSecret:'',redirectUri:(window.Capacitor?'com.rizvi.dashboard://ctrader/callback':(window.location.origin+'/ctrader/callback')),scope:'accounts',live:true};
  const S={ws:null,token:null,refreshToken:null,accountId:null,symbols:[],symbolMap:{},activeSymbolId:null,
    connected:false,authorized:false,manualDisconnect:false,lastQuote:null,lastBar:null,depth:{bids:{},asks:{},updatedAt:null},pending:{},heartbeat:null};
  const emit=(type,data)=>{try{window.dispatchEvent(new CustomEvent('rizvi:ctrader',{detail:{type,...(data||{})}}))}catch{}};
  const setStatus=(s,ok)=>{window.RIZVI_CTRADER={...(window.RIZVI_CTRADER||{}),status:s,connected:!!ok,accountId:S.accountId||null,broker:'FxPro'};const e=document.getElementById('feedStatus');if(e){e.textContent='● '+(s==='REAL BROKER'?'FxPro cTrader':s);e.style.color=ok?'#62dda7':'#d7ae57'}emit('status',{status:s,ok:!!ok})};
  function id(){return 'rizvi-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)}
  function send(payload,timeout=12000){
    if(!S.ws||S.ws.readyState!==WebSocket.OPEN) throw Error('cTrader WebSocket is not connected');
    const clientMsgId=id();const msg={clientMsgId,payloadType:payload.payloadType,payload};S.ws.send(JSON.stringify(msg));
    return new Promise((resolve,reject)=>{const t=setTimeout(()=>{delete S.pending[clientMsgId];reject(Error('cTrader request timeout'))},timeout);S.pending[clientMsgId]={resolve,reject,t}})}
  function norm(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
  async function token(code){
    const q=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:CFG.redirectUri,client_id:CFG.clientId,client_secret:CFG.clientSecret});
    const r=await fetch('https://openapi.ctrader.com/apps/token?'+q.toString(),{headers:{Accept:'application/json'}});
    if(!r.ok)throw Error('cTrader token exchange failed: '+r.status);
    const j=await r.json();if(!j.accessToken)throw Error(j.description||j.errorCode||'No access token returned');
    S.token=j.accessToken;S.refreshToken=j.refreshToken||null;
    return j;
  }
  async function refresh(){
    if(!CFG.clientId||!CFG.clientSecret||!S.refreshToken)throw Error('Missing cTrader refresh credentials');
    const q=new URLSearchParams({grant_type:'refresh_token',refresh_token:S.refreshToken,client_id:CFG.clientId,client_secret:CFG.clientSecret});
    const r=await fetch('https://openapi.ctrader.com/apps/token?'+q.toString(),{headers:{Accept:'application/json'}});
    const j=await r.json();if(!j.accessToken)throw Error(j.description||j.errorCode||'Refresh failed');
    S.token=j.accessToken;S.refreshToken=j.refreshToken||S.refreshToken;return j;
  }
  function authUrl(){
    if(!CFG.clientId)throw Error('Set cTrader Client ID first');
    const q=new URLSearchParams({client_id:CFG.clientId,redirect_uri:CFG.redirectUri,scope:CFG.scope,product:'web'});
    return 'https://id.ctrader.com/my/settings/openapi/grantingaccess/?'+q.toString();
  }
  function configure(o){
    Object.assign(CFG,o||{});
    if(CFG.clientSecret)sessionStorage.setItem('rizvi_ctrader_secret',CFG.clientSecret);
    else CFG.clientSecret=sessionStorage.getItem('rizvi_ctrader_secret')||'';
    window.RIZVI_CTRADER_CONFIG={clientId:CFG.clientId,redirectUri:CFG.redirectUri,scope:CFG.scope,live:CFG.live};
    emit('configured',{clientId:CFG.clientId,redirectUri:CFG.redirectUri});
    return authUrl();
  }
  function connect(){
    S.manualDisconnect=false;
    const host=CFG.live?'wss://live.ctraderapi.com:5036':'wss://demo.ctraderapi.com:5036';
    setStatus('CONNECTING',false);
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket(host);S.ws=ws;
      ws.onopen=async()=>{S.connected=true;setStatus('CONNECTED',true);try{
        const r=await send({payloadType:P.APP_AUTH_REQ,clientId:CFG.clientId,clientSecret:CFG.clientSecret});
        S.authorized=true;setStatus('APP AUTHORIZED',true);resolve(r);
      }catch(e){setStatus('AUTH ERROR',false);reject(e)}};
      ws.onmessage=e=>{try{handle(JSON.parse(e.data))}catch(err){emit('error',{message:String(err)})}};
      ws.onerror=()=>{setStatus('CONNECTION ERROR',false)};
      ws.onclose=()=>{S.connected=false;clearInterval(S.heartbeat);setStatus('DISCONNECTED',false);if(!S.manualDisconnect)setTimeout(()=>{if(CFG.clientId&&CFG.clientSecret&&!S.manualDisconnect)connect().catch(()=>{})},3000)};
    });
  }
  async function handle(m){
    const p=m&&m.payload||{};const type=Number(m&&m.payloadType);
    if(m&&m.clientMsgId&&S.pending[m.clientMsgId]){const x=S.pending[m.clientMsgId];clearTimeout(x.t);delete S.pending[m.clientMsgId];if(type===P.ERROR_RES)x.reject(Error(p.description||p.errorCode||'cTrader error'));else x.resolve(p)}
    if(type===P.HEARTBEAT)return;
    if(type===P.SUB_DEPTH_RES){window.RIZVI_L2_STATUS={status:'SUBSCRIBED',symbolId:S.activeSymbolId,updatedAt:Date.now(),events:0,bidLevels:0,askLevels:0,imbalance:null};emit('l2',{status:'SUBSCRIBED',symbolId:S.activeSymbolId});}
    if(type===P.ACCOUNTS_RES){const a=p.ctidTraderAccount||[];const live=a.filter(x=>!!x.isLive);const pool=CFG.live?live:a;const chosen=pool[0];if(chosen){S.accountId=Number(chosen.ctidTraderAccountId);await accountAuth();}}
    if(type===P.ACCOUNT_AUTH_RES){setStatus('ACCOUNT AUTHORIZED',true);await loadSymbols();startHeartbeat();emit('ready',{accountId:S.accountId});try{if(window.state&&window.state.symbol)await subscribe(window.state.symbol,window.state.tf||'1M')}catch(e){emit('error',{message:e.message})}}
    if(type===P.SYMBOLS_LIST_RES){S.symbols=(p.symbol||[]);S.symbolMap={};S.symbols.forEach(x=>S.symbolMap[norm(x.symbolName)]=x);emit('symbols',{symbols:S.symbols});}
    if(type===P.SPOT_EVENT){const id=Number(p.symbolId);const scale=priceScale(id);const bid=p.bid!=null?Number(p.bid)/scale:null;const ask=p.ask!=null?Number(p.ask)/scale:null;const price=ask!=null&&bid!=null?(ask+bid)/2:(bid??ask);if(Number.isFinite(price)){S.lastQuote={symbolId:id,bid,ask,price,timestamp:p.timestamp||Date.now()};emit('quote',S.lastQuote);applyQuote(id,price,p.timestamp)}if(Array.isArray(p.trendbar)&&p.trendbar.length) p.trendbar.forEach(b=>applyBar(id,b))}
    if(type===P.DEPTH_EVENT){
      const id=Number(p.symbolId);if(id===S.activeSymbolId){
        const d=S.depth||{bids:{},asks:{},updatedAt:null};
        (p.newQuotes||[]).forEach(q=>{const price=Number(q.bid!=null?q.bid:q.ask)/priceScale(id),size=Number(q.size||0)/100,key=String(q.id||price.toFixed(5));if(!Number.isFinite(price))return;(q.bid!=null?d.bids:d.asks)[key]={id:key,price,size}});
        (p.deletedQuotes||[]).forEach(qid=>{delete d.bids[String(qid)];delete d.asks[String(qid)]});
        d.updatedAt=Date.now();S.depth=d;const bv=Object.values(d.bids).reduce((a,x)=>a+Number(x.size||0),0),av=Object.values(d.asks).reduce((a,x)=>a+Number(x.size||0),0),imb=(bv+av)>0?(bv-av)/(bv+av):0;window.RIZVI_L2_STATUS={status:'LIVE',symbolId:id,updatedAt:d.updatedAt,events:Number((window.RIZVI_L2_STATUS||{}).events||0)+1,bidLevels:Object.keys(d.bids).length,askLevels:Object.keys(d.asks).length,bidSize:bv,askSize:av,imbalance:imb};emit('depth',{symbolId:id,depth:d,imbalance:imb,bidSize:bv,askSize:av});window.RIZVI_ORDER_FLOW={status:'CONNECTED',updatedAt:d.updatedAt,bids:d.bids,asks:d.asks,imbalance:imb};
      }
    }
    if(type===P.GET_TB_RES){const id=Number(p.symbolId);const bars=(p.trendbar||[]).map(b=>decodeBar(b,id)).filter(Boolean).sort((a,b)=>a.t-b.t);emit('history',{symbolId:id,bars});applyHistory(id,bars)}
    if(type===P.ERROR_RES)emit('error',{code:p.errorCode,message:p.description||p.errorCode});
  }
  async function accountAuth(){await send({payloadType:P.ACCOUNT_AUTH_REQ,ctidTraderAccountId:S.accountId,accessToken:S.token})}
  async function loadSymbols(){const r=await send({payloadType:P.SYMBOLS_LIST_REQ,ctidTraderAccountId:S.accountId,includeArchivedSymbols:false});S.symbols=r.symbol||[];S.symbolMap={};S.symbols.forEach(x=>S.symbolMap[norm(x.symbolName)]=x);emit('symbols',{symbols:S.symbols});}
  function startHeartbeat(){clearInterval(S.heartbeat);S.heartbeat=setInterval(()=>{try{if(S.ws&&S.ws.readyState===1)S.ws.send(JSON.stringify({clientMsgId:id(),payloadType:P.HEARTBEAT,payload:{}}))}catch{}},10000)}
  function priceScale(id){const s=S.symbols.find(x=>Number(x.symbolId)===Number(id));const d=Number(s&&s.digits);return Number.isFinite(d)&&d>=0&&d<=10?Math.pow(10,d):100000} function decodeBar(b,id){if(!b||b.low==null)return null;const scale=priceScale(id);const low=Number(b.low)/scale;const o=low+Number(b.deltaOpen||0)/scale;const c=low+Number(b.deltaClose||0)/scale;const h=low+Number(b.deltaHigh||0)/scale;return {t:Number(b.utcTimestampInMinutes||0)*60000,o,h,l:low,c,v:Number(b.volume||0)}}
  function find(name){const n=norm(name);return S.symbolMap[n]||S.symbols.find(x=>norm(x.symbolName)===n)||S.symbols.find(x=>norm(x.symbolName).startsWith(n)||n.startsWith(norm(x.symbolName)))}
  async function subscribe(symbolName,tf){
    const s=find(symbolName);if(!s)throw Error('cTrader symbol not found: '+symbolName);
    S.activeSymbolId=Number(s.symbolId);const period=PERIOD[String(tf||'M1').toUpperCase()]||1;
    await send({payloadType:P.SUB_SPOTS_REQ,ctidTraderAccountId:S.accountId,symbolId:[S.activeSymbolId],subscribeToSpotTimestamp:true});
    await send({payloadType:P.SUB_TB_REQ,ctidTraderAccountId:S.accountId,period,symbolId:S.activeSymbolId});
    S.depth={bids:{},asks:{},updatedAt:null};
    try{window.RIZVI_L2_STATUS={status:'SUBSCRIBING',symbolId:S.activeSymbolId,updatedAt:Date.now(),events:0,bidLevels:0,askLevels:0,imbalance:null};await send({payloadType:P.SUB_DEPTH_REQ,ctidTraderAccountId:S.accountId,symbolId:[S.activeSymbolId]})}catch(e){window.RIZVI_L2_STATUS={status:'ERROR',symbolId:S.activeSymbolId,updatedAt:Date.now(),error:e.message};emit('error',{message:'Depth subscription unavailable: '+e.message})}
    const now=Date.now(),from=now-(period===1?12:48)*60*60000;
    await send({payloadType:P.GET_TB_REQ,ctidTraderAccountId:S.accountId,fromTimestamp:from,toTimestamp:now,period,symbolId:S.activeSymbolId,count:260});
    emit('subscribed',{symbol:symbolName,symbolId:S.activeSymbolId,period});
  }
  function applyQuote(id,price,ts){if(id!==S.activeSymbolId)return;window.RIZVI_REAL_FEED={provider:'FxPro cTrader',symbol:window.__RIZVI_ACTIVE_SYMBOL||'XAU/USD',status:'REAL BROKER',price,updatedAt:ts?new Date(Number(ts)).toISOString():new Date().toISOString(),stale:false};if(window.state){window.state.price=price;window.state.history=window.state.history||[];window.state.history.push(price);window.state.history=window.state.history.slice(-260);if(typeof window.update==='function')window.update()}}
  function applyBar(id,b){if(id!==S.activeSymbolId)return;const x=decodeBar(b,id);if(!x)return;window.__RIZVI_CTRADER_LAST_BAR=x;emit('bar',x);if(window.state){window.state.ohlc=window.state.ohlc||[];const a=window.state.ohlc,i=a.findIndex(y=>y.t===x.t);if(i>=0)a[i]=x;else a.push(x);window.state.ohlc=a.slice(-260);window.state.history=window.state.ohlc.map(y=>y.c);if(typeof window.update==='function')window.update()}}
  function applyHistory(id,bars){if(id!==S.activeSymbolId||!window.state)return;window.state.ohlc=bars.slice(-260);window.state.history=window.state.ohlc.map(x=>x.c);if(window.state.ohlc.length)window.state.price=window.state.ohlc[window.state.ohlc.length-1].c;window.update&&window.update()}
  async function handleRedirect(url){try{if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Browser)await window.Capacitor.Plugins.Browser.close()}catch{} const u=new URL(url);const code=u.searchParams.get('code');if(!code)throw Error('No cTrader authorization code');await token(code);await connect();await send({payloadType:P.ACCOUNTS_REQ,accessToken:S.token});}
  window.RizviCTrader={configure,authUrl,connect,refresh,handleRedirect,subscribe,find,state:S,config:CFG};
  window.addEventListener('rizvi:ctrader-subscribe',e=>{const d=e.detail||{};if(S.authorized)subscribe(d.symbol,d.tf).catch(err=>emit('error',{message:err.message}))});
  function installUI(){
    if(document.getElementById('ctraderConnectPanel'))return;
    const gear=document.querySelector('.gear');
    const box=document.createElement('div');box.id='ctraderConnectPanel';box.style.cssText='position:fixed;inset:0;background:rgba(0,4,10,.78);backdrop-filter:blur(5px);display:none;align-items:center;justify-content:center;z-index:100;padding:18px';
    box.innerHTML='<div style="width:min(430px,94vw);background:#07111d;border:1px solid #24506b;border-radius:14px;padding:18px;box-shadow:0 25px 80px rgba(0,0,0,.55)"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">FxPro • cTrader Connection</b><button id="ctClose" style="background:#101f2e;border:1px solid #29445b;color:#cbd8e4;border-radius:7px;padding:6px 10px">✕</button></div><p style="font-size:11px;color:#7890a5;line-height:1.45">Read-only market data connection. Auto Trading remains OFF.</p><label style="font-size:10px;color:#7890a5">Client ID</label><input id="ctId" style="width:100%;margin:4px 0 9px;background:#06101a;color:#eaf2f8;border:1px solid #20394e;border-radius:6px;padding:9px"><label style="font-size:10px;color:#7890a5">Client Secret</label><input id="ctSecret" type="password" style="width:100%;margin:4px 0 9px;background:#06101a;color:#eaf2f8;border:1px solid #20394e;border-radius:6px;padding:9px"><label style="font-size:10px;color:#7890a5">Redirect URI</label><input id="ctRedirect" value="com.rizvi.dashboard://ctrader/callback" style="width:100%;margin:4px 0 12px;background:#06101a;color:#eaf2f8;border:1px solid #20394e;border-radius:6px;padding:9px;font-size:11px"><div style="display:flex;gap:8px"><button id="ctLogin" style="flex:1;background:#10966f;border:1px solid #23c995;color:white;padding:9px;border-radius:7px;font-weight:800">CONNECT cTRADER</button><button id="ctDisconnect" style="background:#101f2e;border:1px solid #29445b;color:#cbd8e4;padding:9px;border-radius:7px">DISCONNECT</button></div><div id="ctMsg" style="margin-top:10px;font-size:10px;color:#8fa8bc">Status: NOT CONFIGURED</div></div>';
    document.body.appendChild(box);
    const open=()=>{box.style.display='flex';document.getElementById('ctId').value=CFG.clientId;document.getElementById('ctRedirect').value=CFG.redirectUri;document.getElementById('ctMsg').textContent='Status: '+((window.RIZVI_CTRADER||{}).status||'NOT CONFIGURED')};
    const close=()=>box.style.display='none';
    if(gear)gear.addEventListener('click',open);
    document.getElementById('ctClose').onclick=close;
    document.getElementById('ctDisconnect').onclick=()=>{S.manualDisconnect=true;try{S.ws&&S.ws.close()}catch{};S.authorized=false;S.accountId=null;S.activeSymbolId=null;window.RIZVI_REAL_FEED={...(window.RIZVI_REAL_FEED||{}),status:'DISCONNECTED',stale:true};setStatus('DISCONNECTED',false);document.getElementById('ctMsg').textContent='Status: DISCONNECTED'};
    document.getElementById('ctLogin').onclick=async()=>{
      const clientId=document.getElementById('ctId').value.trim(),clientSecret=document.getElementById('ctSecret').value,redirectUri=document.getElementById('ctRedirect').value.trim();
      try{const url=configure({clientId,clientSecret,redirectUri,scope:'accounts',live:true});document.getElementById('ctMsg').textContent='Status: opening cTrader authorization…';if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Browser){window.Capacitor.Plugins.Browser.open({url})}else window.open(url,'_blank');}
      catch(e){document.getElementById('ctMsg').textContent='Error: '+e.message}
    };
    window.addEventListener('rizvi:ctrader',e=>{const d=e.detail||{};const m=document.getElementById('ctMsg');if(m)m.textContent='Status: '+(d.status||d.type||'CONNECTED')});
    if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.App){
      window.Capacitor.Plugins.App.addListener('appUrlOpen',e=>handleRedirect(e.url).catch(err=>emit('error',{message:err.message})));
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installUI);else installUI();
  setStatus('NOT CONFIGURED',false);
})();
/* XAU/BTC chart isolation */
(function(){'use strict';if(window.__RIZVI_XAU_LOCK)return;window.__RIZVI_XAU_LOCK=true;let active=window.RIZVI_CURRENT_SYMBOL||'BTCUSD';window.addEventListener('rizvi:symbol-change',e=>{active=e.detail&&e.detail.symbol||'BTCUSD';if(active==='XAU/USD'){window.RIZVI_RAW_BARS=[];window.RIZVI_AGG_BARS=[];}});})();
/* XAU/BTC HARD CHART SOURCE LOCK V3 */
(function(){'use strict';
 if(window.__RIZVI_XAU_BTC_HARD_LOCK_V3)return;
 window.__RIZVI_XAU_BTC_HARD_LOCK_V3=true;
 let active=window.RIZVI_CURRENT_SYMBOL||'BTCUSD';
 let raw=Array.isArray(window.RIZVI_RAW_BARS)?window.RIZVI_RAW_BARS:[];
 function isXAU(){return active==='XAU/USD'}
 function setRaw(v){if(!Array.isArray(v))return;if(isXAU()){const p=v.slice(-5).map(x=>Number(x&&x.c)).filter(Number.isFinite);if(!p.length||p.some(x=>x>20000||x<100))return;}raw=v.slice(-260)}
 try{Object.defineProperty(window,'RIZVI_RAW_BARS',{configurable:true,enumerable:true,get:()=>raw,set:setRaw})}catch(e){}
 async function fetchXAU(){
   if(!isXAU())return;
   try{
     let source='cTrader',d=null,b=[];
     try{
       const r=await fetch('/market/ctrader?symbol=XAUUSD&fresh='+Date.now(),{cache:'no-store'});
       d=await r.json();
       b=Array.isArray(d&&d.bars)?d.bars.filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)):[];
     }catch(e){}
     if(!b.length){
       source='XAUS';
       try{
         const r=await fetch('/market/xau/intraday?hours=12&fresh='+Date.now(),{cache:'no-store'});
         const x=await r.json();
         b=Array.isArray(x&&x.bars)?x.bars.filter(v=>[v.t,v.o,v.h,v.l,v.c].every(Number.isFinite)):[];
       }catch(e){}
     }
     if(!isXAU()||!b.length)return;
     const next=b.slice(-260);
     window.RIZVI_CANDLE_SYMBOL='XAU/USD';
     window.RIZVI_CANDLE_SOURCE=source;
     raw=next;
     window.RIZVI_AGG_BARS=typeof window.RIZVI_SET_TIMEFRAME==='function'
       ?window.RIZVI_SET_TIMEFRAME(window.RIZVI_CANDLE_TIMEFRAME||'1M',raw):raw;
     const last=next[next.length-1];
     const p=Number(d&&d.price);
     window.RIZVI_LIVE_CHART_PRICE=Number.isFinite(p)?p:Number(last.c);
     window.RIZVI_LIVE_PRICES=window.RIZVI_LIVE_PRICES||{};
     window.RIZVI_LIVE_PRICES['XAU/USD']=window.RIZVI_LIVE_CHART_PRICE;
     document.dispatchEvent(new CustomEvent('rizvi:candle-update',{detail:{symbol:'XAU/USD',bars:next.length,source:'XAU_HARD_LOCK_V4',feed:source}}));
     document.dispatchEvent(new CustomEvent('rizvi:price-update',{detail:{symbol:'XAU/USD',price:window.RIZVI_LIVE_CHART_PRICE,direction:window.RIZVI_SIGNAL_DIRECTION||'WAIT'}}));
   }catch(e){}
 }
 function switchTo(s){
   const next=s||'BTCUSD';
   const changed=next!==active;
   active=next;window.RIZVI_CURRENT_SYMBOL=active;
   if(isXAU()&&changed){raw=[];window.RIZVI_AGG_BARS=[];window.RIZVI_LIVE_CHART_PRICE=NaN;}
   if(isXAU())setTimeout(fetchXAU,50);
 }
 window.addEventListener('rizvi:symbol-change',e=>switchTo(e.detail&&e.detail.symbol));
 setInterval(fetchXAU,15000);
 switchTo(active);
})();
/* RIZVI PAGE STABILITY GOVERNOR V1
   Keep Lightweight Charts as the only active renderer.
   Remove detached legacy chart DOM and coalesce high-frequency layout pressure.
*/
(function(){
  'use strict';
  if(window.__RIZVI_PAGE_STABILITY_V1)return;
  window.__RIZVI_PAGE_STABILITY_V1=true;

  function stabilize(){
    try{
      ['rizviCandleCanvasV66','rizviSvgChartV73','rizviLiveSvgV78'].forEach(id=>{
        const el=document.getElementById(id);
        if(el) el.remove();
      });
      const chart=document.querySelector('.chart');
      if(chart){
        chart.style.contain='layout paint';
        chart.style.isolation='isolate';
      }
      const tv=document.getElementById('rizviTvChartV55');
      if(tv){
        tv.style.contain='layout paint size';
        tv.style.willChange='contents';
      }
      const axis=document.getElementById('rizviLiveTimeAxisV71');
      if(axis)axis.remove();
    }catch(e){}
  }

  function boot(){
    stabilize();
    /* Re-assert after legacy engines finish their delayed initialization. */
    setTimeout(stabilize,250);
    setTimeout(stabilize,1000);
    setTimeout(stabilize,2500);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();

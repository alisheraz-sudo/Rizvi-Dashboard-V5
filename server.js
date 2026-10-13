const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const ctrader=require('./ctrader-order-flow');
const {evaluateDiagnostics}=require('./indicator-proxy');

const USER=process.env.RIZVI_USER||'rizvi';
const PASS=process.env.RIZVI_PASSWORD||'CHANGE_ME';
const ROOT=__dirname;
const html=fs.readFileSync(path.join(ROOT,'index.html'));
const SESSION_SECRET=crypto.createHash('sha256').update(USER+'|'+PASS+'|RIZVI-V5').digest('hex');

function sign(value){return crypto.createHmac('sha256',SESSION_SECRET).update(value).digest('hex');}
function makeSession(){const value=USER+'|'+Date.now();return value+'.'+sign(value);}
function validSession(req){
 const raw=(req.headers.cookie||'').match(/(?:^|; )rizvi_session=([^;]+)/)?.[1]; if(!raw)return false;
 const dot=raw.lastIndexOf('.');if(dot<1)return false;const value=raw.slice(0,dot),sig=raw.slice(dot+1);
 if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(value))))return false;
 const parts=value.split('|');return parts[0]===USER&&Number.isFinite(Number(parts[1]))&&Date.now()-Number(parts[1])<7*24*60*60*1000;
}
function send(res,status,type,body,extra={}){res.writeHead(status,{'Content-Type':type,...extra});res.end(body);}
function loginPage(){return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#050b12"><title>Rizvi Dashboard V5 — Private Login</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#050b12;color:#e8eef5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}.card{width:min(430px,100%);background:#0a1420;border:1px solid #1d3448;border-radius:18px;padding:28px;box-shadow:0 20px 60px #0008}.logo{width:58px;height:58px;border-radius:14px;background:#050b12;border:1px solid #263b50;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:900;color:#f0ca67;margin-bottom:18px}.eyebrow{font-size:11px;color:#7890a5;letter-spacing:.12em;text-transform:uppercase;font-weight:800}.title{font-size:25px;font-weight:900;margin:5px 0 8px}.sub{color:#8fa4b6;font-size:13px;margin-bottom:22px}label{display:block;font-size:11px;color:#9db0c0;font-weight:800;margin:12px 0 7px}input{width:100%;padding:14px;border-radius:10px;border:1px solid #294055;background:#07111b;color:#fff;font-size:16px;outline:none}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#49d88f;color:#06130d;font-weight:900;font-size:15px}.note{margin-top:15px;font-size:11px;color:#657d90;text-align:center}</style></head><body><form class="card" method="POST" action="/login"><div class="logo">R</div><div class="eyebrow">Private workspace</div><div class="title">Rizvi Dashboard V5</div><div class="sub">Sign in to continue to your private trading dashboard.</div><label>Username</label><input name="username" autocomplete="username" required><label>Password</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">Sign In</button><div class="note">Private access • Manual Trading • Auto Trading OFF</div></form></body></html>`;}
function parseForm(body){const p=new URLSearchParams(body);return {username:p.get('username')||'',password:p.get('password')||''};}

const RIZVI_TV_SECRET=process.env.TV_WEBHOOK_SECRET||'';
const RIZVI_OF_LATEST=new Map(),RIZVI_OF_HISTORY=new Map();
function readJson(req){return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(body.length>200000)req.destroy();});req.on('end',()=>{try{resolve(body?JSON.parse(body):{})}catch(e){reject(e)}});req.on('error',reject);});}
function normalizedSymbol(x){return String(x||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function ofKey(x){return normalizedSymbol(x.symbol||x.ticker||'BTCUSDT');}
async function fetchXauJson(endpoint){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),10000);try{const r=await fetch('https://xaus.com'+endpoint,{headers:{Accept:'application/json'},signal:ctrl.signal});if(!r.ok)throw new Error('XAUS HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}}
function ofReply(res,status,obj){return send(res,status,'application/json; charset=utf-8',JSON.stringify(obj),{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'});}

// V5 reliability checkpoint: syntax-safe HTML injection and 30m BTC aggregation support.
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');
if(req.method==='OPTIONS')return ofReply(res,204,{ok:true});
if(url.pathname==='/tv/footprint'&&req.method==='POST'){if(RIZVI_TV_SECRET&&url.searchParams.get('secret')!==RIZVI_TV_SECRET)return ofReply(res,401,{ok:false,error:'unauthorized'});try{const payload=await readJson(req),key=ofKey(payload),row={...payload,symbol:key,source:'TradingView Footprint',receivedAt:Date.now()};RIZVI_OF_LATEST.set(key,row);const h=RIZVI_OF_HISTORY.get(key)||[];h.push(row);while(h.length>100)h.shift();RIZVI_OF_HISTORY.set(key,h);return ofReply(res,200,{ok:true,symbol:key,receivedAt:row.receivedAt});}catch(e){return ofReply(res,400,{ok:false,error:'invalid JSON'});}}
if(url.pathname==='/orderflow'&&req.method==='GET'){const key=String(url.searchParams.get('symbol')||'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g,'');return ofReply(res,200,{ok:true,symbol:key,data:RIZVI_OF_LATEST.get(key)||null,history:(RIZVI_OF_HISTORY.get(key)||[]).slice(-30)});}
if(url.pathname==='/market/ctrader'&&req.method==='GET'){const key=normalizedSymbol(url.searchParams.get('symbol')||'XAUUSD'),st=ctrader.status(),id=Object.keys(st.symbols||{}).find(k=>normalizedSymbol(st.symbols[k])===key),q=id?(st.quotes||{})[id]:null,bars=id?(st.bars||{})[id]:[];return ofReply(res,200,{ok:true,symbol:key,source:'cTrader',connected:!!st.connected,authorized:!!st.authorized,price:q?.price??null,bid:q?.bid??null,ask:q?.ask??null,updatedAt:q?.timestamp??null,bars:Array.isArray(bars)?bars:[],error:st.lastError||null});}
if(url.pathname==='/market/btc/intraday'&&req.method==='GET'){
 const requestedGran=Math.min(86400,Math.max(60,Number(url.searchParams.get('granularity')||60)));
 const interval=requestedGran>=3600?'60m':requestedGran>=1800?'30m':requestedGran>=900?'15m':requestedGran>=300?'5m':'1m';
 const freshnessSeconds=Math.max(180,requestedGran*3);
 let yahooError='Yahoo Finance unavailable';
 try{
  const u='https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=1d&interval='+interval+'&includePrePost=true&_='+Date.now();
  const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 RizviDashboard/5.0'},signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(!r.ok)throw new Error('Yahoo Finance HTTP '+r.status);
  const payload=await r.json(),result=payload?.chart?.result?.[0],ts=result?.timestamp||[],q=result?.indicators?.quote?.[0];
  if(payload?.chart?.error)throw new Error(payload.chart.error.description||'Yahoo chart error');
  const bars=Array.isArray(ts)&&q?ts.map((t,i)=>({t:Number(t),o:Number(q.open?.[i]),h:Number(q.high?.[i]),l:Number(q.low?.[i]),c:Number(q.close?.[i]),v:Number(q.volume?.[i]||0)})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)).sort((a,b)=>a.t-b.t):[];
  const age=bars.length?Math.floor(Date.now()/1000)-bars[bars.length-1].t:Infinity;
  if(!bars.length)throw new Error('Yahoo returned no valid OHLC bars');
  if(age>freshnessSeconds)throw new Error('Yahoo candles stale by '+age+'s');
  return ofReply(res,200,{ok:true,symbol:'BTCUSD',source:'Yahoo Finance',ticker:'BTC-USD',interval,bars,latestAgeSeconds:age,fallbackUsed:false,updatedAt:Date.now()});
 }catch(e){yahooError=String(e.message||'Yahoo Finance failed').slice(0,180);}
 try{
  const coinbaseGran=requestedGran===1800?900:Math.min(86400,Math.max(60,requestedGran));
  const r=await fetch('https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity='+coinbaseGran,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(!r.ok)throw new Error('Coinbase HTTP '+r.status);
  const data=await r.json(),bars=Array.isArray(data)?data.reverse().map(x=>({t:+x[0],l:+x[1],h:+x[2],o:+x[3],c:+x[4],v:+x[5]||0})).filter(x=>[x.t,x.l,x.h,x.o,x.c].every(Number.isFinite)):[];
  if(!bars.length)throw new Error('No BTC bars returned');
  return ofReply(res,200,{ok:true,symbol:'BTCUSD',source:'Coinbase fallback',bars,fallbackUsed:true,yahooError,updatedAt:Date.now()});
 }catch(e){return ofReply(res,502,{ok:false,symbol:'BTCUSD',source:'Yahoo Finance + Coinbase fallback',error:'Yahoo: '+yahooError+'; Coinbase: '+String(e.message||'feed failed').slice(0,120)});}
}

if(url.pathname==='/market/engine4-context'&&req.method==='GET'){
 const now=Date.now(),out={ok:true,updatedAt:now,dxy:{status:'UNAVAILABLE',reason:'DXY feed not yet validated'},usNews:{status:'UNAVAILABLE',reason:'US calendar feed not yet validated'}};
 const tasks=[
  (async()=>{const candidates=[
    {ticker:'DX-Y.NYB',source:'Yahoo Finance DX-Y.NYB'},
    {ticker:'DX=F',source:'Yahoo Finance DX=F futures proxy'}
   ];
   const errors=[];
   for(const candidate of candidates){try{
    const u='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(candidate.ticker)+'?range=1d&interval=5m&_='+now;
    const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 RizviDashboard/5.0'},signal:AbortSignal.timeout(10000),cache:'no-store'});
    if(!r.ok)throw new Error('Yahoo '+candidate.ticker+' HTTP '+r.status);
    const p=await r.json(),z=p?.chart?.result?.[0],ts=z?.timestamp||[],q=z?.indicators?.quote?.[0],bars=Array.isArray(ts)&&q?ts.map((t,i)=>({t:Number(t),c:Number(q.close?.[i])})).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.c)&&x.c>0):[],age=bars.length?Math.max(0,Math.floor(now/1000)-bars[bars.length-1].t):Infinity;
    if(p?.chart?.error)throw new Error(p.chart.error.description||'Yahoo chart error');
    if(bars.length<12||age>1800)throw new Error('DXY history insufficient or stale');
    out.dxy={status:'LIVE',source:candidate.source,bars,updatedAt:now,latestAgeSeconds:age};
    return;
   }catch(e){errors.push(candidate.ticker+': '+String(e.message||e).slice(0,100));}}
   out.dxy={status:'UNAVAILABLE',reason:errors.join(' | ').slice(0,240)||'DXY sources unavailable',updatedAt:now};
  })(),
  (async()=>{try{
   const from=new Date(now-86400000).toISOString().slice(0,10),to=new Date(now+7*86400000).toISOString().slice(0,10);
   const u='https://biquote.io/api/calendar?countries=US&importance=high&limit=500&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)+'&_='+now;
   const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 RizviDashboard/5.0'},signal:AbortSignal.timeout(10000),cache:'no-store'});
   if(!r.ok)throw new Error('BiQuote calendar HTTP '+r.status);
   const p=await r.json();if(!Array.isArray(p))throw new Error('BiQuote calendar returned invalid data');
   const events=p.map(e=>{const raw=e.time||e.datetime||e.scheduledAt||e.date||'',time=typeof raw==='number'?(raw<1e12?raw*1000:raw):Date.parse(raw);return {title:String(e.name||e.title||e.event||'Untitled event'),country:String(e.countryCode||e.country||''),currency:String(e.currency||''),impact:String(e.importance||e.impact||''),time:Number.isFinite(time)?time:null,timeMode:String(e.timeMode||'unknown'),sourceUrl:e.sourceUrl||null};})
    .filter(e=>e.time!==null&&(/US|UNITED STATES/i.test(e.country)||e.currency.toUpperCase()==='USD')&&/high/i.test(e.impact))
    .sort((a,b)=>a.time-b.time);
   if(!events.length&&p.length)throw new Error('BiQuote returned no parseable high-impact US events');
   const active=events.find(e=>(e.timeMode==='unknown'||e.timeMode==='exact')&&now>=e.time-30*60000&&now<=e.time+15*60000)||null;
   const next=events.find(e=>e.time>now)||null;
   out.usNews={status:'LIVE',source:'BiQuote public economic calendar',attribution:'https://biquote.io/docs/',events,blocked:!!active,activeEvent:active,nextEvent:next,windowBeforeMinutes:30,windowAfterMinutes:15,updatedAt:now};
  }catch(primary){try{
   const r=await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json?_'+now,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 RizviDashboard/5.0'},signal:AbortSignal.timeout(10000),cache:'no-store'});
   if(!r.ok)throw new Error('Forex Factory calendar HTTP '+r.status);
   const p=await r.json();if(!Array.isArray(p))throw new Error('Forex Factory calendar returned invalid data');
   const events=p.map(e=>{const raw=e.date||e.datetime||e.timestamp||'',time=typeof raw==='number'?(raw<1e12?raw*1000:raw):Date.parse(raw);return {title:String(e.title||e.event||'Untitled event'),country:String(e.country||''),currency:String(e.currency||''),impact:String(e.impact||''),time:Number.isFinite(time)?time:null,timeMode:'unknown'};})
    .filter(e=>e.time!==null&&(/USD|United States|US\b/i.test(e.country)||e.currency.toUpperCase()==='USD')&&/high/i.test(e.impact))
    .sort((a,b)=>a.time-b.time);
   const active=events.find(e=>now>=e.time-30*60000&&now<=e.time+15*60000)||null,next=events.find(e=>e.time>now)||null;
   out.usNews={status:'LIVE',source:'Forex Factory public weekly calendar (fallback)',attribution:'https://www.forexfactory.com/calendar',events,blocked:!!active,activeEvent:active,nextEvent:next,windowBeforeMinutes:30,windowAfterMinutes:15,updatedAt:now,primarySourceError:String(primary.message||primary).slice(0,120)};
  }catch(fallback){out.usNews={status:'UNAVAILABLE',reason:'BiQuote: '+String(primary.message||primary).slice(0,90)+'; fallback: '+String(fallback.message||fallback).slice(0,120),updatedAt:now};}}
  })()
 ];
 await Promise.all(tasks);
 return ofReply(res,200,out);
}
if(url.pathname==='/market/xau/spot'&&req.method==='GET'){
 try{
  const data=await fetchXauJson('/api/v1/spot?compact=1&fresh='+Date.now());
  const price=Number(data?.spot_usd_oz??data?.data?.spot_usd_oz);
  if(!Number.isFinite(price)||price<=0)throw new Error('XAUS spot response missing a valid price');
  return ofReply(res,200,{ok:true,symbol:'XAU/USD',source:'XAUS',data,updated_at:data?.updated_at||data?.price_as_of||Date.now()});
 }catch(primary){
  // If the spot quote endpoint is down, accept only a fresh, validated 1m OHLC close as a temporary quote fallback.
  // Keep the fallback source explicit; never present stale candles as live spot.
  try{
   const r=await fetch('https://biquote.io/api/XAUUSD/ohlc?interval=1m&limit=200',{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 RizviDashboard/5.0'},signal:AbortSignal.timeout(10000),cache:'no-store'});
   if(!r.ok)throw new Error('BiQuote HTTP '+r.status);
   const payload=await r.json(),rows=Array.isArray(payload)?payload:(Array.isArray(payload?.bars)?payload.bars:[]);
   const bars=rows.map(x=>{
    const raw=x.openTime??x.t??x.timestamp??x.time;
    const parsed=typeof raw==='string'&&!/^\\d+(\\.\\d+)?$/.test(raw)?Date.parse(raw):Number(raw);
    const t=Number.isFinite(parsed)?Math.floor(parsed>1e12?parsed/1000:parsed):NaN;
    return {t,c:Number(x.close??x.c)};
   }).filter(x=>Number.isFinite(x.t)&&Number.isFinite(x.c)&&x.c>0&&x.t<=Math.floor(Date.now()/1000)+5).sort((a,b)=>a.t-b.t);
   const last=bars.at(-1),age=last?Math.floor(Date.now()/1000)-last.t:Infinity;
   if(!last||age<0||age>180)throw new Error('BiQuote last candle missing or stale ('+age+'s)');
   return ofReply(res,200,{ok:true,symbol:'XAU/USD',source:'BIQUOTE-MT5-OHLC fallback',data:{spot_usd_oz:last.c},data_state:{status:'fallback-fresh-ohlc'},price_source:'BIQUOTE-MT5-OHLC',price_as_of:last.t,updated_at:Date.now(),fallbackUsed:true,primaryError:String(primary.message||primary).slice(0,140),latestAgeSeconds:age});
  }catch(fallback){
   return ofReply(res,502,{ok:false,symbol:'XAU/USD',source:'XAUS + BiQuote fallback',error:'XAUS: '+String(primary.message||primary).slice(0,100)+'; fallback: '+String(fallback.message||fallback).slice(0,120)});
  }
 }
}
if(url.pathname==='/market/xau/intraday'&&req.method==='GET'){
 const normalizeBars=rows=>{const now=Math.floor(Date.now()/1000);const epochSeconds=value=>{if(value==null)return NaN;let n;if(typeof value==='string'&&!/^\s*\d+(?:\.\d+)?\s*$/.test(value))n=Date.parse(value);else n=Number(value);if(!Number.isFinite(n)||n<=0)return NaN;if(n>=1e17)n/=1e9;else if(n>=1e14)n/=1e6;else if(n>=1e11)n/=1e3;return Math.floor(n);};return rows.map(x=>{const t=epochSeconds(x.openTime??x.t??x.timestamp??x.time??x.date);return {t,o:Number(x.open??x.o),h:Number(x.high??x.h),l:Number(x.low??x.l),c:Number(x.close??x.c),v:Number(x.tickVolume??x.volume??x.v??0)};}).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(Number.isFinite)&&x.t<=now+5).sort((a,b)=>a.t-b.t);};
 const fresh=bars=>{const age=bars.length?Math.floor(Date.now()/1000)-bars[bars.length-1].t:Infinity;return bars.length>0&&age>=0&&age<=180;};
 let primaryError='XAUS unavailable',staleFallback=null;
 try{
  const data=await fetchXauJson('/api/v1/chart?symbol=xau&range=1d&interval=1m&fresh='+Date.now()),rows=Array.isArray(data)?data:(data?.data||data?.bars||data?.points||[]),bars=normalizeBars(rows);
  const age=bars.length?Math.max(0,Math.floor(Date.now()/1000)-bars[bars.length-1].t):Infinity;
  if(fresh(bars))return ofReply(res,200,{ok:true,symbol:'XAU/USD',source:'XAUS-OHLC',interval:'1m',bars,updatedAt:Date.now(),latestAgeSeconds:age,stale:false,live:true});
  if(url.searchParams.get('allowStale')==='1'&&bars.length>=21)staleFallback={source:'XAUS-OHLC (last available; stale)',interval:'1m',bars,latestAgeSeconds:age,reason:'Last available Gold candles; live feed is not refreshing'};
  primaryError=bars.length?'XAUS candles stale':'XAUS returned no valid candles';
 }catch(e){primaryError=String(e.message||'XAUS request failed').slice(0,120);}
 try{
  // Yahoo's chart endpoint is unofficial; try the intended spot ticker first, then a clearly labeled COMEX futures proxy.
  // Yahoo Finance does not provide a working XAUUSD=X chart symbol here (HTTP 404).
  // Use its supported Gold futures ticker as a clearly labeled proxy; never mislabel it as spot XAU/USD.
  const candidates=[
   {ticker:'GC=F',label:'YAHOO-FINANCE-GOLD-FUTURES-GC=F',instrument:'COMEX Gold Futures (GC=F), NOT spot XAU/USD'}
  ];
  const yahooErrors=[];
  for(const candidate of candidates){
   try{
    const u='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(candidate.ticker)+'?range=1d&interval=1m&includePrePost=true&_='+Date.now();
    const r=await fetch(u,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0 RizviDashboard/5.0'},signal:AbortSignal.timeout(10000),cache:'no-store'});
    if(!r.ok)throw new Error('Yahoo Finance HTTP '+r.status);
    const payload=await r.json(),result=payload?.chart?.result?.[0],ts=result?.timestamp||[],q=result?.indicators?.quote?.[0];
    if(payload?.chart?.error)throw new Error('Yahoo Finance '+(payload.chart.error.description||'feed error'));
    const rows=Array.isArray(ts)&&q?ts.map((t,i)=>({t,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i],v:q.volume?.[i]||0})).filter(x=>[x.t,x.o,x.h,x.l,x.c].every(v=>Number.isFinite(Number(v)))):[];
    const bars=normalizeBars(rows);
    const age=bars.length?Math.max(0,Math.floor(Date.now()/1000)-bars[bars.length-1].t):Infinity;
    if(!fresh(bars)){
     if(url.searchParams.get('allowStale')==='1'&&bars.length>=21&&(!staleFallback||age<staleFallback.latestAgeSeconds))staleFallback={source:candidate.label+' (last available; stale)',instrument:candidate.instrument,interval:'1m',bars,latestAgeSeconds:age,reason:'Last available Gold futures candles; not live spot XAU/USD'};
     throw new Error(bars.length?'candles stale':'no valid OHLC candles');
    }
    return ofReply(res,200,{ok:true,symbol:'XAU/USD',source:candidate.label,instrument:candidate.instrument,interval:'1m',bars,updatedAt:Date.now(),latestAgeSeconds:age,stale:false,live:true});
   }catch(yahooError){yahooErrors.push(candidate.ticker+': '+String(yahooError.message||'Yahoo request failed').slice(0,90));}
  }
  throw new Error(yahooErrors.join(' | '));
 }catch(e){primaryError+='; Yahoo fallback: '+String(e.message||'Yahoo Finance failed').slice(0,180);}
 try{
  const r=await fetch('https://biquote.io/api/XAUUSD/ohlc?interval=1m&limit=200',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('BiQuote HTTP '+r.status);
  const data=await r.json(),bars=normalizeBars(Array.isArray(data?.bars)?data.bars:[]);
  const age=bars.length?Math.max(0,Math.floor(Date.now()/1000)-bars[bars.length-1].t):Infinity;
  if(!fresh(bars)){
   if(url.searchParams.get('allowStale')==='1'&&bars.length>=21&&(!staleFallback||age<staleFallback.latestAgeSeconds))staleFallback={source:'BIQUOTE-MT5-OHLC (last available; stale)',interval:'1m',bars,latestAgeSeconds:age,reason:'Last available Gold OHLC; not a live feed'};
   throw new Error(bars.length?'BiQuote candles stale':'BiQuote returned no valid XAUUSD candles');
  }
  return ofReply(res,200,{ok:true,symbol:'XAU/USD',source:'BIQUOTE-MT5-OHLC',interval:'1m',bars,updatedAt:Date.now(),latestAgeSeconds:age,stale:false,live:true});
 }catch(e){if(staleFallback)return ofReply(res,200,{ok:true,symbol:'XAU/USD',...staleFallback,updatedAt:Date.now(),stale:true,live:false});return ofReply(res,502,{ok:false,symbol:'XAU/USD',source:'OHLC-fallbacks',error:'No fresh Gold candles; '+primaryError+'; fallback: '+String(e.message||'BiQuote failed').slice(0,120)});}
}
if(url.pathname==='/health')return send(res,200,'text/plain; charset=utf-8','ok');
if(url.pathname==='/ctrader/status'&&req.method==='GET')return ofReply(res,200,{ok:true,data:ctrader.status()});

if(url.pathname==='/ctrader/auth-url'&&req.method==='GET'){if(!process.env.CTRADER_CLIENT_ID)return ofReply(res,503,{ok:false,error:'CTRADER_CLIENT_ID not configured'});const redirect=process.env.CTRADER_REDIRECT_URI||(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host+'/ctrader/callback',scope=process.env.CTRADER_SCOPE||'accounts',u=new URL('https://id.ctrader.com/my/settings/openapi/grantingaccess/');u.searchParams.set('client_id',process.env.CTRADER_CLIENT_ID);u.searchParams.set('redirect_uri',redirect);u.searchParams.set('scope',scope);u.searchParams.set('product','web');return ofReply(res,200,{ok:true,authorizationUrl:u.toString(),redirectUri:redirect,scope});}
if(url.pathname==='/ctrader/callback'&&req.method==='GET'){const code=url.searchParams.get('code');if(code&&process.env.CTRADER_CLIENT_ID&&process.env.CTRADER_CLIENT_SECRET){try{const redirect=process.env.CTRADER_REDIRECT_URI||(req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host+'/ctrader/callback',qs=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirect,client_id:process.env.CTRADER_CLIENT_ID,client_secret:process.env.CTRADER_CLIENT_SECRET}),tr=await fetch('https://openapi.ctrader.com/apps/token?'+qs.toString(),{headers:{Accept:'application/json'}}),data=await tr.json();if(tr.ok&&!data.errorCode){ctrader.state.accessToken=data.accessToken;ctrader.state.refreshToken=data.refreshToken;await ctrader.start();return send(res,200,'text/html; charset=utf-8','<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;background:#050b12;color:#e8eef5;padding:32px"><h2>cTrader authorization complete</h2><p>Rizvi is now attempting the Level-2 connection.</p><p>For persistent Railway restarts, copy the new refresh token into <b>CTRADER_REFRESH_TOKEN</b> in Railway Variables.</p><p>You may close this page.</p></body>',{'Cache-Control':'no-store'});}return send(res,400,'text/plain; charset=utf-8','cTrader authorization failed: '+(data.description||data.errorCode||'unknown error'));}catch(e){return send(res,500,'text/plain; charset=utf-8','cTrader authorization error: '+e.message);}}return res.writeHead(302,{Location:'/?ctrader_error=authorization_failed','Cache-Control':'no-store'}).end();}
if(url.pathname==='/login'&&req.method==='GET'){if(validSession(req))return res.writeHead(302,{Location:'/'});return send(res,200,'text/html; charset=utf-8',loginPage(),{'Cache-Control':'no-store'});}
if(url.pathname==='/login'&&req.method==='POST'){let body='';req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});return req.on('end',()=>{const {username,password}=parseForm(body);if(username===USER&&password===PASS)return res.writeHead(302,{Location:'/', 'Set-Cookie':`rizvi_session=${makeSession()}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`,'Cache-Control':'no-store'}).end();return send(res,401,'text/html; charset=utf-8',loginPage().replace('</form>','<div style="color:#ff7182;font-size:12px;margin-top:12px;text-align:center">Invalid username or password.</div></form>'),{'Cache-Control':'no-store'});});}
if(url.pathname==='/logout')return res.writeHead(302,{Location:'/login','Set-Cookie':'rizvi_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'}).end();
if(!validSession(req))return res.writeHead(302,{Location:'/login','Cache-Control':'no-store'}).end();
if(url.pathname==='/ctrader/orderflow'&&(req.method==='GET'||req.method==='POST')){
 if(!validSession(req))return ofReply(res,401,{ok:false,error:'Authentication required'});
 if(req.method==='POST'){
  try{
   const payload=await readJson(req),symbol=normalizedSymbol(payload.symbol||'XAUUSD');
   if(symbol!=='XAUUSD')return ofReply(res,400,{ok:false,error:'Only XAUUSD depth is accepted'});
   const levels=(Array.isArray(payload.levels)?payload.levels:[]).slice(0,500).map(x=>({price:Number(x.price),bid:Number(x.bid||0),ask:Number(x.ask||0),time:Number(x.time)||Date.now()})).filter(x=>Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.bid)&&x.bid>=0&&Number.isFinite(x.ask)&&x.ask>=0);
   if(!levels.length)return ofReply(res,400,{ok:false,error:'No valid depth levels'});
   const now=Date.now();global.RIZVI_CTRADER_ORDER_FLOW={symbol,levels,updatedAt:now,source:'CTRADER_LEVEL2'};
   return ofReply(res,200,{ok:true,symbol,levels:levels.length,updatedAt:now});
  }catch(e){return ofReply(res,400,{ok:false,error:'Invalid order-flow payload'});}
 }
 const key=normalizedSymbol(url.searchParams.get('symbol')||'XAUUSD'),data=global.RIZVI_CTRADER_ORDER_FLOW;
 const age=data?Date.now()-Number(data.updatedAt):Infinity;
 if(!data||!Number.isFinite(age)||age<0||age>30000||(data.symbol&&normalizedSymbol(data.symbol)!==key))return ofReply(res,200,{ok:true,connected:ctrader.status().connected,data:null});
 return ofReply(res,200,{ok:true,connected:ctrader.status().connected,data});
}
 if(url.pathname==='/api/indicator-diagnostics'&&req.method==='POST'){try{const payload=await readJson(req);const result=await evaluateDiagnostics(payload);return ofReply(res,result.status,result.body);}catch(e){return ofReply(res,400,{ok:false,signal:'WAIT',confidence:null,reason:'Invalid diagnostics request',autoTrading:false});}}
if(url.pathname==='/internal/feed-diagnostic'&&req.method==='POST'){try{const d=await readJson(req),sym=String(d.symbol||'').slice(0,16),tf=String(d.timeframe||'').slice(0,8),reason=String(d.reason||'').replace(/[\r\n\t]/g,' ').slice(0,220);console.warn('[RIZVI_FEED_DIAG]',JSON.stringify({symbol:sym,timeframe:tf,reason,at:new Date().toISOString()}));return ofReply(res,200,{ok:true});}catch(e){return ofReply(res,400,{ok:false,error:'invalid diagnostic'});}}
const files={'/':'index.html','/index.html':'index.html','/manifest.webmanifest':'manifest.webmanifest','/sw.js':'sw.js','/icons/rizvi-192.svg':'icons/rizvi-192.svg','/icons/rizvi-512.svg':'icons/rizvi-512.svg'};
if(url.pathname.endsWith('.js')&&!url.pathname.includes('/',1)&&/^[A-Za-z0-9._-]+\.js$/.test(url.pathname.slice(1)))files[url.pathname]=url.pathname.slice(1);
const rel=files[url.pathname];
if(rel){const filePath=path.join(ROOT,rel);try{const data=fs.readFileSync(filePath);const type=rel.endsWith('.html')?'text/html; charset=utf-8':rel.endsWith('.js')?'application/javascript; charset=utf-8':rel.endsWith('.webmanifest')?'application/manifest+json':'image/svg+xml';const extra={'Cache-Control':(rel==='index.html'||rel.endsWith('.js')||rel==='sw.js')?'no-store':'private, max-age=3600'};if(rel==='sw.js')extra['Service-Worker-Allowed']='/';const body=rel==='index.html'?(()=>{let h=data.toString();
const disableIds=['rizvi-v55-tradingview-lib','rizvi-single-chart-owner-v3','rizvi-live-canvas-chart-v72','rizvi-chart-v76','rizvi-chart-v77','rizvi-chart-v78'];
for(const id of disableIds){const marker='<script id="'+id+'"';const p=h.indexOf(marker);if(p>=0){const e=h.indexOf('</script>',p);if(e>=0)h=h.slice(0,p)+'<script id="'+id+'">/* disabled: direct TradingView chart is sole owner */</script>'+h.slice(e+9);}}
h=h.replace('</body>','<script src="/indicator-diagnostics-bridge.js" defer></script><script>window.RIZVI_AUTO_TRADING=false;</script></body>');return Buffer.from(h)})():data;return send(res,200,type,body,extra);}catch{return send(res,404,'text/plain; charset=utf-8','Not found');}}
return send(res,404,'text/plain; charset=utf-8','Not found');});
if(process.env.CTRADER_CLIENT_ID&&process.env.CTRADER_CLIENT_SECRET&&(process.env.CTRADER_ACCESS_TOKEN||process.env.CTRADER_REFRESH_TOKEN))ctrader.start().catch(err=>console.error('cTrader startup failed:',err.message));
server.listen(process.env.PORT||10000,'0.0.0.0');
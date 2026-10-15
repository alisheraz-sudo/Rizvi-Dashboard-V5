/**
 * Isolated shadow runner. Reads the production public XAU OHLC endpoint only.
 * Never places orders, never POSTs to production, and never modifies production.
 * Stops sampling after five minutes and keeps process alive for log inspection.
 */
const BASE = {trend:.22,momentum:.18,rsi:.12,vwap:.12,candle:.10,liquidity:.12,divergence:.08,volume_profile:.06};
const BIASES = {
 TRENDING_UP:{trend:1.45,momentum:1.35,vwap:1.15,divergence:.70},
 TRENDING_DOWN:{trend:1.45,momentum:1.35,vwap:1.15,divergence:.70},
 RANGING:{rsi:1.40,divergence:1.30,liquidity:1.20,trend:.70,momentum:.75},
 HIGH_VOLATILITY:{liquidity:1.30,candle:1.20,momentum:.90,rsi:.85}, MIXED:{}
};
const endpoint = process.env.XAU_FEED_URL || 'https://rizvi-dashboard-production.up.railway.app/market/xau/intraday';
const durationMs = 5 * 60 * 1000, intervalMs = 10 * 1000, started = Date.now();
const records = [];
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function detect(bars){
 const closes=bars.map(x=>x.c), last=closes.at(-1), ema=(arr,n)=>{let v=arr[0];const k=2/(n+1);for(const x of arr.slice(1))v=x*k+v*(1-k);return v};
 const e20=ema(closes.slice(-Math.min(80,closes.length)),20), e50=ema(closes.slice(-Math.min(120,closes.length)),50);
 const changes=closes.slice(1).map((x,i)=>x-closes[i]), ranges=bars.slice(-20).map(x=>x.h-x.l), avgRange=mean(ranges), recentRange=bars.at(-1).h-bars.at(-1).l;
 const slope=(last-e20)/Math.max(Math.abs(last)*0.00001,avgRange,0.01);
 const rc=clamp(Math.abs(slope)/2,0.15,0.95);
 let regime='MIXED';
 if(avgRange>0&&recentRange>avgRange*1.8)regime='HIGH_VOLATILITY';
 else if(Math.abs(e20-e50)>avgRange*.7)regime=e20>e50?'TRENDING_UP':'TRENDING_DOWN';
 else if(avgRange>0&&Math.abs(e20-e50)<avgRange*.25)regime='RANGING';
 const last10=changes.slice(-10), mom=mean(last10), net=closes.at(-1)-closes.at(-Math.min(11,closes.length));
 const up=bars.slice(-14).reduce((s,b)=>s+Math.max(0,b.c-b.o),0),dn=bars.slice(-14).reduce((s,b)=>s+Math.max(0,b.o-b.c),0);
 const rsi=dn===0?1:(up===0?-1:clamp((up-dn)/(up+dn),-1,1));
 const vwapBars=bars.slice(-Math.min(100,bars.length)),vol=vwapBars.reduce((s,b)=>s+Math.max(0,b.v||0),0);
 const vwap=vol>0?vwapBars.reduce((s,b)=>s+b.c*Math.max(0,b.v||0),0)/vol:mean(vwapBars.map(b=>b.c));
 const prev=bars.at(-2)||bars.at(-1), cur=bars.at(-1);
 const features={
  trend:clamp((e20-e50)/Math.max(avgRange,0.01),-1,1),
  momentum:clamp(net/Math.max(avgRange*3,0.01),-1,1),
  rsi, vwap:clamp((last-vwap)/Math.max(avgRange*2,0.01),-1,1),
  candle:clamp((cur.c-cur.o)/Math.max(cur.h-cur.l,0.01),-1,1),
  liquidity:clamp((last-Math.min(...bars.slice(-20).map(b=>b.l)) - (Math.max(...bars.slice(-20).map(b=>b.h))-last))/Math.max(avgRange,0.01),-1,1),
  divergence:clamp((last-closes.at(-Math.min(8,closes.length)))/Math.max(avgRange*4,0.01),-1,1),
  volume_profile:vol>0?clamp((last-vwap)/Math.max(avgRange*2,0.01),-1,1):null
 };
 return {regime,regimeConfidence:rc,features,barAgeSeconds:Math.max(0,Math.floor(Date.now()/1000)-cur.t)};
}
function score(features,regime,rc){
 const weighted=0;let sum=0,total=0,active=[],signs=[],weights={};
 for(const [name,base] of Object.entries(BASE)){const raw=features[name];if(raw===null||raw===undefined||!Number.isFinite(raw))continue;
  const value=clamp(raw,-1,1),weight=base*(1+((BIASES[regime]?.[name]??1)-1)*rc);
  sum+=value*weight;total+=weight;active.push(name);signs.push(value>.05?1:value<-.05?-1:0);weights[name]=Number(weight.toFixed(5));
 }
 if(!active.length||total<=0)return {action:'WAIT',confidence:0,score:0,agreement:0,active,weights,reason:'NO_VALID_FEATURES'};
 const rawScore=sum/total, nz=signs.filter(x=>x!==0),agreement=nz.length?Math.abs(nz.reduce((a,b)=>a+b,0))/nz.length:0;
 const confidence=Math.round(100*Math.abs(rawScore)*(.65+.35*agreement)*(.75+.25*rc));
 let action=rawScore>0?'BUY':rawScore<0?'SELL':'WAIT';if(confidence<55||active.length<3||agreement<.25)action='WAIT';
 return {action,confidence:Math.min(100,confidence),score:Number(rawScore.toFixed(5)),agreement:Number(agreement.toFixed(4)),active,weights,reason:action==='WAIT'?'QUALITY_GATE':'OK'};
}
async function sample(){
 const at=new Date().toISOString();
 try{
  const r=await fetch(endpoint,{headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw new Error('feed HTTP '+r.status);
  const payload=await r.json();const bars=(payload.bars||[]).map(b=>({t:Number(b.t),o:Number(b.o),h:Number(b.h),l:Number(b.l),c:Number(b.c),v:Number(b.v||0)})).filter(b=>[b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)&&b.c>0);
  if(bars.length<30)throw new Error('insufficient valid OHLC bars: '+bars.length);
  const m=detect(bars),s=score(m.features,m.regime,m.regimeConfidence);
  const rec={at,source:payload.source||'unspecified',symbol:payload.symbol||'unknown',live:payload.live===true,stale:payload.stale===true,barCount:bars.length,barAgeSeconds:m.barAgeSeconds,price:bars.at(-1).c,regime:m.regime,regimeConfidence:Number(m.regimeConfidence.toFixed(3)),features:m.features,adaptive:s,pythonParity:'NOT_RUN'};
  records.push(rec);console.log('[SHADOW_SAMPLE] '+JSON.stringify(rec));
 }catch(e){const rec={at,error:String(e.message||e)};records.push(rec);console.log('[SHADOW_ERROR] '+JSON.stringify(rec));}
}
(async()=>{
 console.log('[SHADOW_START] '+JSON.stringify({at:new Date(started).toISOString(),durationSeconds:300,intervalSeconds:10,endpoint,mode:'READ_ONLY_XAUUSD_NO_ORDERS'}));
 await sample();const timer=setInterval(async()=>{if(Date.now()-started>=durationMs){clearInterval(timer);const ok=records.filter(r=>r.adaptive),feedOk=ok.filter(r=>r.live&&!r.stale),regimes=[...new Set(ok.map(r=>r.regime))],actions={BUY:0,SELL:0,WAIT:0};for(const r of ok)actions[r.adaptive.action]=(actions[r.adaptive.action]||0)+1;
 console.log('[SHADOW_FINAL] '+JSON.stringify({startedAt:new Date(started).toISOString(),endedAt:new Date().toISOString(),durationSeconds:Math.round((Date.now()-started)/1000),samples:records.length,validSamples:ok.length,feedMarkedLiveFresh:feedOk.length,errors:records.filter(r=>r.error).length,regimes,actions,pythonParity:'NOT_RUN: this Node runner does not execute Python',productionEngine5Parity:'NOT_COMPARABLE: production audit is not fetched in lockstep',note:'Shadow outputs are experimental scores, not calibrated win probabilities or trading advice.'}));return;}await sample();},intervalMs);
})();
setInterval(()=>{},60_000);

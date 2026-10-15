(function(){
'use strict';
const W=window;
if(W.__RIZVI_ENGINE5_AUDIT_BRIDGE)return;
W.__RIZVI_ENGINE5_AUDIT_BRIDGE=true;
const now=()=>Date.now();
const safeNum=v=>v==null||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
const cleanText=(v,max=240)=>String(v==null?'':v).replace(/[\r\n\t]/g,' ').slice(0,max);
function componentMap(){
 const sources=[
  W.RIZVI_INDICATOR_CONFLUENCE?.components,
  W.RIZVI_INDICATOR_TEST_REPORT?.master?.components,
  W.RIZVI_INDICATOR_TEST_REPORT?.components,
  W.RIZVI_MASTER_CONFIRMATION?.indicatorStatus,
  W.RIZVI_INDICATOR_ENGINE_STATUS?.indicators,
  W.RIZVI_GOLD_ENGINE_STATUS?.indicators
 ].filter(x=>x&&typeof x==='object');
 const out={};
 for(const source of sources){
  for(const [name,v] of Object.entries(source)){
   if(out[name])continue;
   out[name]={
    status:cleanText(v?.status||(v?.score!=null?'CALCULATED':'MISSING_REPORT'),64),
    score:safeNum(v?.score),
    bias:safeNum(v?.bias),
    value:cleanText(v?.value??v?.display??v?.result??'',120),
    note:cleanText(v?.note??'',180)
   };
  }
 }
 return out;
}
function buildAuditRecord(){
 const master=W.RIZVI_MASTER_CONFIRMATION||null;
 const e5=master?.engine5||{};
 const report=W.RIZVI_MULTI_ALGORITHM_REPORT||{};
 const confluence=W.RIZVI_INDICATOR_CONFLUENCE||{};
 const status=W.RIZVI_INDICATOR_ENGINE_STATUS||{};
 const feed=W.RIZVI_FEED_STATUS||W.RIZVI_GOLD_ENGINE_STATUS?.feed||{};
 const groups=Array.isArray(confluence.groups)?confluence.groups:[];
 // These are indicator-confluence groups (C1-C6), not independent engines.
 // Keep them separately labeled so audit metrics cannot misrepresent them as Engine 1-4.
 const derivedIndicatorGroups=groups.map((x,i)=>({
  group:`C${i+1}`,reportAvailable:!!x,score:x?safeNum(x.score):null,bias:x?safeNum(x.bias):null,
  indicatorCount:x?safeNum(x.rows):null,
  direction:x?(Number(x.bias)>0?'BUY':Number(x.bias)<0?'SELL':'WAIT'):'NOT_REPORTED'
 }));
 const algorithms=Object.entries(report.algorithms||{}).map(([name,x])=>({
  name,action:cleanText(x?.action||'WAIT',16),confidence:safeNum(x?.confidence),
  agreement:safeNum(x?.agreement),activeIndicators:safeNum(x?.activeIndicators)
 }));
 const indicators=componentMap();
 const algoMean=algorithms.length?algorithms.reduce((sum,x)=>sum+(x.confidence??0),0)/algorithms.length:0;
 const calculatedConfidence=master?Math.round(((safeNum(e5.indicatorScore??confluence.score)??0)+algoMean)/2):null;
 const blockers=[];
 if(!master)blockers.push('MASTER_CONFIRMATION_MISSING');
 if(master&&!master.qualified){
  if(e5.indicatorAction==='WAIT')blockers.push('indicator-WAIT');
  const score=safeNum(e5.indicatorScore??confluence.score),agreement=safeNum(e5.indicatorAgreement??confluence.agreement);
  if(score==null)blockers.push('indicator-score-missing');else if(score<70)blockers.push('indicator-score-below-70');
  if(agreement==null)blockers.push('agreement-missing');else if(agreement<70)blockers.push('agreement<70');
  if(calculatedConfidence<80)blockers.push('confidence<80');
  if(safeNum(e5.algorithmsAligned)<4)blockers.push('aligned-algorithms<4');
  if(safeNum(e5.algorithmsEvaluated??algorithms.length)<5)blockers.push('algorithms-evaluated<5');
  if(safeNum(e5.activeIndicators)<6)blockers.push('active-indicators<6');
  if(safeNum(e5.qualifiedRuns)<safeNum(e5.requiredQualifiedRuns||3))blockers.push('qualified-confirmation-runs-incomplete');
  if(master.reason)blockers.push(cleanText(master.reason,120));
 }
 return {
  schema:'rizvi-engine-audit-v1',eventId:(W.crypto&&W.crypto.randomUUID)?W.crypto.randomUUID():String(now())+'-'+Math.random().toString(36).slice(2,10),
  at:new Date().toISOString(),symbol:cleanText(master?.symbol||status.symbol||W.RIZVI_CURRENT_SYMBOL||'UNKNOWN',20),
  timeframe:cleanText(status.timeframe||W.RIZVI_CANDLE_TIMEFRAME||'UNKNOWN',12),
  feed:{ok:feed.ok===true,live:feed.live===true,stale:feed.stale===true,source:cleanText(feed.source||'',80),
   barCount:safeNum(feed.bars??feed.barCount),latestAgeSeconds:safeNum(feed.latestAgeSeconds),
   updatedAt:safeNum(feed.updatedAt),reason:cleanText(feed.reason||'',200)},
  engines:[],independentEngineReport:false,derivedIndicatorGroups,indicators,
  algorithms,
  engine5:{available:!!master,action:cleanText(master?.direction||'WAIT',16),
   qualified:master?.qualified===true,confidence:calculatedConfidence,displayConfidence:safeNum(master?.confidence),
   indicatorAction:cleanText(e5.indicatorAction||confluence.action||'WAIT',16),
   indicatorScore:safeNum(e5.indicatorScore??confluence.score),
   agreement:safeNum(e5.indicatorAgreement??confluence.agreement),
   algorithmMajority:cleanText(e5.algorithmMajority||master?.alignment?.algorithmMajority||'WAIT',16),
   algorithmsEvaluated:safeNum(e5.algorithmsEvaluated??algorithms.length),
   algorithmsAligned:safeNum(e5.algorithmsAligned),qualifiedRuns:safeNum(e5.qualifiedRuns),
   requiredQualifiedRuns:safeNum(e5.requiredQualifiedRuns),barCount:safeNum(e5.barCount),
   lastPrice:safeNum(e5.lastPrice),barAgeMs:safeNum(e5.barAgeMs),
   status:cleanText(master?.status||'MISSING_REPORT',40),
   reason:cleanText(master?.reason||'',240),blockers:[...new Set(blockers.map(x=>cleanText(x,100)))],
   autoTrading:W.RIZVI_AUTO_TRADING===false?false:master?.autoTrading===false?false:'UNKNOWN'},
  diagnostic:{indicatorValidation:cleanText(W.RIZVI_INDICATOR_TEST_REPORT?.validationLevel||'NOT_REPORTED',48),
   numericalAccuracyVerified:W.RIZVI_INDICATOR_TEST_REPORT?.numericalAccuracyVerified===true,
   engineStatus:cleanText(status.state||'NOT_REPORTED',40)}
 };
}
W.RIZVI_BUILD_ENGINE_AUDIT=buildAuditRecord;
let lastSent=0,lastDecision='',lastSignature='',inFlight=false;
async function publish(){
 if(inFlight||typeof W.fetch!=='function')return;
 const record=buildAuditRecord();
 const decision=JSON.stringify({action:record.engine5.action,qualified:record.engine5.qualified,blockers:record.engine5.blockers});
 const signature=JSON.stringify({decision,score:record.engine5.indicatorScore,agreement:record.engine5.agreement,
  majority:record.engine5.algorithmMajority,algorithms:record.algorithms.map(x=>[x.name,x.action,x.confidence]),
  feed:[record.feed.ok,record.feed.live,record.feed.stale,record.feed.source,record.feed.latestAgeSeconds]});
 const time=now(),urgent=decision!==lastDecision;
 if(!urgent&&signature===lastSignature&&time-lastSent<60000)return;
 if(!urgent&&time-lastSent<15000)return;
 lastDecision=decision;lastSignature=signature;lastSent=time;inFlight=true;
 try{
  const response=await W.fetch('/internal/engine-audit',{method:'POST',credentials:'same-origin',
   headers:{'Content-Type':'application/json'},body:JSON.stringify(record),cache:'no-store',keepalive:true});
  if(!response.ok)W.console?.warn?.('[RIZVI_ENGINE_AUDIT] upload rejected',response.status);
 }catch(error){W.console?.warn?.('[RIZVI_ENGINE_AUDIT] upload failed',cleanText(error?.message||error,160));}
 finally{inFlight=false;}
}
['rizvi:master-confirmation-update','rizvi:multi-algorithm-update','rizvi:indicator-confluence-update'].forEach(name=>W.addEventListener(name,()=>{publish();}));
W.addEventListener('online',publish);
W.setInterval(publish,5000);
W.setTimeout(publish,2500);
})();
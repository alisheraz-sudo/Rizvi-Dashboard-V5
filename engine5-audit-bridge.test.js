const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'engine5-audit-bridge.js'),'utf8');
function buildWindow(overrides={}){
 const w={
  RIZVI_AUTO_TRADING:false,RIZVI_CURRENT_SYMBOL:'XAU/USD',RIZVI_CANDLE_TIMEFRAME:'1M',
  RIZVI_FEED_STATUS:{ok:true,live:true,stale:false,source:'BIQUOTE-MT5-OHLC',bars:201,latestAgeSeconds:20,updatedAt:1000},
  RIZVI_INDICATOR_CONFLUENCE:{action:'WAIT',score:58,agreement:100,groups:[
   {bias:1,score:61,rows:5},{bias:1,score:60,rows:4},{bias:1,score:55,rows:2},{bias:-1,score:50,rows:3}
  ],components:{'EMA 9/21':{status:'CALCULATED',score:64,bias:1,value:'BUY'}}},
  RIZVI_INDICATOR_TEST_REPORT:{validationLevel:'OUTPUT_SANITY_ONLY',numericalAccuracyVerified:false},
  RIZVI_MULTI_ALGORITHM_REPORT:{algorithms:{
   A_TREND:{action:'BUY',confidence:100,agreement:100,activeIndicators:5},
   B_MOMENTUM:{action:'BUY',confidence:100,agreement:100,activeIndicators:4},
   C_LIQUIDITY:{action:'BUY',confidence:78,agreement:80,activeIndicators:4},
   E_REVERSAL:{action:'BUY',confidence:70,agreement:80,activeIndicators:4},
   F_FULL:{action:'BUY',confidence:83,agreement:90,activeIndicators:5}
  }},
  RIZVI_MASTER_CONFIRMATION:{symbol:'XAU/USD',direction:'WAIT',qualified:false,confidence:79,status:'WAIT_FOR_CONFIRMATION',
   engine5:{indicatorAction:'WAIT',indicatorScore:58,indicatorAgreement:100,algorithmMajority:'BUY',algorithmsEvaluated:5,algorithmsAligned:0,activeIndicators:18,qualifiedRuns:0,requiredQualifiedRuns:3,barCount:201,lastPrice:4173.2,barAgeMs:20000}},
  RIZVI_INDICATOR_ENGINE_STATUS:{state:'RUNNING',symbol:'XAU/USD',timeframe:'1M',indicators:{'EMA 9/21':{status:'CALCULATED',score:64,bias:1}}},
  crypto:{randomUUID:()=> 'audit-test-id'},console:{warn(){}},addEventListener(){},setInterval(){},setTimeout(){},fetch:async()=>({ok:true,status:200})
 };
 return Object.assign(w,overrides);
}
function run(w){vm.runInNewContext(source,{window:w,Date,Math,JSON,Number,String,Object,Array,Set});return w.RIZVI_BUILD_ENGINE_AUDIT();}
test('audit keeps indicator-confluence groups separate from independent engine reports',()=>{
 const a=run(buildWindow());
 assert.equal(a.schema,'rizvi-engine-audit-v1');
 assert.equal(a.symbol,'XAU/USD');
 assert.equal(a.engines.length,0);
 assert.equal(a.independentEngineReport,false);
 assert.equal(a.derivedIndicatorGroups.length,4);
 assert.equal(a.derivedIndicatorGroups[0].group,'C1');
 assert.equal(a.derivedIndicatorGroups[0].score,61);
 assert.equal(a.algorithms.length,5);
 assert.equal(a.engine5.action,'WAIT');
 assert.equal(a.engine5.algorithmMajority,'BUY');
 assert.ok(a.engine5.blockers.includes('indicator-WAIT'));
 assert.ok(a.engine5.blockers.includes('confidence<80'));
 assert.equal(a.engine5.autoTrading,false);
});
test('missing confluence group is explicit and does not become an engine report',()=>{
 const w=buildWindow({RIZVI_INDICATOR_CONFLUENCE:{action:'WAIT',score:50,agreement:50,groups:[{bias:1,score:60,rows:2},null,{bias:-1,score:55,rows:1}],components:{}}});
 const a=run(w);
 assert.equal(a.engines.length,0);
 assert.equal(a.independentEngineReport,false);
 assert.equal(a.derivedIndicatorGroups[1].reportAvailable,false);
 assert.equal(a.derivedIndicatorGroups[1].score,null);
 assert.equal(a.derivedIndicatorGroups[1].direction,'NOT_REPORTED');
});
test('server wires authenticated audit endpoint and browser bridge',()=>{
 const server=fs.readFileSync(require('node:path').join(__dirname,'server.js'),'utf8');
 assert.match(server,/url\.pathname===['"]\/internal\/engine-audit['"]/);
 assert.match(server,/RIZVI_ENGINE_AUDIT/);
 assert.match(server,/engine5-audit-bridge\.js/);
});

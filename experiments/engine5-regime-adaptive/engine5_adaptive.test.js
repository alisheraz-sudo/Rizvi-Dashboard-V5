const {test}=require("node:test"); const assert=require("node:assert/strict");
const {scoreEngine5}=require("./engine5_adaptive.js");
test("regime changes weights",()=>{const f={trend:.8,momentum:.7,rsi:.3,vwap:.6,candle:.5,liquidity:.2,divergence:-.2};assert.notDeepEqual(scoreEngine5(f,"TRENDING_UP",1).weights,scoreEngine5(f,"RANGING",1).weights);});
test("missing inputs are excluded",()=>{const r=scoreEngine5({trend:.8,momentum:.7,rsi:.6},"TRENDING_UP",.8);assert.equal(r.active_features.length,3);assert.equal("volume_profile" in r.weights,false);});
test("no inputs returns WAIT",()=>assert.equal(scoreEngine5({},"MIXED").action,"WAIT"));
test("uncertain regime fades adjustment",()=>{const f={trend:.8,momentum:.7,rsi:.3,vwap:.6,candle:.5,liquidity:.2,divergence:-.2};assert.notDeepEqual(scoreEngine5(f,"TRENDING_UP",0).weights,scoreEngine5(f,"TRENDING_UP",1).weights);});

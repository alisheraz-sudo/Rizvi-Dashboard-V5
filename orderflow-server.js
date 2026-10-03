const http=require('http');
const PORT=process.env.PORT||10000;
const SECRET=process.env.TV_WEBHOOK_SECRET||'';
const latest=new Map();
const history=new Map();
function send(res,status,data,type='application/json'){const body=typeof data==='string'?data:JSON.stringify(data);res.writeHead(status,{'Content-Type':type,'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'});res.end(body)}
function read(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>200000)req.destroy()});req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}});req.on('error',reject)})}
function keyOf(x){return String(x.symbol||x.ticker||'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g,'')}
const server=http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS')return send(res,204,'','text/plain');
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/health')return send(res,200,{ok:true,service:'Rizvi Order Flow Bridge',time:Date.now()});
 if(u.pathname==='/orderflow'&&req.method==='GET'){
   const key=String(u.searchParams.get('symbol')||'BTCUSDT').toUpperCase().replace(/[^A-Z0-9]/g,'');
   return send(res,200,{ok:true,symbol:key,data:latest.get(key)||null,history:(history.get(key)||[]).slice(-30)});
 }
 if(u.pathname==='/tv/footprint'&&req.method==='POST'){
   if(SECRET && u.searchParams.get('secret')!==SECRET)return send(res,401,{ok:false,error:'unauthorized'});
   try{
     const x=await read(req);const key=keyOf(x);const row={...x,symbol:key,receivedAt:Date.now(),source:'TradingView Footprint'};
     latest.set(key,row);const h=history.get(key)||[];h.push(row);while(h.length>100)h.shift();history.set(key,h);return send(res,200,{ok:true,symbol:key,receivedAt:row.receivedAt});
   }catch(e){return send(res,400,{ok:false,error:'invalid JSON'})}
 }
 return send(res,404,{ok:false,error:'not found'});
});
server.listen(PORT,()=>console.log('Rizvi Order Flow Bridge listening on '+PORT));

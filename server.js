const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

const USER=process.env.RIZVI_USER||'rizvi';
const PASS=process.env.RIZVI_PASSWORD||'CHANGE_ME';
const ROOT=__dirname;
const html=fs.readFileSync(path.join(ROOT,'index.html'));
const SESSION_SECRET=crypto.createHash('sha256').update(USER+'|'+PASS+'|RIZVI-V5').digest('hex');

function sign(value){
  return crypto.createHmac('sha256',SESSION_SECRET).update(value).digest('hex');
}
function makeSession(){
  const value=USER+'|'+Date.now();
  return value+'.'+sign(value);
}
function validSession(req){
  const raw=(req.headers.cookie||'').match(/(?:^|; )rizvi_session=([^;]+)/)?.[1];
  if(!raw)return false;
  const dot=raw.lastIndexOf('.');
  if(dot<1)return false;
  const value=raw.slice(0,dot);
  const sig=raw.slice(dot+1);
  if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(sign(value))))return false;
  const parts=value.split('|');
  return parts[0]===USER && Number.isFinite(Number(parts[1])) && Date.now()-Number(parts[1]) < 7*24*60*60*1000;
}
function send(res,status,type,body,extra={}){
  res.writeHead(status,{'Content-Type':type,...extra});
  res.end(body);
}
function loginPage(){
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#050b12"><title>Rizvi Dashboard V5 — Private Login</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100vh;background:#050b12;color:#e8eef5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{width:min(430px,100%);background:#0a1420;border:1px solid #1d3448;border-radius:18px;padding:28px;box-shadow:0 20px 60px #0008}.logo{width:58px;height:58px;border-radius:14px;background:#050b12;border:1px solid #263b50;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:900;color:#f0ca67;margin-bottom:18px}.eyebrow{font-size:11px;color:#7890a5;letter-spacing:.12em;text-transform:uppercase;font-weight:800}.title{font-size:25px;font-weight:900;margin:5px 0 8px}.sub{color:#8fa4b6;font-size:13px;margin-bottom:22px}label{display:block;font-size:11px;color:#9db0c0;font-weight:800;margin:12px 0 7px}input{width:100%;padding:14px;border-radius:10px;border:1px solid #294055;background:#07111b;color:#fff;font-size:16px;outline:none}button{width:100%;margin-top:18px;padding:14px;border:0;border-radius:10px;background:#49d88f;color:#06130d;font-weight:900;font-size:15px}.note{margin-top:15px;font-size:11px;color:#657d90;text-align:center}
  </style></head><body><form class="card" method="POST" action="/login"><div class="logo">R</div><div class="eyebrow">Private workspace</div><div class="title">Rizvi Dashboard V5</div><div class="sub">Sign in to continue to your private trading dashboard.</div><label>Username</label><input name="username" autocomplete="username" required><label>Password</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">Sign In</button><div class="note">Private access • Manual Trading • Auto Trading OFF</div></form></body></html>`;
}
function parseForm(body){
  const p=new URLSearchParams(body);
  return {username:p.get('username')||'',password:p.get('password')||''};
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');

  if(url.pathname==='/health')return send(res,200,'text/plain; charset=utf-8','ok');

  if(url.pathname==='/login' && req.method==='GET'){
    if(validSession(req))return res.writeHead(302,{Location:'/'}).end();
    return send(res,200,'text/html; charset=utf-8',loginPage(),{'Cache-Control':'no-store'});
  }

  if(url.pathname==='/login' && req.method==='POST'){
    let body='';
    req.on('data',chunk=>{body+=chunk;if(body.length>10000)req.destroy();});
    return req.on('end',()=>{
      const {username,password}=parseForm(body);
      if(username===USER && password===PASS){
        return res.writeHead(302,{Location:'/', 'Set-Cookie':`rizvi_session=${makeSession()}; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`,'Cache-Control':'no-store'}).end();
      }
      return send(res,401,'text/html; charset=utf-8',loginPage().replace('</form>','<div style="color:#ff7182;font-size:12px;margin-top:12px;text-align:center">Invalid username or password.</div></form>'),{'Cache-Control':'no-store'});
    });
  }

  if(url.pathname==='/logout'){
    return res.writeHead(302,{Location:'/login','Set-Cookie':'rizvi_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'}).end();
  }

  if(!validSession(req)){
    return res.writeHead(302,{Location:'/login','Cache-Control':'no-store'}).end();
  }

  const files={
    '/':'index.html',
    '/index.html':'index.html',
    '/manifest.webmanifest':'manifest.webmanifest',
    '/sw.js':'sw.js',
    '/icons/rizvi-192.svg':'icons/rizvi-192.svg',
    '/icons/rizvi-512.svg':'icons/rizvi-512.svg'
  };
  const rel=files[url.pathname];
  if(rel){
    const filePath=path.join(ROOT,rel);
    try{
      const data=fs.readFileSync(filePath);
      const type=rel.endsWith('.html')?'text/html; charset=utf-8':rel.endsWith('.js')?'application/javascript; charset=utf-8':rel.endsWith('.webmanifest')?'application/manifest+json': 'image/svg+xml';
      const extra={'Cache-Control':rel==='index.html'?'no-store':'private, max-age=3600'};
      if(rel==='sw.js')extra['Service-Worker-Allowed']='/';
      return send(res,200,type,data,extra);
    }catch{return send(res,404,'text/plain; charset=utf-8','Not found');}
  }

  return send(res,404,'text/plain; charset=utf-8','Not found');
});
server.listen(process.env.PORT||10000,'0.0.0.0');

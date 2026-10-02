const http=require('http');const fs=require('fs');const path=require('path');
const USER=process.env.RIZVI_USER||'rizvi';const PASS=process.env.RIZVI_PASSWORD||'CHANGE_ME';
const html=fs.readFileSync(path.join(__dirname,'index.html'));
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end('ok')}
const auth=req.headers.authorization||'';const ok=auth.startsWith('Basic ')?(()=>{try{const [u,p]=Buffer.from(auth.slice(6),'base64').toString().split(':');return u===USER&&p===PASS}catch{return false}})():false;
if(!ok){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Rizvi Dashboard V5"','Cache-Control':'no-store'});return res.end('Private access required');}
res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);
});server.listen(process.env.PORT||10000,'0.0.0.0');

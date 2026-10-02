const CACHE="rizvi-v5-app-3";
const CORE=["./","./index.html","./manifest.webmanifest","./icon.svg","./live-candle-engine.js"];

async function enhancedIndexResponse(req){
  const res=await fetch(req,{cache:"no-store"});
  const html=await res.text();
  const tag='<script src="./live-candle-engine.js"></script>';
  const body=html.includes('live-candle-engine.js')?html:html.replace('</body>',tag+'</body>');
  return new Response(body,{status:res.status,statusText:res.statusText,headers:res.headers});
}

self.addEventListener("install",e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;

  const isNavigation=e.request.mode==="navigate"||e.request.destination==="document"||new URL(e.request.url).pathname.endsWith("/index.html");

  if(isNavigation){
    e.respondWith(
      enhancedIndexResponse(e.request)
        .then(x=>{
          const y=x.clone();
          caches.open(CACHE).then(c=>c.put("./index.html",y));
          return x;
        })
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request)
      .then(r=>r||fetch(e.request).then(x=>{
        const y=x.clone();
        caches.open(CACHE).then(c=>c.put(e.request,y));
        return x;
      }).catch(()=>caches.match("./index.html")))
  );
});
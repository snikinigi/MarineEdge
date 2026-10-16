// Shell is cached so the app opens offline. Ship data is always network-first: stale positions are never served while online.
const V='marineedge-v1',SHELL=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET')return;
  const put=res=>{if(res&&(res.ok||res.type==='opaque'))caches.open(V).then(c=>c.put(r,res.clone()));return res};
  if(u.origin===location.origin&&u.pathname.endsWith('/data/ships.json')){e.respondWith(fetch(r).then(put).catch(()=>caches.match(r)));return}
  if(u.origin===location.origin){e.respondWith(caches.match(r).then(c=>{const n=fetch(r).then(put).catch(()=>c);return c||n}));return}
  if(u.hostname==='cdn.jsdelivr.net'){e.respondWith(caches.match(r).then(c=>c||fetch(r).then(put)));return}
});

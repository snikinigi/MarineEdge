const V='me-v2',STATIC=V+'-static',TILES=V+'-tiles',DATA=V+'-data';
const SHELL=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
const CDN=['https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js','https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css'];
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(STATIC);await Promise.allSettled([...SHELL.map(u=>c.add(new Request(u,{cache:'reload'}))),...CDN.map(u=>c.add(u))]);await self.skipWaiting()})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(!k.startsWith(V))await caches.delete(k);await self.clients.claim()})()));
// Network first with a timeout, then the saved copy (app page, ship data, map style).
async function nf(q,key,name,ms){const c=await caches.open(name),p=fetch(q).then(r=>{if(r.ok)c.put(key,r.clone());return r});p.catch(()=>{});try{return await Promise.race([p,new Promise((_,j)=>setTimeout(j,ms))])}catch{return(await c.match(key))||p}}
// Saved copy first, refreshed in the background (libraries, fonts, icons).
async function swr(q,name){const c=await caches.open(name),hit=await c.match(q),net=fetch(q).then(r=>{if(r.ok||r.type==='opaque')c.put(q,r.clone());return r}).catch(()=>hit);return hit||net}
// Saved copy only, capped (map tiles never change at the same address).
async function cf(q,name,max){const c=await caches.open(name),hit=await c.match(q);if(hit)return hit;const r=await fetch(q);if(r.ok){await c.put(q,r.clone());const k=await c.keys();for(const x of k.slice(0,Math.max(0,k.length-max)))await c.delete(x)}return r}
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET')return;const u=new URL(q.url);let r;
 if(u.origin===location.origin)r=q.mode==='navigate'?nf(q,'index.html',STATIC,4000):u.pathname.endsWith('/data/ships.json')?nf(q,u.origin+u.pathname,DATA,6000):swr(q,STATIC);
 else if(u.hostname==='tiles.openfreemap.org')r=u.pathname.startsWith('/styles/')||u.pathname==='/planet'?nf(q,q.url,TILES,5000):cf(q,TILES,800);
 else if(/(jsdelivr|googleapis|gstatic)\.(net|com)$/.test(u.hostname))r=swr(q,STATIC);
 if(r)e.respondWith(r)});

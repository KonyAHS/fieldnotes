import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync } from "node:fs";
// pdf.js data files (character maps for Japanese/Chinese text, standard fonts
// and image decoders), served from a versioned path so PDFs render offline.
const pdfjs = "node_modules/pdfjs-dist";
const pdfjsVersion = JSON.parse(
  readFileSync(`${pdfjs}/package.json`, "utf8"),
).version;
const pdfjsBase = `assets/pdfjs-${pdfjsVersion}`;
export default defineConfig({
  plugins: [
    react(),
    {
      name: "offline-shell",
      generateBundle(_, bundle) {
        for (const dir of ["cmaps", "standard_fonts", "wasm"])
          for (const name of readdirSync(`${pdfjs}/${dir}`)) {
            if (name.startsWith("LICENSE") || name.startsWith("quickjs"))
              continue;
            this.emitFile({
              type: "asset",
              fileName: `${pdfjsBase}/${dir}/${name}`,
              source: readFileSync(`${pdfjs}/${dir}/${name}`),
            });
          }
        const assets = [
          "/",
          "/index.html",
          "/icon.svg",
          "/icon-192.png",
          "/icon-512.png",
          "/manifest.webmanifest",
          ...Object.keys(bundle),
        ];
        const version = Date.now().toString();
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `
const CACHE='fieldnotes-${version}';
const ASSETS=${JSON.stringify(assets)};
const MATCH={ignoreVary:true,ignoreSearch:true};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS.map(a=>a.startsWith('assets/')?a:new Request(a,{cache:'reload'}))))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fieldnotes-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE_UPDATE')self.skipWaiting()});
// Offline, iOS often leaves requests hanging (for example through a VPN)
// instead of failing them, so the saved page is used after a short wait.
const shell=()=>caches.open(CACHE).then(c=>c.match('/index.html',MATCH).then(r=>r||c.match('/',MATCH)));
function page(request){
 return shell().then(saved=>{
  if(!saved)return fetch(request);
  return new Promise(resolve=>{
   let done=false;
   const finish=r=>{if(!done){done=true;resolve(r)}};
   const timer=setTimeout(()=>finish(saved),2500);
   fetch(request).then(r=>{clearTimeout(timer);finish(r.ok&&!r.redirected?r:saved)},()=>{clearTimeout(timer);finish(saved)});
  });
 });
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname==='/sw.js')return;
 if(event.request.mode==='navigate'){event.respondWith(page(event.request));return;}
 event.respondWith(caches.match(event.request,{ignoreVary:true}).then(found=>found||fetch(event.request).then(r=>{
  if(r.ok&&url.pathname.startsWith('/assets/')){const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy))}
  return r;
 })));
});`,
        });
      },
    },
  ],
  define: { __PDFJS_BASE__: JSON.stringify("/" + pdfjsBase + "/") },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3096" },
  },
});

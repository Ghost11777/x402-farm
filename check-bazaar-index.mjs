// Scan le Bazaar CDP et compte nos routes indexées (par domaine). Usage: node check-bazaar-index.mjs
const ids = ['api.x-402.online','x402-farm.vercel.app'];
let total=null; const found={ 'api.x-402.online':new Set(), 'x402-farm.vercel.app':new Set() };
for (let off=0; off<26000; off+=1000){
  let d; try{ d=await (await fetch(`https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?limit=1000&offset=${off}`,{signal:AbortSignal.timeout(20000)})).json(); }catch{ continue; }
  const items=d.items||[]; total=d.pagination?.total ?? total; if(!items.length) break;
  for(const it of items){ const r=it.resource||''; for(const id of ids) if(r.includes(id)) found[id].add(r); }
}
console.log(`Bazaar total: ${total}`);
console.log(`api.x-402.online : ${found['api.x-402.online'].size}/53 routes indexées`);
console.log(`x402-farm.vercel.app : ${found['x402-farm.vercel.app'].size} routes (legacy bootstrap)`);

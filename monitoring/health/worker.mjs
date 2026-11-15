export async function check(fetcher=fetch,now=Date.now()){
 try{const r=await fetcher('https://jinsim-hot-pick.web.app/index.json',{signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});if(!r.ok)throw Error('Catalog HTTP '+r.status);
 const s=await r.json();const age=(now-Date.parse(s.updated_at))/60000;const cards=Object.keys(s.cards||{}).length;
 return {healthy:Number.isFinite(age)&&age>=-5&&age<=120&&cards>0,checked_at:new Date(now).toISOString(),updated_at:s.updated_at,age_minutes:Math.round(age),cards};
 }catch{return {healthy:false,checked_at:new Date(now).toISOString(),error:'Catalog unavailable or invalid'};}
}
export default {async fetch(request){const p=new URL(request.url).pathname;if(p==='/test-failure')return Response.json({healthy:false,simulation:true},{status:503,headers:{'Cache-Control':'no-store'}});if(p!=='/health')return new Response('Not found',{status:404});const state=await check();return Response.json(state,{status:state.healthy?200:503,headers:{'Cache-Control':'no-store'}});}};

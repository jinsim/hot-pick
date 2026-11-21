// Secret is repository-scoped Actions:write; never served by a public route.
const workflowURL=name=>`https://api.github.com/repos/jinsim/hot-pick/actions/workflows/${name}/dispatches`;
export async function dispatch(env, fetcher=fetch) {
 if(!env.HOT_PICK_DISPATCH_TOKEN)throw Error('Missing repository-scoped dispatch token');
 const r=await fetcher(workflowURL('catalog.yml'),{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${env.HOT_PICK_DISPATCH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'hot-pick-free-scheduler'},body:JSON.stringify({ref:'main',inputs:{trigger_source:'cloudflare-cron'}})});
 if(r.status!==204)throw Error(`Collector dispatch rejected (HTTP ${r.status}); catalog freshness must remain unhealthy until an actual publication succeeds`);
 return {accepted:true,meaning:'GitHub accepted the request; this is not proof of publication'};
}

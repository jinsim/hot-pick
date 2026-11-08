"""Independent Codex sessions. Outputs private raw logs under .research; sanitized summary only is public."""
import json, pathlib, shutil, subprocess, time, os, hashlib, datetime
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'.research/session-eval'
CASES={
 'money-csv': {'files':{'sales.csv':'sku,quantity,unit_price\n"Blue, mug",2,12.50\n컵,3,0.10\n"Blue, mug",1,12.50\n'},'prompt':'Create summarize.py exposing summarize(text: str) -> list[dict] and a CLI: python summarize.py input.csv prints JSON. Parse CSV with columns sku,quantity,unit_price; support quoted commas, UTF-8 names and repeated SKUs. Aggregate quantity and exact decimal revenue by SKU, sorted by SKU. Each result has sku, quantity (integer), revenue (two-decimal string). Reject missing columns, blank SKU, non-integer or negative quantities, non-finite/negative prices, and prices with more than two decimal places with ValueError. CLI errors go to stderr with nonzero exit. Do not silently skip invalid rows. Use stdlib only.'},
 'pagination': {'files':{'pagination.mjs':'export function paginate(items,page,size){return {items:items.slice(page*size,(page+1)*size),page,totalPages:Math.floor(items.length/size)};}\n'},'prompt':'Fix pagination.mjs export paginate(items,page,size). page is one-based. Validate items is an array and page/size are positive safe integers; throw TypeError for invalid inputs. Do not mutate inputs. Return {items,page,totalPages,totalItems,hasPrevious,hasNext}. totalPages is ceil(totalItems/size); empty list has totalPages 0. Preserve requested page even beyond final page, return empty slice there, hasNext false, hasPrevious true for page>1 even on empty lists. No dependencies.'},
 'keyboard-form': {'files':{'index.html':'<!doctype html><html lang="en"><meta charset="utf-8"><title>Preferences</title><style>body{font:16px system-ui}.action{background:#174ea6;color:white;padding:12px 20px;border:0;border-radius:6px;font:inherit;cursor:pointer}.action:focus{outline:none}</style><main><h1>Preferences</h1><form id="settings"><input id="name" placeholder="Display name"><div class="action" onclick="save()">Save settings</div><div id="result"></div></form></main><script>function save(){document.querySelector("#result").textContent="Saved: "+document.querySelector("#name").value}</script></html>'},'prompt':'Fix index.html so the existing Save settings flow is keyboard accessible without changing its colors, spacing, or framework. Label the display-name input; make Save settings a native button, support Enter and Space and Enter from the input without navigating/reloading; preserve visible keyboard focus; expose success text in a persistent polite status region. Keep the text and functionality. No runtime dependencies. Verify with local browser if available; do not just describe fixes.'}
}
COMMON='Work only inside this assigned directory. Do not inspect sibling runs, benchmark validators, repository history, other session logs or private files. No subagents. No git commits, pushes or messages. Complete the task and run meaningful local checks. Do not install paid tools or call model APIs. Only final concise result and checks. '
TREAT=f'Use hot-pick for this task. Read {ROOT}/skills/hot-pick/SKILL.md. Use its CLI with --cache .hot-pick-cache and catalog URL https://jinsim-hot-pick.web.app/index.json (timeout 40000 if needed). Choose based on actual task fit, inspect pinned source and apply relevant guidance, recording selection and checks; reject unsuitable results rather than forcing a tool. Do not use other preinstalled skills. '
BASE='Do not invoke hot-pick or read any skill files. Solve the task normally with your knowledge and ordinary tools. '

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 manifest={'created_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':CASES,'order':[['money-csv','baseline'],['money-csv','hot-pick'],['pagination','hot-pick'],['pagination','baseline'],['keyboard-form','baseline'],['keyboard-form','hot-pick']],'timeout_seconds':480,'model_override':None,'baseline_instructions':BASE,'treatment_instructions':TREAT,'common_instructions':COMMON}
 if any((OUT/f'{case}-{arm}').exists() for case,arm in manifest['order']):raise RuntimeError('Existing run directories: preserve them and use a fresh evaluation checkout/output directory')
 (OUT/'preregistered.json').write_text(json.dumps(manifest,indent=2))
 summaries=[]
 for case,arm in manifest['order']:
  key=f'{case}-{arm}';d=OUT/key;d.mkdir(exist_ok=False)
  for name,body in CASES[case]['files'].items():(d/name).write_text(body)
  prompt=COMMON+(TREAT if arm=='hot-pick' else BASE)+CASES[case]['prompt']
  (d/'request.txt').write_text(prompt)
  args=['codex','exec','--ephemeral','--skip-git-repo-check','--json','-s','danger-full-access','-C',str(d),'-c','project_doc_max_bytes=0',prompt]
  started=time.time();code=None;timeout=False
  with (OUT/(key+'.jsonl')).open('w') as stdout,(OUT/(key+'.stderr')).open('w') as stderr:
   try:code=subprocess.run(args,stdout=stdout,stderr=stderr,timeout=480).returncode
   except subprocess.TimeoutExpired:timeout=True
  elapsed=time.time()-started;events=[]
  for line in (OUT/(key+'.jsonl')).read_text().splitlines():
   try:events.append(json.loads(line))
   except ValueError:pass
  usages=[e['usage'] for e in events if e.get('type')=='turn.completed'];usage={k:sum(u.get(k,0) for u in usages) for k in set().union(*(u.keys() for u in usages))} if usages else None
  summary={'case':case,'arm':arm,'wall_seconds':elapsed,'exit_code':code,'timed_out':timeout,'usage':usage,'completed_turns':len(usages),'session_id':next((e.get('thread_id') for e in events if e.get('type')=='thread.started'),None),'started_at':datetime.datetime.fromtimestamp(started,datetime.timezone.utc).isoformat()}
  summaries.append(summary);(OUT/'summary.json').write_text(json.dumps(summaries,indent=2));print(json.dumps(summary),flush=True)
if __name__=='__main__':main()

"""Fresh treatment sessions after a separately identified product change; prompts unchanged."""
import json,pathlib,subprocess,time,datetime,hashlib,sys,os
from run import ROOT,OUT,CASES
rows=json.loads((OUT/'summary.json').read_text())
if not (OUT/'summary-original.json').exists():(OUT/'summary-original.json').write_text(json.dumps(rows,indent=2))
for case in sys.argv[1:]:
 if case not in CASES:raise ValueError(case)
 arm=os.environ.get('HOT_PICK_EVAL_ARM','hot-pick-improved');
 if arm not in ['hot-pick-improved','hot-pick-improved-batched']:raise ValueError('Unsupported evaluation arm')
 key=f'{case}-{arm}';d=OUT/key
 if d.exists():raise RuntimeError('Refusing to overwrite existing run '+key)
 d.mkdir()
 for name,body in CASES[case]['files'].items():(d/name).write_text(body)
 prompt=(OUT/f'{case}-hot-pick/request.txt').read_text();(d/'request.txt').write_text(prompt)
 args=['codex','exec','--ephemeral','--skip-git-repo-check','--json','-s','danger-full-access','-C',str(d),'-c','project_doc_max_bytes=0',prompt]
 started=time.time();code=None;timeout=False
 with (OUT/(key+'.jsonl')).open('w') as out,(OUT/(key+'.stderr')).open('w') as err:
  try:code=subprocess.run(args,stdout=out,stderr=err,timeout=480).returncode
  except subprocess.TimeoutExpired:timeout=True
 elapsed=time.time()-started;events=[]
 for line in (OUT/(key+'.jsonl')).read_text().splitlines():
  try:events.append(json.loads(line))
  except ValueError:pass
 usages=[e['usage'] for e in events if e.get('type')=='turn.completed'];usage={k:sum(u.get(k,0) for u in usages) for k in set().union(*(u.keys() for u in usages))} if usages else None
 row={'case':case,'arm':arm,'wall_seconds':elapsed,'exit_code':code,'timed_out':timeout,'usage':usage,'completed_turns':len(usages),'started_at':datetime.datetime.fromtimestamp(started,datetime.timezone.utc).isoformat(),'phase_source_sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'skills/hot-pick/SKILL.md',ROOT/'skills/hot-pick/scripts/catalog.mjs']},'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest()}
 rows.append(row);(OUT/'summary.json').write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True)

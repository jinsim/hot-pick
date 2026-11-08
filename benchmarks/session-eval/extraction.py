"""Additional OSS-friendly paired task with frozen original skill source."""
import json,pathlib,subprocess,time,datetime
from run import ROOT,OUT,COMMON,BASE,TREAT
CASE={'files':{'cards.html':'<article class="product" data-sku="A"><h2 class="name">Coffee <em>&amp;</em> tea</h2><span class="price">$12.50</span><span class="stock">3</span></article><article class="product" data-sku="B"><h2 class="name">컵</h2><span class="price">$0.10</span><span class="stock">0</span></article>', 'table.html':'<table><tr data-sku="A"><td class="name">Coffee &amp; tea</td><td class="price">$12.50</td><td class="stock">3</td></tr><tr data-sku="C"><td class="name">Desk</td><td class="price">$1,299.90</td><td class="stock">2</td></tr></table>'},'prompt':'Implement extract.py exposing extract(html: str) -> list[dict] and a CLI: python extract.py file1.html [file2.html ...] outputs one JSON array. Read the two provided HTML layouts: article.product and table tr elements with data-sku. Their descendants have classes name, price, stock. Emit sku, name (nested text with whitespace collapsed and HTML entities decoded), price (two-decimal string), stock (nonnegative integer). Support currencies prefixed with $, comma thousands separators, UTF-8, nested markup and class-list order. Ignore unrelated markup and rows without data-sku. Deduplicate by sku preserving the first occurrence, including across CLI files. Invalid product data (missing fields, invalid/negative amount, fractional/negative stock) must raise ValueError; CLI fails with nonzero status. Dependencies are allowed if free and installed locally; record how to reproduce the environment. Do not fetch external live product sites. Write actual working code and run checks.'}
# Freeze task and rubric before sessions start.
(OUT/'extraction-preregistered.json').write_text(json.dumps(CASE,indent=2))
while len(json.loads((OUT/'summary.json').read_text()))<6:time.sleep(3)
rows=json.loads((OUT/'summary.json').read_text())
for arm in ['hot-pick','baseline']:
 key='html-extraction-'+arm;d=OUT/key;d.mkdir(exist_ok=False)
 for name,body in CASE['files'].items():(d/name).write_text(body)
 treatment=TREAT.replace(str(ROOT/'skills/hot-pick'),str(OUT/'pinned-hot-pick'))
 prompt=COMMON+(treatment if arm=='hot-pick' else BASE)+CASE['prompt'];(d/'request.txt').write_text(prompt)
 args=['codex','exec','--ephemeral','--skip-git-repo-check','--json','-s','danger-full-access','-C',str(d),'-c','project_doc_max_bytes=0',prompt]
 start=time.time();code=None;timeout=False
 with (OUT/(key+'.jsonl')).open('w') as out,(OUT/(key+'.stderr')).open('w') as err:
  try:code=subprocess.run(args,stdout=out,stderr=err,timeout=480).returncode
  except subprocess.TimeoutExpired:timeout=True
 events=[]
 for line in (OUT/(key+'.jsonl')).read_text().splitlines():
  try:events.append(json.loads(line))
  except ValueError:pass
 usages=[e['usage'] for e in events if e.get('type')=='turn.completed'];usage={k:sum(u.get(k,0) for u in usages) for k in set().union(*(u.keys() for u in usages))} if usages else None
 row={'case':'html-extraction','arm':arm,'wall_seconds':time.time()-start,'exit_code':code,'timed_out':timeout,'usage':usage,'completed_turns':len(usages),'started_at':datetime.datetime.fromtimestamp(start,datetime.timezone.utc).isoformat(),'skill_source':'git archive 58464d8 skills/hot-pick'}
 rows.append(row);(OUT/'summary.json').write_text(json.dumps(rows,indent=2));print(json.dumps(row),flush=True)

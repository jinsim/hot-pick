import datetime as dt, importlib.util, json, os, subprocess, tempfile
from pathlib import Path
script=Path(__file__).with_name('weekend-git.py').resolve()
spec=importlib.util.spec_from_file_location('policy',script);policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
for date,expected in [('2026-11-11','2026-11-07'),('2026-11-08','2026-10-31'),('2026-11-07','2026-10-31'),('2026-11-01','2026-10-24')]:
 assert str(policy.weekend_start(dt.datetime.fromisoformat(date).replace(tzinfo=policy.TZ)).date())==expected
with tempfile.TemporaryDirectory(prefix='hot-pick-date-test-') as folder:
 def git(*args,env=None):return subprocess.check_output(['git',*args],cwd=folder,env=env,stderr=subprocess.PIPE).decode().strip()
 git('init','-b','main');git('config','user.name','Policy Test');git('config','user.email','policy@example.invalid');git('remote','add','origin','https://github.com/jinsim/hot-pick.git')
 old=[]
 for i,day in enumerate(['2026-11-01','2026-11-07','2026-11-11']):
  Path(folder,'example.txt').write_text(str(i));git('add','example.txt');date=day+'T12:00:00+09:00';env={**os.environ,'GIT_AUTHOR_DATE':date,'GIT_COMMITTER_DATE':date}
  git('-c','core.hooksPath=/dev/null','commit','-m',f'fixture {i}',env=env);old.append(git('rev-parse','HEAD'))
 before=[git('show','-s','--format=%T%n%an%n%ae%n%B',x) for x in old]
 result=subprocess.run(['python3',str(script),'rewrite','--apply'],cwd=folder,text=True,capture_output=True,check=True);report=json.loads(result.stdout)
 for i,row in enumerate(report['commits']):
  assert row['old']==old[i];assert git('show','-s','--format=%T%n%an%n%ae%n%B',row['new'])==before[i]
  when=dt.datetime.fromisoformat(row['display_date']);assert when.weekday() in [5,6]
  assert git('show','-s','--format=%at',row['new'])==git('show','-s','--format=%ct',row['new'])
 assert git('rev-parse','HEAD')==report['commits'][-1]['new']
 backup=list(Path(folder,'.research/history-backup').glob('*.bundle'));assert len(backup)==1;git('bundle','verify',str(backup[0]))
 second=subprocess.run(['python3',str(script),'rewrite','--apply'],cwd=folder,text=True,capture_output=True);assert second.returncode!=0 and 'already normalized' in second.stderr
 Path(folder,'scripts').mkdir();Path(folder,'scripts/weekend-git.py').write_bytes(script.read_bytes())
 Path(folder,'.githooks').mkdir();hook=Path(folder,'.githooks/pre-commit');hook.write_text('#!/bin/sh\nexec python3 scripts/weekend-git.py check\n');hook.chmod(0o755)
 git('config','core.hooksPath','.githooks');git('add','scripts/weekend-git.py','.githooks/pre-commit')
 wrapped=subprocess.run(['python3',str(script),'commit','-m','wrapper with guard'],cwd=folder,text=True,capture_output=True)
 assert wrapped.returncode==0,wrapped.stderr
 git('add','example.txt')
 rejected=subprocess.run(['git','commit','--allow-empty','-m','unguarded date'],cwd=folder,text=True,capture_output=True,env={k:v for k,v in os.environ.items() if k not in ['GIT_AUTHOR_DATE','GIT_COMMITTER_DATE']})
 assert rejected.returncode!=0 and 'weekend-commit' in rejected.stderr
 good=subprocess.run(['python3',str(script),'check-push'],cwd=folder,input='refs/heads/main '+git('rev-parse','HEAD')+' refs/heads/main '+'0'*40+'\n',text=True,capture_output=True)
 assert good.returncode==0,good.stderr
 bad=subprocess.run(['python3',str(script),'check-push'],cwd=folder,input='refs/heads/main '+old[-1]+' refs/heads/main '+'0'*40+'\n',text=True,capture_output=True)
 assert bad.returncode!=0 and 'weekday' in bad.stderr
print('Date boundaries, identity/tree/message preservation, refs, backup, repeat guard and guarded wrapper: passed')

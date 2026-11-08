#!/usr/bin/env python3
"""Explicit, documented Git display-date policy. Never changes evidence timestamps."""
import datetime as dt, hashlib, json, os, re, subprocess, sys
from pathlib import Path
TZ=dt.timezone(dt.timedelta(hours=9))
def git(*args, input=None, env=None):
    return subprocess.check_output(['git',*args],input=input,env=env)
def weekend_start(actual):
    local=actual.astimezone(TZ)
    monday=(local-dt.timedelta(days=local.weekday())).date()
    return dt.datetime.combine(monday-dt.timedelta(days=2),dt.time(10),TZ)
def jitter(seed, upper):
    return int(hashlib.sha256(seed.encode()).hexdigest()[:12],16)%upper

def commit_date(actual, seed, parent=None):
    base=weekend_start(actual)
    target=base+dt.timedelta(days=jitter(seed+'day',2),seconds=jitter(seed,11*3600))
    if parent is not None and parent.date() in [base.date(),base.date()+dt.timedelta(days=1)] and target<=parent:
        target=parent+dt.timedelta(seconds=60+jitter(seed+'next',540))
    if target.date()>base.date()+dt.timedelta(days=1):
        raise ValueError('Previous weekend has no chronological slot remaining; do not invent a weekday date')
    return target

def ensure_repo():
    origin=git('remote','get-url','origin').decode().strip()
    if origin not in ['https://github.com/jinsim/hot-pick.git','git@github.com:jinsim/hot-pick.git']:
        raise ValueError('This policy applies only to jinsim/hot-pick')

def commit(args):
    ensure_repo()
    now=dt.datetime.now(TZ)
    parent=dt.datetime.fromtimestamp(int(git('show','-s','--format=%ct','HEAD')),TZ)
    when=commit_date(now,now.isoformat()+git('write-tree').decode(),parent)
    env={**os.environ,'GIT_AUTHOR_DATE':when.isoformat(),'GIT_COMMITTER_DATE':when.isoformat()}
    print('Git display date:',when.isoformat(),'(normalized previous weekend; not execution time)',flush=True)
    return subprocess.call(['git','commit','--date='+when.isoformat(),*args],env=env)

def check():
    for key in ['GIT_AUTHOR_DATE','GIT_COMMITTER_DATE']:
        value=os.environ.get(key,'')
        try: when=dt.datetime.fromisoformat(value).astimezone(TZ)
        except ValueError:
            canonical=re.fullmatch(r'@?(\d+) [+-]\d{4}',value)
            if not canonical:raise ValueError('Use git weekend-commit (explicit previous-weekend date policy)')
            when=dt.datetime.fromtimestamp(int(canonical[1]),TZ)
        base=weekend_start(dt.datetime.now(TZ))
        if when.date() not in [base.date(),base.date()+dt.timedelta(days=1)]:
            raise ValueError('Use git weekend-commit: display date must be in the previous weekend, Asia/Seoul')
    return 0

def check_push():
    ensure_repo()
    for line in sys.stdin:
        local_ref,local_sha,remote_ref,remote_sha=line.split()
        if set(local_sha)=={'0'}:continue
        have_old=remote_sha.strip('0') and subprocess.run(['git','cat-file','-e',remote_sha+'^{commit}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
        revision=remote_sha+'..'+local_sha if have_old else local_sha
        for row in git('log','--format=%H %at %ct',revision).decode().splitlines():
            sha,author,committer=row.split()
            if any(dt.datetime.fromtimestamp(int(stamp),TZ).weekday()<5 for stamp in [author,committer]):
                raise ValueError(f'Push blocked: {sha[:12]} has weekday display dates. Use the documented weekend commit workflow; do not rewrite normalized history again.')
    return 0

def rewrite(apply=False):
    ensure_repo()
    if apply and (Path('docs/git-history-map.json').exists() or subprocess.run(['git','config','--local','--get','hotPick.historyNormalized'],capture_output=True,text=True).stdout.strip()=='true'):raise ValueError('History already normalized; do not shift display dates twice')
    if apply and git('status','--porcelain').strip():raise ValueError('Commit or preserve work before rewriting history')
    refs={line.split()[0]:line.split()[1] for line in git('for-each-ref','--format=%(refname) %(objectname)','refs/heads/').decode().splitlines()}
    commits=git('rev-list','--reverse','--topo-order',*refs.values()).decode().splitlines()
    raw={sha:git('cat-file','commit',sha) for sha in commits}
    groups={}
    for sha in commits:
        if b'\ngpgsig ' in raw[sha] or b'\nmergetag ' in raw[sha]:raise ValueError('Signed commit/tag requires separate preservation plan')
        m=re.search(rb'^committer .* (\d+) [+-]\d{4}$',raw[sha],re.M)
        actual=dt.datetime.fromtimestamp(int(m[1]),TZ)
        groups.setdefault(weekend_start(actual),[]).append(sha)
    dates={}
    for base,items in groups.items():
        # Two daytime windows. Jitter is deterministic and bounded within each slot.
        for i,sha in enumerate(items):
            total=22*3600;slot=total//len(items);offset=i*slot+jitter(sha,max(1,slot//2))
            dates[sha]=base+dt.timedelta(days=offset//(11*3600),seconds=offset%(11*3600))
    mapping={};report=[]
    for sha in commits:
        body=raw[sha];stamp=str(int(dates[sha].timestamp())).encode()+b' +0900'
        header,message=body.split(b'\n\n',1)
        header=re.sub(rb'^(author|committer) (.*) \d+ [+-]\d{4}$',lambda m:m[1]+b' '+m[2]+b' '+stamp,header,flags=re.M)
        header=re.sub(rb'^parent ([a-f0-9]+)$',lambda m:b'parent '+mapping[m[1].decode()].encode(),header,flags=re.M)
        new=git('hash-object','-t','commit',*(['-w'] if apply else []),'--stdin',input=header+b'\n\n'+message).decode().strip()
        mapping[sha]=new;report.append({'old':sha,'new':new,'display_date':dates[sha].isoformat()})
    if apply:
        backup=Path('.research/history-backup');backup.mkdir(parents=True,exist_ok=True)
        label=dt.datetime.now(TZ).strftime('%Y%m%dT%H%M%S')
        git('bundle','create',str(backup/(label+'.bundle')),'--all')
        (backup/(label+'.json')).write_text(json.dumps({'recorded_at':dt.datetime.now(TZ).isoformat(),'refs':refs,'mapping':report},indent=2)+'\n')
        commands='start\n'+''.join(f'update {ref} {mapping[old]} {old}\n' for ref,old in refs.items())+'prepare\ncommit\n'
        git('update-ref','--stdin',input=commands.encode())
        git('config','--local','hotPick.historyNormalized','true')
    print(json.dumps({'applied':apply,'refs':refs,'commits':report},indent=2))
    return 0

def main():
    if len(sys.argv)<2:raise ValueError('Use commit [git commit arguments], check, plan, or rewrite --apply')
    cmd=sys.argv[1]
    if cmd=='commit':return commit(sys.argv[2:])
    if cmd=='check':return check()
    if cmd=='check-push':return check_push()
    if cmd in ['plan','rewrite']:return rewrite(cmd=='rewrite' and sys.argv[2:]==['--apply'])
    raise ValueError('Unknown command')
if __name__=='__main__':
    try:sys.exit(main())
    except (ValueError,subprocess.CalledProcessError) as e:print(str(e),file=sys.stderr);sys.exit(1)

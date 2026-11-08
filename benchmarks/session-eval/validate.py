"""Predeclared independent acceptance checks, deliberately not provided to agents."""
import importlib.util,json,pathlib,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'.research/session-eval'
def money(d):
 spec=importlib.util.spec_from_file_location('candidate',d/'summarize.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);f=m.summarize
 checks=[]
 def check(name,fn):
  try:assert fn();checks.append({'name':name,'passed':True})
  except Exception as e:checks.append({'name':name,'passed':False,'error':type(e).__name__})
 check('quoted names aggregation',lambda:f('sku,quantity,unit_price\n"Blue, mug",2,12.50\n"Blue, mug",1,12.50\n')==[{'sku':'Blue, mug','quantity':3,'revenue':'37.50'}])
 check('decimal exactness and sorting',lambda:f('sku,quantity,unit_price\nz,3,0.10\na,2,1.05\n')==[{'sku':'a','quantity':2,'revenue':'2.10'},{'sku':'z','quantity':3,'revenue':'0.30'}])
 check('zero and unicode',lambda:f('sku,quantity,unit_price\n컵,0,0.00\n')==[{'sku':'컵','quantity':0,'revenue':'0.00'}])
 for name,text in [('missing columns','sku,quantity\na,1\n'),('blank SKU','sku,quantity,unit_price\n ,1,1\n'),('fractional quantity','sku,quantity,unit_price\na,1.5,1\n'),('negative quantity','sku,quantity,unit_price\na,-1,1\n'),('negative price','sku,quantity,unit_price\na,1,-1\n'),('NaN','sku,quantity,unit_price\na,1,NaN\n'),('Infinity','sku,quantity,unit_price\na,1,Infinity\n'),('excess decimals','sku,quantity,unit_price\na,1,1.234\n')]:
  def rejects(t=text):
   try:f(t)
   except ValueError:return True
   return False
  check(name,rejects)
 check('CLI JSON',lambda:json.loads(subprocess.check_output([sys.executable,str(d/'summarize.py'),str(d/'sales.csv')]))==f((d/'sales.csv').read_text()))
 return checks
NODE=r'''import {pathToFileURL} from 'node:url'; const {paginate:f}=await import(pathToFileURL(process.argv[1])); const checks=[];function t(name,fn){try{if(!fn())throw Error('assert');checks.push({name,passed:true})}catch(e){checks.push({name,passed:false,error:e.name})}} const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;const eq=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));t('first page',()=>eq(f([1,2,3],1,2),{items:[1,2],page:1,totalPages:2,totalItems:3,hasPrevious:false,hasNext:true}));t('last page',()=>eq(f([1,2,3],2,2),{items:[3],page:2,totalPages:2,totalItems:3,hasPrevious:true,hasNext:false}));t('beyond end',()=>eq(f([1],9,2),{items:[],page:9,totalPages:1,totalItems:1,hasPrevious:true,hasNext:false}));t('empty',()=>eq(f([],2,2),{items:[],page:2,totalPages:0,totalItems:0,hasPrevious:true,hasNext:false}));for(const [name,args]of [['not array',[{},1,2]],['zero page',[[],0,2]],['fractional size',[[],1,1.1]],['unsafe page',[[],Number.MAX_SAFE_INTEGER+1,2]],['string page',[[],'1',2]],['negative size',[[],1,-1]],['NaN',[[],NaN,2]]])t(name,()=>{try{f(...args)}catch(e){return e instanceof TypeError}return false});t('no mutation',()=>{const a=Object.freeze([1,2,3]);f(a,1,2);return eq(a,[1,2,3])});console.log(JSON.stringify(checks));'''
def main():
 result=[]
 for row in json.loads((OUT/'summary.json').read_text()):
  d=OUT/(row['case']+'-'+row['arm'])
  grading_start=time.perf_counter()
  try:
   if row['case']=='money-csv':checks=money(d)
   elif row['case']=='html-extraction':
    python=str(d/'.venv/bin/python') if (d/'.venv/bin/python').exists() else sys.executable
    checks=json.loads(subprocess.check_output([python,str(ROOT/'benchmarks/session-eval/extraction-check.py'),str(d)],cwd=d))
   elif row['case']=='pagination':checks=json.loads(subprocess.check_output(['node','--input-type=module','-e',NODE,str(d/'pagination.mjs')]))
   else:checks=json.loads(subprocess.check_output(['node',str(ROOT/'benchmarks/session-eval/browser-check.mjs'),str(d/'index.html')]))
  except Exception as e:checks=[{'name':'load solution','passed':False,'error':type(e).__name__}]
  result.append({**row,'external_grader_seconds':time.perf_counter()-grading_start,'checks':checks,'passed':sum(c['passed'] for c in checks),'total':{'money-csv':12,'pagination':12,'keyboard-form':8,'html-extraction':11}[row['case']]})
 (OUT/'validated.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if __name__=='__main__':main()

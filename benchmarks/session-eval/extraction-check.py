"""Held-out extraction behaviors, executable in the submitted dependency environment."""
import importlib.util,json,sys,subprocess,pathlib
D=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('candidate',D/'extract.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);f=m.extract;checks=[]
def t(name,fn):
 try:assert fn();checks.append({'name':name,'passed':True})
 except Exception as e:checks.append({'name':name,'passed':False,'error':type(e).__name__})
def product(name='A &amp; B',price='$1,234.50',stock='4',sku='x'):
 return f'<article class="featured product" data-sku="{sku}"><h2 class="name title">{name}</h2><span class="sale price">{price}</span><b class="stock">{stock}</b></article>'
t('nested text/entities/class order',lambda:f(product('A <b>&amp;</b> B'))==[{'sku':'x','name':'A & B','price':'1234.50','stock':4}])
t('unicode and cents',lambda:f(product('컵','$0.10','0'))==[{'sku':'x','name':'컵','price':'0.10','stock':0}])
t('ignore unrelated',lambda:f('<h2>No products</h2><tr><td class="name">Ignore</td></tr>')==[])
t('deduplicate first',lambda:len(f(product()+product('changed')))==1 and f(product()+product('changed'))[0]['name']=='A & B')
t('table layout',lambda:f('<table><tr data-sku="q"><td class="name">Desk <em>large</em></td><td class="price">$12.50</td><td class="stock">2</td></tr></table>')==[{'sku':'q','name':'Desk large','price':'12.50','stock':2}])
for name,text in [('missing field','<article class="product" data-sku="x"><h2 class="name">X</h2></article>'),('negative price',product(price='$-1')),('invalid amount',product(price='NaN')),('negative stock',product(stock='-1')),('fractional stock',product(stock='1.5'))]:
 def bad(text=text):
  try:f(text)
  except ValueError:return True
  return False
 t(name,bad)
t('CLI merge dedup',lambda:len(json.loads(subprocess.check_output([sys.executable,str(D/'extract.py'),str(D/'cards.html'),str(D/'table.html')],cwd=D)))==3)
print(json.dumps(checks))

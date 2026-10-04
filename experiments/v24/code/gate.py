"""Necessary structural conditions for numeric comparison, never semantic truth certification."""
from fractions import Fraction
import ast
AXES=('referent','property','population','conditions','time')
UNITS={'count':('count',1),'percent':('ratio',Fraction(1,100)),'ratio':('ratio',1),'m':('length',1),'cm':('length',Fraction(1,100)),'km':('length',1000),'m2':('area',1),'cm2':('area',Fraction(1,10000)),'km2':('area',1000000),'g':('mass',1),'kg':('mass',1000),'tonne':('mass',1000000),'l':('volume',1),'ml':('volume',Fraction(1,1000)),'currency':('currency',1)}
def scalar(q):
 if not isinstance(q,dict) or q.get('unit') not in UNITS:raise ValueError('quantity/unit absent')
 d,f=UNITS[q['unit']];return d,Fraction(str(q['value']))*f

def arithmetic(expr,operands):
 values={x['name']:Fraction(str(x['value'])) for x in operands}
 if len(values)!=len(operands):raise ValueError('duplicate operands')
 def walk(n):
  if isinstance(n,ast.Name) and n.id in values:return values[n.id]
  if isinstance(n,ast.BinOp) and isinstance(n.op,(ast.Add,ast.Sub,ast.Mult,ast.Div)):
   a,b=walk(n.left),walk(n.right)
   if isinstance(n.op,ast.Add):return a+b
   if isinstance(n.op,ast.Sub):return a-b
   if isinstance(n.op,ast.Mult):return a*b
   return a/b
  raise ValueError('arithmetic must use anchored operands, no constants/calls')
 return walk(ast.parse(expr,mode='eval').body)

def check(unit,c):
 sources={s['id']:s['text'] for s in unit['sources']};reasons=[]
 def witness(w):return isinstance(w,dict) and bool(w.get('quote')) and w.get('source_id') in sources and w['quote'] in sources[w['source_id']]
 if not c.get('article_quote') or c['article_quote'] not in unit['article']['text']:reasons.append('article anchor absent')
 if not c.get('evidence') or not all(witness(w) for w in c['evidence']):reasons.append('evidence anchor absent')
 for axis in AXES:
  x=c.get('axes',{}).get(axis,{})
  if x.get('relation')!='same':reasons.append(axis+': identity not certified')
  if not x.get('article_anchor') or x['article_anchor'] not in unit['article']['text']:reasons.append(axis+': article anchor absent')
  if not x.get('source_anchors') or not all(witness(w) for w in x['source_anchors']):reasons.append(axis+': source anchor absent')
 try:
  ad,av=scalar(c['article_quantity']);ed,ev=scalar(c['evidence_quantity'])
  if ad!=ed:reasons.append('incompatible units')
  calc=c.get('arithmetic')
  if calc:
   if not calc.get('operands') or not all(witness(w) for w in calc['operands']):reasons.append('arithmetic anchor absent')
   if arithmetic(calc['expression'],calc['operands'])!=Fraction(str(c['evidence_quantity']['value'])):reasons.append('arithmetic result mismatch')
 except (KeyError,ValueError,TypeError,ZeroDivisionError,SyntaxError):reasons.append('invalid quantity/arithmetic')
 return {'id':c.get('id'),'gate_result':'blocked' if reasons else ('eligible_mismatch' if av!=ev else 'normalized_equal'),'reasons':reasons,'semantic_identity_verified':False}

def run(unit,certificate):
 ids=[c.get('id') for c in certificate['comparisons']]
 if any(not x for x in ids) or len(ids)!=len(set(ids)):raise ValueError('invalid comparison identifiers')
 return {'unit_id':unit['unit_id'],'results':[check(unit,c) for c in certificate['comparisons']],'limits':'Exact anchor presence and typed arithmetic only; AI semantic binding may be false. Necessary not sufficient.'}
if __name__=='__main__':
 import json,sys
 print(json.dumps(run(json.load(open(sys.argv[1])),json.load(open(sys.argv[2]))),ensure_ascii=False,indent=2))

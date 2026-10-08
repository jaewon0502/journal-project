"""Independent synthetic v2 audit: no experiment cases/outcomes loaded."""
import copy, hashlib, importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def module(name):
 spec=importlib.util.spec_from_file_location('audit_v2_'+name,ROOT/'code_v2'/(name+'.py'))
 obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
gate=module('gate');delivery=module('delivery')
def fixture(article='A is 2 m. B is 7 m.',aq='A is 2 m.',av='2',au='m',source='A is 3 m. B is 7 m.',sq='A is 3 m.',ev='3',eu='m'):
 u={'unit_id':'independent-synthetic','article':{'text':article},'sources':[{'id':'S','text':source}]}
 w={'source_id':'S','quote':sq}
 c={'comparisons':[{'id':'c','article_quote':aq,'axes':{k:{'relation':'same','article_anchor':aq,'source_anchors':[copy.deepcopy(w)]} for k in gate.AXES},'article_quantity':{'value':av,'unit':au},'evidence_quantity':{'value':ev,'unit':eu},'arithmetic':None,'evidence':[w]}]}
 return u,c
def deliver(u,c,before,after,ids=None,g=None):
 return delivery.enforce(u,{'patches':[{'id':'p','comparison_ids':['c'] if ids is None else ids,'before':before,'after':after}]},gate.run(u,c) if g is None else g)
results={}
u,c=fixture()
for name,before,after,ids in [('unrelated_clause','B is 7 m.','B is 999 m.',['c']),('arbitrary_replacement','A is 2 m.','A is 999 kg and B is closed.',['c']),('mixed_ids','A is 2 m.','A is 3 m.',['c','unknown']),('wrong_numeric_value','A is 2 m.','A is 999 m.',['c'])]:
 out=deliver(u,c,before,after,ids);assert not out['accepted_patch_ids'] and out['full_edited_text']==u['article']['text'];results[name]=out
for key,value in [('unit_id','other'),('article_sha256','bad')]:
 g=gate.run(u,c);g[key]=value;out=deliver(u,c,'A is 2 m.','A is 3 m.',g=g)
 assert out['status']=='blocked' and not out['accepted_patch_ids'];results['wrong_'+key]=out
bad=copy.deepcopy(c);bad['comparisons'][0]['axes']=[]
results['malformed_axes']=gate.run(u,bad);assert results['malformed_axes']['results'][0]['gate_result']=='blocked'
bad=copy.deepcopy(c);bad['comparisons'][0]['evidence_quantity']['value']='9';bad['comparisons'][0]['arithmetic']={'expression':'x*x','operands':[{'name':'x','value':'3','unit':'m','source_id':'S','quote':'A is 3 m.'}]}
results['dimension_arithmetic']=gate.run(u,bad);assert results['dimension_arithmetic']['results'][0]['gate_result']=='blocked'
results['legitimate_edit']=deliver(u,c,'A is 2 m.','A is 3 m.');assert results['legitimate_edit']['accepted_patch_ids']==['p']
u,c=fixture('A is 2 km.','2 km','2','km','A is 3000 m.','A is 3000 m.','3000','m')
results['converted_edit']=deliver(u,c,'2 km','3 km');assert results['converted_edit']['accepted_patch_ids']==['p']
u,c=fixture('A is 2 km.','2 km','2','km','A is 2000 m.','A is 2000 m.','2000','m')
results['normalized_equal']=gate.run(u,c);assert results['normalized_equal']['results'][0]['gate_result']=='normalized_equal'
u,c=fixture('A area is 2 m2.','2 m2','2','m2','A is square with side 300 cm.','A is square with side 300 cm.','9','m2')
c['comparisons'][0]['arithmetic']={'expression':'x*x','operands':[{'name':'x','value':'300','unit':'cm','source_id':'S','quote':'A is square with side 300 cm.'}]}
results['typed_area']=deliver(u,c,'2 m2','9 m2');assert results['typed_area']['accepted_patch_ids']==['p']
u,c=fixture('A is 1 m.','1 m','1','m','A equals x minus y; x is 300 cm and y is 1 m.','A equals x minus y; x is 300 cm and y is 1 m.','2','m')
c['comparisons'][0]['arithmetic']={'expression':'x-y','operands':[{'name':n,'value':v,'unit':un,'source_id':'S','quote':'A equals x minus y; x is 300 cm and y is 1 m.'} for n,v,un in [('x','300','cm'),('y','1','m')]]}
results['typed_subtraction']=deliver(u,c,'1 m','2 m');assert results['typed_subtraction']['accepted_patch_ids']==['p']
u,c=fixture('A is 2 m.','A is 2 m.','2','m','B is 3 m.','B is 3 m.','3','m')
results['false_semantic_certificate_gate']=gate.run(u,c)
results['false_semantic_certificate_delivery']=deliver(u,c,'A is 2 m.','A is 3 m.')
assert results['false_semantic_certificate_delivery']['accepted_patch_ids']==['p']
assert results['false_semantic_certificate_gate']['results'][0]['semantic_identity_verified'] is False
u,c=fixture();g=gate.run(u,c)
results['unrelated_contradiction_label']=delivery.enforce(u,{'clause_audit':[{'quote':'B is 7 m.','relation':'contradicted','comparison_ids':['c']}]},g)
assert len(results['unrelated_contradiction_label']['raw_label_violations'])==1
old=json.loads((ROOT/'code-audit.json').read_text())
results['v1_code_hashes_unchanged']={f:hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==h for f,h in old['scope']['file_sha256'].items() if f.startswith('code/')}
assert all(results['v1_code_hashes_unchanged'].values())
print('Independent replay: all assertions passed; '+str(len(results))+' result records checked.')

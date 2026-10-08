"""Synthetic structural audit only; does not load experiment cases or outcomes."""
import copy, importlib.util, json
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'code'
def module(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py'))
 obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
gate=module('gate');delivery=module('delivery')
u={'unit_id':'synthetic-audit','article':{'text':'A is 2 m. B is 7 m.'},'sources':[{'id':'S','text':'A is 3 m. B is 7 m.'}]}
w={'source_id':'S','quote':'A is 3 m.'}
c={'comparisons':[{'id':'c','article_quote':'A is 2 m.','axes':{k:{'relation':'same','article_anchor':'A is 2 m.','source_anchors':[w]} for k in gate.AXES},'article_quantity':{'value':'2','unit':'m'},'evidence_quantity':{'value':'3','unit':'m'},'arithmetic':None,'evidence':[w]}]}
g=gate.run(u,c)
assert g['results'][0]['gate_result']=='eligible_mismatch'
proposals={
 'unrelated_clause':{'patches':[{'id':'p','comparison_ids':['c'],'before':'B is 7 m.','after':'B is 999 m.'}]},
 'arbitrary_replacement':{'patches':[{'id':'p','comparison_ids':['c'],'before':'A is 2 m.','after':'A is 999 kg and B is closed.'}]},
 'mixed_ids':{'patches':[{'id':'p','comparison_ids':['c','unknown'],'before':'B is 7 m.','after':'B is 999 m.'}]},
}
results={'baseline_gate':g,'deliveries':{k:delivery.enforce(u,p,g) for k,p in proposals.items()}}
for v in results['deliveries'].values():assert v['accepted_patch_ids']==['p']
dim=copy.deepcopy(c);dim['comparisons'][0]['evidence_quantity']['value']='9'
dim['comparisons'][0]['arithmetic']={'expression':'x*x','operands':[dict(w,name='x',value='3',unit='m')]}
results['dimension_arithmetic']=gate.run(u,dim)
assert results['dimension_arithmetic']['results'][0]['gate_result']=='eligible_mismatch'
malformed=copy.deepcopy(c);malformed['comparisons'][0]['axes']=[]
try:gate.run(u,malformed)
except Exception as e:results['malformed_axes']={'exception_type':type(e).__name__,'message':str(e)}
other=copy.deepcopy(g);other['unit_id']='different-unit'
results['wrong_unit_gate']=delivery.enforce(u,proposals['unrelated_clause'],other)
assert results['wrong_unit_gate']['accepted_patch_ids']==['p']
print(json.dumps(results,indent=2))

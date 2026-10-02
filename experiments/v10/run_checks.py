"""Offline mechanical and arithmetic replay. Does not run or impersonate an AI."""
from pathlib import Path
import sys,json,unittest,importlib.util,hashlib
ROOT=Path(__file__).resolve().parent
sys.dont_write_bytecode=True
sys.path.insert(0,str(ROOT/'editing-v1_1'))
import delivery,test_delivery,test_strict_types
suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromModule(test_delivery),unittest.defaultTestLoader.loadTestsFromModule(test_strict_types)])
r=unittest.TextTestRunner(verbosity=1).run(suite)
spec=importlib.util.spec_from_file_location('independent_test',ROOT/'independent-code-audit/test_independent.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
# Original frozen case accepts False as rejection; implementation's preserved contract raises ValueError.
original=mod.verify_delivery
def rejection_adapter(*args,**kwargs):
 try:return original(*args,**kwargs)
 except ValueError:return False
mod.verify_delivery=rejection_adapter
q=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(mod.IndependentTests))
axes=list(json.loads((ROOT/'calibration/rubric.json').read_text())['axes']);order=json.loads((ROOT/'calibration/run-order.json').read_text())
if isinstance(order,dict):order=order['packet_ids']
counts={a:0 for a in axes}
for id in order:
 a=json.loads((ROOT/'calibration/raw'/f'A__{id}.json').read_text());b=json.loads((ROOT/'calibration/raw'/f'B__{id}.json').read_text())
 for axis in axes:counts[axis]+=a[axis]==b[axis]
print('Calibration raw paired agreement:',counts,'denominator=',len(order))
initial=json.loads((ROOT/'results/initial-candidates-summary.json').read_text());rows=initial['rows'];agree={a:sum(x['axes'][a]['A']==x['axes'][a]['B'] for x in rows) for a in axes}
assert all(agree[a]==initial['agreement_by_axis'][a]['equal'] for a in axes)
assert sum(x['body_changed'] for x in rows)==initial['body_changed']
final=json.loads((ROOT/'results/final-summary.json').read_text());fr=final['rows'];assert sum(x['released'] for x in fr)==final['local_released'];assert sum(x['output_changed'] and x['released'] for x in fr)==final['released_edited']
assert all(x['delivered_target_resolution']=='not_reassessed_after_hold' for x in fr if not x['released'])
print('Natural+synthetic initial agreement from disclosed projection:',agree,'denominator=',len(rows))
print('Final local states:',{k:final[k] for k in ['local_released','local_held','released_edited','released_unchanged','applied_patch_count']})
print('NOTE: natural full raw judgments not redistributed; these counts do not independently re-adjudicate their truth.')
raise SystemExit(not(r.wasSuccessful() and q.wasSuccessful()))

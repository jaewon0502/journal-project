import unittest,copy
from gate import run
class GateTest(unittest.TestCase):
 def setUp(self):
  self.u={'unit_id':'mechanical','article':{'text':'A is 2 km.'},'sources':[{'id':'S','text':'A is 2000 m.'}]}
  w={'source_id':'S','quote':'A is 2000 m.'}
  self.c={'comparisons':[{'id':'c','article_quote':'2 km','axes':{k:{'relation':'same','article_anchor':'A is 2 km.','source_anchors':[w]} for k in ['referent','property','population','conditions','time']},'article_quantity':{'value':'2','unit':'km'},'evidence_quantity':{'value':'2000','unit':'m'},'arithmetic':None,'evidence':[w]}]}
 def result(self):return run(self.u,self.c)['results'][0]['gate_result']
 def test_unit_equivalence(self):self.assertEqual(self.result(),'normalized_equal')
 def test_true_mismatch_permission(self):
  self.c['comparisons'][0]['article_quantity']['value']='3';self.assertEqual(self.result(),'eligible_mismatch')
 def test_each_missing_identity_blocks(self):
  for k in self.c['comparisons'][0]['axes']:
   self.c['comparisons'][0]['axes'][k]['relation']='unknown';self.assertEqual(self.result(),'blocked');self.c['comparisons'][0]['axes'][k]['relation']='same'
 def test_different_time_blocks(self):
  self.c['comparisons'][0]['axes']['time']['relation']='different';self.assertEqual(self.result(),'blocked')
 def test_unsupported_witness_blocks(self):
  self.c['comparisons'][0]['evidence']=[{'source_id':'S','quote':'not present'}];self.assertEqual(self.result(),'blocked')
 def test_incompatible_dimension_blocks(self):
  self.c['comparisons'][0]['evidence_quantity']['unit']='kg';self.assertEqual(self.result(),'blocked')
 def test_arithmetic_without_anchored_operand_blocks(self):
  self.c['comparisons'][0]['arithmetic']={'expression':'x+1','operands':[{'name':'x','value':1999,'source_id':'S','quote':'A is 2000 m.'}]};self.assertEqual(self.result(),'blocked')
 def test_semantically_false_binding_can_pass(self):
  # Deliberate limitation witness: copied anchors do not prove that assigned values describe them.
  self.c['comparisons'][0]['article_quantity']['value']='999';self.assertEqual(self.result(),'eligible_mismatch')
if __name__=='__main__':unittest.main()

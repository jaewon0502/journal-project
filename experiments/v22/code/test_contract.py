import copy,unittest
from contract import check
class GuardTests(unittest.TestCase):
 def setUp(self):
  self.u={'unit_id':'s','article':{'text':'수치는 12다.'}}
  self.r={'unit_id':'s','claims':[{'id':'C','fact_support':'supported','attribution_support':'not_applicable','edit_necessity':'none','decision':'keep','rationale_rule':'supported_original','rationale':'The source supports 12.','patch_ids':[]}],'patches':[],'full_edited_article':'수치는 12다.'}
 def test_consistent_keep(self):self.assertEqual(check(self.u,self.r)['gate'],'structurally_consistent_only')
 def test_kept_declared_conflict(self):
  self.r['claims'][0]['fact_support']='contradicted';self.assertTrue(check(self.u,self.r)['flags'])
 def test_kept_attribution_overclaim(self):
  self.r['claims'][0]['attribution_support']='overstated';self.assertTrue(check(self.u,self.r)['flags'])
 def test_optional_repair(self):
  c=self.r['claims'][0];c.update(decision='repair',edit_necessity='required',rationale_rule='optional_detail',patch_ids=['P']);self.r['patches']=[{'id':'P','claim_ids':['C'],'before':'12','after':'열두'}];self.r['full_edited_article']='수치는 열두다.';self.assertTrue(check(self.u,self.r)['flags'])
 def test_supported_hold(self):
  self.r['claims'][0].update(decision='hold',edit_necessity='unresolved');self.assertTrue(check(self.u,self.r)['flags'])
 def test_duplicate_id(self):
  self.r['claims'].append(copy.deepcopy(self.r['claims'][0]));self.assertTrue(check(self.u,self.r)['errors'])
 def test_invalid_enum(self):
  self.r['claims'][0]['fact_support']=True;self.assertTrue(check(self.u,self.r)['errors'])
 def test_broken_link(self):
  self.r['claims'][0].update(decision='repair',edit_necessity='required',patch_ids=['P']);self.assertTrue(check(self.u,self.r)['errors'])
 def test_delivery_mismatch(self):
  self.r['full_edited_article']='수치는 18이다.';self.assertTrue(check(self.u,self.r)['errors'])
 def test_unverified_is_not_automatic_false(self):
  self.r['claims'][0].update(fact_support='not_established',rationale_rule='unverified_attribution');self.assertEqual(check(self.u,self.r)['gate'],'structurally_consistent_only')
 def test_prose_semantics_not_verified(self):
  self.r['claims'][0]['rationale']='The source says 18, so this original 12 is wrong.';r=check(self.u,self.r);self.assertEqual(r['gate'],'structurally_consistent_only');self.assertFalse(r['meaning_verified'])
if __name__=='__main__':unittest.main()

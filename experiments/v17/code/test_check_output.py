import json,unittest
from pathlib import Path
from check_output import apply_checked
S=json.loads(Path('schema.json').read_text())
def fixture():
 u={'unit_id':'X','original_text':'alpha beta gamma','candidate_text':'alpha beta gamma','sources':[{'id':'S','text':'Support clause.'}]}
 f={k:'' for k in S['properties']['findings']['items']['required']}
 for k in ['original_meaning_loss','factual_error','conclusion_changing_omission','required_answer_missing','answer_present_but_incorrect','optional_clarification']:f[k]='no'
 f.update(id='F',question_part='Q1',origin='new_from_edit',necessity='yes',evidence_support='yes',preserves_other_meaning='yes',context_safe='yes',local_action='patch',source_refs=['S'],evidence_relations=[])
 o={'unit_id':'X','findings':[f],'patches':[{'id':'P','finding_id':'F','before':'alpha','after':'ALPHA LONG','depends_on':[]}], 'preservation_decision':'repair','local_hold_reasons':[],'coverage_gaps':[],'selected_candidate_delta_safety':'safe','overall_readiness':'unknown','overall_reason':'fixture','read_scope':'synthetic'}
 return u,o
class Checks(unittest.TestCase):
 def test_offsets_use_original_candidate(self):
  u,o=fixture();o['patches'].append({'id':'Q','finding_id':'F','before':'gamma','after':'G','depends_on':['P']})
  self.assertEqual(apply_checked(u,o,S),'ALPHA LONG beta G')
 def test_duplicate_anchor_rejected(self):
  u,o=fixture();u['candidate_text']='alpha beta alpha'
  with self.assertRaises(ValueError):apply_checked(u,o,S)
 def test_overlap_rejected(self):
  u,o=fixture();o['patches'].append({'id':'Q','finding_id':'F','before':'alpha beta','after':'B','depends_on':[]})
  with self.assertRaises(ValueError):apply_checked(u,o,S)
 def test_missing_or_cyclic_dependency(self):
  for dep in ['missing','P']:
   u,o=fixture();o['patches'][0]['depends_on']=[dep]
   with self.assertRaises(ValueError):apply_checked(u,o,S)
 def test_bad_source_quote(self):
  u,o=fixture();o['findings'][0]['evidence_relations']=[{'supporting_clause':{'document_id':'S','locator':'one','quote':'Unsupported clause.'},'linked_clause':None,'relation':'supports','relevance_to_claim':'fixture'}]
  with self.assertRaises(ValueError):apply_checked(u,o,S)
 def test_atomic_question_cannot_be_missing_and_wrong(self):
  u,o=fixture();o['findings'][0].update(required_answer_missing='yes',answer_present_but_incorrect='yes')
  with self.assertRaises(ValueError):apply_checked(u,o,S)
 def test_unknown_safety_cannot_apply(self):
  u,o=fixture();o['selected_candidate_delta_safety']='unknown'
  with self.assertRaises(ValueError):apply_checked(u,o,S)
 def test_normal_unchanged(self):
  u,o=fixture();o.update(findings=[],patches=[],preservation_decision='no_change')
  self.assertEqual(apply_checked(u,o,S),u['candidate_text'])
 def test_undelivered_patch_finding(self):
  u,o=fixture();o.update(patches=[],preservation_decision='no_change')
  with self.assertRaises(ValueError):apply_checked(u,o,S)
 def test_noop_cannot_be_repair(self):
  u,o=fixture();o['patches'][0]['after']='alpha'
  with self.assertRaises(ValueError):apply_checked(u,o,S)
if __name__=='__main__':unittest.main()

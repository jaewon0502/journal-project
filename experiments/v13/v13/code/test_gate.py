"""Authored mechanics fixtures, not model outputs or measured experiment results."""
import copy
import unittest
from gate import binding, canonical, evaluate, prepare

def fixture(n=2):
    b={'bundle_id':'mechanics','source_documents':[{'id':'s','url':'fictional','paragraphs':[{'id':'s1','text':'A B C'}]}],'original_article':'A B C','questions':[],'proposed_patches':[{'id':str(i),'before':v,'after':v.lower(),'reason':'fixture','evidence_ids':['s1']} for i,v in enumerate('ABC'[:n])],'source_scope_note':'fixture only'}
    raw=canonical(b)
    r={**binding(b,raw),'complete':True,'read_complete':True,'patch_assessments':[{'patch_id':p['id'],**{f:'yes' for f in ['warranted','evidence_support','preserves_untargeted_meaning','context_safe','application_valid']},'dependencies':[],'dependency_status':'complete','anchors':[{'document_id':'original','quote':p['before']}],'reason':'mechanics fixture','confidence':'high'} for p in b['proposed_patches']],'background_issues':[],'global_material_risk':'no','global_risk_reason':'fixture','global_risk_anchors':[],'preference_differences':[],'overall_reason':'fixture'}
    return b,raw,[r,copy.deepcopy(r)]

def issue(**kw):
    return {'id':'gap','status':'unresolved','material':'yes','affects_patch_ids':[],'unrelated_to_edits':'yes','anchors':[{'document_id':'original','quote':'C'}],'reason':'C is outside both independent changed spans and their relations',**kw}

class Mechanics(unittest.TestCase):
    def test_mixed_independent(self):
        b,raw,r=fixture(); r[1]['patch_assessments'][1]['evidence_support']='unknown'
        x=evaluate(b,raw,r)['results']; self.assertEqual(x['G0']['delivered_text'],'A B C'); self.assertEqual(x['G1']['delivered_text'],'a B C')
    def test_dependency_rollback_transitive(self):
        b,raw,r=fixture(3); r[0]['patch_assessments'][0]['dependencies']=['1']; r[1]['patch_assessments'][1]['dependencies']=['2']; r[1]['patch_assessments'][2]['context_safe']='no'
        self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],[])
    def test_global_unlocalized(self):
        b,raw,r=fixture(); r[0]['global_material_risk']='unknown'; r[0]['global_risk_anchors']=[{'document_id':'original','quote':'A'}]; self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],[])
    def test_missing_hash(self):
        b,raw,r=fixture(); del r[1]['input_sha256']; self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],[])
    def test_raw_byte_binding(self):
        b,raw,r=fixture(); self.assertEqual(evaluate(b,raw+b' ',r)['results']['G1']['accepted_ids'],[])
    def test_normal_no_patch(self):
        b,raw,r=fixture(0)
        for x in evaluate(b,raw,r)['results'].values(): self.assertEqual(x['status'],'no_op'); self.assertEqual(x['delivered_text'],'A B C')
    def test_unrelated_gap(self):
        b,raw,r=fixture(); r[0]['background_issues']=[issue()]; x=evaluate(b,raw,r)['results']; self.assertEqual(x['G0']['accepted_ids'],[]); self.assertEqual(x['G1']['accepted_ids'],['0','1'])
    def test_preference_only(self):
        b,raw,r=fixture(); r[0]['preference_differences']=[{'description':'prefer less criticism','reason_preference_only':'no semantic objection'}]
        for x in evaluate(b,raw,r)['results'].values(): self.assertEqual(x['accepted_ids'],['0','1'])
    def test_mapped_material(self):
        b,raw,r=fixture(); r[0]['background_issues']=[issue(affects_patch_ids=['1'],unrelated_to_edits='no',material='unknown')]; self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],['0'])
    def test_unknown_relation(self):
        b,raw,r=fixture(); r[0]['background_issues']=[issue(unrelated_to_edits='unknown')]; self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],[])
    def test_cycles(self):
        b,raw,r=fixture(); r[0]['patch_assessments'][0]['dependencies']=['1']; r[0]['patch_assessments'][1]['dependencies']=['0']; x=evaluate(b,raw,r)['results']['G1']; self.assertEqual(x['delivered_text'],'a b C'); self.assertTrue(x['final_audit_required'])
    def test_unknown_dependency(self):
        b,raw,r=fixture(); r[0]['patch_assessments'][0]['dependency_status']='unknown'; self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],['1'])
    def test_inexact_evidence(self):
        b,raw,r=fixture(); r[0]['patch_assessments'][0]['anchors'][0]['quote']='invented'; self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],[])
    def test_simultaneous(self):
        b,raw,r=fixture(); b['proposed_patches'][0]['after']='B'; raw=canonical(b)
        for review in r: review.update(binding(b,raw))
        self.assertEqual(evaluate(b,raw,r)['results']['G1']['delivered_text'],'B b C')
    def test_nonunique_anchor(self):
        b,raw,r=fixture(); b['original_article']='A A B C'; raw=canonical(b)
        for review in r: review.update(binding(b,raw))
        self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],['1'])
    def test_overlap(self):
        b,raw,r=fixture(); b['proposed_patches'][0]['before']='A B'; raw=canonical(b)
        for review in r: review.update(binding(b,raw))
        self.assertEqual(evaluate(b,raw,r)['results']['G1']['accepted_ids'],[])
    def test_missing_review(self):
        b,raw,r=fixture(); self.assertEqual(evaluate(b,raw,r[:1])['results']['G1']['accepted_ids'],[])
if __name__=='__main__': unittest.main()

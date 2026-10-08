import copy
import unittest
from gate import run, AXES, UNITS
from delivery import enforce

class StructuralTests(unittest.TestCase):
    def fixture(self, article='A is 2 m. B is 7 m.', quote='A is 2 m.', av='2', au='m', ev='3', eu='m'):
        unit = {'unit_id':'test', 'article':{'text':article}, 'sources':[{'id':'S', 'text':'A is 3 m. B is 7 m. x is 300 cm; y is 1 m.'}]}
        w = {'source_id':'S', 'quote':'A is 3 m.'}
        comparison = {'id':'c', 'article_quote':quote, 'axes':{k:{'relation':'same','article_anchor':quote,'source_anchors':[w]} for k in AXES}, 'article_quantity':{'value':av,'unit':au}, 'evidence_quantity':{'value':ev,'unit':eu}, 'arithmetic':None, 'evidence':[w]}
        return unit, {'comparisons':[comparison]}
    def setUp(self):
        self.u, self.c = self.fixture()
    def result(self):
        return run(self.u, self.c)['results'][0]['gate_result']
    def delivery(self, before='A is 2 m.', after='A is 3 m.', ids=None, gate=None):
        return enforce(self.u, {'patches':[{'id':'p','before':before,'after':after,'comparison_ids':['c'] if ids is None else ids}]}, run(self.u,self.c) if gate is None else gate)
    def blocked(self, out):
        self.assertEqual(out['accepted_patch_ids'], [])
        self.assertEqual(out['full_edited_text'], self.u['article']['text'])
        self.assertTrue(out['local_review_required'])
    def test_truthful_mismatch_and_delivery(self):
        self.assertEqual(self.result(), 'eligible_mismatch')
        out=self.delivery()
        self.assertEqual(out['accepted_patch_ids'], ['p'])
        self.assertEqual(out['full_edited_text'], 'A is 3 m. B is 7 m.')
    def test_equivalent_units_normal_control(self):
        self.u,self.c=self.fixture('A is 2 km.', '2 km', '2','km','2000','m')
        self.assertEqual(self.result(),'normalized_equal')
        self.assertEqual(enforce(self.u,{'patches':[]},run(self.u,self.c))['full_edited_text'],'A is 2 km.')
        self.blocked(self.delivery('2 km','3 km'))
    def test_expected_converted_to_original_unit(self):
        self.u,self.c=self.fixture('A is 2 km.', '2 km','2','km','3000','m')
        self.assertEqual(self.delivery('2 km','3 km')['accepted_patch_ids'],['p'])
        self.blocked(self.delivery('2 km','3000 km'))
    def test_exact_rational_target_no_rounding(self):
        self.c['comparisons'][0]['evidence_quantity']['value']='1/3'
        self.blocked(self.delivery('2 m','0.333 m'))
    def test_dimensionless_division(self):
        self.u,self.c=self.fixture('A is 2 percent.', '2 percent','2','percent','300','percent')
        self.calc('x/y',[{'name':'x','value':'300','unit':'cm'},{'name':'y','value':'1','unit':'m'}],'300','percent')
        self.assertEqual(self.result(),'eligible_mismatch')
        self.assertEqual(self.delivery('2 percent','300 percent')['accepted_patch_ids'],['p'])
    def test_normal_equal_all_allowed_units(self):
        for unit in UNITS:
            with self.subTest(unit=unit):
                self.u,self.c=self.fixture('A is 2 units.', '2 units','2',unit,'2',unit)
                self.assertEqual(self.result(),'normalized_equal')
    def test_unrelated_clause_arbitrary_and_unknown_ids(self):
        for before,after,ids in [('B is 7 m.','B is 999 m.',['c']),('A is 2 m.','A is 999 kg and B is closed.',['c']),('A is 2 m.','A is 3 m.',['c','unknown']),('A is 2 m.','A is 999 m.',['c']),('A is 2 m.','A is 300 cm.',['c'])]:
            with self.subTest(after=after,ids=ids): self.blocked(self.delivery(before,after,ids))
    def test_gate_wrong_unit_and_hash(self):
        for key,value in [('unit_id','other'),('article_sha256','bad')]:
            g=run(self.u,self.c);g[key]=value;self.blocked(self.delivery(gate=g))
        g=run(self.u,self.c);self.u['article']['text']+=' changed';self.blocked(self.delivery(gate=g))
    def test_all_ids_must_be_eligible(self):
        other=copy.deepcopy(self.c['comparisons'][0]);other['id']='d';other['axes']['time']['relation']='different';self.c['comparisons'].append(other)
        self.blocked(self.delivery(ids=['c','d']))
    def calc(self, expression, operands, ev='2', eu='m'):
        self.c['comparisons'][0]['evidence_quantity']={'value':ev,'unit':eu}
        self.c['comparisons'][0]['arithmetic']={'expression':expression,'operands':[dict(source_id='S',quote='x is 300 cm; y is 1 m.',**v) for v in operands]}
    def test_subtraction_normalizes_operands(self):
        self.calc('x-y',[{'name':'x','value':'300','unit':'cm'},{'name':'y','value':'1','unit':'m'}])
        self.assertEqual(self.result(),'normalized_equal')
        self.u['article']['text']='A is 4 m. B is 7 m.';self.c['comparisons'][0]['article_quote']='A is 4 m.';self.c['comparisons'][0]['article_quantity']['value']='4'
        for x in self.c['comparisons'][0]['axes'].values():x['article_anchor']='A is 4 m.'
        self.assertEqual(self.result(),'eligible_mismatch');self.assertEqual(self.delivery('A is 4 m.','A is 2 m.')['accepted_patch_ids'],['p'])
    def test_length_squared_area(self):
        self.u,self.c=self.fixture('A is 2 m2.','2 m2','2','m2','9','m2')
        self.calc('x*x',[{'name':'x','value':'300','unit':'cm'}],'9','m2')
        self.assertEqual(self.result(),'eligible_mismatch')
        self.assertEqual(self.delivery('2 m2','9 m2')['accepted_patch_ids'],['p'])
    def test_bad_arithmetic(self):
        for expression,ops in [('x*x',[{'name':'x','value':'3','unit':'m'}]),('x',[{'name':'x','value':'9'}]),('x+y',[{'name':'x','value':'3','unit':'m'},{'name':'y','value':'6','unit':'kg'}]),('x+1',[{'name':'x','value':'8','unit':'m'}])]:
            with self.subTest(expression=expression,ops=ops):
                self.calc(expression,ops,'9');self.assertEqual(self.result(),'blocked')
    def test_numeric_substring_and_korean_suffix(self):
        self.u,self.c=self.fixture('수량은 2명이다.', '2명','2','count','3','count')
        self.assertEqual(self.delivery('2명','3명')['accepted_patch_ids'],['p'])
        self.u,self.c=self.fixture('A is 12 m.', '12 m','12','m','13','m')
        self.blocked(self.delivery('2 m','3 m'))
    def test_no_multiple_numeric_or_prose_changes(self):
        self.blocked(self.delivery('A is 2 m. B is 7 m.','A is 3 m. B is 8 m.'))
        self.blocked(self.delivery('A is 2 m.','C is 3 m.'))
    def test_identity_anchors_and_false_values(self):
        for axis in AXES:
            self.c['comparisons'][0]['axes'][axis]['relation']='unknown';self.assertEqual(self.result(),'blocked');self.c['comparisons'][0]['axes'][axis]['relation']='same'
        self.c['comparisons'][0]['article_quantity']['value']='999';self.assertEqual(self.result(),'blocked')
    def test_known_semantic_certificate_limitation(self):
        # Source actually says B, but a certificate falsely asserts identity to A.
        self.u['sources'][0]['text']='B is 3 m.'
        c=self.c['comparisons'][0];c['evidence'][0]['quote']='B is 3 m.'
        self.assertEqual(self.result(),'eligible_mismatch')
        self.assertFalse(run(self.u,self.c)['results'][0]['semantic_identity_verified'])
        self.assertEqual(self.delivery()['accepted_patch_ids'], ['p'])
    def test_label_bound_to_clause_and_every_id(self):
        for quote,ids in [('B is 7 m.',['c']),('A is 2 m.',['c','unknown'])]:
            out=enforce(self.u,{'clause_audit':[{'quote':quote,'relation':'contradicted','comparison_ids':ids}]},run(self.u,self.c))
            self.assertEqual(len(out['raw_label_violations']),1)
        out=enforce(self.u,{'clause_audit':[{'quote':'A is 2 m.','relation':'contradicted','comparison_ids':['c']}]},run(self.u,self.c));self.assertEqual(out['raw_label_violations'],[])
    def test_malformed_inputs_fail_closed(self):
        for bad in [None,[],{}, {'comparisons':[None]}, {'comparisons':[{'id':[]}]}, {'comparisons':[],'other':None}]:
            out=run(self.u,bad);self.assertIsInstance(out,dict)
        for axes in [[],None,5]:
            self.c['comparisons'][0]['axes']=axes;self.assertEqual(self.result(),'blocked')
        self.u,self.c=self.fixture()
        for proposal in [None,[],{'patches':None},{'patches':[None]},{'patches':[{'id':'p','comparison_ids':[{}]}]},{'clause_audit':[None]}]:
            self.blocked(enforce(self.u,proposal,run(self.u,self.c)))
        for unit in [None,[],{}, {'unit_id':'x','article':[]}]:
            self.assertEqual(run(unit,self.c)['status'],'blocked')
            self.assertEqual(enforce(unit,{},run(self.u,self.c))['status'],'blocked')
    def test_duplicate_and_ambiguous_anchors(self):
        self.c['comparisons'].append(copy.deepcopy(self.c['comparisons'][0]));self.assertEqual(run(self.u,self.c)['status'],'blocked')
        self.u,self.c=self.fixture('A is 2 m. A is 2 m.');self.assertEqual(self.result(),'blocked')
    def test_overlap_rejected(self):
        p={'id':'p','before':'A is 2 m.','after':'A is 3 m.','comparison_ids':['c']}
        out=enforce(self.u,{'patches':[p,dict(p,id='q')]},run(self.u,self.c));self.assertEqual(out['accepted_patch_ids'],['p']);self.assertEqual(len(out['blocked_patches']),1)

if __name__=='__main__':unittest.main()

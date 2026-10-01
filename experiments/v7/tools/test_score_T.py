import unittest
from score_T import outcome


class ScoringTests(unittest.TestCase):
    def test_repair_requires_all_four_conditions(self):
        j={'original_error_repaired':'yes','revised_source_supported':'yes','necessary_question_meaning_preserved':'yes','new_factual_errors':[]}
        self.assertTrue(outcome('mutation',b'a',b'b',j,'model_patch_guarded')['repair_success'])
        for key,value in [('original_error_repaired','no'),('revised_source_supported','no'),('necessary_question_meaning_preserved','no'),('new_factual_errors',['new error'])]:
            altered=dict(j);altered[key]=value
            self.assertFalse(outcome('mutation',b'a',b'b',altered,'model_patch_guarded')['repair_success'])

    def test_hold_never_repair_success_and_pending_is_unknown(self):
        j={'original_error_repaired':'yes','revised_source_supported':'yes','necessary_question_meaning_preserved':'yes','new_factual_errors':[]}
        result=outcome('mutation',b'a',b'a',j,'unsupported')
        self.assertFalse(result['repair_success']);self.assertTrue(result['nominal_kind_vs_judgment_disagreement'])
        result=outcome('mutation',b'a',None,None,'pending')
        self.assertIsNone(result['repair_success']);self.assertEqual(result['semantic_outcome_state'],'pending')

    def test_preservation_requires_byte_identity_and_support(self):
        self.assertTrue(outcome('equivalent',b'a',b'a',{'revised_source_supported':'yes'},'no_op')['preserved_and_source_supported'])
        self.assertFalse(outcome('normal',b'a',b'b',{'revised_source_supported':'yes'},'model_patch_guarded')['preserved_and_source_supported'])
        self.assertIsNone(outcome('normal',b'a',b'a',{},'no_op')['preserved_and_source_supported'])


if __name__=='__main__':unittest.main()

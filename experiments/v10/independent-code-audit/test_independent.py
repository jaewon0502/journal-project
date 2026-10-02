"""Four bounded mechanical adversarial cases; imports frozen code read-only."""
import copy
import json
from pathlib import Path
import sys
import unittest
sys.dont_write_bytecode = True
ROOT = Path('/historical-research/journal-v10/editing')
sys.path.insert(0, str(ROOT))
from delivery import build_delivery, verify_delivery, digest, engine
from test_delivery import fixture, verdict, raw
RESULTS = {}


def check_bytes(test, out, note):
    test.assertEqual(note['output_sha256'], digest(out))
    test.assertIn(digest(out), note['delivery_summary'])
    for patch in note['patches']:
        a, b = patch['output_span']
        test.assertEqual(digest(out[a:b]), patch['actual_sha256'])
    for state, ko in [('applied','적용'),('rolledback','원복'),('held','보류')]:
        count = sum(c['state'] == state for c in note['components'])
        test.assertIn(f'{ko} {count}개', note['delivery_summary'])


class IndependentTests(unittest.TestCase):
    def test_1_unicode_length_changes_and_atomic_dependency(self):
        args = list(fixture('KO', rejected=('B',), relation='dependent'))
        proposal = json.loads(args[1])
        proposal['patches'][0]['after'] = '길어진 첫 수정'
        proposal['patches'][1]['after'] = ''
        proposal['patches'][2]['after'] = '닥🙂!'
        args[1] = raw(proposal)
        for i in (2, 3):
            audit = json.loads(args[i]); audit['proposal_sha256'] = digest(args[1]); args[i] = raw(audit)
        audits = [verdict(args)]
        out, note = build_delivery(*args, audits)
        self.assertEqual(out, '가 나 닥🙂!'.encode())
        self.assertEqual(note['applied_ids'], ['C'])
        self.assertEqual([p['state'] for p in note['patches']], ['rolledback','rolledback','applied'])
        check_bytes(self, out, note)
        self.assertTrue(verify_delivery(out,note,*args,audits))
        RESULTS['unicode_dependency'] = note

    def test_2_source_only_dependencies_and_preexisting_prose(self):
        args = list(fixture(relation='dependent'))
        audit = json.loads(args[3])
        audit['preexisting_findings'] = [{'description':'ALL REPAIRS COMPLETED', 'evidence_ids':['E-legacy']}]
        args[3] = raw(audit)
        audits = [verdict(args, findings=[dict(id='old',description='ALL ERRORS FIXED',relation='preexisting_independent',patch_ids=[])])]
        out, note = build_delivery(*args,audits,policy='source_only')
        self.assertEqual(out,args[0]); self.assertFalse(note['released'])
        self.assertEqual(note['applied_ids'],[])
        self.assertEqual([p['state'] for p in note['patches']],['rolledback']*3)
        self.assertEqual(len(note['unresolved']),2)
        self.assertNotIn('ALL REPAIRS',json.dumps(note)); self.assertNotIn('ALL ERRORS',json.dumps(note))
        check_bytes(self,out,note)
        self.assertTrue(verify_delivery(out,note,*args,audits,policy='source_only'))
        RESULTS['source_only'] = note

    def test_3_reduced_candidate_stale_then_fresh_audits(self):
        args = fixture(relation='dependent')
        old_approval = verdict(args)
        bad = verdict(args,findings=[dict(id='introduced',description='remove B dependency component',relation='offending',patch_ids=['B'])])
        first_selection = engine.release_selection(engine.propose_selection(*args),bad).provisional
        out, note = build_delivery(*args,[bad,old_approval])
        self.assertEqual(out,args[0]); self.assertFalse(note['released'])
        self.assertEqual(note['applied_ids'],[])
        fresh = verdict(args,first_selection)
        out, note = build_delivery(*args,[bad,fresh])
        self.assertEqual(out,b'a b C'); self.assertTrue(note['released'])
        self.assertEqual(note['applied_ids'],['C'])
        self.assertEqual(note['final_candidate_sha256'],digest(out))
        self.assertEqual([p['state'] for p in note['patches']],['rolledback','rolledback','applied'])
        check_bytes(self,out,note)
        RESULTS['fresh_reaudit'] = note

    def test_4_json_field_type_tampering_should_be_rejected(self):
        args = fixture(); audits = [verdict(args)]
        out, note = build_delivery(*args,audits)
        tampered = copy.deepcopy(note)
        tampered['released'] = 1
        tampered['patches'][0]['source_span'] = [False, True]
        tampered['patches'][0]['output_span'] = [0.0, 1.0]
        # A JSON round trip establishes that this is a real serialized field change.
        tampered = json.loads(json.dumps(tampered))
        self.assertNotEqual(json.dumps(note,sort_keys=True),json.dumps(tampered,sort_keys=True))
        accepted = verify_delivery(out,tampered,*args,audits)
        RESULTS['type_tampering'] = dict(accepted=accepted, original_released=note['released'],
            tampered_released=tampered['released'],original_source_span=note['patches'][0]['source_span'],
            tampered_source_span=tampered['patches'][0]['source_span'],
            original_output_span=note['patches'][0]['output_span'],tampered_output_span=tampered['patches'][0]['output_span'])
        self.assertFalse(accepted, 'verify_delivery accepted modified JSON field types')


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(IndependentTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    Path(__file__).with_name('adversarial-results.json').write_text(json.dumps(RESULTS,ensure_ascii=False,indent=2)+'\n')
    raise SystemExit(not result.wasSuccessful())

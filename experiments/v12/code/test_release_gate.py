"""Authored synthetic fixtures only; not sampled model outputs or semantic validation."""
import unittest
from copy import deepcopy
from release_gate import release_gate, digest

class GateChecks(unittest.TestCase):
    def setUp(self):
        self.source = 'The sample contains ten items.'
        self.patches = [{'id': 'p1', 'before': 'ten items', 'after': 'ten items, all blue'}]
        self.review = {'packet_id': 'synthetic', 'complete': True, 'read_complete': True,
            'overall_flags': {'any_supported_harm': False, 'any_unresolved_material_issue': False},
            'patch_assessments': [{'patch_id': 'p1', 'warranted': 'yes', 'new_assertion': 'yes',
                'meaning_loss': 'no', 'overediting': 'no', 'location_correct': 'yes',
                'repairs_identified_issue': 'yes', 'evidence_justifies_difference': 'yes'}],
            'finding_assessments': [], 'reference_assessments': [], 'unanswered_scope': [], 'unlisted_findings': []}
        self.reviews = [deepcopy(self.review), deepcopy(self.review)]
    def run_gate(self, **changes):
        args = dict(original=self.source, patches=self.patches, reviews=self.reviews,
                    packet_id='synthetic', expected_source_sha256=digest(self.source),
                    expected_candidate_sha256=digest('The sample contains ten items, all blue.'))
        args.update(changes)
        return release_gate(**args)
    def assert_hold(self, result):
        self.assertEqual(result['status'], 'hold')
        self.assertEqual(result['delivered_text'], self.source)
    def test_supported_addition_and_input_immutability(self):
        before = deepcopy((self.patches, self.reviews))
        self.assertEqual(self.run_gate()['status'], 'accept')
        self.assertEqual((self.patches, self.reviews), before)
    def test_disagreement(self):
        self.reviews[1]['patch_assessments'][0]['repairs_identified_issue'] = 'partial'
        result = self.run_gate()
        self.assert_hold(result)
        self.assertIn('reviewer_disagreement', result['reasons'])
    def test_unsupported_change(self):
        for r in self.reviews:
            r['patch_assessments'][0]['evidence_justifies_difference'] = 'no'
        self.assert_hold(self.run_gate())
    def test_stale_hashes(self):
        for key in ('expected_source_sha256', 'expected_candidate_sha256'):
            with self.subTest(key=key): self.assert_hold(self.run_gate(**{key: 'stale'}))
    def test_missing_and_incomplete_reviews_or_assessment(self):
        for reviews in ([self.review], [self.review, None]):
            self.assert_hold(self.run_gate(reviews=reviews))
        self.reviews[0]['patch_assessments'] = []
        self.assert_hold(self.run_gate())
        self.reviews = [deepcopy(self.review), deepcopy(self.review)]
        self.reviews[1]['read_complete'] = False
        self.assert_hold(self.run_gate())
    def test_noop_still_requires_reviews(self):
        for r in self.reviews: r['patch_assessments'] = []
        self.assertEqual(self.run_gate(patches=[], expected_candidate_sha256=digest(self.source))['status'], 'no-op')
        self.reviews[0]['overall_flags']['any_unresolved_material_issue'] = True
        self.assert_hold(self.run_gate(patches=[], expected_candidate_sha256=digest(self.source)))
    def test_packet_unknown_and_whole_candidate_hold(self):
        self.reviews[0]['packet_id'] = 'other'
        self.assert_hold(self.run_gate())
        self.reviews[0]['packet_id'] = 'synthetic'
        self.reviews[0]['patch_assessments'][0]['meaning_loss'] = 'unknown'
        self.assert_hold(self.run_gate())
        self.reviews[0]['patch_assessments'][0]['meaning_loss'] = 'yes'
        self.patches.append({'id': 'p2', 'before': 'The sample', 'after': 'This sample'})
        for r in self.reviews:
            second = deepcopy(self.review['patch_assessments'][0])
            second.update(patch_id='p2', new_assertion='no', evidence_justifies_difference='not_applicable')
            r['patch_assessments'].append(second)
        self.assert_hold(self.run_gate(expected_candidate_sha256=digest('This sample contains ten items, all blue.')))
    def test_application_failure(self):
        bad = deepcopy(self.patches)
        bad[0]['before'] = 'missing anchor'
        self.assert_hold(self.run_gate(patches=bad))

if __name__ == '__main__':
    unittest.main()

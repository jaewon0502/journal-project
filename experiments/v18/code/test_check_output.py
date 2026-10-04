import json
from pathlib import Path
import unittest
from check_output import apply_checked

class WholeDelivery(unittest.TestCase):
    def fixture(self):
        schema = json.loads((Path(__file__).parent / 'schema.json').read_text())
        unit = {'unit_id': 'N', 'article': {'full_text': 'A condition.\nA reply.'}, 'sources': []}
        output = {'unit_id': 'N', 'findings': [], 'patches': [], 'preservation_decision': 'no_change',
                  'local_hold_reasons': [], 'coverage_gaps': [], 'selected_candidate_delta_safety': 'safe',
                  'overall_readiness': 'unknown', 'overall_reason': 'Test only', 'read_scope': 'Synthetic fixture',
                  'full_edited_article': unit['article']['full_text'],
                  'protection_items': [{'id': 'R', 'original_quotes': ['A condition.', 'A reply.'],
                                       'relation': 'context', 'why_preserve': 'Both statements',
                                       'confidence': 'supported', 'conflict': 'none'}]}
        return unit, output, schema
    def test_normal_exact_delivery(self):
        u, o, s = self.fixture()
        self.assertEqual(apply_checked(u, o, s), u['article']['full_text'])
    def test_undeclared_full_article_deletion_rejected(self):
        u, o, s = self.fixture()
        o['full_edited_article'] = 'A condition.'
        with self.assertRaisesRegex(ValueError, 'native whole article'):
            apply_checked(u, o, s)
    def test_invented_protection_quote_rejected(self):
        u, o, s = self.fixture()
        o['protection_items'][0]['original_quotes'] = ['Invented condition.']
        with self.assertRaisesRegex(ValueError, 'protection anchor'):
            apply_checked(u, o, s)

if __name__ == '__main__':
    unittest.main()

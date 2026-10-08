"""Guard public reader provenance and prevent summaries becoming quotations."""
import json
from pathlib import Path
import unittest
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


class ReaderProvenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / 'docs/reader-data.json').read_text())

    def test_exact_patch_is_the_frozen_public_patch(self):
        patch = json.loads((ROOT / 'experiments/v28/local-patch.json').read_text())
        exact = [c for c in self.data['cases'] if c['original']['kind'] == 'exact']
        self.assertEqual(len(exact), 1)
        self.assertEqual(exact[0]['original']['text'], patch['before'])
        self.assertEqual(exact[0]['proposal']['kind'], 'exact')
        self.assertEqual(exact[0]['proposal']['text'], patch['after'])

    def test_prior_human_reference_is_not_zero_or_new(self):
        reference = json.loads((ROOT / 'experiments/source-evidence-ai-review/data/human-reference.json').read_text())
        human = self.data['human_reference']
        self.assertEqual(human['participants'], reference['participants'])
        self.assertEqual(human['responses'], reference['direct_importance_responses'])
        self.assertTrue(human['limits'])
        self.assertIn('새 사람 응답은 0건', human['summary'])

    def test_evaluation_corrections_are_not_applied_article_patches(self):
        cases = {c['id']: c for c in self.data['cases']}
        for key in ('material-list', 'precision-80-77'):
            self.assertEqual(cases[key]['status'], 'corrected')
            self.assertEqual(cases[key]['original']['kind'], 'summary')
            self.assertEqual(cases[key]['proposal']['kind'], 'summary')

    def test_each_claim_has_evidence_and_unresolved_scope(self):
        identifiers = [c['id'] for c in self.data['cases']]
        self.assertEqual(len(set(identifiers)), len(identifiers))
        for case in self.data['cases']:
            with self.subTest(case=case['id']):
                self.assertTrue(case['evidence'])
                self.assertTrue(case['remaining'])
                for key in ('original', 'proposal'):
                    self.assertIn(case[key]['kind'], ('exact', 'summary', 'unavailable'))
                for evidence in case['evidence']:
                    self.assertIn(evidence['kind'], ('source_summary', 'exact_quote', 'unavailable'))
                    self.assertTrue(evidence['scope_note'])
                    self.assertEqual(urlparse(evidence['url']).scheme, 'https')

    def test_record_paths_stay_in_the_existing_public_tree(self):
        paths = [c['record_path'] for c in self.data['cases']]
        paths += [v['path'] for v in self.data['versions']]
        for name in paths:
            with self.subTest(path=name):
                path = (ROOT / name.split('#', 1)[0]).resolve()
                self.assertTrue(path.is_relative_to(ROOT))
                self.assertTrue(path.exists())

    def test_history_covers_integrated_research_without_reverted_v14(self):
        versions = {v['version'] for v in self.data['versions'] if v['status'] != 'excluded'}
        self.assertTrue({f'v{n}' for n in range(15, 29)} <= versions)
        self.assertNotIn('v14', versions)
        self.assertEqual(self.data['version'], 'v28')


if __name__ == '__main__':
    unittest.main()

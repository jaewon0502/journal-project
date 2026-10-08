"""Guard public reader provenance and prevent summaries becoming quotations."""
import json
from pathlib import Path
import re
import unittest
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
CASE_ARTICLE_UNITS = {
    'ps-body': 'D73',
    'generation-estimate': 'D71',
    'size-attribution': 'D71',
    'plot-area': 'D71',
    'maturity-delay': 'D71',
    'material-list': 'D73',
    'precision-80-77': 'D73',
    'evisa-timing': 'D72',
    'sealevel-control': 'v27_fresh_sealevel2024',
    'sealevel-year': 'v27_fresh_sealevel2024',
}


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
                if '#' in name:
                    self.assertEqual(path.suffix, '.md')
                    fragment = unquote(name.split('#', 1)[1])
                    # Current links use unique plain-text section headings. Check
                    # the actual target, not only the presence of an anchor string.
                    headings = re.findall(r'^#{1,6} (.+)$', path.read_text(), re.M)
                    slugs = [heading.lower().replace(' ', '-') for heading in headings]
                    self.assertEqual(slugs.count(fragment), 1)

    def test_article_links_match_the_published_source_manifest(self):
        manifest = json.loads((ROOT / 'experiments/v28/source-manifest.json').read_text())
        articles = {row['unit']: row for row in manifest if row['role'] == 'article'}
        self.assertEqual({case['id'] for case in self.data['cases']}, set(CASE_ARTICLE_UNITS))
        for case in self.data['cases']:
            with self.subTest(case=case['id']):
                source = articles[CASE_ARTICLE_UNITS[case['id']]]
                article = case['article']
                self.assertEqual(article['url'], source['url'])
                self.assertEqual(urlparse(article['url']).scheme, 'https')
                self.assertTrue(article['scope_note'])
                self.assertTrue(article['date_note'])
                self.assertNotIn('body', article)
                if source.get('title'):
                    self.assertEqual(article['title_kind'], 'exact')
                    self.assertEqual(article['title'], source['title'])
                else:
                    self.assertEqual(article['title_kind'], 'label')
                    self.assertIn('원제목', article['scope_note'])
                dates = source.get('dates', {})
                date = source.get('published') or dates.get('publication') or dates.get('published')
                expected = date.split(' (', 1)[0] if date else None
                self.assertEqual(article['source_date'], expected)

    def test_synthetic_error_is_not_attributed_to_the_external_article(self):
        cases = {case['id']: case for case in self.data['cases']}
        variant = cases['sealevel-year']['article']
        normal = cases['sealevel-control']['article']
        self.assertEqual(variant['url'], normal['url'])
        self.assertEqual(variant['relationship'], 'base_article_for_synthetic_variant')
        self.assertIn('오류 주입 전', variant['scope_note'])
        self.assertIn('외부 기사에 있었다는 뜻이 아닙니다', variant['scope_note'])
        for case in self.data['cases']:
            if case['id'] != 'sealevel-year':
                self.assertEqual(case['article']['relationship'], 'reviewed_article')

    def test_blocked_preproof_does_not_gain_a_guessed_page_fragment(self):
        affected = []
        for case in self.data['cases']:
            for evidence in case['evidence']:
                if urlparse(evidence['url']).hostname == 'www.researchgate.net':
                    affected.append(case['id'])
                    self.assertFalse(urlparse(evidence['url']).fragment)
                    note = evidence['access_note']
                    self.assertIn('2026-10-09', note)
                    self.assertIn('자동 접근', note)
                    self.assertIn('HTTP 403', note)
                    self.assertIn('미확인', note)
        self.assertCountEqual(affected, ['ps-body', 'material-list', 'precision-80-77'])

    def test_history_covers_integrated_research_without_reverted_v14(self):
        versions = {v['version'] for v in self.data['versions'] if v['status'] != 'excluded'}
        self.assertTrue({f'v{n}' for n in range(15, 29)} <= versions)
        self.assertNotIn('v14', versions)
        self.assertEqual(self.data['version'], 'v28')


if __name__ == '__main__':
    unittest.main()

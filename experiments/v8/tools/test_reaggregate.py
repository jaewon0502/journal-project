"""Published arithmetic checks; no claims about semantic correctness."""
from collections import Counter
from copy import deepcopy
import json
import unittest
from reaggregate import ROOT, aggregate, calculate


class PublishedResults(unittest.TestCase):
    def rows(self, split):
        return json.loads((ROOT / 'data' / (split + '-per-case.json')).read_text())

    def test_recomputed_aggregates(self):
        self.assertEqual(calculate(), json.loads((ROOT / 'data' / 'aggregates.json').read_text()))

    def test_allocation_coverage(self):
        manifest = json.loads((ROOT / 'data' / 'source-manifest.json').read_text())
        self.assertEqual(Counter((r['split'],r['language']) for r in manifest),
                         {('DEV','KO'):6,('DEV','EN'):6,('EVAL','KO'):24,('EVAL','EN'):24})
        for split, expected in [('dev',44), ('eval',144)]:
            rows = self.rows(split)
            self.assertEqual(len(rows), expected)
            self.assertEqual({r['article_id'] for r in rows},
                             {r['article_id'] for r in manifest if r['split']==split.upper()})
        for case in {r['article_id'] for r in self.rows('eval')}:
            self.assertEqual(Counter(r['arm'] for r in self.rows('eval') if r['article_id']==case),
                             {'ORIGINAL':1,'FULLREWRITE':1,'LOCAL':1})

    def test_eval_denominators_and_known_failures(self):
        rows = self.rows('eval')
        for lang, claims, necessary in [('KO',949,7), ('EN',1335,6)]:
            for arm in ('ORIGINAL','FULLREWRITE','LOCAL'):
                selected = [r for r in rows if r['language']==lang and r['arm']==arm]
                self.assertEqual(sum(sum(r['counts']['source_claims'].values()) for r in selected),claims)
                self.assertEqual(sum(v for r in selected for k,v in r['counts']['issues'].items()
                                     if k.startswith('necessary_')),necessary)
        climate = next(r for r in rows if r['article_id']=='EN023' and r['arm']=='FULLREWRITE')
        self.assertEqual(climate['counts']['source_claims']['omitted'],1)
        self.assertEqual(climate['counts']['source_severity']['major'],1)
        bank = [r for r in rows if r['article_id']=='KO011' and r['arm'] in {'ORIGINAL','LOCAL'}]
        self.assertEqual(len({r['output_sha256'] for r in bank}),1)
        self.assertTrue(all(r['counts']['issues']['necessary_failed']==2 for r in bank))

    def test_duplicate_and_invalid_counts_rejected(self):
        row = self.rows('eval')[0]
        with self.assertRaises(ValueError): aggregate([row,row])
        for value in (-1,True,1.5):
            bad = deepcopy(row)
            bad['counts']['source_claims']['preserved']=value
            with self.assertRaises(ValueError): aggregate([bad])

    def test_language_and_phase_not_pooled(self):
        groups=calculate()
        self.assertEqual({r['phase'] for r in groups if r['split']=='DEV'},
                         {'organization','relations','confirmation'})
        self.assertEqual({r['language'] for r in groups},{'KO','EN'})


if __name__ == '__main__': unittest.main()

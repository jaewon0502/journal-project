import copy
import json
import unittest
from reaggregate import ROOT, aggregate_t


class FrozenResultsTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads((ROOT/'results/T-eval-summary.json').read_text())

    def test_frozen_results_and_holds(self):
        actual=aggregate_t(self.data)
        self.assertEqual(actual['free']['repair_success'],4)
        for method in ['typed','exact_extractive']:
            self.assertEqual(actual[method]['repair_success'],3)
            self.assertEqual(actual[method]['holds'],1)
        self.assertTrue(all(x['preserved']==8 for x in actual.values()))

    def test_changed_semantic_verdict_is_detected(self):
        altered=copy.deepcopy(self.data)
        altered['events'][0]['methods']['free'][0]['blind_model_judgment']['revised_source_supported']='no'
        with self.assertRaises(ValueError):aggregate_t(altered)

    def test_changed_denominator_is_detected(self):
        altered=copy.deepcopy(self.data)
        altered['events'][0]['method_counts']['typed']['assigned_outputs']+=1
        with self.assertRaises(ValueError):aggregate_t(altered)

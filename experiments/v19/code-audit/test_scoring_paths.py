"""Synthetic continuation tests; no article access or historical result changes."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
import score_T_checked_v2 as fixed

HERE = fixed.ROOT / 'experiments/v15/code-audit/aggregation'
sys.path.insert(0, str(HERE))
_spec = importlib.util.spec_from_file_location('v15_scoring_fixtures', HERE / 'test_aggregation.py')
fixtures = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fixtures)


class RealizationPaths(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.AggregationRegression()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.report = self.f.root / 'runs/T/eval-realized/report.json'
        self.followup = self.f.root / 'runs/T/eval-free-realized/report.json'
        self.original = json.loads(self.report.read_text())
        self.f.write(self.f.root / 'judgments/T/eval-outcomes.raw.json', {'items': self.f.judgments})

    def score(self, backend=fixed):
        return backend.score('eval', self.f.root, self.f.private, self.f.output)

    def reject(self, code):
        self.f.output.write_bytes(b'existing result')
        with self.assertRaises(fixed.JudgmentIdentityError) as caught:
            self.score()
        self.assertIn(code, caught.exception.diagnostics)
        self.assertEqual(self.f.output.read_bytes(), b'existing result')

    def test_valid_result_identical_to_v15(self):
        actual = self.score()
        expected = fixed.v15.score('eval', self.f.root, self.f.private, self.f.output.with_name('reference.json'))
        self.assertEqual(actual, expected)

    def test_duplicate_all_methods_and_both_orders(self):
        for method in fixed.v15.legacy.METHODS:
            for reverse in (False, True):
                with self.subTest(method=method, reverse=reverse):
                    report = copy.deepcopy(self.original)
                    row = next(r for r in report['records'] if r['method'] == method)
                    report['records'].append(dict(row, status='model_hold'))
                    if reverse: report['records'].reverse()
                    self.f.write(self.report, report)
                    self.reject('duplicate_realization_identity')

    def test_identical_duplicate_and_followup_duplicate_rejected(self):
        self.f.write(self.followup, {'records': [self.original['records'][0]] * 2})
        self.reject('duplicate_realization_identity')

    def test_documented_free_followup_supersession_preserved(self):
        self.f.write(self.followup, {'records': [dict(self.original['records'][0], status='model_hold')]})
        actual = self.score()
        expected = fixed.v15.score('eval', self.f.root, self.f.private, self.f.output.with_name('reference.json'))
        self.assertEqual(actual, expected)
        self.assertTrue(actual['events'][0]['methods']['free'][0]['pipeline_hold'])

    def test_foreign_method_in_free_followup_rejected(self):
        self.f.write(self.followup, {'records': [self.original['records'][1]]})
        self.reject('unexpected_realization_identity')

    def test_unknown_case_or_method_rejected(self):
        for field in ('case_id', 'method'):
            report = copy.deepcopy(self.original); report['records'][0][field] = 'foreign'
            self.f.write(self.report, report)
            self.reject('unexpected_realization_identity')

    def test_invalid_identity_types_rejected(self):
        for field in ('case_id', 'method'):
            for value in (None, True, 1, '', ' ', [], {}):
                report = copy.deepcopy(self.original); report['records'][0][field] = value
                self.f.write(self.report, report)
                self.reject('invalid_realization_identity')

    def test_missing_record_rejected(self):
        report = copy.deepcopy(self.original); report['records'].pop()
        self.f.write(self.report, report)
        self.reject('missing_realization_identities')

    def test_declared_prepared_hash_checked(self):
        self.f.write(self.report, dict(self.original, prepared_sha256='0' * 64))
        self.reject('realization_prepared_hash_mismatch')

    def test_good_declared_prepared_hash(self):
        path = self.f.private / 'T-realization-inputs/eval/prepared.json'
        self.f.write(self.report, dict(self.original, prepared_sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
        self.score()

    def test_full_candidate_hash_binding_remains_checked(self):
        Path(self.original['records'][0]['output_path']).write_text('changed')
        with self.assertRaisesRegex(ValueError, 'Returned output hash mismatch'):
            self.score()
        self.assertFalse(self.f.output.exists())

    def test_blind_candidate_binding_remains_checked(self):
        self.f.blind[0]['revised'] = 'changed'
        self.f.write(self.f.private / 'T-blind-inputs/eval/input.json', {'cases': self.f.blind})
        with self.assertRaisesRegex(ValueError, 'Blind/raw realization mismatch'):
            self.score()
        self.assertFalse(self.f.output.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)

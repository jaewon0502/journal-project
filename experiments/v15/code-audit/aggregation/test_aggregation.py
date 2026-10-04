"""Synthetic identities only; never adds judgments to research evidence."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import score_T_checked as checked

BACKEND = checked.legacy if os.environ.get('AGGREGATION_BACKEND') == 'legacy' else checked


class AggregationRegression(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'public'
        self.private = Path(self.tmp.name) / 'private'
        self.output = Path(self.tmp.name) / 'result.json'
        digest = hashlib.sha256(b'draft').hexdigest()
        self.write(self.private / 'T-inputs-v2/private-key.json', {'case': {'event_id': 'event', 'kind': 'normal'}})
        self.write(self.private / 'T-realization-inputs/eval/prepared.json', {'items': [{'case': {'case_id': 'case', 'draft': 'draft'}, 'audit': {}}]})
        self.blind = [{'opaque_output_id': 'expected', 'original': 'draft', 'revised': 'draft'}]
        self.write(self.private / 'T-blind-inputs/eval/input.json', {'cases': self.blind})
        self.write(self.private / 'T-blind-inputs/dev/input.json', {'cases': [{'opaque_output_id': 'dev-only'}]})
        self.write(self.private / 'T-blind-inputs/eval/private-mapping.json', {'mapping': {'expected': [{'case_id': 'case', 'method': method, 'output_sha256': digest} for method in checked.legacy.METHODS]}})
        content = Path(self.tmp.name) / 'output.txt'
        content.write_text('draft')
        self.write(self.root / 'runs/T/eval-realized/report.json', {'records': [{'case_id': 'case', 'method': method, 'status': 'no_op', 'output_path': str(content), 'returned_sha256': digest} for method in checked.legacy.METHODS]})
        self.judgments = [{'opaque_output_id': 'expected', 'revised_source_supported': 'yes'}]

    def write(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def run_score(self):
        self.write(self.root / 'judgments/T/eval-outcomes.raw.json', {'items': self.judgments})
        return BACKEND.score('eval', self.root, self.private, self.output)

    def rejected(self, key, expected):
        with self.assertRaises(checked.JudgmentIdentityError) as context:
            self.run_score()
        self.assertEqual(context.exception.diagnostics[key], expected)
        self.assertFalse(self.output.exists())

    def test_valid_shared_output_keeps_assigned_denominators(self):
        result = self.run_score()
        self.assertEqual(result['unique_judged_outputs'], 1)
        self.assertEqual(result['assigned_method_outputs'], 3)
        self.assertEqual(result['assigned_case_denominator'], 1)
        self.assertEqual(result['event_denominator'], 1)

    def test_unknown_extra_is_rejected(self):
        self.judgments.append({'opaque_output_id': 'unknown-extra'})
        self.rejected('unknown_extra_judgment_ids', ['unknown-extra'])

    def test_foreign_phase_is_distinguished(self):
        self.judgments.append({'opaque_output_id': 'dev-only'})
        self.rejected('wrong_phase_judgment_ids', {'dev-only': ['dev']})

    def test_duplicate_is_rejected(self):
        self.judgments *= 2
        self.rejected('duplicate_judgment_ids', ['expected'])

    def test_missing_is_rejected(self):
        self.judgments = []
        self.rejected('missing_judgment_ids', ['expected'])

    def test_duplicate_blind_is_rejected(self):
        self.write(self.private / 'T-blind-inputs/eval/input.json', {'cases': self.blind * 2})
        self.rejected('duplicate_blind_ids', ['expected'])

    def test_same_extra_count_cannot_hide_missing(self):
        self.judgments = [{'opaque_output_id': 'unknown-extra'}]
        self.rejected('missing_judgment_ids', ['expected'])

    def test_invalid_id_values_are_structured_and_existing_output_unchanged(self):
        self.output.write_bytes(b'existing result')
        for value in (None, True, 1, 1.0, '', '   ', [], {}):
            with self.subTest(value=value):
                self.write(self.private / 'T-blind-inputs/eval/input.json', {'cases': [{'opaque_output_id': value}]})
                self.judgments = [{'opaque_output_id': value}]
                with self.assertRaises(checked.JudgmentIdentityError) as context:
                    self.run_score()
                self.assertIn('invalid_opaque_output_ids', context.exception.diagnostics)
                self.assertEqual(self.output.read_bytes(), b'existing result')

    def test_invalid_raw_id_is_structured(self):
        for value in (None, True, 1, 1.0, '', '   ', [], {}):
            with self.subTest(value=value):
                with self.assertRaises(checked.JudgmentIdentityError):
                    checked.validate_ids('eval', self.blind, [{'opaque_output_id': value}])

    def test_invalid_foreign_blind_id_is_structured(self):
        self.write(self.private / 'T-blind-inputs/dev/input.json', {'cases': [{'opaque_output_id': []}]})
        with self.assertRaises(checked.JudgmentIdentityError):
            self.run_score()
        self.assertFalse(self.output.exists())

    def test_invalid_foreign_raw_id_is_structured(self):
        self.write(self.root / 'judgments/T/dev-outcomes.raw.json', {'items': [{'opaque_output_id': True}]})
        with self.assertRaises(checked.JudgmentIdentityError):
            self.run_score()
        self.assertFalse(self.output.exists())

    def test_empty_mapping_is_rejected_without_overwriting(self):
        self.write(self.private / 'T-blind-inputs/eval/private-mapping.json', {'mapping': {}})
        self.output.write_bytes(b'existing result')
        with self.assertRaises(checked.JudgmentIdentityError) as context:
            self.run_score()
        self.assertEqual(context.exception.diagnostics['missing_mapping_pair_count'], 3)
        self.assertEqual(self.output.read_bytes(), b'existing result')

    def test_incomplete_mapping_is_rejected(self):
        path = self.private / 'T-blind-inputs/eval/private-mapping.json'
        data = json.loads(path.read_text())
        data['mapping']['expected'].pop()
        self.write(path, data)
        self.rejected('missing_mapping_pair_count', 1)

    def test_invalid_id_containers_are_structured(self):
        for value in (None, {}, True):
            with self.subTest(value=value):
                with self.assertRaises(checked.JudgmentIdentityError):
                    checked.validate_ids('eval', value, self.judgments)

    def test_valid_result_matches_legacy_exactly(self):
        result = self.run_score()
        reference = checked.legacy.score('eval', self.root, self.private, self.output.with_name('legacy.json'))
        self.assertEqual(result, reference)


if __name__ == '__main__':
    unittest.main(verbosity=2)

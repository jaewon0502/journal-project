"""Input identity regressions, using public synthetic atomic fixtures only."""
import copy
import importlib.util
import sys
import unittest
import check_output_strict as strict

sys.path.insert(0, str(strict.ROOT / 'experiments/v18/code'))
_spec = importlib.util.spec_from_file_location('strict_atomic_fixture', strict.ROOT / 'experiments/v18/code/test_atomic_dependencies.py')
fixtures = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fixtures)


class StrictInput(unittest.TestCase):
    def fixture(self):
        unit, output = fixtures.fixture()
        output['protection_items'] = [dict(id='R', original_quotes=['Tail unchanged.'], relation='context', why_preserve='synthetic', confidence='supported', conflict='none')]
        return unit, output

    def test_valid_result_equals_v18_and_inputs_unchanged(self):
        unit, output = self.fixture(); before = copy.deepcopy((unit, output))
        self.assertEqual(strict.apply_checked(unit, output, fixtures.SCHEMA), fixtures.apply_checked(unit, output, fixtures.SCHEMA))
        self.assertEqual((unit, output), before)

    def test_invalid_unit_identifiers(self):
        for value in (None, True, 1, 1.0, '', '  ', '\n', [], {}):
            with self.subTest(value=value):
                unit, output = self.fixture(); unit['unit_id'] = output['unit_id'] = value
                with self.assertRaisesRegex(ValueError, 'invalid unit id'):
                    strict.apply_checked(unit, output, fixtures.SCHEMA)

    def test_invalid_source_identifiers_even_when_unused(self):
        for value in (None, True, 1, 1.0, '', '  ', '\n', [], {}):
            with self.subTest(value=value):
                unit, output = self.fixture(); unit['sources'][0]['id'] = value; output['findings'][0]['source_refs'] = []
                with self.assertRaisesRegex(ValueError, 'invalid source id'):
                    strict.apply_checked(unit, output, fixtures.SCHEMA)

    def test_duplicate_source_identifiers(self):
        unit, output = self.fixture(); unit['sources'] *= 2
        with self.assertRaisesRegex(ValueError, 'duplicate source id'):
            strict.apply_checked(unit, output, fixtures.SCHEMA)

    def test_blank_and_nonstring_protection_identifiers(self):
        for value in (None, True, 1, '', '  ', [], {}):
            with self.subTest(value=value):
                unit, output = self.fixture(); output['protection_items'][0]['id'] = value
                with self.assertRaises(ValueError):
                    strict.apply_checked(unit, output, fixtures.SCHEMA)

    def test_duplicate_protection_identifiers(self):
        unit, output = self.fixture(); output['protection_items'] *= 2
        with self.assertRaisesRegex(ValueError, 'duplicate protection id'):
            strict.apply_checked(unit, output, fixtures.SCHEMA)

    def test_invalid_unit_source_and_article_containers(self):
        for field, value in [('article', None), ('article', {'full_text': []}), ('sources', {}), ('sources', [None]), ('sources', [{'id':'S','text':[]}])]:
            unit, output = self.fixture(); unit[field] = value
            with self.assertRaises(ValueError):
                strict.apply_checked(unit, output, fixtures.SCHEMA)

    def test_input_quote_accepts_modified_quote_rejects(self):
        unit, output = self.fixture(); output['findings'][0].update(original_quote='alpha', candidate_quote='alpha')
        strict.apply_checked(unit, output, fixtures.SCHEMA)
        output['findings'][0]['candidate_quote'] = 'ALPHA LONG'
        with self.assertRaisesRegex(ValueError, 'inexact article quote'):
            strict.apply_checked(unit, output, fixtures.SCHEMA)

    def test_missing_partner_and_partial_delivery_still_rejected(self):
        unit, output = self.fixture(); output['patches'].pop()
        with self.assertRaisesRegex(ValueError, 'missing dependency'):
            strict.apply_checked(unit, output, fixtures.SCHEMA)
        unit, output = self.fixture(); output['full_edited_article'] = unit['article']['full_text'].replace('alpha', 'ALPHA LONG')
        with self.assertRaisesRegex(ValueError, 'native whole article'):
            strict.apply_checked(unit, output, fixtures.SCHEMA)


if __name__ == '__main__':
    unittest.main(verbosity=2)

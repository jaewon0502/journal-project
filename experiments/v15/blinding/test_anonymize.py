"""Synthetic regression tests only; no real articles or audit records."""
import copy
import unittest
from anonymize import anonymize


class BlindingTests(unittest.TestCase):
    def writer(self):
        return {'candidate_text': 'A/B 시험에서 A군은 4, B군은 5다.',
                'id': 'A-condition', 'condition': 'A', 'model': 'secret-model',
                'reason': 'secret rationale', 'inventory': ['secret'], 'filename': 'A-model.json',
                'patches': [{'id': 'A-P5', 'before': 'A군은 3', 'after': 'A군은 4',
                             'reason': 'A condition rationale', 'rawid': 'A-P5',
                             'condition': 'A', 'model': 'secret', 'inventory': ['secret']}]}

    def test_exact_allowlist_and_separate_private_mapping(self):
        public, private = anonymize([self.writer()], ['C901'])
        self.assertEqual(set(public[0]), {'neutralcandidate_id', 'candidate_text', 'patches'})
        self.assertEqual(set(public[0]['patches'][0]), {'id', 'before', 'after'})
        self.assertEqual(public[0]['patches'][0]['id'], 'P01')
        self.assertEqual(private[0]['patch_id_mapping'][0]['raw_patch_id'], 'A-P5')
        self.assertNotIn('A-P5', repr(public))
        self.assertNotIn('secret', repr(public))

    def test_original_condition_ids_never_reused(self):
        a, b = self.writer(), self.writer()
        b.update(condition='B', id='B-condition', filename='B-model.json')
        b['patches'][0]['id'] = 'B-P5'
        public, _ = anonymize([a, b], ['C832', 'C107'])
        self.assertEqual([r['neutralcandidate_id'] for r in public], ['C832', 'C107'])
        self.assertEqual([r['patches'][0]['id'] for r in public], ['P01', 'P01'])
        # Metadata changes, including raw IDs, do not change public audit input.
        self.assertEqual(anonymize([a], ['C555'])[0], anonymize([b], ['C555'])[0])

    def test_body_and_patch_text_preserved_including_valid_a_b(self):
        writer = self.writer()
        writer['candidate_text'] += '\nA/B\tA\r\nB'
        public, _ = anonymize([writer], ['C100'])
        self.assertEqual(public[0]['candidate_text'], writer['candidate_text'])
        for field in ('before', 'after'):
            self.assertEqual(public[0]['patches'][0][field], writer['patches'][0][field])

    def test_inputs_unchanged_and_no_mutable_output_aliases(self):
        writer = self.writer()
        snapshot = copy.deepcopy(writer)
        public, private = anonymize([writer], ['C100'])
        self.assertEqual(writer, snapshot)
        public[0]['patches'][0]['before'] = 'different'
        private[0]['patch_id_mapping'][0]['raw_patch_id'] = 'different'
        self.assertEqual(writer, snapshot)

    def test_candidate_id_types_uniqueness_and_neutral_format(self):
        for ids in (['A'], ['B-P1'], ['model123'], [None], [1], [True], [[]], ['C１２３'], []):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                anonymize([self.writer()], ids)
        with self.assertRaises(ValueError):
            anonymize([self.writer(), self.writer()], ['C101', 'C101'])
        with self.assertRaises(ValueError):
            anonymize([self.writer()], ('C101',))
        with self.assertRaises(ValueError):
            anonymize({}, [])

    def test_required_writer_and_patch_types(self):
        bad = [None, {}, {'candidate_text': 1, 'patches': []},
               {'candidate_text': 'x', 'patches': {}},
               {'candidate_text': 'x', 'patches': [None]}]
        for field in ('id', 'before', 'after'):
            for value in (None, 1, [], {}):
                writer = self.writer()
                writer['patches'][0][field] = value
                bad.append(writer)
            writer = self.writer()
            del writer['patches'][0][field]
            bad.append(writer)
        for writer in bad:
            with self.subTest(writer=writer), self.assertRaises(ValueError):
                anonymize([writer], ['C101'])
        for raw_id in ('', ' '):
            writer = self.writer()
            writer['patches'][0]['id'] = raw_id
            with self.assertRaises(ValueError):
                anonymize([writer], ['C101'])

    def test_duplicate_patch_ids_and_sequential_reassignment(self):
        writer = self.writer()
        writer['patches'].append(copy.deepcopy(writer['patches'][0]))
        with self.assertRaises(ValueError):
            anonymize([writer], ['C101'])
        writer['patches'][1]['id'] = 'B-non-sequential-999'
        public, _ = anonymize([writer], ['C101'])
        self.assertEqual([p['id'] for p in public[0]['patches']], ['P01', 'P02'])

    def test_noop_and_empty_input(self):
        self.assertEqual(anonymize([], []), ([], []))
        public, _ = anonymize([{'candidate_text': 'A/B remain.', 'patches': []}], ['C101'])
        self.assertEqual(public[0]['patches'], [])


if __name__ == '__main__':
    unittest.main()

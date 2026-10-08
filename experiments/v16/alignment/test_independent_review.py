"""Synthetic-only independent audit and rejection regression tests."""
import itertools
import unittest
from copy import deepcopy

from alignment import build_alignment, replay


class IndependentReviewTests(unittest.TestCase):
    def test_exhaustive_small_reconstruction_and_coverage(self):
        words = [''.join(x) for n in range(4)
                 for x in itertools.product('a🙂', repeat=n)]
        for original, candidate in itertools.product(words, repeat=2):
            artifact = build_alignment(original, candidate)
            self.assertEqual(replay(original, artifact), candidate)
            self.assertEqual(artifact, build_alignment(original, candidate))
            previous_a = previous_c = 0
            for segment in artifact['all_segments']:
                a, b = segment['original_start'], segment['original_end']
                c, d = segment['candidate_start'], segment['candidate_end']
                self.assertEqual((a, c), (previous_a, previous_c))
                if segment['operation'] == 'equal':
                    self.assertEqual(original[a:b], candidate[c:d])
                previous_a, previous_c = b, d
            self.assertEqual((previous_a, previous_c), (len(original), len(candidate)))

    def test_unicode_no_normalization_and_repeated_text(self):
        for original, candidate in [
            ('é', 'e\u0301'), ('가', '\u1100\u1161'),
            ('👩\u200d💻 says no', '👩\u200d💻 says yes'),
            ('a\r\nb', 'a\nb'), ('\x00a', '\x00b'),
            ('same same same', 'same changed same'),
        ]:
            artifact = build_alignment(original, candidate)
            self.assertEqual(replay(original, artifact), candidate)
            self.assertNotEqual(artifact['original_sha256'], artifact['candidate_sha256'])

    def test_digest_tampering_rejected(self):
        artifact = build_alignment('abc', 'axc')
        for key in ('original_sha256', 'candidate_sha256'):
            altered = deepcopy(artifact)
            altered[key] = '0' * 64
            with self.assertRaises(ValueError):
                replay('abc', altered)

    def test_basic_invalid_original_offsets_rejected(self):
        artifact = build_alignment('abc', 'axc')
        for value in (-1, True, 0.5, 100):
            altered = deepcopy(artifact)
            altered['rows'][0]['original_start'] = value
            with self.assertRaises(ValueError):
                replay('abc', altered)

    def test_r1_all_segments_tampering_rejected(self):
        artifact = build_alignment('abc', 'axc')
        for segments in ([], [{'operation': 'equal', 'original_start': -999,
                                'original_end': 999, 'candidate_start': True,
                                'candidate_end': 'invalid'}]):
            altered = deepcopy(artifact)
            altered['all_segments'] = segments
            with self.assertRaises(ValueError):
                replay('abc', altered)

    def test_r2_repeated_candidate_offset_rejected(self):
        artifact = build_alignment('abc', 'XabcX')
        self.assertEqual(artifact['rows'][1]['candidate_start'], 4)
        artifact['rows'][1]['candidate_start'] = 0
        artifact['rows'][1]['candidate_end'] = 1
        with self.assertRaises(ValueError):
            replay('abc', artifact)

    def test_r2_wrong_deletion_offset_rejected(self):
        artifact = build_alignment('abc', 'ac')
        self.assertEqual(artifact['rows'][0]['candidate_start'], 1)
        artifact['rows'][0]['candidate_start'] = 0
        artifact['rows'][0]['candidate_end'] = 0
        with self.assertRaises(ValueError):
            replay('abc', artifact)

    def test_r3_candidate_offsets_require_strict_integer(self):
        for value in (True, 1.0):
            artifact = build_alignment('abc', 'axc')
            artifact['rows'][0]['candidate_start'] = value
            with self.assertRaises(ValueError):
                replay('abc', artifact)

    def test_r3_segment_offsets_and_flags_require_strict_types(self):
        for field, value in [('original_end', 1.0), ('candidate_end', True),
                             ('equal_text_omitted_but_available_in_full_documents', 1)]:
            artifact = build_alignment('abc', 'axc')
            artifact['all_segments'][0][field] = value
            with self.assertRaises(ValueError):
                replay('abc', artifact)

    def test_r4_wrong_unicode_offset_unit_rejected(self):
        artifact = build_alignment('🙂abc', '🙂axc')
        artifact['offset_unit'] = 'UTF-8 bytes'
        with self.assertRaises(ValueError):
            replay('🙂abc', artifact)


if __name__ == '__main__':
    unittest.main()

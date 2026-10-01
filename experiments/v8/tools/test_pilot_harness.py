"""Synthetic integrity checks only: zero article-performance observations."""
import unittest
from pilot_harness import aggregate, blind_packets, paragraph_patch, sha


class Integrity(unittest.TestCase):
    def setUp(self):
        self.source = '가나다\n\nCafe\u0301 tail'.encode()
        self.cut = len('가나다\n\n'.encode())
        self.paragraphs = [{'id': 'p1', 'start': 0, 'end': self.cut},
                           {'id': 'p2', 'start': self.cut, 'end': len(self.source)}]
        self.authority = {'preimage_sha256': sha(self.source), 'allowed_spans': [{'start': 0, 'end': len(self.source)}]}
        self.proposal = {'preimage_sha256': sha(self.source), 'patches': [
            {'paragraph_id': 'p1', 'start': 0, 'end': 3, 'before': '가', 'after': '라'}]}

    def test_unicode_and_unchanged_tail(self):
        output, report = paragraph_patch(self.source, self.paragraphs, self.proposal, self.authority)
        self.assertEqual(output, '라나다\n\nCafe\u0301 tail'.encode())
        self.assertEqual(output[3:], self.source[3:])
        self.assertEqual(report['patch_count'], 1)

    def test_partial_codepoint_rejected(self):
        self.proposal['patches'][0]['end'] = 2
        with self.assertRaises(ValueError):
            paragraph_patch(self.source, self.paragraphs, self.proposal, self.authority)

    def test_cross_paragraph_rejected(self):
        self.proposal['patches'][0].update(end=self.cut + 1, before=self.source[:self.cut + 1].decode())
        with self.assertRaises(ValueError):
            paragraph_patch(self.source, self.paragraphs, self.proposal, self.authority)

    def test_missing_tail_rejected(self):
        with self.assertRaises(ValueError):
            paragraph_patch(self.source, self.paragraphs[:1], self.proposal, self.authority)

    def test_stale_authority_rejected(self):
        self.authority['preimage_sha256'] = '0' * 64
        with self.assertRaises(ValueError):
            paragraph_patch(self.source, self.paragraphs, self.proposal, self.authority)

    def test_blind_identical_outputs_share_judgment(self):
        common = dict(article_id='secret-case', output='synthetic', source='synthetic source', evidence=[], reference_sha256='f' * 64)
        packets, mapping = blind_packets([dict(common, arm=arm) for arm in ('ORIGINAL', 'LOCAL')])
        self.assertEqual(len(packets), 1)
        self.assertEqual(len(mapping), 2)
        self.assertNotIn('arm', packets[0])
        self.assertNotIn('article_id', packets[0])
        self.assertEqual(mapping[0]['packet_id'], mapping[1]['packet_id'])

    def test_noop_unknown_not_success(self):
        base = dict(article_id='synthetic', arm='LOCAL', language='KO', necessity='necessary')
        rows = [dict(base, issue_id='1', status='failed'), dict(base, issue_id='2', status='unknown')]
        manifest = [dict(article_id='synthetic', arm='LOCAL', language='KO', issues={'1': 'necessary', '2': 'necessary'}, paragraph_ids=['p1'])]
        paragraphs = [dict(article_id='synthetic', arm='LOCAL', paragraph_id='p1', coverage='uncertain')]
        result = aggregate(rows, manifest, paragraphs)['KO/LOCAL/canonical']
        self.assertEqual(result['necessary_denominator'], 2)
        self.assertEqual(result.get('necessary_success', 0), 0)
        with self.assertRaises(ValueError):
            aggregate(rows + rows[:1], manifest, paragraphs)
        with self.assertRaises(ValueError):
            aggregate(rows[:1], manifest, paragraphs)
        with self.assertRaises(ValueError):
            aggregate(rows, manifest, [])
        with self.assertRaises(ValueError):
            aggregate([dict(row, config_id='unregistered') for row in rows], manifest, paragraphs)

    def test_config_mapping_deduplicates_identical_outputs(self):
        common = dict(article_id='synthetic', arm='LOCAL', source='source', evidence=[], reference_sha256='a' * 64)
        packets, mapping = blind_packets([dict(common, config_id='base', output='same'), dict(common, config_id='chunk', output='same')])
        self.assertEqual(len(packets), 1)
        self.assertEqual({m['config_id'] for m in mapping}, {'base', 'chunk'})
        self.assertNotIn('config_id', packets[0])
        packets, mapping = blind_packets([dict(common, config_id='base', output='one'), dict(common, config_id='chunk', output='two')])
        self.assertEqual(len(packets), 2)
        for bad in ('', None, 'bad/key'):
            with self.assertRaises(ValueError):
                blind_packets([dict(common, config_id=bad, output='same')])
        with self.assertRaises(ValueError):
            blind_packets([dict(common, config_id='base', condition='chunk', output='same')])

    def test_aggregate_config_strata_and_unknown(self):
        manifest, rows, paragraphs = [], [], []
        for config in ('base', 'chunk'):
            common = dict(article_id='synthetic', arm='LOCAL', config_id=config)
            manifest.append(dict(common, language='EN', issues={'i': 'unknown'}, paragraph_ids=['p']))
            rows.append(dict(common, language='EN', issue_id='i', necessity='unknown', status='unknown'))
            paragraphs.append(dict(common, paragraph_id='p', coverage='covered'))
        result = aggregate(rows, manifest, paragraphs)
        self.assertEqual(set(result), {'EN/LOCAL/base', 'EN/LOCAL/chunk'})
        self.assertEqual(result['EN/LOCAL/base']['unknown_denominator'], 1)


if __name__ == '__main__':
    unittest.main()

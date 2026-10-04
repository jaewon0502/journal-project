"""Mutations test the replay's audit boundary, not an assumed AI success rate."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from replay_controls import ROOT, replay, unique_span, decode

class ControlReplayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        shutil.copytree(ROOT / 'data', self.root / 'data')

    def mutate(self, name, edit):
        p = self.root / 'data' / name
        d = json.loads(p.read_text())
        edit(d)
        p.write_text(json.dumps(d, ensure_ascii=False))

    def test_saved_results_can_be_reaggregated(self):
        r = replay(self.root)
        self.assertEqual(r['natural_news_articles'], 0)
        self.assertEqual(r['article_variants'], 6)
        self.assertEqual(len(r['reviewers']), 2)
        self.assertFalse(r['human_alignment_proven'])

    def test_modified_source_input_rejected(self):
        self.mutate('control-input.json', lambda d: d['sources'][0]['paragraphs'][0].update(text='altered'))
        with self.assertRaisesRegex(ValueError, 'input hash'):
            replay(self.root)

    def test_stale_reported_count_rejected(self):
        self.mutate('control-results.json', lambda d: d['reviewers'][0].update(faithful_unchanged=999))
        with self.assertRaisesRegex(ValueError, 'saved control results'):
            replay(self.root, check_saved=True)

    def test_reviewer_cannot_bind_different_input(self):
        self.mutate('control-review-r1.json', lambda d: d.update(input_sha256='0'*64))
        with self.assertRaisesRegex(ValueError, 'binding'):
            replay(self.root)

    def test_duplicate_judgment_rejected(self):
        self.mutate('control-review-r1.json', lambda d: d['cases'].append(d['cases'][0]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            replay(self.root)

    def test_invented_evidence_rejected(self):
        def edit(d):
            case = next(c for c in d['cases'] if c['patches'])
            case['patches'][0]['anchors'][0]['quote'] = 'not present in any source'
        self.mutate('control-review-r1.json', edit)
        with self.assertRaisesRegex(ValueError, 'evidence'):
            replay(self.root)

    def test_failed_cli_returns_nonzero(self):
        self.mutate('control-review-r2.json', lambda d: d.update(input_sha256='0'*64))
        p = subprocess.run([sys.executable, str(ROOT/'tools/replay_controls.py'), '--root', str(self.root)], capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('failed', p.stderr)

    def test_overlapping_occurrences_are_not_unique(self):
        with self.assertRaisesRegex(ValueError, 'nonunique'):
            unique_span('aaa', 'aa')

    def test_duplicate_json_decision_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            decode('{"decision":"unchanged","decision":"repair"}')

    def test_review_bytes_read_once_for_parsing_and_digest(self):
        from unittest.mock import patch
        original = Path.read_bytes
        counts = {}
        def tracked(path):
            counts[str(path)] = counts.get(str(path), 0) + 1
            return original(path)
        with patch.object(Path, 'read_bytes', tracked):
            replay(self.root)
        for name in ('control-input.json', 'control-construction.json', 'control-review-r1.json', 'control-review-r2.json'):
            self.assertEqual(counts[str(self.root/'data'/name)], 1)

if __name__ == '__main__':
    unittest.main()

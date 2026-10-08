"""Synthetic mutation tests for replay integrity; no private article text required."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


def write_json(path, value):
    path.write_text(json.dumps(value))


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


class ReplayIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='v28-replay-test-')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.private = root / 'private'
        self.raw = root / 'v27' / 'raw'
        self.inputs = root / 'v27' / 'inputs'
        self.public = root / 'public'
        for path in (self.private / 'clean', self.raw, self.inputs, self.public):
            path.mkdir(parents=True)
        self.script = self.public / 'replay.py'
        shutil.copyfile(Path(__file__).with_name('replay.py'), self.script)
        mapping, freeze = {}, {}
        for i in range(15):
            identifier, old_id = f'C{i}', f'old-{i}'
            article = {'text': f'Synthetic article {i}'}
            sources = [{'text': f'Synthetic source {i}'}]
            record = dict(blind_id=identifier, article=article, sources=sources,
                          final_text='old text')
            path = self.private / 'clean' / f'{identifier}.json'
            write_json(path, record)
            freeze[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
            mapping[identifier] = old_id
            write_json(self.raw / f'{old_id}.json', {'full_selected_text': 'old text'})
            write_json(self.inputs / f'{old_id}.json', dict(article=article, sources=sources))
        write_json(self.private / 'private-map.json', mapping)
        write_json(self.private / 'clean-freeze.json', freeze)
        patch = dict(source_final='C0', start=0, end=3, before='old', after='new',
                     input_sha256=digest('old text'), output_sha256=digest('new text'))
        write_json(self.private / 'local-patch.json', patch)
        write_json(self.public / 'local-patch.json', patch)
        local = json.loads((self.private / 'clean/C0.json').read_text())
        local.update(blind_id='local', final_text='new text')
        write_json(self.private / 'local-clean.json', local)

    def mutate(self, path, field, value, refreeze=False):
        record = json.loads(path.read_text())
        record[field] = value
        write_json(path, record)
        if refreeze:
            freeze_path = self.private / 'clean-freeze.json'
            freeze = json.loads(freeze_path.read_text())
            freeze[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
            write_json(freeze_path, freeze)

    def check_modes(self, expected_error=None):
        for mode in ([], ['-O']):
            with self.subTest(mode=mode):
                result = subprocess.run([sys.executable, *mode, str(self.script),
                                         str(self.private), str(self.raw)],
                                        capture_output=True, text=True)
                if expected_error is None:
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn('No semantic certification.', result.stdout)
                else:
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(expected_error, result.stderr)
                    self.assertNotIn('replay passed', result.stdout)

    def test_valid_fixture(self):
        self.check_modes()

    def test_changed_final_with_updated_freeze(self):
        self.mutate(self.private / 'clean/C0.json', 'final_text', 'tampered', True)
        self.check_modes('v27 final text mismatch')

    def test_changed_sources_with_updated_freeze(self):
        self.mutate(self.private / 'clean/C0.json', 'sources', [], True)
        self.check_modes('v27 sources mismatch')

    def test_changed_article_with_updated_freeze(self):
        self.mutate(self.private / 'clean/C0.json', 'article', {}, True)
        self.check_modes('v27 article mismatch')

    def test_changed_local_sources(self):
        self.mutate(self.private / 'local-clean.json', 'sources', [])
        self.check_modes('Local sources changed')

    def test_changed_local_article(self):
        self.mutate(self.private / 'local-clean.json', 'article', {})
        self.check_modes('Local article changed')

    def test_public_patch_mismatch(self):
        self.mutate(self.public / 'local-patch.json', 'after', 'different')
        self.check_modes('Public/private local patch mismatch')

    def test_duplicate_mapping(self):
        self.mutate(self.private / 'private-map.json', 'C1', 'old-0')
        self.check_modes('Expected 15 distinct mapped v27 outputs')


if __name__ == '__main__':
    unittest.main()

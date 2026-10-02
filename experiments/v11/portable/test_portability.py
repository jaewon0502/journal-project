import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import loader

class PortableTests(unittest.TestCase):
    def test_relocated_bundle_never_reads_legacy_absolute_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest=Path(tmp)/'moved portable bundle'
            shutil.copytree(loader.ROOT,dest,ignore=shutil.ignore_patterns('__pycache__'))
            script="""from pathlib import Path
original=Path.read_bytes
def guarded(path):
    if str(path).startswith('/historical-research/journal-v10/'):
        raise AssertionError('absolute legacy dependency accessed')
    return original(path)
Path.read_bytes=guarded
import replay
import json
versions=json.loads(Path('bundle-manifest.json').read_bytes())['candidates']
print(sum(replay.run(version)['synthetic_cases'] for version in versions))
"""
            result=subprocess.run([sys.executable,'-B','-c',script],cwd=dest,capture_output=True,text=True,check=True)
            versions=json.loads((loader.ROOT/'bundle-manifest.json').read_bytes())['candidates']
            self.assertEqual(result.stdout.strip(),str(10*len(versions)))
    def test_missing_future_version_is_explicit(self):
        manifest=json.loads((loader.ROOT/'bundle-manifest.json').read_bytes())
        if 'v1_2' in manifest['candidates']: self.skipTest('v1_2 has since been bundled')
        with self.assertRaisesRegex(ValueError,'not bundled'):loader.load_receipt('v1_2')
    def test_external_engine_environment_override_refused(self):
        old=os.environ.get('V10_ENGINE_PATH')
        os.environ['V10_ENGINE_PATH']='/not/a/bundled/engine'
        try:
            with self.assertRaisesRegex(ValueError,'unset V10_ENGINE_PATH'):loader.load_receipt()
        finally:
            if old is None:os.environ.pop('V10_ENGINE_PATH',None)
            else:os.environ['V10_ENGINE_PATH']=old

if __name__=='__main__':unittest.main(verbosity=2)

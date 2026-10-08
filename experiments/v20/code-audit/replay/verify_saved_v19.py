"""Exact saved-artifact identity wrapper; no semantic rescoring or new model run."""
import hashlib,json,subprocess,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
def verify(root, manifest):
 for name,expected in manifest.items():
  p=root/name
  if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=expected:
   raise ValueError('saved artifact identity mismatch: '+name)
 return len(manifest)
if __name__=='__main__':
 manifest=json.loads((HERE/'v19-artifact-hashes.json').read_text());print('Verified exact saved artifact files:',verify(ROOT,manifest),flush=True)
 subprocess.run([sys.executable,str(ROOT/'experiments/v19/synthetic/replay.py')],check=True)

import hashlib,json,tempfile,unittest
from pathlib import Path
import verify_saved_v19 as m
class IdentityTests(unittest.TestCase):
 def test_current_saved_artifacts(self):
  manifest=json.loads((m.HERE/'v19-artifact-hashes.json').read_text());self.assertEqual(m.verify(m.ROOT,manifest),len(manifest))
 def test_parse_equivalent_output_bytes_rejected(self):
  raw=(m.ROOT/'experiments/v19/synthetic/SY191-output.json').read_bytes()
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'output.json').write_bytes(raw+b' ')
   self.assertEqual(json.loads(raw),json.loads((root/'output.json').read_bytes()))
   with self.assertRaises(ValueError):m.verify(root,{'output.json':hashlib.sha256(raw).hexdigest()})
 def test_missing_saved_output_rejected(self):
  with tempfile.TemporaryDirectory() as temp:
   with self.assertRaises(ValueError):m.verify(Path(temp),{'missing.json':'0'*64})
if __name__=='__main__':unittest.main()

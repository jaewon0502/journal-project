import unittest
from patch_guard import check,digest

class GuardTests(unittest.TestCase):
    def setUp(self):
        self.original='앞 A up. 뒤'.encode()
        self.start=self.original.index(b'up')
        self.authority={'allowed_spans':[{'start':self.start,'end':self.start+2}]}
    def proposal(self,patches):
        return {'preimage_sha256':digest(self.original),'patches':patches}
    def patch(self):
        return {'start':self.start,'end':self.start+2,'before':'up','after':'down'}
    def test_preserved_multibyte_context(self):
        out,info=check(self.original,self.proposal([self.patch()]),self.authority)
        self.assertEqual(out,'앞 A down. 뒤'.encode())
        self.assertEqual(info['unchanged_bytes'],len(self.original)-2)
    def test_empty_is_byte_identical(self):
        self.assertEqual(check(self.original,self.proposal([]),self.authority)[0],self.original)
    def test_reject_mutations(self):
        for change in [{'before':'UP'},{'start':1},{'after':'up'},{'end':len(self.original),'before':'up. 뒤'}]:
            with self.subTest(change=change),self.assertRaises(ValueError):
                check(self.original,self.proposal([self.patch()|change]),self.authority)
    def test_hash_and_overlap(self):
        with self.assertRaises(ValueError):
            check(self.original,self.proposal([])|{'preimage_sha256':'wrong'},self.authority)
        with self.assertRaises(ValueError):
            check(self.original,self.proposal([self.patch(),self.patch()]),self.authority)
    def test_cli_veto_and_invalid_rollback(self):
        import tempfile,json,subprocess,sys
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'draft').write_bytes(self.original)
            (root/'allowed.json').write_text(json.dumps(self.authority))
            for index,decision in enumerate(('pending','rejected','approved')):
                proposal=self.proposal([self.patch()])
                if decision=='approved': proposal['preimage_sha256']='invalid'
                (root/'patches.json').write_text(json.dumps(proposal))
                command=[sys.executable,str(Path(__file__).with_name('patch_guard.py')),'--draft',str(root/'draft'),'--allowed',str(root/'allowed.json'),'--patches',str(root/'patches.json'),'--output',str(root/f'out{index}'),'--report',str(root/f'report{index}'),'--decision',decision]
                result=subprocess.run(command,capture_output=True)
                self.assertEqual(result.returncode,2 if decision=='approved' else 0)
                self.assertEqual((root/f'out{index}').read_bytes(),self.original)
                self.assertTrue(json.loads((root/f'report{index}').read_text())['rollback_byte_identical'])

    def test_boundary_insertion_rejected(self):
        patch={'start':self.start,'end':self.start,'before':'','after':'x'}
        with self.assertRaises(ValueError):
            check(self.original,self.proposal([patch]),self.authority)

if __name__=='__main__': unittest.main()

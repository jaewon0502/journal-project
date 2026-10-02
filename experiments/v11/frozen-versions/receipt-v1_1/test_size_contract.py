"""Actual canonical receipt boundaries, without mocks or hidden-case access."""
import json
from pathlib import Path
import tempfile
import unittest
import receipt as r
from test_receipt import fixture


def padded_args(padding):
    args=list(fixture())
    audit=json.loads(args[6])
    audit['preexisting_findings']=[{'description':'bounded reference', 'evidence_ids':['x'*padding]}]
    args[6]=r.canonical(audit)
    assert len(args[6]) <= r.engine.MAX_BYTES
    args[0],args[2]=r.v10.build_delivery(*args[3:7],args[7])
    return args

class SizeContractTests(unittest.TestCase):
    def test_real_near_exact_and_above_boundary(self):
        self.assertEqual(r.MAX_RECEIPT_BYTES,2*1024*1024)
        base=len(r.build(*padded_args(0)).raw)
        for offset in (-1,0):
            target=r.MAX_RECEIPT_BYTES+offset
            args=padded_args(target-base)
            receipt=r.build(*args)
            self.assertEqual(len(receipt.raw),target)
            self.assertTrue(r.verify(receipt,*args))
            for lang in ('EN','KO'):
                self.assertEqual(r.emit(receipt,*args,lang=lang)['status'],'verified')
            with tempfile.TemporaryDirectory() as tmp:
                store=r.Store(Path(tmp)/'objects')
                try:
                    store.put(receipt,*args)
                    self.assertEqual(store.get(receipt.address,*args),receipt)
                finally: store.close()
        # The same canonical structure and one additional ASCII evidence byte.
        # All source/audit inputs still fit the unchanged engine's 2 MiB limit.
        args=padded_args(r.MAX_RECEIPT_BYTES+1-base)
        with self.assertRaisesRegex(ValueError,'shared byte limit'): r.build(*args)
        with self.assertRaisesRegex(ValueError,'shared byte limit'): r.Receipt(b'x'*(r.MAX_RECEIPT_BYTES+1))

    def test_oversized_bypass_rejected_before_store_write(self):
        # Simulate an untrusted object bypassing constructor checks.
        args=fixture(); forged=object.__new__(r.Receipt)
        object.__setattr__(forged,'raw',b'x'*(r.MAX_RECEIPT_BYTES+1))
        with self.assertRaisesRegex(ValueError,'shared byte limit'): r.verify(forged,*args)
        self.assertEqual(r.emit(forged,*args)['status'],'verification_failed')
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)/'objects'; store=r.Store(folder)
            try:
                before=set(folder.iterdir())
                with self.assertRaisesRegex(ValueError,'shared byte limit'): store.put(forged,*args)
                self.assertEqual(before,set(folder.iterdir()))
                with self.assertRaisesRegex(ValueError,'shared byte limit'): store._exclusive('oversized.json',forged.raw)
                self.assertEqual(before,set(folder.iterdir()))
            finally: store.close()

    def test_actual_thirty_thousand_finding_expansion_rejected(self):
        args=list(fixture()); audit=json.loads(args[6])
        audit['preexisting_findings']=[{'description':'review reference','evidence_ids':[]} for _ in range(30000)]
        args[6]=r.canonical(audit)
        self.assertEqual(len(args[6]),1590340)
        args[0],args[2]=r.v10.build_delivery(*args[3:7],args[7])
        with self.assertRaisesRegex(ValueError,'shared byte limit'): r.build(*args)

if __name__=='__main__': unittest.main()

"""New binding tests plus all eight unchanged historical sidecar test methods."""
import copy
import importlib.util
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import sidecar_adapter as adapter


class BindingTests(unittest.TestCase):
    def test_current_verified_binding(self):
        module = adapter.load_sidecar()
        self.assertEqual(module.R.PORTABLE_REPLAY_PROVENANCE['original_receipt_sha256'], adapter.RECEIPT)
        self.assertEqual(module.V20_BINDING_PROVENANCE['in_memory_binding_replacements'], 1)
        self.assertEqual(module.V20_BINDING_PROVENANCE['old_receipt_binding'], adapter.OLD_RECEIPT)

    def test_wrong_provenance_rejected(self):
        module = adapter.load_sidecar()
        portable = adapter.ROOT / 'experiments/v11/portable'
        raw = (portable / 'candidates/v1_3/receipt.py').read_bytes()
        for field, value in [('original_receipt_sha256', adapter.OLD_RECEIPT),
                             ('executed_receipt_sha256', '0' * 64),
                             ('dependencies', {}), ('version_label', 'v1_2'),
                             ('in_memory_replacement_count', 2), ('in_memory_replacement_count', True),
                             ('in_memory_replacement_count', 1.0), ('replacement', 'foreign')]:
            with self.subTest(field=field):
                provenance = copy.deepcopy(module.R.PORTABLE_REPLAY_PROVENANCE)
                provenance[field] = value
                with self.assertRaisesRegex(ValueError, 'unexpected portable receipt provenance'):
                    adapter.check_provenance(provenance, raw, portable)

    def test_tampered_source_pins_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for relative in adapter.PINS:
                dest = root / 'experiments/v11' / relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(adapter.ROOT / 'experiments/v11' / relative, dest)
            for relative in adapter.PINS:
                with self.subTest(relative=relative):
                    path = root / 'experiments/v11' / relative
                    original = path.read_bytes()
                    path.write_bytes(original + b'\n')
                    try:
                        with self.assertRaisesRegex(ValueError, 'v20 source binding mismatch'):
                            adapter.load_sidecar(root)
                    finally:
                        path.write_bytes(original)

    def test_frozen_sidecar_failure_is_preserved(self):
        path = adapter.ROOT / 'experiments/v11/sidecar/sidecar.py'
        spec = importlib.util.spec_from_file_location('_unaltered_sidecar_failure', path)
        module = importlib.util.module_from_spec(spec)
        with self.assertRaisesRegex(ValueError, 'unexpected receipt implementation'):
            spec.loader.exec_module(module)


def load_tests(loader, tests, pattern):
    module = adapter.load_sidecar()
    old = sys.modules.get('sidecar')
    sys.modules['sidecar'] = module
    try:
        path = adapter.ROOT / 'experiments/v11/sidecar/test_sidecar.py'
        spec = importlib.util.spec_from_file_location('_unchanged_sidecar_tests', path)
        historical = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(historical)
    finally:
        if old is None:
            sys.modules.pop('sidecar', None)
        else:
            sys.modules['sidecar'] = old
    tests.addTests(loader.loadTestsFromTestCase(historical.SidecarTests))
    return tests

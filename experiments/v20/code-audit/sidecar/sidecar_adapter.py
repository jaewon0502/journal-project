"""Explicit v20 binding adapter; frozen sidecar/receipt sources stay unchanged."""
from pathlib import Path
import hashlib
import json
import sys
import types
import uuid

ROOT = Path(__file__).resolve().parents[4]
OLD_RECEIPT = '3f3a4dc118c4311bd0adef8fe4893cd6d1340ce1e490b445febb7d13464a6014'
RECEIPT = '120e8c86cce2fc13dee257bde4b19e691f034f69b044ca5d387e2724a3f70e8e'
PINS = {
    'sidecar/sidecar.py': 'f9dd8f82b65392910f716e780d64aafe483245afcb886973cc3f5ba71b45f034',
    'portable/loader.py': 'e2e57bba4e68ed8f1898064103a2e4a4c07cbb2701cca6af946125c4c1a24de8',
    'portable/candidates/v1_3/receipt.py': RECEIPT,
    'frozen-versions/receipt-v1_3/receipt.py': RECEIPT,
    'portable/dependencies/delivery.py': 'b785ca128b1f2ec489da8c581bbb33b46b1c1c2f62e0c59b10e4bd606d80c8f6',
    'portable/dependencies/vendor/selective_rollback.py': '480cfc3aaf8da84b95e850f05ccb7d454f3cb05dc3e89edce60218a5d690360a',
}


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def check_provenance(provenance, receipt_raw, portable):
    assignment = "V10 = Path('/historical-research/journal-v10/editing-v1_1/delivery.py')"
    replacement = 'V10 = Path(' + repr(str(portable / 'dependencies/delivery.py')) + ')'
    text = receipt_raw.decode('utf-8')
    if text.count(assignment) != 1:
        raise ValueError('unexpected receipt dependency assignment')
    expected = {
        'version_label': 'v1_3',
        'original_receipt_sha256': RECEIPT,
        'executed_receipt_sha256': digest(text.replace(assignment, replacement, 1).encode()),
        'in_memory_replacement_count': 1,
        'replacement': replacement,
        'dependencies': {name.removeprefix('portable/'): value for name, value in PINS.items()
                         if name.startswith('portable/dependencies/')},
    }
    if json.dumps(provenance, sort_keys=True) != json.dumps(expected, sort_keys=True):
        raise ValueError('unexpected portable receipt provenance')


def load_sidecar(root=ROOT):
    base = Path(root).resolve() / 'experiments/v11'
    originals = {}
    for relative, expected in PINS.items():
        raw = (base / relative).read_bytes()
        if digest(raw) != expected:
            raise ValueError('v20 source binding mismatch: ' + relative)
        originals[relative] = raw
    # Retain the sidecar's require assertion, changing its sole pinned value only.
    source = originals['sidecar/sidecar.py'].decode('utf-8')
    if source.count(OLD_RECEIPT) != 1:
        raise ValueError('expected exactly one sidecar receipt binding')
    adapted = source.replace(OLD_RECEIPT, RECEIPT, 1)
    module = types.ModuleType('_v20_sidecar_' + uuid.uuid4().hex)
    module.__file__ = str(base / 'sidecar/sidecar.py')
    sys.modules[module.__name__] = module
    try:
        exec(compile(adapted, module.__file__, 'exec'), module.__dict__)
        check_provenance(module.R.PORTABLE_REPLAY_PROVENANCE,
                         originals['portable/candidates/v1_3/receipt.py'], base / 'portable')
    except BaseException:
        sys.modules.pop(module.__name__, None)
        raise
    module.V20_BINDING_PROVENANCE = {
        'original_sidecar_sha256': digest(originals['sidecar/sidecar.py']),
        'executed_sidecar_sha256': digest(adapted.encode()),
        'old_receipt_binding': OLD_RECEIPT,
        'verified_receipt_binding': RECEIPT,
        'in_memory_binding_replacements': 1,
        'verified_source_pins': dict(PINS),
    }
    return module

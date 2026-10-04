"""Real subprocess CLI regressions; synthetic files only, no archived writes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
LEGACY = ROOT / 'experiments/legacy/repair-v4/patches/patch_engine.py'
FIXED = HERE / 'patch_engine.py'
CASES = (
    'normal', 'log_spec_name', 'log_source_name', 'log_output_name',
    'receipt_is_output', 'receipt_is_source', 'receipt_is_evidence',
    'receipt_existing', 'receipt_symlink_source', 'receipt_symlink_spec',
    'receipt_hardlink_source', 'receipt_dangling_symlink',
    'output_is_source', 'output_is_spec', 'output_is_evidence',
    'output_existing', 'output_symlink_source', 'output_hardlink_source',
    'output_dangling_symlink', 'receipt_is_output_alias',
)
SUCCESS = {'normal', 'log_spec_name', 'log_source_name', 'log_output_name'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def exercise(engine, case):
    with tempfile.TemporaryDirectory() as directory:
        base = Path(directory)
        spec_path = base / ('case.log.json' if case == 'log_spec_name' else 'case.spec.json')
        receipt = spec_path.with_suffix('.log.json')
        source = base / ('source.log.json' if case == 'log_source_name' else 'source.txt')
        target = base / ('result.log.json' if case == 'log_output_name' else 'result.txt')
        evidence = base / 'evidence.txt'
        if case == 'receipt_is_source':
            source = receipt
        if case == 'receipt_is_evidence':
            evidence = receipt
        source.write_bytes(b'old')
        evidence.write_bytes(b'proof')
        if case == 'receipt_is_output':
            target = receipt
        if case == 'receipt_is_output_alias':
            (base / 'nested').mkdir()
            target = base / 'nested' / '..' / receipt.name
        if case == 'output_is_source':
            target = source
        if case == 'output_is_spec':
            target = spec_path
        if case == 'output_is_evidence':
            target = evidence
        spec = {'source': str(source.relative_to(base)), 'output': str(target.relative_to(base)),
                'source_sha256': sha(b'old'), 'evidence_inputs': [{'path': str(evidence.relative_to(base)), 'sha256': sha(b'proof')}],
                'edits': [{'id': 'replace', 'old': 'old', 'new': 'new'}]}
        spec_path.write_text(json.dumps(spec))
        if case in {'receipt_existing', 'output_existing'}:
            (receipt if case.startswith('receipt') else target).write_bytes(b'existing')
        for prefix, destination in [('receipt', receipt), ('output', target)]:
            if case == prefix + '_symlink_source':
                destination.symlink_to(source.name)
            if case == prefix + '_hardlink_source':
                os.link(source, destination)
            if case == prefix + '_dangling_symlink':
                destination.symlink_to('missing.txt')
        if case == 'receipt_symlink_spec':
            receipt.symlink_to(spec_path.name)
        before = {str(p.relative_to(base)): p.read_bytes() for p in base.iterdir() if p.is_file()}
        links_before = {p.name: os.readlink(p) for p in base.iterdir() if p.is_symlink()}
        names_before = {p.name for p in base.iterdir()}
        process = subprocess.run([sys.executable, str(engine), str(spec_path)], capture_output=True)
        changed = [name for name, data in before.items() if not (base / name).exists() or (base / name).read_bytes() != data]
        links_preserved = all((base / name).is_symlink() and os.readlink(base / name) == value for name, value in links_before.items())
        created = sorted({p.name for p in base.iterdir()} - names_before)
        valid_output = target.is_file() and target.read_bytes() == b'new'
        try:
            record = json.loads(receipt.read_bytes())
            valid_receipt = record['after_sha256'] == sha(b'new') and record['before_sha256'] == sha(b'old')
        except (OSError, ValueError, KeyError):
            valid_receipt = False
        expected_success = case in SUCCESS
        passed = (process.returncode == 0 and valid_output and valid_receipt and not changed) if expected_success else (process.returncode != 0 and not changed and links_preserved and not created)
        return {'case': case, 'expected': 'success' if expected_success else 'reject_without_writes',
                'returncode': process.returncode, 'changed_existing_files': changed, 'created_files': created,
                'output_matches_expected_bytes': valid_output, 'valid_receipt_metadata': valid_receipt,
                'contract_pass': passed}


class ReceiptCLI(unittest.TestCase):
    def test_collision_matrix(self):
        for case in CASES:
            with self.subTest(case=case):
                result = exercise(FIXED, case)
                self.assertTrue(result['contract_pass'], result)


if __name__ == '__main__':
    if '--evidence' in sys.argv:
        results = {'legacy_sha256': sha(LEGACY.read_bytes()), 'fixed_sha256': sha(FIXED.read_bytes()),
                   'legacy': [exercise(LEGACY, c) for c in CASES], 'fixed': [exercise(FIXED, c) for c in CASES]}
        print(json.dumps(results, indent=2))
    else:
        unittest.main()

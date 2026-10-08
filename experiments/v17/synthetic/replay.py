"""Offline replay of saved fictional outputs; performs no model calls."""
import hashlib
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    for relative, expected in manifest['validator'].items():
        if digest(ROOT / relative) != expected:
            raise ValueError('validator hash mismatch: ' + relative)
    spec = importlib.util.spec_from_file_location('v17_check', ROOT.parent / 'code/check_output.py')
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    schema = json.loads((ROOT.parent / 'code/schema.json').read_text())
    units = {}
    for row in manifest['units']:
        path = ROOT / row['path']
        if digest(path) != row['public_sha256'] or row['original_sha256'] != row['public_sha256']:
            raise ValueError('unit hash mismatch')
        unit = json.loads(path.read_text())
        units[unit['unit_id']] = unit
    summary = {phase: {'outputs': 0, 'valid': 0, 'rejected': 0,
                       'delivered_repairs': 0, 'delivered_no_change': 0}
               for phase in ('v1', 'v2')}
    rows = []
    for row in manifest['outputs']:
        path = ROOT / row['path']
        if digest(path) != row['public_sha256']:
            raise ValueError('output hash mismatch')
        output = json.loads(path.read_text())
        if output['preservation_decision'] != row['expected_decision']:
            raise ValueError('decision mismatch')
        error = None
        delivered = None
        try:
            text = checker.apply_checked(units[row['unit']], output, schema)
            delivered = hashlib.sha256(text.encode()).hexdigest()
        except ValueError as exc:
            error = str(exc)
        if error != row['expected_error'] or delivered != row['expected_delivered_sha256']:
            raise ValueError('replay differs from saved observation: ' + row['path'])
        bucket = summary[row['phase']]
        bucket['outputs'] += 1
        bucket['valid' if error is None else 'rejected'] += 1
        if error is None:
            bucket['delivered_' + ('repairs' if output['patches'] else 'no_change')] += 1
        rows.append({'phase': row['phase'], 'unit': row['unit'], 'method': row['method'],
                     'error': error, 'delivered_sha256': delivered})
    expected = {'v1': {'outputs': 8, 'valid': 1, 'rejected': 7, 'delivered_repairs': 0, 'delivered_no_change': 1},
                'v2': {'outputs': 4, 'valid': 4, 'rejected': 0, 'delivered_repairs': 2, 'delivered_no_change': 2}}
    if summary != expected:
        raise ValueError('unexpected replay counts')
    print(json.dumps({'summary': summary, 'observations': rows}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

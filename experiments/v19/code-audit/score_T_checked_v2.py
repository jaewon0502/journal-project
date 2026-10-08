#!/usr/bin/env python3
"""Validate realization identities before the checked completed-judgment scorer.

The named free-followup report may supersede the initial free record, as the
producer explicitly specifies. Repeated keys within either report are errors.
No historical code or outcome labels are changed.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location('v15_checked_scoring', ROOT / 'experiments/v15/code-audit/aggregation/score_T_checked.py')
v15 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v15)
JudgmentIdentityError = v15.JudgmentIdentityError


def reject(code, **details):
    raise JudgmentIdentityError({code: details or True})


def validate_realizations(phase, root, private):
    prepared_path = private / 'T-realization-inputs' / phase / 'prepared.json'
    prepared_bytes = prepared_path.read_bytes()
    prepared = json.loads(prepared_bytes)
    items = prepared.get('items') if isinstance(prepared, dict) else None
    if not isinstance(items, list):
        reject('invalid_prepared_items')
    case_ids = []
    for index, item in enumerate(items):
        case = item.get('case') if isinstance(item, dict) else None
        cid = case.get('case_id') if isinstance(case, dict) else None
        if not isinstance(cid, str) or not cid.strip():
            reject('invalid_assigned_case_id', index=index)
        if cid in case_ids:
            reject('duplicate_assigned_case_id', case_id=cid)
        case_ids.append(cid)
    expected = {(cid, method) for cid in case_ids for method in v15.legacy.METHODS}
    seen_final = set()
    for suffix, allowed in (('realized', set(v15.legacy.METHODS)), ('free-realized', {'free'})):
        path = root / 'runs/T' / (phase + '-' + suffix) / 'report.json'
        if not path.exists():
            continue
        report = json.loads(path.read_bytes())
        records = report.get('records') if isinstance(report, dict) else None
        if not isinstance(records, list):
            reject('invalid_realization_records', report=suffix)
        if 'prepared_sha256' in report and report['prepared_sha256'] != hashlib.sha256(prepared_bytes).hexdigest():
            reject('realization_prepared_hash_mismatch', report=suffix)
        seen = set()
        for index, record in enumerate(records):
            if not isinstance(record, dict):
                reject('invalid_realization_record', report=suffix, index=index)
            cid, method = record.get('case_id'), record.get('method')
            if not isinstance(cid, str) or not cid.strip() or not isinstance(method, str) or not method.strip():
                reject('invalid_realization_identity', report=suffix, index=index)
            key = (cid, method)
            if key in seen:
                reject('duplicate_realization_identity', report=suffix, case_id=cid, method=method)
            if key not in expected or method not in allowed:
                reject('unexpected_realization_identity', report=suffix, case_id=cid, method=method)
            seen.add(key)
        seen_final.update(seen)
    if seen_final != expected:
        reject('missing_realization_identities', count=len(expected - seen_final))


def score(phase, root, private, output):
    validate_realizations(phase, root, private)
    return v15.score(phase, root, private, output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', required=True)
    for name in ('root', 'private', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    result = score(args.phase, args.root, args.private, args.output)
    print(json.dumps({key: result[key] for key in ('phase', 'unique_blind_inputs', 'unique_judged_outputs')}))

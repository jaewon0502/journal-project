#!/usr/bin/env python3
"""Strict completed-judgment scoring; preserves the historical v7 scorer."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

LEGACY_TOOLS = Path(__file__).resolve().parents[3] / 'v7' / 'tools'
sys.path.insert(0, str(LEGACY_TOOLS))
import score_T as legacy


class JudgmentIdentityError(ValueError):
    def __init__(self, diagnostics):
        self.diagnostics = diagnostics
        super().__init__(json.dumps(diagnostics, sort_keys=True))


def validate_id_rows(rows, source):
    """IDs must be strings containing a non-whitespace character; no coercion."""
    invalid = []
    if not isinstance(rows, list):
        raise JudgmentIdentityError({'invalid_id_containers': [{'source': source, 'type': type(rows).__name__}]})
    for index, row in enumerate(rows):
        value = row.get('opaque_output_id') if isinstance(row, dict) else None
        if not isinstance(value, str) or not value.strip():
            invalid.append({'source': source, 'index': index, 'type': type(value).__name__})
    if invalid:
        raise JudgmentIdentityError({'invalid_opaque_output_ids': invalid})
    return [row['opaque_output_id'] for row in rows]


def validate_mapping(blind, mapping, prepared):
    if not isinstance(mapping, dict):
        raise JudgmentIdentityError({'invalid_mapping_type': type(mapping).__name__})
    validate_id_rows([{'opaque_output_id': key} for key in mapping], 'mapping')
    blind_ids = set(validate_id_rows(blind, 'blind'))
    assigned = {(item['case']['case_id'], method) for item in prepared['items'] for method in legacy.METHODS}
    pairs = []
    malformed = []
    for index, entries in enumerate(mapping.values()):
        if not isinstance(entries, list) or not entries:
            malformed.append(index)
            continue
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get('case_id'), str) or not isinstance(entry.get('method'), str):
                malformed.append(index)
            else:
                pairs.append((entry['case_id'], entry['method']))
    diagnostics = {
        'mapping_missing_ids': sorted(blind_ids - set(mapping)),
        'mapping_unexpected_ids': sorted(set(mapping) - blind_ids),
        'malformed_mapping_entry_indices': malformed,
        'duplicate_mapping_pair_count': len(pairs) - len(set(pairs)),
        'missing_mapping_pair_count': len(assigned - set(pairs)),
        'unexpected_mapping_pair_count': len(set(pairs) - assigned),
    }
    if any(diagnostics.values()):
        raise JudgmentIdentityError(diagnostics)


def validate_ids(phase, blind, judgments, other_phase_ids=None):
    """Reject incomplete/ambiguous identities before any result is written.

    A foreign-phase label requires an observed other-phase blind input. Opaque
    strings alone cannot establish phase membership.
    """
    expected = Counter(validate_id_rows(blind, 'blind'))
    actual = Counter(validate_id_rows(judgments, 'raw'))
    foreign = other_phase_ids or {}
    validate_id_rows([{'opaque_output_id': key} for key in foreign], 'foreign_registry')
    unexpected = set(actual) - set(expected)
    wrong_phase = {key: sorted(foreign[key]) for key in sorted(unexpected) if key in foreign}
    diagnostics = {
        'phase': phase,
        'duplicate_blind_ids': sorted(k for k, n in expected.items() if n > 1),
        'duplicate_judgment_ids': sorted(k for k, n in actual.items() if n > 1),
        'unexpected_judgment_ids': sorted(unexpected),
        'unknown_extra_judgment_ids': sorted(unexpected - set(wrong_phase)),
        'wrong_phase_judgment_ids': wrong_phase,
        'missing_judgment_ids': sorted(set(expected) - set(actual)),
    }
    if any(value for key, value in diagnostics.items() if key != 'phase'):
        raise JudgmentIdentityError(diagnostics)
    return diagnostics


def score(phase, root, private, output):
    blind_root = private / 'T-blind-inputs'
    blind = json.loads((blind_root / phase / 'input.json').read_text())['cases']
    raw = json.loads((root / 'judgments/T' / (phase + '-outcomes.raw.json')).read_text())['items']
    validate_id_rows(blind, 'blind')
    validate_id_rows(raw, 'raw')
    foreign = {}
    for path in sorted(blind_root.glob('*/input.json')):
        if path.parent.name == phase:
            continue
        other_blind = json.loads(path.read_text())['cases']
        for opaque in validate_id_rows(other_blind, 'foreign_blind:' + path.parent.name):
            foreign.setdefault(opaque, set()).add(path.parent.name)
        other_raw_path = root / 'judgments/T' / (path.parent.name + '-outcomes.raw.json')
        if other_raw_path.exists():
            validate_id_rows(json.loads(other_raw_path.read_text())['items'], 'foreign_raw:' + path.parent.name)
    validate_ids(phase, blind, raw, foreign)
    mapping_path = blind_root / phase / 'private-mapping.json'
    mapping = json.loads(mapping_path.read_text()).get('mapping') if mapping_path.exists() else None
    prepared = json.loads((private / 'T-realization-inputs' / phase / 'prepared.json').read_text())
    validate_mapping(blind, mapping, prepared)
    return legacy.score(phase, root, private, output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', required=True)
    for name in ('root', 'private', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    result = score(args.phase, args.root, args.private, args.output)
    print(json.dumps({k: result[k] for k in ('phase', 'unique_blind_inputs', 'unique_judged_outputs')}))

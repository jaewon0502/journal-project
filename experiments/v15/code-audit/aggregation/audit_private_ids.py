#!/usr/bin/env python3
"""Read private identity evidence and emit only hashes/counts/booleans."""
import argparse
import hashlib
import json
from pathlib import Path
import score_T_checked as checked


def audit(root, private):
    phases = ['dev-v1', 'dev-v2', 'eval']
    loaded = {}
    evidence = {}
    for phase in phases:
        paths = {'blind': private / 'T-blind-inputs' / phase / 'input.json',
                 'mapping': private / 'T-blind-inputs' / phase / 'private-mapping.json',
                 'raw': root / 'judgments/T' / (phase + '-outcomes.raw.json')}
        loaded[phase] = {}
        evidence[phase] = {}
        for role, path in paths.items():
            raw = path.read_bytes()
            loaded[phase][role] = json.loads(raw)
            evidence[phase][role + '_sha256'] = hashlib.sha256(raw).hexdigest()
    for phase in phases:
        checked.validate_id_rows(loaded[phase]['blind']['cases'], 'blind:' + phase)
        checked.validate_id_rows(loaded[phase]['raw']['items'], 'raw:' + phase)
    results = []
    for phase in phases:
        data = loaded[phase]
        blind = data['blind']['cases']
        judgments = data['raw']['items']
        mapping = data['mapping']['mapping']
        foreign = {}
        for other in phases:
            if phase != other:
                for item in loaded[other]['blind']['cases']:
                    foreign.setdefault(item['opaque_output_id'], set()).add(other)
        try:
            diagnostics = checked.validate_ids(phase, blind, judgments, foreign)
            valid = True
        except checked.JudgmentIdentityError as error:
            diagnostics = error.diagnostics
            valid = False
        public_path = checked.LEGACY_TOOLS.parent / 'results' / ('T-' + phase + '-summary.json')
        public = json.loads(public_path.read_text())
        original_summary_bytes = (root / 'results' / ('T-' + phase + '-summary.json')).read_bytes()
        original_summary = json.loads(original_summary_bytes)
        evidence[phase]['original_summary_sha256'] = hashlib.sha256(original_summary_bytes).hexdigest()
        raw_index = {j['opaque_output_id']: j for j in judgments}
        rows = [row for event in public['events'] for group in event['methods'].values() for row in group]
        pairs = [(entry['case_id'], entry['method']) for entries in mapping.values() for entry in entries]
        checks = {
            'strict_identity_validation_passed': valid,
            'blind_and_raw_ids_are_nonblank_strings': all(isinstance(row.get('opaque_output_id'), str) and bool(row['opaque_output_id'].strip()) for row in blind + judgments),
            'blind_and_mapping_id_sets_equal': set(mapping) == {x['opaque_output_id'] for x in blind},
            'mapping_case_method_pairs_unique': len(pairs) == len(set(pairs)),
            'mapping_pairs_match_public_rows': set(pairs) == {(row['case_id'], method) for event in public['events'] for method, group in event['methods'].items() for row in group},
            'original_summary_judgments_equal_raw': all(row['blind_model_judgment'] == raw_index.get(row['opaque_output_id']) for event in original_summary['events'] for group in event['methods'].values() for row in group),
            'public_scoring_fields_equal_original_raw': all(all(row['blind_model_judgment'].get(key) == raw_index[row['opaque_output_id']].get(key) for key in ('opaque_output_id', 'new_factual_errors', 'revised_source_supported', 'original_error_repaired', 'necessary_question_meaning_preserved', 'unjustified_edit', 'original_source_supported')) for row in rows),
            'public_unique_judged_count_matches_raw': public['unique_judged_outputs'] == len(raw_index),
            'original_summary_raw_provenance_hash_matches': any(key.endswith('/judgments/T/' + phase + '-outcomes.raw.json') and value == evidence[phase]['raw_sha256'] for key, value in original_summary['provenance'].items()),
        }
        results.append({'phase': phase, **evidence[phase],
            'blind_rows': len(blind), 'raw_judgment_rows': len(judgments), 'mapping_case_method_pairs': len(pairs),
            'diagnostic_counts': {key: len(value) for key, value in diagnostics.items() if key != 'phase'},
            'checks': checks})
    return {'scope': 'All three retained original v7 T blind inputs, private mappings, and raw outcome judgment files; read only.',
            'privacy': 'No source text, output text, opaque IDs or private filesystem paths exported.',
            'phases': results,
            'all_checks_pass': all(all(p['checks'].values()) for p in results)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--private', required=True, type=Path)
    args = parser.parse_args()
    result = audit(args.root, args.private)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['all_checks_pass'] else 1)

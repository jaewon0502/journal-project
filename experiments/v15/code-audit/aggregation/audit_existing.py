#!/usr/bin/env python3
"""Read-only check of public frozen summaries; not a private raw-input replay."""
import hashlib
import json
from pathlib import Path
import score_T_checked as checked
from reaggregate import aggregate_t


def audit():
    root = checked.LEGACY_TOOLS.parent
    output = {'scope': 'Public v7 T summaries and exposed judgment rows only',
              'limitation': 'This script checks distributed public summaries only. The separate private-id-impact.json records the retained private-source ID audit.',
              'legacy_scorer_sha256': hashlib.sha256((checked.LEGACY_TOOLS / 'score_T.py').read_bytes()).hexdigest(),
              'phases': []}
    for path in sorted((root / 'results').glob('T-*-summary.json')):
        raw = path.read_bytes()
        data = json.loads(raw)
        exposed_ids = set()
        exposed_judged_ids = set()
        for event in data['events']:
            for rows in event['methods'].values():
                for row in rows:
                    if row['opaque_output_id'] is not None:
                        exposed_ids.add(row['opaque_output_id'])
                    if row['blind_model_judgment'] is not None:
                        exposed_judged_ids.add(row['opaque_output_id'])
        diagnostics = {key: data[key] for key in ('unexpected_judgment_ids', 'duplicate_judgment_ids', 'missing_judgment_ids')}
        totals = aggregate_t(data)
        checks = {
            'public_unique_blind_count_matches_rows': data['unique_blind_inputs'] == len(exposed_ids),
            'public_unique_judged_count_matches_rows': data['unique_judged_outputs'] == len(exposed_judged_ids),
            'published_id_diagnostics_empty': not any(diagnostics.values()),
            'event_denominator_matches_rows': data['event_denominator'] == len(data['events']),
            'assigned_method_outputs_matches_rows': data['assigned_method_outputs'] == sum(len(rows) for e in data['events'] for rows in e['methods'].values()),
        }
        output['phases'].append({'phase': data['phase'], 'file': str(path.relative_to(root.parent.parent)),
            'sha256': hashlib.sha256(raw).hexdigest(), 'published_unique_judged_outputs': data['unique_judged_outputs'],
            'exposed_unique_judged_outputs': len(exposed_judged_ids), 'diagnostics': diagnostics,
            'checks': checks, 'public_reaggregated_totals': totals})
        if not all(checks.values()):
            raise ValueError(checks)
    output['conclusion'] = 'No published-count discrepancy observed in the three public phases; unchanged public semantic totals. See separate private-id-impact.json for retained private raw ID verification.'
    return output


if __name__ == '__main__':
    print(json.dumps(audit(), indent=2, ensure_ascii=False))

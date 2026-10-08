"""Reproduce old checked scorer's order-dependent repair credit, synthetic only."""
import copy
import hashlib
import json
from pathlib import Path
from test_scoring_paths import fixtures, fixed


def exercise(reverse, backend):
    f = fixtures.AggregationRegression(); f.setUp()
    try:
        f.write(f.private / 'T-inputs-v2/private-key.json', {'case': {'event_id': 'event', 'kind': 'mutation'}})
        f.blind[0]['revised'] = 'fixed'
        f.write(f.private / 'T-blind-inputs/eval/input.json', {'cases': f.blind})
        digest = hashlib.sha256(b'fixed').hexdigest()
        mapping_path = f.private / 'T-blind-inputs/eval/private-mapping.json'
        mapping = json.loads(mapping_path.read_text())
        for entry in mapping['mapping']['expected']: entry['output_sha256'] = digest
        f.write(mapping_path, mapping)
        path = f.root / 'runs/T/eval-realized/report.json'
        report = json.loads(path.read_text())
        for row in report['records']:
            Path(row['output_path']).write_text('fixed')
            row.update(returned_sha256=digest, status='applied')
        row = report['records'][0]; held = dict(row, status='model_hold')
        report['records'] = ([held, row] if reverse else [row, held]) + report['records'][1:]
        f.write(path, report)
        f.write(f.root / 'judgments/T/eval-outcomes.raw.json', {'items': [{'opaque_output_id': 'expected', 'revised_source_supported': 'yes', 'original_error_repaired': 'yes', 'necessary_question_meaning_preserved': 'yes', 'new_factual_errors': []}]})
        try:
            result = backend.score('eval', f.root, f.private, f.output)
            row = result['events'][0]['methods']['free'][0]
            return {'accepted': True, 'repair_success': row['repair_success'], 'pipeline_hold': row['pipeline_hold'], 'result_written': f.output.exists()}
        except fixed.JudgmentIdentityError as error:
            return {'accepted': False, 'diagnostics': error.diagnostics, 'result_written': f.output.exists()}
    finally:
        f.doCleanups()


if __name__ == '__main__':
    print(json.dumps({name: {order: exercise(reverse, backend) for order, reverse in [('hold_last', False), ('hold_first', True)]} for name, backend in [('v15_checked', fixed.v15), ('v19_checked_v2', fixed)]}, indent=2))

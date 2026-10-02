#!/usr/bin/env python3
"""Audit frozen necessity inputs and saved classifications; never generate judgments.
Requires Python 3 and jsonschema. Run from any directory; private inputs required.
"""
import argparse
import hashlib
import json
from pathlib import Path
import jsonschema

FIELDS = ['source_meaning_error', 'original_meaning_loss', 'required_answer_missing', 'optional_context_absence', 'decision']
TEXT = ['source', 'original_article', 'candidate', 'reader_question']
def read(p):
    return json.loads(p.read_text())
def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def run(private, public):
    manifest = read(private / 'manifest.json')
    checks = {'manifest_freeze': digest(private / 'manifest.json') == (private / 'freeze.sha256').read_text().split()[0]}
    checks['frozen_files'] = all(digest(Path(f['path'])) == f['sha256'] and Path(f['path']).stat().st_size == f['bytes'] for f in manifest['files'])
    packets = {p.stem: read(p) for p in sorted((private / 'inputs').glob('*.json'))}
    items = {k: v['item'] for k, v in packets.items()}
    authors = read(private / 'author-labels.json')
    expected = {x['item_id']: x['expected'] for x in authors['items']}
    independent = {x['item_id']: x for x in read(private / 'validation/independent-first.json')['items']}
    validation = read(private / 'validation/validation.json')
    collection = {x['item_id']: x for x in read(private / 'source-and-task-only.json')['items']}
    checks['six_items'] = len(items) == 6 and set(items) == set(expected) == set(independent)
    checks['constant_prompt_schema'] = len({json.dumps([p['classifier_prompt'], p['output_schema']], sort_keys=True) for p in packets.values()}) == 1
    checks['input_collection_equal'] = items == collection
    checks['no_labels_in_detector_packets'] = all(set(p) == {'classifier_prompt', 'output_schema', 'item'} and set(p['item']) == {'item_id', 'fiction_notice', *TEXT} for p in packets.values())
    pairs = []
    for index, pair in enumerate(authors['pairs'], 1):
        a, b = [items[k] for k in pair['item_ids']]
        changed = [f for f in TEXT if a[f] != b[f]]
        intended = ['reader_question'] if index < 3 else ['candidate']
        deletion = None if index < 3 else a['candidate'].replace('안전교육을 이수한 경우에만 ', '', 1) == b['candidate']
        pairs.append({'pair': index, 'item_ids': pair['item_ids'], 'changed_fields': changed, 'one_factor_verified': changed == intended and deletion is not False, 'exact_condition_deletion': deletion})
    checks['three_one_factor_pairs'] = len(pairs) == 3 and all(p['one_factor_verified'] for p in pairs)
    output_paths = sorted((private / 'classifier-results').glob('*.json'))
    checks['two_outputs_each'] = {p.name for p in output_paths} == {f'{r}__{i}.json' for r in ['A', 'B'] for i in items}
    provenance_path = private / 'orchestrator-provenance.json'
    provenance = read(provenance_path)
    checks['orchestrator_record_covers_fresh_tasks'] = len(provenance['rows']) == 12 and len({r['task_name'] for r in provenance['rows']}) == 12 and {(r['replicate'], r['item_id']) for r in provenance['rows']} == {(r, i) for r in ['A', 'B'] for i in items} and all(r['context_inheritance'] == 'none' and (private / r['expected_output']).is_file() for r in provenance['rows'])
    results, quotes = [], []
    for p in output_paths:
        repeat, item_id = p.stem.split('__')
        result = read(p)
        errors = [e.message for e in jsonschema.Draft7Validator(packets[item_id]['output_schema']).iter_errors(result)]
        evidence = []
        for e in result['evidence']:
            ok = e['field'] in TEXT and bool(e['quote']) and e['quote'] in items[item_id][e['field']]
            evidence.append({'field': e['field'], 'quote': e['quote'], 'exact_substring': ok})
            quotes.append(ok)
        differences = {f: {'expected': expected[item_id][f], 'observed': result[f]} for f in FIELDS if result[f] != expected[item_id][f]}
        results.append({'item_id': item_id, 'repeat': repeat, 'file_sha256': digest(p), 'observed': {f: result[f] for f in FIELDS}, 'expected': expected[item_id], 'differences': differences, 'schema_errors': errors, 'evidence': evidence})
    checks['all_output_schema_valid'] = all(not r['schema_errors'] for r in results)
    checks['all_quotes_exact_in_named_field'] = all(quotes)
    validation_disagreements = {i: {f: {'author': expected[i][f], 'validator': independent[i][f]} for f in FIELDS if expected[i][f] != independent[i][f]} for i in items}
    result_by_key = {(r['repeat'], r['item_id']): r['observed'] for r in results}
    report = {
        'module': 'supplementary-necessity', 'design': 'controlled synthetic mechanism probe; no actual rewrite outputs',
        'counts': {'synthetic_items': len(items), 'independent_synthetic_bases': len(pairs), 'pairs': len(pairs), 'classifications': len(results), 'new_real_cases': 0, 'actual_rewrite_outputs': 0},
        'checks': checks, 'pairs': pairs,
        'comparison_to_provisional_ai_expectations': {'full_five_field_matches': sum(not r['differences'] for r in results), 'total_classifications': len(results), 'per_field_matches': {f: sum(r['observed'][f] == r['expected'][f] for r in results) for f in FIELDS}, 'mismatches': [r for r in results if r['differences']], 'interpretation': 'Concordance only, not accuracy against human ground truth.'},
        'repeat_five_field_agreement_items': sum(result_by_key['A', i] == result_by_key['B', i] for i in items),
        'evidence_check': {'exact_quotes': sum(quotes), 'total_quotes': len(quotes), 'method': 'nonempty exact substring in the explicitly named source field; does not by itself prove semantic validity'},
        'preclassification_validation': {'recorded_before_labels': validation['independence']['own_answers_saved_before_author_labels_manifest_schema'], 'validator_saw_outputs': validation['independence']['classifier_outputs_seen'], 'label_disagreements': {i: d for i, d in validation_disagreements.items() if d}, 'ambiguous_items': [i for i, v in independent.items() if v['ambiguous']], 'provenance_limit': 'Order is attested in saved records, not independently authenticated by this checker.'},
        'fresh_context_provenance': {'basis': 'Executor statement based on actual native independent-context invocation calls', 'record_sha256': digest(provenance_path), 'record_status': provenance['status'], 'context_inheritance': 'none', 'tasks': [f'review-role-{r}{n}' for r in ['a', 'b'] for n in range(1, 7)], 'number_to_item': {str(n): i for n, i in enumerate(sorted(items), 1)}, 'model_or_effort_override': False, 'independent_context_authentication': False, 'limitation': 'Bare result JSON proves two outputs per item only; no independent session, seed, or exact model-version attestation.'},
        'classifications': results, 'old_main_metrics_changed': False,
        'limitations': ['AI-authored provisional expectations and AI validation are not human gold.', 'Six paired synthetic items are not 12 independent cases or new real data.', 'Prompt explicitly defines distinctions; this is a mechanism probe, not a method-performance estimate.', 'No rewritten article was generated or tested; patch is a classification decision.', 'No post-result expected-label edits; future contested expectations must remain marked ambiguous.']
    }
    public.mkdir(parents=True, exist_ok=True)
    (public / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'checks': checks, 'comparison': report['comparison_to_provisional_ai_expectations'], 'evidence': report['evidence_check']}, ensure_ascii=False, indent=2))
    if not all(checks.values()):
        raise SystemExit(1)
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--private', type=Path, default=Path('/historical-research/journal-v12-private/supplementary/necessity'))
    parser.add_argument('--public', type=Path, default=Path(__file__).resolve().parents[1] / 'supplementary/necessity')
    args = parser.parse_args()
    run(args.private, args.public)

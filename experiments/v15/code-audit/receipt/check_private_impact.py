"""Read-only historical receipt checks. Emits hashes/booleans, never private text or paths.

Usage: python check_private_impact.py /LOCAL/RESEARCH/repair-v4
"""
import importlib.util
import json
from pathlib import Path
import sys

here = Path(__file__).resolve().parent
module_spec = importlib.util.spec_from_file_location('receipt_fix', here / 'patch_engine.py')
engine = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(engine)
root = Path(sys.argv[1]).resolve()
patches = root / 'patches'
# Snapshot the entire original v4 artifact tree, not just fixtures under test.
before = {p: engine.sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}
rows = []
all_evidence = []
for case in ('EVAL03', 'EVAL05', 'NEW01'):
    spec_path = patches / (case + '.spec.json')
    spec = json.loads(spec_path.read_bytes())
    source = patches / spec['source']
    target = patches / spec['output']
    receipt_path = spec_path.with_suffix('.log.json')
    data, output = source.read_bytes(), target.read_bytes()
    regenerated, generated_receipt = engine.apply(data, spec)
    receipt = json.loads(receipt_path.read_bytes())
    evidence = []
    for item in spec['evidence_inputs']:
        path = patches / item['path']
        matches = engine.sha(path.read_bytes()) == item['sha256']
        evidence.append(matches)
        all_evidence.append(matches)
    inputs = [spec_path, source] + [patches / item['path'] for item in spec['evidence_inputs']]
    row = {'case': case, 'spec_sha256': engine.sha(spec_path.read_bytes()),
           'source_sha256': engine.sha(data), 'output_sha256': engine.sha(output),
           'receipt_sha256': engine.sha(receipt_path.read_bytes()),
           'source_hash_matches_spec_and_receipt': engine.sha(data) == spec['source_sha256'] == receipt['before_sha256'],
           'output_hash_matches_receipt': engine.sha(output) == receipt['after_sha256'],
           'output_equals_replayed_patch': output == regenerated,
           'receipt_core_equals_replay': all(receipt[key] == value for key, value in generated_receipt.items()),
           'receipt_rollback_equals_source': engine.rollback(output, receipt) == data,
           'receipt_paths_match_spec': Path(receipt['source']).resolve() == source.resolve() and Path(receipt['output']).resolve() == target.resolve(),
           'receipt_output_input_paths_distinct': len({p.resolve() for p in [receipt_path, target] + inputs}) == len([receipt_path, target] + inputs),
           'evidence_input_count': len(evidence), 'all_evidence_hashes_match': all(evidence)}
    rows.append(row)
extra = json.loads((patches / 'NEW01.log.json').read_bytes())
new_spec = json.loads((patches / 'NEW01.spec.json').read_bytes())
new_source = (patches / new_spec['source']).read_bytes()
new_output = (patches / new_spec['output']).read_bytes()
extra_check = {'receipt_sha256': engine.sha((patches / 'NEW01.log.json').read_bytes()),
               'source_hash_matches': extra['before_sha256'] == engine.sha(new_source),
               'output_hash_matches': extra['after_sha256'] == engine.sha(new_output),
               'rollback_equals_source': engine.rollback(new_output, extra) == new_source}
after = {p: engine.sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}
result = {'scope': 'Retained original repair-v4 local artifacts; three spec-derived receipts and one extended NEW01 receipt. No private text, paths, inverse payloads or raw receipts exported.',
          'original_engine_sha256': engine.sha((patches / 'patch_engine.py').read_bytes()),
          'original_v4_tree_file_count': len(before), 'original_v4_tree_unchanged': before == after,
          'cases': rows, 'extended_NEW01_receipt': extra_check,
          'evidence_checks_count': len(all_evidence), 'all_evidence_hashes_match': all(all_evidence),
          'interpretation': 'No receipt collision damage detected in retained originals; hashes, exact patch replay and receipt rollback agree. This does not prove the absence of other discarded executions and does not re-evaluate semantic ratings.'}
print(json.dumps(result, indent=2))
boolean_keys = [key for key, value in rows[0].items() if isinstance(value, bool)]
assert before == after
assert all(all(row[key] for key in boolean_keys) for row in rows)
assert all(extra_check[key] for key in ('source_hash_matches', 'output_hash_matches', 'rollback_equals_source'))

"""Read-only archive replay and inventory verification for the v15 derivative."""
import importlib.util
import json
from pathlib import Path
from test_receipt_paths import FIXED, LEGACY, ROOT, sha


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


old, new = load(LEGACY, 'old'), load(FIXED, 'new')
archive = ROOT / 'experiments/legacy'
inventory = json.loads((archive / 'inventory.json').read_text())
# inventory is a metadata object; locate its artifact list explicitly.
entries = inventory if isinstance(inventory, list) else inventory['artifacts']
checks = []
for entry in entries:
    path = archive / entry['public_file']
    checks.append({'path': entry['public_file'], 'sha256_matches_inventory': sha(path.read_bytes()) == entry['public_sha256']})
fixtures = []
for name in ('EVAL03', 'EVAL05', 'NEW01'):
    spec = json.loads((LEGACY.parent / (name + '.spec.json')).read_text())
    source = (LEGACY.parent / spec['source']).read_bytes()
    expected = (LEGACY.parent / spec['output']).read_bytes()
    old_output, old_receipt = old.apply(source, spec)
    output, receipt = new.apply(source, spec)
    fixtures.append({'case': name, 'archived_output_sha256': sha(expected), 'same_output_bytes': output == expected == old_output,
                     'same_receipt': receipt == old_receipt, 'rollback_exact': new.rollback(output, receipt) == source,
                     'historical_cli_collision': (LEGACY.parent / (name + '.spec.json')).with_suffix('.log.json').resolve() in {(LEGACY.parent / spec[k]).resolve() for k in ('source', 'output')}})
result = {'legacy_engine_sha256': sha(LEGACY.read_bytes()), 'all_inventory_hashes_preserved': all(c['sha256_matches_inventory'] for c in checks),
          'inventory_entry_count': len(checks), 'fixtures': fixtures,
          'scope': 'Public sanitized fixtures only; original private checks are recorded separately in private-impact-summary.json. No claim of source-support or semantic revalidation.'}
print(json.dumps(result, indent=2))
assert result['all_inventory_hashes_preserved']
assert all(f['same_output_bytes'] and f['same_receipt'] and f['rollback_exact'] and not f['historical_cli_collision'] for f in fixtures)

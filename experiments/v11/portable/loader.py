"""Portable loading of frozen receipts; only the V10 assignment changes in memory."""
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import types
import uuid

ROOT = Path(__file__).resolve().parent
ORIGINAL_ASSIGNMENT = "V10 = Path('/historical-research/journal-v10/editing-v1_1/delivery.py')"
EXPECTED_DEPENDENCIES = {
    'dependencies/delivery.py': 'b785ca128b1f2ec489da8c581bbb33b46b1c1c2f62e0c59b10e4bd606d80c8f6',
    'dependencies/vendor/selective_rollback.py': '480cfc3aaf8da84b95e850f05ccb7d454f3cb05dc3e89edce60218a5d690360a',
}

def digest(raw):
    return sha256(raw).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

def check_dependencies():
    for relative, expected in EXPECTED_DEPENDENCIES.items():
        require(digest((ROOT / relative).read_bytes()) == expected,
                'bundled dependency fingerprint mismatch: ' + relative)
    # The unchanged wrapper honors this environment variable. Refuse it so its
    # ordinary sibling-vendor resolution is guaranteed; do not rewrite wrapper.
    require('V10_ENGINE_PATH' not in os.environ,
            'unset V10_ENGINE_PATH before portable replay; external overrides are not allowed')

def frozen_source(candidate_dir):
    """Read a caller-selected frozen candidate, checking its own manifest."""
    candidate_dir = Path(candidate_dir).resolve()
    manifest_raw = (candidate_dir / 'frozen-manifest.json').read_bytes()
    manifest = json.loads(manifest_raw)
    raw = (candidate_dir / 'receipt.py').read_bytes()
    require(digest(raw) == manifest['files']['receipt.py'], 'candidate receipt freeze mismatch')
    expected_legacy = set(EXPECTED_DEPENDENCIES.values())
    require(set(manifest['legacy_dependencies'].values()) == expected_legacy,
            'candidate uses different legacy dependency fingerprints')
    return raw, {'receipt_sha256': digest(raw), 'origin_manifest_sha256': digest(manifest_raw)}

def bundle_candidate(version, candidate_dir):
    """Copy only frozen receipt.py, never article/evidence inputs. No overwrite."""
    require(version in ('v1_1', 'v1_2', 'v1_3'), 'supported versions are v1_1, v1_2 and v1_3')
    check_dependencies()
    raw, provenance = frozen_source(candidate_dir)
    require(raw.decode('utf-8').count(ORIGINAL_ASSIGNMENT) == 1,
            'expected exactly one original V10 path assignment')
    manifest_path = ROOT / 'bundle-manifest.json'
    manifest = json.loads(manifest_path.read_bytes())
    require(version not in manifest['candidates'] or manifest['candidates'][version]['receipt_sha256'] == digest(raw),
            'refusing to replace an existing bundled version')
    destination = ROOT / 'candidates' / version / 'receipt.py'
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        require(destination.read_bytes() == raw, 'refusing candidate overwrite')
    else:
        with destination.open('xb') as stream:
            stream.write(raw)
    manifest['candidates'][version] = dict(provenance, path=str(destination.relative_to(ROOT)))
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    return manifest['candidates'][version]

def load_receipt(version='v1_1', *, candidate_dir=None):
    """Load bundled version, or explicitly supplied frozen candidate directory.

    All source bytes are checked before exactly one documented assignment is
    replaced IN MEMORY. No source file is edited. Wrapper and engine bytes are
    never rewritten. The receipt's dependency hash fields remain unchanged.
    """
    require(version in ('v1_1', 'v1_2', 'v1_3'), 'supported versions are v1_1, v1_2 and v1_3')
    check_dependencies()
    if candidate_dir is None:
        manifest = json.loads((ROOT / 'bundle-manifest.json').read_bytes())
        require(manifest.get('dependencies') == EXPECTED_DEPENDENCIES, 'bundle manifest dependency mismatch')
        require(version in manifest['candidates'], 'version not bundled; supply candidate_dir or bundle it first')
        record = manifest['candidates'][version]
        path = ROOT / 'candidates' / version / 'receipt.py'
        require(record['path'] == str(path.relative_to(ROOT)), 'unexpected bundled candidate path')
        raw = path.read_bytes()
        require(digest(raw) == record['receipt_sha256'], 'bundled candidate fingerprint mismatch')
    else:
        raw, record = frozen_source(candidate_dir)
        path = Path(candidate_dir).resolve() / 'receipt.py'
    text = raw.decode('utf-8')
    require(text.count(ORIGINAL_ASSIGNMENT) == 1, 'expected exactly one original V10 path assignment')
    replacement = 'V10 = Path(' + repr(str(ROOT / 'dependencies' / 'delivery.py')) + ')'
    adapted = text.replace(ORIGINAL_ASSIGNMENT, replacement, 1)
    module = types.ModuleType('_portable_receipt_' + version + '_' + uuid.uuid4().hex)
    module.__file__ = str(path)
    sys.modules[module.__name__] = module
    try:
        exec(compile(adapted, str(path), 'exec'), module.__dict__)
    except BaseException:
        del sys.modules[module.__name__]
        raise
    module.PORTABLE_REPLAY_PROVENANCE = {
        'version_label': version,
        'original_receipt_sha256': digest(raw),
        'executed_receipt_sha256': digest(adapted.encode('utf-8')),
        'in_memory_replacement_count': 1,
        'replacement': replacement,
        'dependencies': dict(EXPECTED_DEPENDENCIES),
    }
    return module

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', choices=['v1_1', 'v1_2', 'v1_3'], default='v1_1')
    parser.add_argument('--candidate-dir', type=Path)
    parser.add_argument('--bundle', action='store_true', help='copy frozen receipt.py into this portable directory')
    args = parser.parse_args()
    if args.bundle:
        parser.error('--bundle needs --candidate-dir') if args.candidate_dir is None else None
        print(json.dumps(bundle_candidate(args.version, args.candidate_dir), indent=2))
    else:
        print(json.dumps(load_receipt(args.version, candidate_dir=args.candidate_dir).PORTABLE_REPLAY_PROVENANCE, indent=2))

"""Verify public synthetic derivatives and replay saved edits; no model calls."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parent

def read(p):
    return json.loads(p.read_text())

def main():
    manifest = read(ROOT / 'derivation.json')
    seen = set()
    for row in manifest:
        path = (ROOT / row['public_file']).resolve()
        if not path.is_relative_to(ROOT) or path in seen:
            raise ValueError('Invalid or duplicate derivative path')
        seen.add(path)
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['public_sha256']:
            raise ValueError(f'Derivative digest mismatch: {path.name}')
    counts = {}
    for version, expected in [('v1', 8), ('v2', 6)]:
        raw = sorted((ROOT / version / 'raw').glob('*.json'))
        if len(raw) != expected:
            raise ValueError('Unexpected output count')
        actions = {}
        for file in raw:
            result = read(file)
            unit = result['unit_id']
            if version == 'v1':
                source = ROOT / version / 'units' / f'{unit}.json'
            else:
                candidates = [ROOT / version / d / f'{unit}-M0.json' for d in ('newinputs', 'regression-inputs')]
                existing = [p for p in candidates if p.exists()]
                if len(existing) != 1:
                    raise ValueError('Ambiguous unit input')
                source = existing[0]
            text = read(source)['candidate_text']
            findings = {f['id']: f for f in result['findings']}
            if len(findings) != len(result['findings']):
                raise ValueError('Duplicate finding')
            spans = []
            for patch in result['patches']:
                before = patch['before']
                if not before or text.count(before) != 1:
                    raise ValueError('Ambiguous patch')
                start = text.index(before); end = start + len(before)
                if any(start < b and a < end for a, b in spans):
                    raise ValueError('Overlapping patch')
                spans.append((start, end))
                finding = findings[patch['finding_id']]
                if any(finding[k] != 'yes' for k in ('necessity', 'evidence_support', 'preserves_other_meaning', 'context_safe')):
                    raise ValueError('Unapproved patch axis')
            for (start, end), patch in sorted(zip(spans, result['patches']), reverse=True):
                text = text[:start] + patch['after'] + text[end:]
            action = result['preservation_decision']
            actions[action] = actions.get(action, 0) + 1
        counts[version] = {'saved_outputs': len(raw), 'actions': actions}
    print(json.dumps({'derivatives_verified': len(manifest), 'saved_replay': counts,
                      'new_model_calls': 0, 'semantic_rescoring': False}, ensure_ascii=False))

if __name__ == '__main__':
    main()

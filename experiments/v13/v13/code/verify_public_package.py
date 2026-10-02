"""Offline verification: stdlib hashes/exact patch replay; optional full gate replay."""
from pathlib import Path
import argparse, hashlib, importlib.util, json

def digest(b): return hashlib.sha256(b).hexdigest()
def verify(root, full_gate=False):
    root=Path(root); manifest=json.loads((root/'PACKAGE-MANIFEST.json').read_text())
    expected={r['path'] for r in manifest['files']}|{'PACKAGE-MANIFEST.json'}
    actual={str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
    if expected!=actual: raise ValueError('Manifest file set differs')
    for r in manifest['files']:
        p=root/r['path']
        if p.is_symlink() or len(p.read_bytes())!=r['bytes'] or digest(p.read_bytes())!=r['sha256']: raise ValueError('Hash mismatch: '+r['path'])
    rows=json.loads((root/'v13/synthetic/audit-map.json').read_text())['outputs']; count=0
    gate=None
    if full_gate:
        spec=importlib.util.spec_from_file_location('public_gate',root/'v13/code/gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
    for bid in sorted({r['bundle_id'] for r in rows}):
        raw=(root/f'v13/synthetic/inputs/{bid}.json').read_bytes(); b=json.loads(raw)
        evaluated=gate.evaluate(b,raw,[json.loads((root/f'v13/synthetic/reviews/{role}__{bid}.json').read_text()) for role in ('A','B')]) if gate else None
        for row in [r for r in rows if r['bundle_id']==bid]:
            edits=[]; original=b['original_article']
            for patch in b['proposed_patches']:
                if patch['id'] not in row['accepted_ids']:continue
                before=patch['before'];start=original.find(before)
                if not before or start<0 or original.find(before,start+1)>=0:raise ValueError('Nonunique patch anchor')
                edits.append((start,start+len(before),patch['after']))
            edits.sort()
            if any(a[1]>z[0] for a,z in zip(edits,edits[1:])):raise ValueError('Overlapping patches')
            candidate=original
            for start,end,after in reversed(edits):candidate=candidate[:start]+after+candidate[end:]
            if digest(candidate.encode())!=row['delivered_sha256']:raise ValueError('Candidate replay mismatch')
            packet=json.loads((root/f"v13/synthetic/audit-inputs/{row['audit_id']}.json").read_text())
            if candidate!=packet['candidate_article']:raise ValueError('Audit candidate mismatch')
            if evaluated:
                result=evaluated['results'][row['gate']]
                for key in ('accepted_ids','held_ids','status','delivered_sha256','bundle_reasons','reasons'):
                    if result[key]!=row[key]:raise ValueError('Gate decision replay mismatch: '+key)
            count+=1
    return {'manifest_entries':len(manifest['files']),'synthetic_exact_patch_replays':count,'full_gate_replay':full_gate,'status':'pass','new_model_calls':0}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('root',nargs='?',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--full-gate',action='store_true');a=p.parse_args();print(json.dumps(verify(a.root,a.full_gate),indent=2))

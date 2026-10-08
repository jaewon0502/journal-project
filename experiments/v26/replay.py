"""Validate saved projections/patch delivery; never certify semantic truth or invoke models."""
import argparse,json,hashlib
from pathlib import Path
p=Path(__file__).resolve().parent
read=lambda f:json.loads(f.read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
a=argparse.ArgumentParser();a.add_argument('--private',type=Path);args=a.parse_args()
rows=[read(f) for f in sorted((p/'projections').glob('*.json'))]
assert len(rows)==8 and len({r['unit_id'] for r in rows})==8
assert all(r['exact_literal_delivery'] and r['patch_count']==len(r['patches']) for r in rows)
assert sum(r['patch_count'] for r in rows)==63
assert sum(r['clause_count'] for r in rows)==366
selection=read(p/'selection-projection.json');assert len(selection)==2
assert all(len(r['decisions'])==19 and r['exact_delivery'] for r in selection)
if args.private:
 root=args.private
 for f,h in read(p/'private-artifact-hashes.json').items():assert sha((root/f).read_bytes())==h,f
 for r in rows:
  d=read(root/'raw'/f"{r['unit_id']}.json");u=read(root/'inputs'/f"{r['unit_id']}.json");body=u['article']['text']
  for patch in d['patches']:
   assert patch['before'] and body.count(patch['before'])==1
   body=body.replace(patch['before'],patch['after'],1)
  assert body==d['full_edited_text'] and sha(body.encode())==r['final_sha256']
 for arm,blind in [('c','V61'),('x','V84')]:
  u=read(root/'selection/input.json');d=read(root/'selection'/f'{arm}-output.json');dec={x['patch_id']:x for x in d['decisions']};body=u['article']['text']
  assert len(dec)==len(d['decisions'])==len(u['candidates'])
  for patch in u['candidates']:
   if dec[patch['id']]['decision']=='apply':
    assert body.count(patch['before'])==1
    body=body.replace(patch['before'],patch['after'],1)
  assert body==read(root/'selection'/f'{blind}.json')['full_edited_text']
print(json.dumps({'autonomous_articles':8,'audit_rows_not_events':366,'proposed_patches_not_errors':63,'selector_outputs':2,'private_replay':bool(args.private),'semantic_certification':False}))

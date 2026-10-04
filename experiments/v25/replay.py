"""Replay public projections, or private saved outputs; no new model/semantic certification."""
from pathlib import Path
import json,hashlib,argparse
p=Path(__file__).resolve().parent
read=lambda f:json.loads(f.read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
a=argparse.ArgumentParser();a.add_argument('--private',type=Path);args=a.parse_args()
rows=[read(f) for f in sorted((p/'projections').glob('*.json'))]
assert len(rows)==8 and sum(len(r['alignment']) for r in rows)==32
assert sum(len(r['claim_audit']) for r in rows)==16
for r in rows:
 assert r['exact_delivery']
 assert r['article_unchanged']==(r['original_text_sha256']==r['final_text_sha256'])
for v in {r['variant_id'] for r in rows}:
 pair=[r for r in rows if r['variant_id']==v]
 assert len(pair)==2 and {r['condition'] for r in pair}=={'T','V'}
 assert len({r['final_text_sha256'] for r in pair})==1
 assert pair[0]['alignment'] and [(x['question_id'],x['candidate_id'],x['relation']) for x in pair[0]['alignment']]==[(x['question_id'],x['candidate_id'],x['relation']) for x in pair[1]['alignment']]
audit=read(p/'audit-projection.json')['rows']
for arm in ['T','V']:
 rr=[r for r in audit if r['condition']==arm]
 observed=dict(outputs=len(rr),candidate_links=sum(len(r['links']) for r in rr),links_agree_with_pre_and_source=sum(x['agrees'] for r in rr for x in r['links']),selected_claims=sum(len(r['claims']) for r in rr),claim_judgments_agree=sum(x['agrees'] for r in rr for x in r['claims']),exact_minimal_results=sum(r['exact_minimal_result'] for r in rr))
 assert observed==read(p/'summary.json')[arm]
if args.private:
 root=args.private
 for f,h in read(p/'private-artifact-hashes.json').items():assert sha((root/f).read_bytes())==h,f
 for m in read(root/'raw-mapping.json'):
  raw=read(root/'raw'/m['raw']); inp=read(root/'writer-inputs'/m['input_dir']/'input.json')
  body=inp['article']['text']; original=body
  for patch in raw['patches']:
   assert body.count(patch['before'])==1
   body=body.replace(patch['before'],patch['after'],1)
  assert body==raw['full_edited_text']
  pr=next(r for r in rows if r['output_id']==Path(m['raw']).stem)
  assert sha(original.encode())==pr['original_text_sha256']
  assert sha(body.encode())==pr['final_text_sha256']
print(json.dumps({'public_outputs':8,'candidate_link_rows':32,'selected_claim_rows':16,'private_replay':bool(args.private),'semantic_truth_certification':False}))

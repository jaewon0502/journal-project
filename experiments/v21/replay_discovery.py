"""Replay identity and witness checks only; no fresh semantic adjudication."""
import argparse,json,hashlib
from pathlib import Path
norm=lambda s:' '.join(s.split())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
a=argparse.ArgumentParser();a.add_argument('--private-root',type=Path,required=True);a.add_argument('--output',type=Path,required=True);args=a.parse_args();rows=[]
for phase in ['discovery-development','discovery-transfer']:
 root=args.private_root/phase;f=json.loads((args.private_root/(phase+'-freeze.json')).read_text())
 for rel,h in f['files'].items():
  if sha(args.private_root/rel)!=h:raise ValueError('Frozen input changed '+rel)
 mapping=json.loads((root/'blind-mapping.json').read_text());seen=set()
 for m in mapping:
  key=(m['unit_id'],m['run'])
  if key in seen:raise ValueError('Duplicate output')
  seen.add(key);p=root/'raw'/m['run']/(m['unit_id']+'.json')
  if sha(p)!=m['raw_sha256']:raise ValueError('Output changed')
  r=json.loads(p.read_text());u=json.loads((root/'inputs'/p.name).read_text());ss={s['id']:s.get('text',s.get('full_text','')) for s in u['sources']};art=u['article'].get('text',u['article'].get('full_text'))
  ids=[x['id'] for x in r['observations']]
  if len(ids)!=len(set(ids)):raise ValueError('Duplicate observation')
  for x in r['observations']:
   for q in x['article_quotes']:
    if norm(q) not in norm(art):raise ValueError('Article witness mismatch')
   for w in x['source_witnesses']:
    if norm(w['quote']) not in norm(ss.get(w['document_id'],'')):raise ValueError('Source witness mismatch')
  rows.append({'phase':phase,'unit_id':m['unit_id'],'policy':'A' if m['run']=='146' else 'B','observation_rows':len(ids),'output_chars':len(p.read_text()),'output_sha256':sha(p),'witness_spans_match':True})
 if len(seen)!=4:raise ValueError('Incomplete phase')
args.output.write_text(json.dumps({'native_discovery_outputs':len(rows),'new_model_calls_during_replay':0,'rows':rows,'limits':'Matching strings and hashes do not establish entailment, completeness or necessary editing. More observation rows are not a success score.'},ensure_ascii=False,indent=2));print('Verified',len(rows),'saved discovery outputs; no new model calls.')

from pathlib import Path
import json,hashlib
P=Path('/historical-research/journal-v12-private');O=P/'hidden-review-inputs';O.mkdir(exist_ok=True)
rows=json.loads((P/'hidden-pairs/experiment_private_mapping.json').read_text());groups=[[] for _ in range(4)]
bases=sorted({r['base_id'] for r in rows});manifest=[]
for bi,base in enumerate(bases):
 subset=sorted([r for r in rows if r['base_id']==base],key=lambda x:(x['method'],x['role']))
 for j,r in enumerate(subset):
  f=P/'hidden-detector-results'/f"{r['packet_id']}.json"
  if not f.exists():continue
  x=json.loads((P/'hidden-pairs/detector-inputs'/f"{r['packet_id']}.json").read_text())['input'];w=json.loads(f.read_text());candidate=x['candidate'];status='applied';spans=[]
  try:
   for p in w['patches']:
    before=p['before'];after=p['after']
    if not before:spans.append((len(candidate),len(candidate),after))
    else:
     if candidate.count(before)!=1:raise ValueError('nonunique or missing anchor')
     pos=candidate.index(before);spans.append((pos,pos+len(before),after))
   spans.sort()
   for a,b in zip(spans,spans[1:]):
    if a[1]>b[0]:raise ValueError('overlap')
   result=candidate
   for a,b,replacement in reversed(spans):result=result[:a]+replacement+result[b:]
  except ValueError as e:result=candidate;status='failed:'+str(e)
  rid=hashlib.sha256((r['packet_id']+'|repair-review').encode()).hexdigest()[:18]
  entry={'review_id':rid,'language':x['language'],'source':x['source'],'fixed_question':x['fixed_broad_question'],'original_candidate':candidate,'detector_output':w,'patched_candidate':result,'application_status':status}
  group=(j+bi)%4;groups[group].append(entry);manifest.append({'review_id':rid,'packet_id':r['packet_id'],'group':group,'application_status':status})
for i,group in enumerate(groups):
 (O/f'group{i}.json').write_text(json.dumps({'instruction':'Independently judge source vs original and patched candidate; do not assume detector right or source questions exhaustive. For every item return review_id, original_verdict faithful/inconsistent/unknown, detector_verdict_supported yes/no/unknown, patch_warranted yes/no/not_applicable/unknown, repaired yes/no/not_applicable/unknown, introduced_error yes/no/unknown, unnecessary_edit yes/no/unknown, short exact source/candidate anchors and reason. Faithful unchanged candidates are valid. Assess criticism/conditions/time/attribution and do not invent real-world facts.','items':group},ensure_ascii=False,indent=2)+'\n')
(P/'hidden-review-map.json').write_text(json.dumps(manifest,indent=2)+'\n');print([len(g) for g in groups])

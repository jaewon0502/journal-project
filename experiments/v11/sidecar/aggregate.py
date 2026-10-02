from pathlib import Path
import json,collections,hashlib,datetime
B=Path('/historical-research/journal-v11');P=Path('/historical-research/journal-v11-private')
def read(p):return json.loads(p.read_bytes())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def counts(a):return dict(sorted(collections.Counter(a).items()))
mapping=read(P/'sidecar-reader-map-private.json');questions=list(read(B/'sidecar/reader-rubric.json')['questions']);records=[];common={}
for m in mapping:
 f=P/'sidecar-reader-inputs'/f'{m["packet_id"]}.json';assert sha(f)==m['packet_sha256'];q=read(f)
 for a in ['A','B']:
  path=P/'sidecar-reader-results'/f'{a}__{m["packet_id"]}.json';r=read(path);assert r['complete'] and r['read_complete'];assert r['packet_id']==m['packet_id'];assert set(r['answers'])==set(questions)
  records.append({'mapping':m,'reader':a,'result':r,'raw_sha256':sha(path)})
 assert hashlib.sha256(q['displayed_annotation'].encode()).hexdigest()==m['annotation_sha256']
 common.setdefault(m['input_id'],[]).append(m['common_input_sha256'])
assert len(records)==16 and len(mapping)==8 and all(len(set(x))==1 for x in common.values())
s={'scope':'Four already exposed synthetic variants; supplied issue selection deliberately fixed from known failures, not fresh generalization','native_writing_outputs':0,'new_deterministic_sidecars':4,'reader_judgments':16,'conditions':{},'disagreements':[],'records':records}
for condition in sorted({m['condition'] for m in mapping}):
 rr=[r for r in records if r['mapping']['condition']==condition]
 s['conditions'][condition]={'judgments':len(rr),'questions':{q:counts(x['result']['answers'][q]['answer'] for x in rr) for q in questions},'recovery_basis':counts(x['result']['recovery_basis'] for x in rr),'missing_issue_references':sum(len(x['result']['missing_issue_ids']) for x in rr),'additional_concerns':[{'packet_id':x['mapping']['packet_id'],'reader':x['reader'],'concerns':x['result']['additional_concerns']} for x in rr if x['result']['additional_concerns']]}
 for m in [m for m in mapping if m['condition']==condition]:
  a=next(r['result'] for r in rr if r['mapping']['packet_id']==m['packet_id'] and r['reader']=='A');b=next(r['result'] for r in rr if r['mapping']['packet_id']==m['packet_id'] and r['reader']=='B')
  for q in questions:
   if a['answers'][q]['answer']!=b['answers'][q]['answer']:s['disagreements'].append({'packet_id':m['packet_id'],'condition':condition,'question':q,'A':a['answers'][q],'B':b['answers'][q]})
(B/'sidecar/summary.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in s.items() if k!='records'},ensure_ascii=False,indent=2))

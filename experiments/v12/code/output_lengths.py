from pathlib import Path
import json,re
P=Path('/historical-research/journal-v12-private');B=Path('/historical-research/journal-v12');rows=[]
def strings(v):
 if isinstance(v,str):return [v]
 if isinstance(v,list):return sum((strings(x) for x in v),[])
 if isinstance(v,dict):return sum((strings(x) for x in v.values()),[])
 return []
for version in ['v1','v2']:
 for r in json.loads((P/f'writer-map-{version}.json').read_text()):
  f=P/f'writer-results-{version}'/f"{r['input_id']}.json"
  if not f.exists():continue
  x=json.loads(f.read_text());n=[]
  for z in x['findings']:n+=strings({k:z[k] for k in ['description','materiality','status','limits'] if k in z})
  for z in x['patches']:n+=strings({k:z[k] for k in ['after','justification'] if k in z})
  for z in x['question_answers']:n+=strings({k:z[k] for k in ['answer','remaining_unknown'] if k in z})
  n+=strings(x.get('unanswered_scope',[]))+strings(x.get('no_change_reason',''))+strings(x.get('declared_limits',[]))
  narrative='\n'.join(n);total=f.read_text();words=len(narrative.split());chars=len(narrative)
  rows.append({'version':version,'case_id':r['case_id'],'condition':r['condition'],'input_id':r['input_id'],'total_json_characters':len(total),'total_json_whitespace_words':len(total.split()),'narrative_characters':chars,'narrative_whitespace_words':words,'requested_cap':900 if r['language']=='EN' else 3500,'exceeds_requested_cap':words>900 if r['language']=='EN' else chars>3500})
(B/'results/output-lengths.json').write_text(json.dumps({'measurement':'Counts descriptions/materiality/status/limits, patch after+justification, answers/remaining_unknown, unanswered_scope/no_change_reason/declared_limits. Excludes before, article/evidence anchor quotes, identifiers and JSON keys. Replacement after always counted even if partly copied. This explicit mechanical operationalization is measurement metadata, not posthoc success threshold. No truncation/rerun for exceedance.','rows':rows},indent=2)+'\n')
for r in rows:print(r['version'],r['case_id'],r['condition'],r['narrative_whitespace_words'] if r['case_id'].startswith('EN') else r['narrative_characters'],r['exceeds_requested_cap'])

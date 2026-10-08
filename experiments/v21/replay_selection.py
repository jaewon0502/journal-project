"""Verify saved fixed-candidate executions; no model calls or semantic rescoring."""
import argparse,hashlib,json
from pathlib import Path

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def norm(t):return ' '.join(t.split())
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--private-root',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args();root=args.private_root
 rows=[]
 for phase in ('development','transfer'):
  freeze=json.loads((root/(phase+'-freeze.json')).read_text())
  for rel,h in freeze['files'].items():
   if sha(root/rel)!=h:raise ValueError('Frozen input changed: '+rel)
  mapping=json.loads((root/phase/'blind-mapping.json').read_text());audit=json.loads((root/phase/'audit/result.json').read_text());judgments={x['blind_id']:x for x in audit.get('judgments',audit.get('results',[]))}
  seen=set()
  for m in mapping:
   key=(m['unit_id'],m['run'])
   if key in seen:raise ValueError('Duplicate decision '+str(key))
   seen.add(key);p=root/phase/'raw'/m['run']/(m['unit_id']+'.json')
   if sha(p)!=m['raw_sha256']:raise ValueError('Raw judgment changed')
   r=json.loads(p.read_text());u=json.loads((root/phase/'inputs'/(m['unit_id']+'.json')).read_text());o=u['article'].get('full_text',u['article'].get('text'));patch=u['patch']
   if o.count(patch['before'])!=1:raise ValueError('Ambiguous patch')
   if r['decision'] not in ('apply','reject','hold'):raise ValueError('Invalid action')
   delivered=o.replace(patch['before'],patch['after'],1) if r['decision']=='apply' else o
   blind=json.loads((root/phase/'blind'/(m['blind_id']+'.json')).read_text())
   if delivered!=blind['mechanical_delivery'] or hashlib.sha256(delivered.encode()).hexdigest()!=blind['delivery_sha256']:raise ValueError('Delivery mismatch')
   for w in r['source_witnesses']:
    candidates=[s.get('text',s.get('full_text','')) for s in u['sources'] if s['id']==w['document_id']]
    if not candidates or not any(norm(w['quote']) in norm(s) for s in candidates):raise ValueError('Source witness mismatch: '+str(key))
   j=judgments[m['blind_id']]
   rows.append({'phase':phase,'unit_id':m['unit_id'],'policy':'A' if m['run']=='814' else 'B','decision':r['decision'],'AI_pre_agreement':j.get('decision_agrees_with_pre',j.get('decision_matches_pre')),'mechanical_delivery_sha256':blind['delivery_sha256'],'release_state':'held_not_publishable' if r['decision']=='hold' else 'candidate_scope_only','input_chars':len((root/phase/'inputs'/(m['unit_id']+'.json')).read_text()),'output_chars':len(p.read_text())})
  if len(seen)!=8:raise ValueError('Incomplete phase')
 result={'native_selection_outputs':len(rows),'new_model_calls_during_replay':0,'rows':rows,'limits':'Saved AI judgments, not human truth; candidate-scope decisions, not whole-article release certification. Hold leaves unresolved text and is not a correction success.'}
 args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2));print('Verified',len(rows),'saved selections; no new model calls.')
if __name__=='__main__':main()

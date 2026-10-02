from pathlib import Path
import importlib.util,json,hashlib,datetime
r=Path('/historical-research/journal-v13');p=Path('/historical-research/journal-v13-private/fresh-control')
spec=importlib.util.spec_from_file_location('gate',r/'code/gate.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
raw=(p/'bundle.json').read_bytes();b=json.loads(raw);reviews=[json.loads((p/f'review-{x}.json').read_text()) for x in ['A','B']]
out=g.evaluate(b,raw,reviews);(p/'gate-output.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
seen={};mapping=[];audits=[]
for name,d in out['results'].items():
 h=d['delivered_sha256'];aid=seen.get(h)
 if not aid:
  aid=hashlib.sha256(('fresh-final:'+h).encode()).hexdigest()[:24];seen[h]=aid
  packet={'audit_id':aid,'source_documents':b['source_documents'],'source_scope_note':b['source_scope_note'],'original_article':b['original_article'],'reader_questions':b['questions'],'candidate_article':d['delivered_text'],'instruction':(r/'protocol/final-audit-instruction.md').read_text()}
  (p/'audit-inputs').mkdir(exist_ok=True);(p/'audit-results').mkdir(exist_ok=True);f=p/'audit-inputs'/(aid+'.json');f.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n');audits.append({'audit_id':aid,'input_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'candidate_sha256':h})
 mapping.append({'gate':name,'audit_id':aid,'accepted_ids':d['accepted_ids'],'held_ids':d['held_ids'],'status':d['status'],'reasons':d['reasons'],'bundle_reasons':d['bundle_reasons']})
(p/'audit-map.json').write_text(json.dumps({'mapping':mapping,'audits':audits},ensure_ascii=False,indent=2)+'\n');(r/'protocol/fresh-control-audit-lock.json').write_text(json.dumps({'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'audits':audits},indent=2)+'\n')
print(json.dumps({'mapping':mapping,'audits':audits},ensure_ascii=False,indent=2))

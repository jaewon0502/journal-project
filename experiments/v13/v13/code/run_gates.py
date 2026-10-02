from pathlib import Path
import importlib.util,json,hashlib,datetime
root=Path('/historical-research/journal-v13'); private=Path('/historical-research/journal-v13-private')
spec=importlib.util.spec_from_file_location('gate',root/'code/gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
rows=json.loads((private/'allocation.json').read_text())['order']; outputs=[];audits=[]
(private/'audit-inputs').mkdir(exist_ok=True);(private/'audit-results').mkdir(exist_ok=True)
for r in rows:
 bid=r['id'];raw=Path(r['path']).read_bytes();bundle=json.loads(raw)
 reviews=[json.loads((private/'reviews'/f'{role}__{bid}.json').read_text()) for role in ['A','B']]
 result=gate.evaluate(bundle,raw,reviews);dest=private/'delivery'/(bid+'.json');dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 seen={}
 for name,d in result['results'].items():
  h=d['delivered_sha256'];audit_id=seen.get(h)
  if not audit_id:
   audit_id=hashlib.sha256(('v13-final-audit:'+bid+':'+h).encode()).hexdigest()[:24];seen[h]=audit_id
   packet={'audit_id':audit_id,'source_documents':bundle['source_documents'],'source_scope_note':bundle['source_scope_note'],'original_article':bundle['original_article'],'reader_questions':bundle['questions'],'candidate_article':d['delivered_text'],'instruction':(root/'protocol/final-audit-instruction.md').read_text()}
   f=private/'audit-inputs'/(audit_id+'.json');f.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n')
   audits.append({'audit_id':audit_id,'bundle_id':bid,'kind':r['kind'],'input_sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'candidate_sha256':h})
  outputs.append({'bundle_id':bid,'kind':r['kind'],'gate':name,'proposals':len(bundle['proposed_patches']),'accepted_ids':d['accepted_ids'],'held_ids':d['held_ids'],'status':d['status'],'bundle_reasons':d['bundle_reasons'],'reasons':d['reasons'],'audit_id':audit_id,'delivered_sha256':h})
(private/'audit-map.json').write_text(json.dumps({'outputs':outputs,'audits':audits},ensure_ascii=False,indent=2)+'\n')
(root/'results/preaudit-gates.json').write_text(json.dumps({'status':'pre-final-audit;not-certified-delivery','rows':outputs,'unique_audit_candidates':len(audits),'time_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()},ensure_ascii=False,indent=2)+'\n')
(root/'protocol/final-audit-input-lock.json').write_text(json.dumps({'audits':audits},indent=2)+'\n')
print(json.dumps({'rows':[{k:v for k,v in x.items() if k in ['bundle_id','gate','accepted_ids','held_ids','status','audit_id']} for x in outputs],'unique_audits':len(audits)},ensure_ascii=False,indent=2))

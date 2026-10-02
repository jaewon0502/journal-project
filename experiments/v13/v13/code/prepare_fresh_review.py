from pathlib import Path
import importlib.util,json,hashlib,datetime
r=Path('/historical-research/journal-v13');p=Path('/historical-research/journal-v13-private/fresh-control')
spec=importlib.util.spec_from_file_location('gate',r/'code/gate.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
d=json.loads((p/'source-packet.json').read_text());w=json.loads((p/'writer-output.json').read_text())
b={k:d[k] for k in ['bundle_id','source_documents','original_article','questions','source_scope_note']};b['proposed_patches']=w['patches']
f=p/'bundle.json';f.write_text(json.dumps(b,ensure_ascii=False,indent=2)+'\n');raw=f.read_bytes();wrapper=g.prepare(b,raw)
wrapper['review_instructions']=(r/'protocol/REVIEW_INSTRUCTIONS.md').read_text();wrapper['review_schema']=json.loads((r/'protocol/REVIEW_SCHEMA.json').read_text())
(p/'review-input.json').write_text(json.dumps(wrapper,ensure_ascii=False,indent=2)+'\n')
lock={'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'writer_proposal_count':len(w['patches']),'actual_writer_output':True,'application_errors':wrapper['candidate_application_errors'],'files':{n:hashlib.sha256((p/n).read_bytes()).hexdigest() for n in ['source-packet.json','source-first-reference.json','writer-input.json','writer-output.json','bundle.json','review-input.json']}}
(r/'protocol/fresh-control-review-lock.json').write_text(json.dumps(lock,ensure_ascii=False,indent=2)+'\n');print({'proposals':len(w['patches']),'application_errors':wrapper['candidate_application_errors']})

from pathlib import Path
import importlib.util,json,hashlib,datetime
root=Path('/historical-research/journal-v13'); private=Path('/historical-research/journal-v13-private')
spec=importlib.util.spec_from_file_location('gate',root/'code/gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
rows=json.loads((private/'allocation.json').read_text())['order']; out=[]
for r in rows:
 p=Path(r['path']);raw=p.read_bytes();d=json.loads(raw);w=gate.prepare(d,raw)
 w['review_instructions']=(root/'protocol/REVIEW_INSTRUCTIONS.md').read_text();w['review_schema']=json.loads((root/'protocol/REVIEW_SCHEMA.json').read_text())
 target=private/'inputs'/(r['id']+'.json');target.write_text(json.dumps(w,ensure_ascii=False,indent=2)+'\n');out.append({'id':r['id'],'sha256':hashlib.sha256(target.read_bytes()).hexdigest()})
(root/'protocol/review-input-lock.json').write_text(json.dumps({'created_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':out},indent=2)+'\n')
print('prepared',len(out),'review inputs')

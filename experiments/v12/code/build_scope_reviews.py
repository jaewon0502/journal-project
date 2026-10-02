from pathlib import Path
import json,hashlib
from apply_exact import apply
P=Path('/historical-research/journal-v12-private/supplementary/scope');B=Path('/historical-research/journal-v12/supplementary/scope');rows=json.loads((P/'allocation-map.json').read_text())['order'];sha=lambda x:hashlib.sha256(x).hexdigest();out=[]
(P/'reviewer-inputs').mkdir(exist_ok=True);(P/'candidates').mkdir(exist_ok=True)
for r in rows:
 f=P/'writer-results'/f"{r['input_id']}.json"
 if not f.exists():continue
 x=json.loads((P/'writer-inputs'/f"{r['input_id']}.json").read_text());w=json.loads(f.read_text());original='\n\n'.join(z['text'] for z in x['article']['paragraphs']);pid=sha((r['input_id']+'|'+sha(f.read_bytes())).encode())[:24]
 try:c=apply(original,w['patches']);status='applied';error=None
 except (ValueError,TypeError,KeyError) as e:c={'candidate':original,'source_sha256':sha(original.encode()),'candidate_sha256':sha(original.encode())};status='failed_original_retained';error=str(e)
 p={'packet_id':pid,'instruction':(B/'reviewer-instruction.md').read_text(),'questions':x['questions'],'article':x['article'],'allowed_primary_evidence':x['primary_evidence'],'allowed_evidence_scope':x.get('evidence_scope'),'original_text':original,'writer_output':w,'displayed_candidate':c['candidate'],'application_status':status,'application_error':error}
 (P/'reviewer-inputs'/f'{pid}.json').write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n');(P/'candidates'/f'{pid}.json').write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
 out.append({**r,'packet_id':pid,'writer_sha256':sha(f.read_bytes()),'reviewer_input_sha256':sha((P/'reviewer-inputs'/f'{pid}.json').read_bytes()),'source_sha256':c['source_sha256'],'candidate_sha256':c['candidate_sha256'],'application_status':status,'patches':len(w['patches'])})
(P/'review-map.json').write_text(json.dumps(out,indent=2)+'\n');(B/'mechanical-results.json').write_text(json.dumps(out,indent=2)+'\n');print([(r['input_id'],r['packet_id'],r['application_status'],r['patches']) for r in out])

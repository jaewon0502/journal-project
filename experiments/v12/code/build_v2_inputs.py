from pathlib import Path
import json,hashlib,datetime,re
B=Path('/historical-research/journal-v12'); P=Path('/historical-research/journal-v12-private')
sha=lambda b:hashlib.sha256(b).hexdigest()
proposal=(P/'development-adaptation/proposal.md').read_text()
gate=next(x[1:] for x in proposal.splitlines() if x.startswith('+Before emitting each patch'))
(B/'protocol/B-v2-boundary-gate.txt').write_text(gate+'\n')
rows=[]
(P/'writer-inputs-v2').mkdir(exist_ok=True);(P/'writer-results-v2').mkdir(exist_ok=True)
for r in json.loads((P/'writer-map-v1.json').read_text()):
 x=json.loads((P/'writer-inputs-v1'/f"{r['input_id']}.json").read_text())
 iid=sha((r['case_id']+'|'+r['condition']+'|v12-real-v2').encode())[:24]
 x['input_id']=iid
 if r['condition']=='B':x['method_instruction']+='\n\n'+gate
 p=P/'writer-inputs-v2'/f'{iid}.json';p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
 rows.append({**r,'input_id':iid,'input_sha256':sha(p.read_bytes()),'previous_input_id':r['input_id'],'run_plan':'run' if r['split']!='development' or r['condition']=='B' else 'unchanged A; reuse v1 development output only'})
(P/'writer-map-v2.json').write_text(json.dumps(rows,indent=2)+'\n')
(B/'protocol/final-method-lock-v2.json').write_text(json.dumps({'frozen_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'decision':'One DEV-based B-only boundary gate adaptation. A unchanged. No further adaptation after this lock. B-v2 vs A is a composite treatment, not isolated gate effect. Two B-v2 DEV reruns are exposed regression. Four EVAL runs are fresh writer contexts.','gate_sha256':sha((gate+'\n').encode()),'v1_lock_sha256':sha((B/'protocol/development-method-v1-lock.json').read_bytes()),'rows':rows},indent=2)+'\n')
print(json.dumps(rows,indent=2))

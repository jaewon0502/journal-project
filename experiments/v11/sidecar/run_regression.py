"""Execute frozen exposed regression once; preserve existing inputs/receipts."""
from pathlib import Path
import json,hashlib,ast,itertools,sys,datetime,importlib.util
B=Path('/historical-research/journal-v11');P=Path('/historical-research/journal-v11-private')
spec=importlib.util.spec_from_file_location('sidecar_frozen',B/'sidecar/sidecar.py');C=importlib.util.module_from_spec(spec);sys.modules[spec.name]=C;spec.loader.exec_module(C)
sys.path.insert(0,str(B/'portable'));from loader import load_receipt
R=load_receipt('v1_3');t=ast.parse((B/'confirmation/adapter.py').read_text());env={'R':R,'raw':R.canonical,'itertools':itertools};exec(compile(t,'adapter','exec'),env)
def read(p):return json.loads(p.read_bytes())
def sha(b):return hashlib.sha256(b).hexdigest()
mapping=read(P/'sidecar-inputs/map-private.json');cases={c['case_id']:c for c in read(P/'confirmation-hidden/cases.json')};old={r['case_id']:r for r in read(B/'confirmation/results.json')['cases']}
out=P/'sidecar-results';packets=P/'sidecar-reader-inputs';out.mkdir(exist_ok=True);packets.mkdir(exist_ok=True)
rows=[];mappings=[]
for m in mapping:
 raw=(P/'sidecar-inputs'/f'{m["input_id"]}.json').read_bytes();assert sha(raw)==m['input_sha256'];x=json.loads(raw);c=cases[m['case_id']];args=env['args_for'](c);rr=R.canonical(old[c['case_id']]['receipt'])
 result=C.emit(raw,rr,*args);(out/f'{m["input_id"]}.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 if result['status']!='verified':
  rows.append({**m,'result':result});continue
 # root validates renderer fields after implementation contract is finalized.
 annotation=result['combined_text'];baseline=old[c['case_id']]['annotation']['text']
 common={'source':c['source'],'actual_output':c['actual_output'],'existing_receipt':old[c['case_id']]['receipt'],'evidence':x['evidence'],'supplied_issue_assertions':x['issues'],'scope':'Already exposed authored synthetic regression; supplied issues are not gold and do not establish complete coverage.'}
 common_hash=sha(R.canonical(common))
 for condition,text in [('STATUS_ONLY',baseline),('STATUS_PLUS_LINKED_ISSUES',annotation)]:
  id=sha((m['input_id']+'|'+condition+'|'+text).encode())[:24];packet={'packet_id':id,'language':m['language'],**common,'displayed_annotation':text};q=packets/f'{id}.json';q.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n')
  mappings.append({'input_id':m['input_id'],'case_id':m['case_id'],'packet_id':id,'condition':condition,'language':m['language'],'common_input_sha256':common_hash,'packet_sha256':sha(q.read_bytes()),'annotation_sha256':sha(text.encode()),'issue_count':len(x['issues'])})
 rows.append({**m,'status':result['status'],'result_sha256':sha((out/f'{m["input_id"]}.json').read_bytes()),'original_receipt_unchanged':rr==R.build(*args).raw})
(B/'sidecar/regression-results.json').write_text(json.dumps({'executed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Exposed regression, not new holdout','rows':rows},indent=2)+'\n')
(P/'sidecar-reader-map-private.json').write_text(json.dumps(mappings,indent=2)+'\n')
order=sorted([m['packet_id'] for m in mappings],key=lambda x:sha(('blind order'+x).encode()))
(P/'sidecar-reader-order.json').write_text(json.dumps(order,indent=2)+'\n')
(B/'sidecar/reader-lock.json').write_text(json.dumps({'frozen_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'packet_hashes':{m['packet_id']:m['packet_sha256'] for m in mappings},'instruction_sha256':sha((B/'sidecar/reader-instructions.md').read_bytes()),'rubric_sha256':sha((B/'sidecar/reader-rubric.json').read_bytes())},indent=2)+'\n')
print(json.dumps({'executed_inputs':len(rows),'verified':sum(r.get('status')=='verified' for r in rows),'reader_packets':len(mappings)}))

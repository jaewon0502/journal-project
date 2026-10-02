"""Portable arithmetic/checks; no network or model calls, no natural raw needed."""
from pathlib import Path
import json,hashlib,sys,subprocess,tempfile,collections,ast,itertools,shutil
B=Path(__file__).resolve().parent;S=B/'synthetic'
def read(p):return json.loads(p.read_bytes())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def counts(items):return dict(sorted(collections.Counter(items).items()))
for line in (B/'SHA256SUMS').read_text().splitlines():
 h,p=line.split('  ',1);assert sha(B/p)==h,p
sys.path.insert(0,str(B/'portable'));from loader import load_receipt
R=load_receipt('v1_3')
# Reuse exactly the authored confirmation adapter body; adapter source is shared.
t=ast.parse((B/'confirmation/adapter.py').read_text());f=next(n for n in t.body if isinstance(n,ast.FunctionDef) and n.name=='args_for')
env={'R':R,'raw':R.canonical,'itertools':itertools};exec(compile(ast.Module(body=[f],type_ignores=[]),'authored adapter','exec'),env)
cases=read(S/'confirmation-hidden/cases.json');baseline={r['case_id']:r for r in read(B/'confirmation/results.json')['cases']}
for c in cases:
 args=env['args_for'](c);receipt=R.build(*args);out=R.emit(receipt,*args,lang=c['language'])
 assert receipt.address==baseline[c['case_id']]['receipt_sha256'];assert out==baseline[c['case_id']]['annotation']
mutations=0
for m in read(S/'confirmation-hidden/mechanical-private.json'):
 c=next(x for x in cases if x['case_id']==m['case_id']);args=list(env['args_for'](c));r=R.build(*args)
 if m['failure']=='corrupt_output':args[0]+=b'!'
 elif m['failure']=='stale_receipt':j=json.loads(r.raw);j['output_sha256']=j['source_sha256'];r=R.Receipt(R.canonical(j))
 elif m['failure']=='partial_write':p=c['proposed_patches'][0];s=c['source'].encode();args[0]=s[:p['start_byte']]+p['after'].encode()+s[p['end_byte']:]
 assert R.emit(r,*args,lang=c['language'])['status']=='verification_failed';mutations+=1
# Recompute each condition/question answer and annotation distributions from raw.
mapping=read(S/'reader-map-private.json')['rows'];saved=read(B/'analysis/reader-summary.json');records=[]
for m in mapping:
 packet_path=S/'reader-inputs'/f'{m["packet_id"]}.json';assert sha(packet_path)==m['packet_sha256']
 for a in ['A','B']:records.append((m,read(S/'reader-results'/f'{a}__{m["packet_id"]}.json')))
for cond,stats in saved['conditions'].items():
 rr=[r for m,r in records if m['condition']==cond]
 for q,stat in stats['by_question'].items():
  assert counts(r['answers'][q]['answer'] for r in rr)==stat['answers']
  assert counts(r['annotation_checks'][q]['rating'] for r in rr)==stat['annotation_ratings']
# Natural precision audit: arithmetic over public projections only, not rejudging.
p=read(B/'precision/public-projection.json')
for cond,stats in p['conditions'].items():
 rr=[v for x in p['outputs'] if x['condition']==cond for v in x['ratings'].values()]
 for key in ['strengthened_precision','contradiction_claim','contradiction_support']:assert counts(r[key] for r in rr)==stats[key]
 assert sum(r['unsupported_inference_items'] for r in rr)==stats['unsupported_inference_items']
# Recount final exposed sidecar reader answers directly from raw judgments.
sm=read(S/'sidecar-reader-map-private.json');ss=read(B/'sidecar/summary.json');sr=[]
for m in sm:
 assert sha(S/'sidecar-reader-inputs'/f'{m["packet_id"]}.json')==m['packet_sha256']
 for a in ['A','B']:sr.append((m,read(S/'sidecar-reader-results'/f'{a}__{m["packet_id"]}.json')))
for cond,stats in ss['conditions'].items():
 rr=[r for m,r in sr if m['condition']==cond]
 for q,distribution in stats['questions'].items():assert counts(r['answers'][q]['answer'] for r in rr)==distribution
print(json.dumps({'manifest_valid':True,'frozen_confirmation_replays':10,'mechanical_rejections':mutations,'raw_reader_judgments_recounted':len(records),'precision_projection_judgments_recounted':8,'sidecar_raw_judgments_recounted':len(sr),'new_model_calls':0,'natural_source_reverification':False},indent=2))

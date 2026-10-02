from pathlib import Path
import json,hashlib,sys,datetime
from apply_exact import apply
B=Path('/historical-research/journal-v12');P=Path('/historical-research/journal-v12-private');version=sys.argv[1] if len(sys.argv)>1 else 'v1';split=sys.argv[2] if len(sys.argv)>2 else 'development';rows=json.loads((P/f'writer-map-{version}.json').read_bytes());out=P/f'reviewer-inputs-{version}';out.mkdir(exist_ok=True);cand=P/f'candidates-{version}';cand.mkdir(exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest();results=[]
for r in rows:
 if r['split']!=split:continue
 path=P/f'writer-results-{version}'/f'{r["input_id"]}.json'
 if not path.exists():continue
 w=json.loads(path.read_bytes());packet=json.loads((P/f'writer-inputs-{version}'/f'{r["input_id"]}.json').read_bytes());source='\n\n'.join(x['text'] for x in packet['article']['paragraphs']);assert sha(source.encode())==r['article_text_sha256']
 try:a=apply(source,w['patches']);status='applied' if w['patches'] else 'no-op';error=None
 except (ValueError,KeyError,TypeError) as e:a={'source_sha256':sha(source.encode()),'candidate_sha256':sha(source.encode()),'candidate':source,'patches':[],'semantic_approval':False};status='failed-original-retained';error=str(e)
 id=sha((r['input_id']+'|review|'+sha(path.read_bytes())).encode())[:24]
 common={'language':r['language'],'questions':packet['questions'],'article':packet['article'],'primary_evidence':packet['primary_evidence'],'evidence_scope':packet['evidence_scope'],'original_text':source}
 key=json.loads((P/'frozen-reference'/f'{r["case_id"]}.frozen-reference.json').read_bytes())
 rr={'packet_id':id,**common,'writer_output':w,'displayed_candidate':a['candidate'],'application_status':status,'application_error':error,'provisional_reference':key,'reference_is_gold':False,'evaluator_schema':json.loads((B/'protocol/evaluator-schema.json').read_bytes())}
 (out/f'{id}.json').write_text(json.dumps(rr,ensure_ascii=False,indent=2)+'\n');(cand/f'{id}.json').write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')
 # Third reviewer gets no reference, original verdict or writer method.
 to=P/f'third-inputs-{version}';to.mkdir(exist_ok=True)
 (to/f'{id}.source.json').write_text(json.dumps({'packet_id':id,**common},ensure_ascii=False,indent=2)+'\n')
 (to/f'{id}.candidate.json').write_text(json.dumps({'packet_id':id,'writer_output':w,'displayed_candidate':a['candidate'],'application_status':status,'application_error':error},ensure_ascii=False,indent=2)+'\n')
 results.append({**r,'packet_id':id,'writer_raw_sha256':sha(path.read_bytes()),'review_input_sha256':sha((out/f'{id}.json').read_bytes()),'candidate_sha256':a['candidate_sha256'],'application_status':status,'application_error':error,'finding_items':len(w.get('findings',[])),'patch_count':len(w.get('patches',[]))})
file=P/f'review-map-{version}-{split}.json';file.write_text(json.dumps(results,indent=2)+'\n');(B/'results'/f'mechanical-{version}-{split}.json').write_text(json.dumps({'built_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':results},indent=2)+'\n');print(json.dumps(results,indent=2))

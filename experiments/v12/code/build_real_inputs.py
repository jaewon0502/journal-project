from pathlib import Path
import json,hashlib,datetime
B=Path('/historical-research/journal-v12');P=Path('/historical-research/journal-v12-private');O=P/'writer-inputs-v1';O.mkdir(exist_ok=True);(P/'writer-results-v1').mkdir(exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_bytes())
text=(B/'protocol/condition-prompts.md').read_text();shared=text.split('# Shared task wrapper\n',1)[1].split('[ARTICLE]',1)[0].strip();a=text.split('# Condition A addition\n',1)[1].split('# Condition B addition',1)[0].strip();b=text.split('# Condition B addition\n',1)[1].split('# Freeze notes',1)[0].strip();schema=read(B/'protocol/output-schema.json')
rows=[]
for case in ['KO-DEV-01','EN-DEV-01','KO-EVAL-01','EN-EVAL-01']:
 art=read(P/'reference-inputs'/f'{case}.article.json');prim=read(P/'reference-inputs'/f'{case}.primary.json');source='\n\n'.join(p['text'] for p in art['documents'][0]['paragraphs']);common={'language':art['language'],'questions':art['questions'],'article':art['documents'][0],'primary_evidence':prim['documents'],'source_text_construction':'Join article.paragraphs text in order with two newline characters. Exact before anchors must be unique in this text.','article_text_sha256':sha(source.encode()),'evidence_scope':prim.get('evidence_rule',prim.get('evidence_cutoff')),'shared_instruction':shared,'narrative_cap':{'EN_words':900,'KO_Unicode_characters':3500,'excludes':'JSON keys/IDs and copied exact anchors; no finding count cap'},'output_schema':schema}
 commonhash=sha(json.dumps(common,ensure_ascii=False,sort_keys=True).encode())
 for cond,instruction in [('A',a),('B',b)]:
  iid=sha((case+'|'+cond+'|v12-real-v1').encode())[:24];packet={'input_id':iid,**common,'method_instruction':instruction};path=O/f'{iid}.json';path.write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n');rows.append({'case_id':case,'condition':cond,'input_id':iid,'split':art['split'],'language':art['language'],'input_sha256':sha(path.read_bytes()),'common_input_sha256':commonhash,'article_text_sha256':sha(source.encode())})
(P/'writer-map-v1.json').write_text(json.dumps(rows,indent=2)+'\n');(B/'protocol/writer-input-lock-v1.json').write_text(json.dumps({'frozen_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':rows,'instruction_scope':'A/B differ only method_instruction and opaque input_id; paired common hash identical. No curator labels provided.'},indent=2)+'\n');print(json.dumps(rows,indent=2))

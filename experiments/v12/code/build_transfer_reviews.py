from pathlib import Path
import json,hashlib
from apply_exact import apply
P=Path('/historical-research/journal-v12-private/supplementary/transfer');B=Path('/historical-research/journal-v12/supplementary/transfer');rows=json.loads((P/'allocation-map.json').read_text())['runs'];sha=lambda b:hashlib.sha256(b).hexdigest();out=[]
for d in ['reviewer-inputs','candidates']: (P/d).mkdir(exist_ok=True)
ref=json.loads((P/'target-coverage-reference.json').read_text())
for r in rows:
 f=P/'writer-results'/f"{r['input_id']}.json"
 if not f.exists():continue
 x=json.loads((P/'writer-inputs'/f"{r['input_id']}.json").read_text());w=json.loads(f.read_text());original='\n\n'.join(z['text'] for z in x['article']['paragraphs']);assert sha(original.encode())==x['article_text_sha256'];pid=sha((r['input_id']+'|'+sha(f.read_bytes())).encode())[:24]
 try:c=apply(original,w['patches']);status='applied';error=None
 except (ValueError,TypeError,KeyError) as e:c={'candidate':original,'source_sha256':sha(original.encode()),'candidate_sha256':sha(original.encode())};status='failed_original_retained';error=str(e)
 packet={'packet_id':pid,'article':x['article'],'original_text':original,'allowed_primary_evidence':x['primary_evidence'],'allowed_evidence_scope':x['evidence_scope'],'questions':x['questions'],'frozen_grader_reference':ref,'writer_output':w,'displayed_candidate':c['candidate'],'application_status':status,'application_error':error,'instruction':'Follow the frozen grader reference. Return JSON: packet_id; target_assessments one row each G1/G2 with component judgments, final_article_presence, source_support, exact short anchors, finding_mention and answer_mention separately; patch_assessments every patch with warranted/collateral_loss/unsupported_strengthening/unnecessary_edit/source_receipts/reason; preservation including criticism/counterargument/time/forecast attribution; all new_harms and unresolved issues; inspected paragraph IDs and actual relation pairs; complete/read_complete. Use only this packet, no other runs or web. Starting article is intentionally reused AI candidate, not a new published article. Source facts and target necessity may be challenged with evidence; reference is not gold. Distinguish residual starting issues from new harms. No rawoutput edits or majority voting.'}
 (P/'reviewer-inputs'/f'{pid}.json').write_text(json.dumps(packet,ensure_ascii=False,indent=2)+'\n');(P/'candidates'/f'{pid}.json').write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n')
 out.append({**r,'packet_id':pid,'writer_sha256':sha(f.read_bytes()),'reviewer_input_sha256':sha((P/'reviewer-inputs'/f'{pid}.json').read_bytes()),'source_sha256':c['source_sha256'],'candidate_sha256':c['candidate_sha256'],'application_status':status,'patches':len(w['patches'])})
(P/'review-map.json').write_text(json.dumps(out,indent=2)+'\n');(B/'mechanical-results.json').write_text(json.dumps(out,indent=2)+'\n');print([(r['input_id'],r['packet_id'],r['application_status'],r['patches']) for r in out])

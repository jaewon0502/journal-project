"""Apply only eligible, non-overlapping numeric patches. Raw proposal is never overwritten."""
def enforce(unit,proposal,gate):
 original=unit['article']['text'];eligible={r['id'] for r in gate['results'] if r['gate_result']=='eligible_mismatch'}
 accepted=[];blocked=[];spans=[];violations=[]
 for p in proposal.get('patches',[]):
  ids=p.get('comparison_ids',[]);before=p.get('before','')
  if not ids or not (set(ids)&eligible):blocked.append({'id':p.get('id'),'reason':'no eligible numerical comparison','before':before});continue
  if not before or original.count(before)!=1:blocked.append({'id':p.get('id'),'reason':'nonunique original anchor','before':before});continue
  i=original.index(before);j=i+len(before)
  if any(i<e and s<j for s,e,_ in spans):blocked.append({'id':p.get('id'),'reason':'overlapping patches','before':before});continue
  spans.append((i,j,p['after']));accepted.append(p.get('id'))
 text=original
 for i,j,after in sorted(spans,reverse=True):text=text[:i]+after+text[j:]
 for r in proposal.get('clause_audit',[]):
  if r.get('relation')=='contradicted' and not(set(r.get('comparison_ids',[]))&eligible):violations.append({'quote':r.get('quote'),'delivered_disposition':'review_required','reason':'raw contradiction label lacked eligible comparison'})
 return {'unit_id':unit['unit_id'],'kind':'deterministic gated delivery; not native model generation','full_edited_text':text,'accepted_patch_ids':accepted,'blocked_patches':blocked,'raw_label_violations':violations,'local_review_required':[x['before'] for x in blocked]+[x['quote'] for x in violations],'semantic_correctness_certified':False,'raw_output_preserved':True}

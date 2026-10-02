#!/usr/bin/env python3
"""Arithmetic over immutable recorded responses; creates no new reader judgments."""
import json,pathlib,collections,hashlib,statistics
ROOT=pathlib.Path('/historical-research/journal-v11'); PRIVATE=pathlib.Path('/historical-research/journal-v11-private'); OUT=ROOT/'analysis'
def read(p):return json.loads(p.read_text())
def sha(b):return hashlib.sha256(b).hexdigest()
def counts(xs):return dict(sorted(collections.Counter(xs).items()))
maprows=read(PRIVATE/'reader-map-private.json')['rows']; keypath=PRIVATE/'confirmation-hidden/expected-private.json'; keyhash=sha(keypath.read_bytes());keys={x['case_id']:x for x in read(keypath)}
qs=list(next(iter(keys.values()))['expected']);conditions=['AUTHOR_PROPOSAL','NATIVE_FINAL','RECEIPT_FINAL']; records=[]; provenance=[]
for m in maprows:
 ppath=PRIVATE/'reader-inputs'/f"{m['packet_id']}.json";packet=read(ppath)
 assert sha(ppath.read_bytes())==m['packet_sha256']
 common={k:v for k,v in packet.items() if k not in ['packet_id','annotation']}
 assert sha(json.dumps(common,sort_keys=True,ensure_ascii=False).encode())==m['common_input_sha256']
 assert sha(packet['annotation'].encode())==m['annotation_sha256']
 for reader in ['A','B']:
  path=PRIVATE/'reader-results'/f"{reader}__{m['packet_id']}.json";r=read(path)
  assert r['packet_id']==m['packet_id'] and r['complete'] and r['read_complete']
  assert set(r['answers'])==set(qs) and set(r['annotation_checks'])==set(qs)
  records.append(dict(mapping=m,reader=reader,result=r))
  provenance.append(dict(path=str(path),sha256=sha(path.read_bytes())))
assert len(records)==60 and len(maprows)==30
for cid in keys:assert len({m['common_input_sha256'] for m in maprows if m['case_id']==cid})==1
summary={'scope':'Recorded AI reader judgments only; no new adjudication. Authored key is preserved and is not gold.','underlying_scenarios':10,'case_dependency':'Ten language/state variants of one fictional library setting, not ten independent real-world events.','packets':30,'reader_judgments':60,'judgments_per_condition':20,'readers':['A','B'],'questions':qs,'key_sha256_unchanged':keyhash,'all_packet_and_annotation_hashes_match':True,'same_common_input_hash_within_all_10_cases':True,'conditions':{},'key_mismatches':[],'reader_disagreements':[],'unsupported_claim_records':[],'meaning_omission_records':[]}
for cond in conditions:
 rec=[r for r in records if r['mapping']['condition']==cond]; stats={'by_question':{},'unsupported_claim_items':0,'judgments_with_unsupported_claims':0,'judgments_with_meaning_details_absent':0,'annotation_ratings_all_questions':{},'length_by_language':{}}
 for q in qs:
  st={'answers':counts(r['result']['answers'][q]['answer'] for r in rec),'key_exact_matches':sum(r['result']['answers'][q]['answer']==keys[r['mapping']['case_id']]['expected'][q] for r in rec),'denominator':20,'annotation_ratings':counts(r['result']['annotation_checks'][q]['rating'] for r in rec),'by_reader':{}}
  for reader in ['A','B']:
   rr=[r for r in rec if r['reader']==reader]
   st['by_reader'][reader]={'answers':counts(r['result']['answers'][q]['answer'] for r in rr),'key_exact_matches':sum(r['result']['answers'][q]['answer']==keys[r['mapping']['case_id']]['expected'][q] for r in rr),'denominator':10,'annotation_ratings':counts(r['result']['annotation_checks'][q]['rating'] for r in rr)}
  stats['by_question'][q]=st
  for r in rec:
   expected=keys[r['mapping']['case_id']]['expected'][q];actual=r['result']['answers'][q]
   if actual['answer']!=expected:summary['key_mismatches'].append({'condition':cond,'reader':r['reader'],'packet_id':r['mapping']['packet_id'],'case_id':r['mapping']['case_id'],'question':q,'authored_expected':expected,**actual})
 stats['annotation_ratings_all_questions']=counts(r['result']['annotation_checks'][q]['rating'] for r in rec for q in qs)
 for r in rec:
  claims=r['result']['annotation_new_unsupported_claims']; absent=r['result']['important_meaning_details_absent_from_annotation']
  stats['unsupported_claim_items']+=len(claims);stats['judgments_with_unsupported_claims']+=bool(claims);stats['judgments_with_meaning_details_absent']+=bool(absent)
  meta=dict(condition=cond,reader=r['reader'],packet_id=r['mapping']['packet_id'],case_id=r['mapping']['case_id'])
  if claims:summary['unsupported_claim_records'].append({**meta,'recorded_claims':claims})
  if absent:summary['meaning_omission_records'].append({**meta,'recorded_absent_details':absent})
 for lang in ['KO','EN']:
  lengths=[m['annotation_length'] for m in maprows if m['condition']==cond and m['language']==lang]
  stats['length_by_language'][lang]={'unit':'characters' if lang=='KO' else 'whitespace_words','n':len(lengths),'min':min(lengths),'max':max(lengths),'median':statistics.median(lengths),'mean':statistics.mean(lengths)}
 summary['conditions'][cond]=stats
 for m in [m for m in maprows if m['condition']==cond]:
  a=next(r['result'] for r in rec if r['reader']=='A' and r['mapping']['packet_id']==m['packet_id']);b=next(r['result'] for r in rec if r['reader']=='B' and r['mapping']['packet_id']==m['packet_id'])
  for q in qs:
   for field,sub in [('answers','answer'),('annotation_checks','rating')]:
    if a[field][q][sub]!=b[field][q][sub]:summary['reader_disagreements'].append({'condition':cond,'packet_id':m['packet_id'],'case_id':m['case_id'],'question':q,'field':field,'A':a[field][q],'B':b[field][q]})
summary['raw_response_provenance']=provenance
assert sha(keypath.read_bytes())==keyhash
(OUT/'reader-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
# Flat preservation of every recorded proposition: useful for auditing arithmetic.
flat=[]
for r in records:
 for q in qs:flat.append({'condition':r['mapping']['condition'],'packet_id':r['mapping']['packet_id'],'case_id':r['mapping']['case_id'],'reader':r['reader'],'question':q,'authored_expected':keys[r['mapping']['case_id']]['expected'][q],**r['result']['answers'][q],'annotation_check':r['result']['annotation_checks'][q]})
(OUT/'reader-propositions.json').write_text(json.dumps(flat,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({c:{'answers':{q:s['answers'] for q,s in summary['conditions'][c]['by_question'].items()},'ratings':{q:s['annotation_ratings'] for q,s in summary['conditions'][c]['by_question'].items()},'unsupported':summary['conditions'][c]['unsupported_claim_items'],'meaning_absent':summary['conditions'][c]['judgments_with_meaning_details_absent']} for c in conditions},indent=2))
print('Mismatches',len(summary['key_mismatches']),'Disagreements',len(summary['reader_disagreements']))

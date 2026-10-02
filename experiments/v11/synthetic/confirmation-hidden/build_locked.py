import json,hashlib,pathlib,datetime,random
H=pathlib.Path(__file__).parent
P=pathlib.Path('/historical-research/journal-v11/protocol')
def sha(s): return hashlib.sha256(s.encode()).hexdigest()
def write(path,obj): path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
rows=[]; keys=[]
for lang in ['KO','EN']:
 source=('도서관 방문 비율은 21%에서 24%로 올라 3% 증가했다. 회의는 금요일에 열린다.' if lang=='KO' else 'Library attendance rose from 21% to 24%, an increase of 3%. The meeting is on Friday.')
 edits=[('3%','3%포인트'),('금요일','토요일')] if lang=='KO' else [('3%','3 percentage points'),('Friday','Saturday')]
 for kind in ['full','normal','partial','dependent', 'preexisting' if lang=='KO' else 'abstain']:
  src=source
  if kind=='normal': src=source.replace(edits[0][0],edits[0][1])
  if kind=='preexisting': src+=' 참석자는 8명과 5명으로 총 14명이다.'
  pp=[]
  for i,(before,after) in enumerate(edits if kind!='normal' else []):
   at=src.index(before); pp.append(dict(id='p'+str(i+1),before=before,after=after,start_byte=len(src[:at].encode()),end_byte=len(src[:at+len(before)].encode())))
  decisions={'p1':'approved','p2':'approved'}
  if kind in ['partial','dependent']: decisions['p2']='rejected'
  if kind=='abstain': decisions={'p1':'unknown','p2':'unknown'}
  applied=[] if kind in ['normal','dependent','abstain'] else ['p1'] if kind=='partial' else ['p1','p2']
  output=src
  for p in sorted(pp,key=lambda p:p['start_byte'],reverse=True):
   if p['id'] in applied:
    b=output.encode(); output=(b[:p['start_byte']]+p['after'].encode()+b[p['end_byte']:]).decode()
  cid=sha('v11-authored-control:'+lang+':'+kind)[:12]
  evidence=[{'id':'E1','type':'authored_scenario','text':'The scenario stipulates the endpoints 21% and 24%. Their difference is 3 percentage points. No real-world library data are asserted.'},{'id':'E2','type':'authored_scenario','text':'The fictional meeting schedule says Saturday. The review decision is independently stipulated and is not world-truth evidence.'}]
  if kind=='normal': evidence[1]['text']='The fictional meeting schedule says Friday. The source already satisfies the stated checks.'
  if kind=='preexisting': evidence.append({'id':'E3','type':'authored_scenario','text':'The unchanged sentence gives two disjoint counts, 8 and 5, and an incorrect total of 14. Neither proposed patch touches this sentence.'})
  evidence.append({'id':'E4','type':'scope','text':'No external publication action occurred. The scenario does not establish the overall factual accuracy of the article or any real-world facts.'})
  memo=('검토안은 증가 폭의 단위와 회의 요일을 다룬다. 수치 차이는 3%포인트이며 일정 자료는 토요일을 가리킨다. 외부 사실 확인과 게시 여부는 별도의 문제다.' if lang=='KO' else 'The review addresses the increase unit and meeting day. The numerical difference is 3 percentage points, and the schedule points to Saturday. External fact verification and publication are separate matters.')
  if kind=='normal': memo='제시된 검토 범위에서 문구를 바꿀 이유를 찾지 못했다.' if lang=='KO' else 'I found no reason to change the wording within the supplied review scope.'
  components=[['p1','p2']] if kind=='dependent' else [[p['id']] for p in pp]
  receipt=dict(schema='authored-actual-receipt-v1',source_sha256=sha(src),output_sha256=sha(output),applied_ids=applied,excluded_ids=[p['id'] for p in pp if p['id'] not in applied],external_published=False,receipt_scope='completed local output bytes only',patch_outcomes={p['id']:('applied' if p['id'] in applied else 'held' if kind=='abstain' else 'rolledback') for p in pp})
  row=dict(case_id=cid,language=lang,provenance='entirely authored synthetic scenario; not a model output or factual article',source=src,proposed_patches=pp,review_decisions={p['id']:decisions[p['id']] for p in pp},dependency_components=components,actual_output=output,actual_applied_receipt=receipt,evidence=evidence,semantic_facts=dict(overall_world_truth='unknown',supplied_arithmetic='correct' if kind!='preexisting' else 'unrelated_total_incorrect',meaning_resolution='unresolved' if kind in ['partial','dependent','preexisting','abstain'] else 'resolved_within_supplied_checks',external_facts='unknown'),authored_free_memo_comparator=dict(text=memo,provenance='plausible authored review memo; never generated model output',stage='review proposal; not bound to final artifact'))
  rows.append(row)
  keys.append(dict(case_id=cid,private_kind=kind,expected=dict(applied_local='yes' if applied else 'no',unchanged='yes' if src==output else 'no',allproposed_applied='not_applicable' if not pp else 'yes' if len(applied)==len(pp) else 'no',verifiedcorrect='unknown',externalpublished='no',unresolvedmeaning='yes' if kind in ['partial','dependent','preexisting','abstain'] else 'no'),expected_applied_ids=applied,one_factor_parent_kind='partial' if kind=='dependent' else 'full' if kind in ['partial','preexisting','abstain'] else None,changed_input_factor={'dependent':'dependency grouping only (output/receipt mechanically follow)','partial':'p2 review approval becomes rejection (output/receipt mechanically follow)','preexisting':'one unrelated preexisting arithmetic-error sentence added','abstain':'review-certainty field changes both patch decisions to unknown (output/receipt follow)','normal':'separate normal no-edit control','full':'baseline'}[kind]))
write(H/'cases.json',rows);write(H/'expected-private.json',keys)
# Mechanical failures mutate existing cases only; they are not extra underlying semantic cases.
mechanical=[]
for lang in ['KO','EN']:
 row=next(r for r,k in zip(rows,keys) if r['language']==lang and k['private_kind']=='full')
 for typ in ['corrupt_output','stale_receipt','partial_write']:
  mechanical.append(dict(case_id=row['case_id'],failure=typ,mutation={'corrupt_output':'append U+0021 to actual_output after receipt issuance','stale_receipt':'replace receipt output_sha256 by the source_sha256 while retaining full-output bytes','partial_write':'retain only p1 after-bytes in actual_output while keeping the full-output receipt'}[typ],expected_verification='reject',expected_release='hold',do_not_count_as_additional_underlying_case=True))
write(H/'mechanical-private.json',mechanical)
# Opaque seeded orders, never labels exposed to readers.
rng=random.Random(781107); order=[]
for row in rows:
 for condition in ['authored_free_memo','receipt_annotation']:
  order.append(dict(packet_id=sha(row['case_id']+condition+'order-v11')[:20],case_id=row['case_id'],private_condition=condition))
rng.shuffle(order); write(H/'reader-map-private.json',order)
print('Created',len(rows),'underlying cases; 5 KO / 5 EN; 6 mechanical mutations; 20 planned opaque packets')

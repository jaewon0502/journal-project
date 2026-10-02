"""Read-only input analysis; regenerates quote-free supplementary ledgers only."""
from pathlib import Path
from datetime import datetime
import json,re,hashlib,collections
B=Path('/historical-research/journal-v12'); P=Path('/historical-research/journal-v12-private/supplementary/scope'); O=B/'supplementary/scope'
def read(p):return json.loads(p.read_text())
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def strings(v):
 if isinstance(v,str):return [v]
 if isinstance(v,list):return sum((strings(x) for x in v),[])
 if isinstance(v,dict):return sum((strings(x) for x in v.values()),[])
 return []
def ids(v):return sorted(set(re.findall(r'EN-DEV-[AS]-P\d{3}',json.dumps(v,ensure_ascii=False))))
def timestamp(s):return datetime.fromisoformat(s.replace(' UTC','+00:00').replace('Z','+00:00'))
def lengths(x,raw):
 n=[]
 for z in x['findings']:n+=strings({k:z[k] for k in ['description','materiality','status','limits'] if k in z})
 for z in x['patches']:n+=strings({k:z[k] for k in ['after','justification'] if k in z})
 for z in x['question_answers']:n+=strings({k:z[k] for k in ['answer','remaining_unknown'] if k in z})
 n+=strings(x.get('unanswered_scope',[]))+strings(x.get('no_change_reason',''))+strings(x.get('declared_limits',[]))
 s='\n'.join(n)
 return dict(total_json_characters=len(raw),total_json_whitespace_words=len(raw.split()),narrative_characters=len(s),narrative_whitespace_words=len(s.split()),requested_cap=900,exceeds_requested_cap=len(s.split())>900)
rows=read(P/'review-map.json'); ins=[read(P/'writer-inputs'/f"{r['input_id']}.json") for r in rows]
checks=[]
for lock in ['hash-lock.json','reviewer-instruction-lock.json']:
 for f in read(O/lock).get('files',[]):
  path=Path('/workspace')/f['path'];checks.append(dict(path=f['path'],matches=digest(path)==f['sha256']))
checks.append({'path':'journal-v12/supplementary/scope/reviewer-instruction.md','matches':digest(O/'reviewer-instruction.md')==read(O/'reviewer-instruction-lock.json')['sha256']})
base=ins[0]; invariant=[k for k in base if k not in ['input_id','primary_evidence','evidence_scope']]
assert all(all(x[k]==base[k] for k in invariant) for x in ins)
old=base['primary_evidence'][0]['paragraphs']
assert all(x['primary_evidence'][0]['paragraphs'][:len(old)]==old for x in ins)
notes={
'OLD-1':['원 기사 저구간 유지; 정확한 하한은 허용 자료로 독립 검증 불가. 수치 미교정을 실패로 취급하지 않음.','저–중 정성적 순서 보존. 직접 쌍대 유의성이나 수치 차이 주장은 없음.','tau·인지와 amyloid 결과 구분. 기능 결과의 추가는 의무 아님.','기저 amyloid 조건 추가; 추적 중 축적 결과와 구분.','도입부를 포함해 주요 인과 표현 수정. 두 평가자 모두 정당한 변경 판정.','저자 귀속과 가능성 표현 유지; 독립적인 tracker 효능 검증은 아님.'],
'EXPANDED-1':['허용 자료로 저구간 하한 3,000→3,001 교정; tau·인지 연결도 유지.','저–중 정성적 순서 유지; 비활동군 대비를 별도로 제시. 직접 쌍대 검정으로 강화하지 않음.','tau·인지·기능 간 효과량/유의성 전이 없음. 기능 상세는 선택적.','기저 amyloid 조건 추가; 조건의 배타적 적용 대상이라는 주장 아님.','본문의 인과 표현 교정; 도입부의 질병 진행 억제/충분성/손쉬운 개입 함의 잔존. 두 평가자는 정당한 변경으로 분류하면서 이 잔존 위험을 명시.','귀속 및 가능성 보존; 자료의 침묵을 반박으로 해석하지 않음.'],
'EXPANDED-2':['저구간 하한 3,001로 근거 있는 교정; 연관된 tau·인지 결과 유지.','저–중 정성적 순서와 비활동군 기준 분리 유지. 직접 쌍대 유의성 주장 없음.','결과별 구분 유지; 기능의 비유의성을 tau나 인지로 전이하지 않음.','기저 amyloid 조건 추가; 저구간은 앞 문단의 조건을 문맥상 이어받음.','본문 수정은 지지되나 제목과 도입부의 개입 함의 잔존. 양 평가자 모두 부분 교정 판정.','저자 귀속/가능성 보존; 측정 근거를 tracker 개입 효과로 바꾸지 않음.'],
'OLD-2':['원 기사의 저구간임을 한정해 유지; 하한 미검증은 실패 아님. 결과 연결은 앞 문단을 통한 암묵적 보존.','저–중 정성적 관계 보존; 직접 쌍대 유의성으로 강화하지 않음.','결과 간 효과량/유의성 전이 없음. 도입부 단백질 표현은 덜 구체적.','본문에 기저 amyloid 조건 추가; 도입부는 덜 한정됨.','대부분 인과 표현 교정하나 도입부의 걷기 개입 효과 함의 잔존. 양 평가자 부분 교정.','귀속 및 가능성 그대로 보존; 독립 검증되지 않은 기사 보고로 유지 가능.']}
result={'module':'v12-supplementary-scope','status':'completed_analysis_only','main_v12_scores_changed':False,'design':{'case':'EN-DEV exposed targeted regression diagnostic','method':'frozen B-v2','conditions':{'OLD':2,'EXPANDED':2},'same_article_and_procedure_fields':True,'compared_invariant_fields':invariant,'old_evidence_prefix_exact':True,'sole_intended_manipulation':'allowable evidence scope and truthful provenance metadata','primary_paragraphs':{'OLD':19,'EXPANDED':62},'input_bytes':{'OLD':30632,'EXPANDED':64713},'launch_order':['OLD-1','EXPANDED-1','EXPANDED-2','OLD-2'],'execution_intervals_overlap':True,'runtime_model_effort':'inherited per all four records; exact identities/settings unavailable, equality not independently established','version_seed_cost':'unknown','limitations':['one exposed case, two repeats per condition','evidence informativeness and input length/attention confounded','stochastic variation not identifiable separately with four outputs','not fresh discovery, no statistical significance or general guarantee']},'lock_checks':checks,'length_policy':'Identical field selection to code/output_lengths.py: findings description/materiality/status/limits; patches after/justification; question answers answer/remaining_unknown; unanswered_scope/no_change_reason/declared_limits. Nested string values joined with newline. Excludes before, anchors, IDs and keys; all replacement after text counts. No rerun/truncation or new success threshold.','timing_policy':'Clock-recorded writer task end minus start, seconds; not API latency, token throughput or cost. Clock precision is seconds. Overlapping task times must not be summed as experiment wall time.','runs':[]}
private=[]
for r,x in zip(rows,ins):
 key=f"{r['condition']}-{r['repeat']}"; wf=P/'writer-results'/f"{r['input_id']}.json";w=read(wf);m=read(wf.with_suffix('.meta.json'));start=m.get('started_at_utc',m.get('start_utc'));end=m.get('ended_at_utc',m.get('end_utc'))
 rr={k:r[k] for k in ['run_order','input_id','condition','repeat','packet_id','application_status','patches','writer_sha256','candidate_sha256']};rr.update(label=key,writer_hash_verified=digest(wf)==r['writer_sha256'],task_clock={'start_utc':start,'end_utc':end,'elapsed_seconds':(timestamp(end)-timestamp(start)).total_seconds(),'clock_source':m.get('clock_source','not specified in sidecar; recorded UTC start/end'),'api_latency':None,'cost':None},output_lengths=lengths(w,wf.read_text()),finding_count=len(w['findings']),question_answer_ids=[a['question_id'] for a in w['question_answers']],finding_patch_links=[{'patch_id':p['id'],'finding_ids':p.get('finding_ids',[])} for p in w['patches']],analysis_notes_by_dimension=notes[key],judges={})
 for j in ['A','B']:
  f=P/'reviewer-results'/f"{j}__{r['packet_id']}.json";v=read(f);private.append({'run':key,'judge':j,'review':v})
  dims=[]
  for d,n in zip(v['dimensions'],notes[key]):
   z={k:d[k] for k in ['dimension','patch_ids','preservation','new_claim_support']};z.update(original_span_ids=ids(d['article_anchor']),allowed_source_receipt_ids=ids(d['allowed_source_receipts']),candidate_anchor_present=bool(d.get('candidate_anchor')),analyst_quote_free_rationale=n);dims.append(z)
  rr['judges'][j]={'review_sha256':digest(f),'complete':v.get('complete'),'read_complete':v.get('read_complete'),'dimensions':dims,'patch_assessments':[{k:a[k] for k in ['patch_id','warranted','collateral_loss','unsupported_strengthening','unnecessary_edit','supported_repair']} for a in v['patch_assessments']],'additional_detail_capability':[{k:a[k] for k in ['named_detail','present_in_allowed_source','used_in_candidate','candidate_supported']} for a in v['additional_detail_capability']],'inspected_paragraph_ids':v['inspected_paragraph_ids'],'relation_pair_count':len(v['relation_pairs'])}
 rr['categorical_disagreements']=[]
 for a,b in zip(rr['judges']['A']['dimensions'],rr['judges']['B']['dimensions']):
  fields={k:{'A':a[k],'B':b[k]} for k in ['preservation','new_claim_support','patch_ids'] if a[k]!=b[k]}
  if fields:rr['categorical_disagreements'].append({'dimension':a['dimension'],'fields':fields})
 for a,b in zip(rr['judges']['A']['patch_assessments'],rr['judges']['B']['patch_assessments']):
  assert a['patch_id']==b['patch_id'];fields={k:{'A':a[k],'B':b[k]} for k in a if a[k]!=b[k]}
  if fields:rr['categorical_disagreements'].append({'patch_id':a['patch_id'],'fields':fields})
 result['runs'].append(rr)
result['condition_counts_by_judge']={}
for cond in ['OLD','EXPANDED']:
 result['condition_counts_by_judge'][cond]={}
 for j in ['A','B']:
  rs=[r for r in result['runs'] if r['condition']==cond]
  result['condition_counts_by_judge'][cond][j]={d:{field:dict(collections.Counter(next(z for z in r['judges'][j]['dimensions'] if z['dimension']==d)[field] for r in rs)) for field in ['preservation','new_claim_support']} for d in [z['dimension'] for z in rs[0]['judges'][j]['dimensions']]}
result['descriptive_common_and_extra_evidence_counts']={'denominator_per_condition':2,'supported_exact_low_boundary_correction':{'OLD':{'count':None,'status':'unavailable/not assessed, not failure'},'EXPANDED':2},'low_vs_moderate_qualitative_relation_retained':{'OLD':2,'EXPANDED':2},'endpoint_effect_or_significance_transfer_detected':{'OLD':0,'EXPANDED':0},'baseline_amyloid_condition_added':{'OLD':2,'EXPANDED':2},'tracker_attribution_and_possible_modality_retained':{'OLD':2,'EXPANDED':2},'analyst_residual_opening_causal_framing':{'OLD':1,'EXPANDED':2},'new_patch_unsupported_strengthening_flag':{'OLD':{'A':0,'B':1},'EXPANDED':{'A':0,'B':0}},'note':'Descriptive separate dimensions, not aggregate success score. Residual opening assessment includes EXPANDED-1 despite both reviewers classifying causal_status as justified_change.'}
result['material_disagreements_and_limits']=['OLD-1 P7: A supported repair yes/no strengthening; B partial repair/yes strengthening due to generalizability possibility becoming definite. Keep both; tracker modality itself retained.','EXPANDED-1 both judges mention residual opening but classify causal status justified_change; EXPANDED-2 both classify partial despite a closely related residual. Preserve categorization and narrative concern separately.','OLD-1 and OLD-2 writer REFUTED status language overstates unestablished causality as disproof; candidate article judgments do not erase writer finding-level concern.','Some preservation versus justified_change and support labels differ even when both identify retained relation; no majority adjudication.','Exact low range absent from OLD cannot enter a failure denominator. Optional newly available details omitted from candidate are not automatic errors.']
result['coverage_notes']={'OLD-1':'5 findings and Q1–Q3 answers address causality, amyloid condition, baseline-only measurement, tau subset and selection. No exact low-bound verification claimed.', 'EXPANDED-1':'6 findings and Q1–Q3 answers address inactive reference, category boundaries/plateau, outcome and follow-up scope. Q3 explicitly distinguishes nonsignificant low-category functional comparison; functional result is not added to article.', 'EXPANDED-2':'6 findings and Q1–Q3 answers retain low/moderate ordering, inactive reference and scope limits; exact low boundary appears in patch. Sensitivity analysis language does not establish causation.', 'OLD-2':'5 findings and Q1–Q3 answers address causality, amyloid, exposure timing, imaging subsets and selection. Detailed article patch carries low/moderate relation implicitly; lead remains uncorrected.'}
(O/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(P/'analysis-evidence-summary.json').write_text(json.dumps({'reviews_preserved_without_adjudication':private,'public_output':str(O/'results.json')},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'locks':checks,'runs':[{k:r[k] for k in ['label','task_clock','output_lengths']} for r in result['runs']]},ensure_ascii=False,indent=2))

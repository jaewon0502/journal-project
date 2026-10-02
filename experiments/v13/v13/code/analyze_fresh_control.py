"""Replay the frozen single fresh case; no generation, criteria changes, or core writes."""
import datetime, hashlib, importlib.util, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PRIVATE=ROOT.parent/'journal-v13-private'/'fresh-control'
def read(path): return json.loads(path.read_text())
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def sha(text): return hashlib.sha256(text.encode()).hexdigest()
def clean(text): return re.sub(r'cite\d+†(.*?)',lambda m:m.group(1).split('†')[0].replace(', opens new tab',''),text).strip()
def lines(name): return {int(n):clean(t) for n,t in re.findall(r'(?:^|[ \n])L(\d+): ?(.*?)(?=(?:[ \n]L\d+:)|\Z)',read(PRIVATE/name),re.S)}
def main():
 checks={}; detail={}
 def check(name,value): checks[name]=bool(value)
 packet=read(PRIVATE/'source-packet.json'); writer=read(PRIVATE/'writer-output.json'); ref=read(PRIVATE/'source-first-reference.json'); bundle=read(PRIVATE/'bundle.json')
 locks={n:read(ROOT/'protocol'/f'fresh-control-{n}-lock.json') for n in ['source','writer','reference','review','audit']}
 for name,entry in locks['source']['files'].items(): check('source_file_hash:'+name,digest(PRIVATE/name)==entry['sha256'] and (PRIVATE/name).stat().st_size==entry['bytes'])
 for name,h in locks['review']['files'].items(): check('pre_review_file_hash:'+name,digest(PRIVATE/name)==h)
 check('writer_input_lock',digest(PRIVATE/'writer-input.json')==locks['writer']['writer_input_sha256'])
 check('writer_source_lock',digest(PRIVATE/'source-packet.json')==locks['writer']['source_packet_sha256'])
 check('reference_hash_lock',digest(PRIVATE/'source-first-reference.json')==locks['reference']['source_first_reference_sha256'])
 check('reference_frozen_before_output_lock',locks['reference']['writer_output_exists'] is False and locks['source']['locked_at']<locks['writer']['created_utc']<locks['reference']['created_utc']<locks['review']['created_utc'])
 freeze=read(ROOT/'protocol/FREEZE_GATE.json')
 for name in ['code/gate.py','protocol/REVIEW_SCHEMA.json','protocol/REVIEW_INSTRUCTIONS.md','protocol/PREREGISTRATION.md']: check('frozen:'+name,digest(ROOT/name)==freeze['files'][name])
 for line in (ROOT/'protocol/initial-lock.sha256').read_text().splitlines():
  h,name=line.split(maxsplit=1);check('initial:'+Path(name).name,digest(Path(name))==h)
 for line in (ROOT/'protocol/fresh-control-addendum-lock.sha256').read_text().splitlines():
  h,name=line.split(maxsplit=1);check('addendum_hash_frozen',digest(Path(name))==h)
 # Read the saved snapshots only; never reacquire or re-run the packet builder.
 r,n=lines('reuters-web-raw.json'),lines('nasa-web-raw.json'); meta=packet['metadata']; article='\n\n'.join(r[i] for i in meta['article']['included_snapshot_lines']); pars=packet['source_documents'][0]['paragraphs']; ids=[x['id'] for x in pars]
 check('article_exact_saved_direct_page_reconstruction',article==packet['original_article'])
 check('source_exact_saved_direct_page_reconstruction',all(x['text']==n[x['snapshot_line']] for x in pars))
 check('article_saved_text_exact',(PRIVATE/'reuters-full-article.txt').read_text()==article+'\n')
 check('source_saved_text_exact',(PRIVATE/'nasa-full-release.txt').read_text()=='\n\n'.join(x['text'] for x in pars)+'\n')
 check('article_body_count_18',len(meta['article']['article_body_lines'])==18)
 check('source_paragraph_count_38',len(pars)==38 and len(set(ids))==38)
 check('source_update_metadata_saved',n[301]=='Feb 03, 2025' and meta['primary']['updated_date']=='2025-02-03')
 detail['excluded_editorial_boundary_lines']={key:[{'line':i,'text':ls.get(i,'')} for i in range(lo,hi+1) if i not in included] for key,ls,lo,hi,included in [('article',r,151,192,meta['article']['included_snapshot_lines']),('source',n,244,294,meta['primary']['included_snapshot_lines'])]}
 detail['blank_source_id_035']={'snapshot_line':290,'text':n.get(290),'note':'Empty line omitted; IDs retain extraction enumeration.'}
 check('source_missing_id_is_blank', 'BENNU-P1-035' not in ids and n.get(290)=='')
 wi=read(PRIVATE/'writer-input.json'); corekeys=['bundle_id','source_documents','original_article','questions','source_scope_note']
 check('writer_input_exact_packet_fields',all(wi[k]==packet[k] for k in corekeys))
 check('writer_no_reference_or_gate_fields',set(wi)==set(corekeys+['instruction']))
 check('writer_and_bundle_single_raw_patch',len(writer['patches'])==1 and bundle['proposed_patches']==writer['patches'])
 check('bundle_packet_fields_unchanged',all(bundle[k]==packet[k] for k in corekeys))
 check('writer_read_coverage',writer['read_complete'] and writer['original_read_complete'] and writer['read_source_paragraph_ids']==ids)
 check('reference_read_coverage',ref['read_complete'] and ref['paragraph_ids_read']['official_source']==ids and len(ref['paragraph_ids_read']['article'])==27)
 check('reference_18_provisional_items',len(ref['must_preserve_provisional'])==18)
 spec=importlib.util.spec_from_file_location('fresh_gate',ROOT/'code/gate.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
 raw=(PRIVATE/'bundle.json').read_bytes(); reviews=[read(PRIVATE/f'review-{x}.json') for x in ['A','B']]; positions,errors=gate.spans(bundle)
 check('unique_nonoverlapping_application',not errors and len(positions)==1)
 expected=gate.binding(bundle,raw); docs=gate.documents(bundle)
 for label,review in zip(['A','B'],reviews):
  errs=gate.validate_review(review,expected,['P1'],docs);check('review_'+label+'_valid',not errs and review['complete'] and review['read_complete']);detail['review_'+label+'_errors']=errs
 ri=read(PRIVATE/'review-input.json'); check('review_input_frozen_instructions',ri['review_instructions']==(ROOT/'protocol/REVIEW_INSTRUCTIONS.md').read_text() and ri['review_schema']==read(ROOT/'protocol/REVIEW_SCHEMA.json'))
 check('review_input_full_candidate',ri['full_candidate']==gate.apply(article,['P1'],positions))
 replay=gate.evaluate(bundle,raw,reviews);saved=read(PRIVATE/'gate-output.json');check('gate_output_exact_replay',replay==saved)
 amap=read(PRIVATE/'audit-map.json');outcomes={}; audits={}
 for entry in locks['audit']['audits']:
  aid=entry['audit_id'];inp=read(PRIVATE/'audit-inputs'/f'{aid}.json');a=read(PRIVATE/'audit-results'/f'{aid}.json');audits[aid]=a
  check('audit_input_lock:'+aid,digest(PRIVATE/'audit-inputs'/f'{aid}.json')==entry['input_sha256'] and sha(inp['candidate_article'])==entry['candidate_sha256'])
  check('audit_instruction:'+aid,inp['instruction']==(ROOT/'protocol/final-audit-instruction.md').read_text())
  check('audit_read_coverage:'+aid,a['complete'] and a['read_complete'] and a['original_paragraphs_read'] and a['read_source_paragraph_ids']==ids)
  for c in a['changes']:
   check('changed_source_anchors:'+aid,all(x['paragraph_id'] in docs and x['text'] in docs[x['paragraph_id']] for x in c['source_anchors']))
   check('changed_text_actual:'+aid,c['before'] in article and c['after'] in inp['candidate_article'] and article.replace(c['before'],c['after'],1)==inp['candidate_article'])
   check('changed_context_anchors:'+aid,all(x in article for x in c['original_anchors']) and all(x in inp['candidate_article'] for x in c['candidate_anchors']))
 for m in amap['mapping']:
  name=m['gate'];a=audits[m['audit_id']];g=saved['results'][name];check('audit_gate_candidate:'+name,sha(read(PRIVATE/'audit-inputs'/f"{m['audit_id']}.json")['candidate_article'])==g['delivered_sha256'])
  outcomes[name]={'proposal_count':1,'accepted_ids':g['accepted_ids'],'held_ids':g['held_ids'],'gate_status':g['status'],'final_audit_complete':a['complete'],'final_audit_safety':a['full_context_safety'],'release_recommendation':a['release_recommendation'],'normal_noop':a['normal_noop'],'delivered_changed_span_count':len(a['changes']),'source_supported_warranted_corrections':sum(c['warranted']=='yes' and c['evidence_support']=='yes' for c in a['changes']),'introduced_material_harms':sum(c['introduced_material_harm']=='yes' for c in a['changes']),'unmet_required_answers_reported':a['unmet_required_answers'],'delivered_sha256':g['delivered_sha256'],'audit_id':m['audit_id']}
 detail['actual_changes']={aid:a['changes'] for aid,a in audits.items()};detail['gate_hold_reasons']={k:v['bundle_reasons'] for k,v in saved['results'].items()}
 coverage={}
 for f in sorted(PRIVATE.glob('coverage-*.json')):
  if f.name.startswith('coverage-input'):continue
  coverage[f.name]=read(f)
 coverage_public={}
 article_docs={x['paragraph_id']:article.split('\n\n')[x['packet_string_block_index']] for x in ref['article_paragraph_map']}
 all_docs={**docs,**article_docs}
 for m in amap['mapping']:
  aid=m['audit_id'];f=PRIVATE/f'coverage-result-{aid}.json'
  if not f.exists():continue
  c=read(f);ci=read(PRIVATE/f'coverage-input-{aid}.json');ai=read(PRIVATE/'audit-inputs'/f'{aid}.json')
  check('coverage_input_candidate_and_reference:'+aid,all(ci[k]==ai[k] for k in ['audit_id','source_documents','source_scope_note','original_article','reader_questions','candidate_article']) and ci['provisional_source_first_reference']==ref)
  check('coverage_complete_18_plus_3:'+aid,c['complete'] and c['read_complete'] and [x['id'] for x in c['item_assessments']]==[x['id'] for x in ref['must_preserve_provisional']] and [x['id'] for x in c['qualification_assessments']]==['C01','C02','C03'])
  anchor_errors=[]
  for item in c['item_assessments']+c['qualification_assessments']:
   for anchor in item.get('exact_short_source_anchors',[]):
    if anchor['paragraph_id'] not in all_docs or anchor.get('exact_short_anchor',anchor.get('text','')) not in all_docs[anchor['paragraph_id']]:anchor_errors.append(item['id']+':source')
   for anchor in item.get('exact_short_candidate_anchors',[]):
    text=anchor if isinstance(anchor,str) else anchor.get('exact_short_anchor',anchor.get('text',''))
    if text not in ci['candidate_article']:anchor_errors.append(item['id']+':candidate')
  check('coverage_exact_anchors:'+aid,not anchor_errors);detail['coverage_anchor_errors:'+aid]=anchor_errors
  coverage_public[m['gate']]={'audit_id':aid,'complete':c['complete'],'input_sha256':digest(PRIVATE/f'coverage-input-{aid}.json'),'result_sha256':digest(f),'items':[{k:i[k] for k in ['id','requiredness','candidate_presence','source_support']} for i in c['item_assessments']],'qualifications':[{k:i[k] for k in ['id','status']} for i in c['qualification_assessments']]}
 detail['coverage_audits']=coverage
 result={'generated_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'fresh_control_only','fresh_cases':1,'actual_writer_runs':1,'actual_writer_proposals':1,'core_bundles_unchanged':8,'core_proposals_unchanged':27,'checks':checks,'all_mechanical_checks_pass':all(checks.values()),'outcomes':outcomes,'secondary_coverage_status':'complete' if len(coverage)==2 else 'pending','secondary_coverage_count':len(coverage),'reference_is_gold':False,'reference_provisional_items':18,'requiredness_dispute':{'item':'C02','source_first_reference':'nucleobase clarification required if explanatory sentence retained','final_audits':'unchanged imprecision mitigated by explicit no DNA/RNA; no unmet required answers reported','conclusion':'unresolved; safe edit does not establish correction completeness'},'source_urls':{'article':meta['article']['url'],'official_summary':meta['primary']['url']},'dates':{k:meta[k] for k in []},'limitations':['One purposive fresh case and one proposal; no generalization or pooled score.','Official NASA summary only; neither complete papers nor independent scientific verification.','NASA update 2025-02-03 follows Reuters publication 2025-01-29; no contemporaneous fault inference.','Full supplied-paragraph read attestations do not prove exhaustive semantic coverage.','Reference is provisional, not gold; C02 requiredness disagreement remains.']}
 result['dates']={'article_publication':'2025-01-29T16:08:00Z','article_update':'2025-01-29','NASA_publication':'2025-01-29','NASA_update':'2025-02-03','snapshot_collection':'2026-10-02'}
 result['secondary_coverage']=coverage_public
 (ROOT/'results/fresh-control.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');detail['checks']=checks;(PRIVATE/'analysis-evidence.json').write_text(json.dumps(detail,ensure_ascii=False,indent=2)+'\n')
 (PRIVATE/'analysis-evidence.json').chmod(0o600)
 report=f'''# 새 Bennu 통제 사례: 동결 자료 기반 결과

기존 8번들·27제안 결과와 분리한 **새 실제 사례 1건, 작성기 실제 실행 1회, 원시 제안 1개**다. 자료를 먼저 동결하고 작성기 출력 전에 출처 우선 잠정 참조를 기록했다. 같은 제안과 두 위험 검토에 기존 G0/G1 코드·스키마·지침을 그대로 적용했다. 기준 조정이나 재생성은 하지 않았다. 외부 매체에 게시하거나 배포한 결과가 아니라, 저장된 검사 대상 후보문을 평가한 결과다.

| 항목 | G0 | G1 |
|---|---|---|
| 제안 P1 | 보류 | 수용 |
| 검사 대상 후보문 | 원문 유지 | 광물 신규성의 범위를 일부로 한정 |
| 최종 감사 | 원문 대비 안전 판정 | 원문 대비 안전 판정 |
| 후보에 반영된 근거 있는 교정 | 0 | 1 |
| 감사에서 확인된 새 중대한 해 | 0 | 0 |

G0는 두 검토에 남은 배경 쟁점 때문에 전체를 보류했다. G1은 후속 출처 갱신의 시간 제약을 해당 제안의 비중대한 한계로, 원문 고유의 역사·인용 검증 공백을 편집과 무관한 쟁점으로 분류한 동일 검토를 적용해 P1을 통과시켰다. G0 최종 감사의 안전 판정은 원문 대비 새 손상이 없다는 뜻이며, 원문 정확성이나 교정 완료를 보증하지 않는다.

교정은 “Some of”를 넣어 광물 전부가 처음 검출되었다는 독해를 좁혔다. [NASA 공식 발표]({meta['primary']['url']})는 이전에 검출된 증발암 광물, 증발 과정을 보존한 완전한 집합의 신규성, 일부 개별 광물의 첫 외계 시료 검출을 구분한다. G1 문장은 일부 광물의 신규성을 뒷받침하지만, 완전한 집합의 별도 신규성을 추가 설명하지 않는다. 이는 기존에 없던 상세 설명이며 편집으로 생긴 손실은 아니다. [Reuters 기사]({meta['article']['url']})의 의도한 지시 대상이나 당시 취재 잘못을 이 기록만으로 단정하지 않는다.

기계 검증은 **{'통과' if all(checks.values()) else '실패'}**했다. 저장한 직접 페이지 출력과 기사 18개 본문 문단·공식 발표 38개 공급 문단을 재구성해 대조했고, 원문·출처·작성기·참조·검토 입력·감사 입력 해시, 유일한 교정 위치, 두 위험 검토의 스키마와 근거 앵커, 게이트 출력의 정확한 재실행 일치, 두 최종 감사의 읽기 목록 및 실제 변경·출처 앵커를 확인했다. 출처 ID 035는 저장 페이지의 빈 줄에 해당한다. 작성기·잠정 참조·최종 감사의 38문단 읽기 목록은 모두 일치한다. 위험 검토는 동결 스키마에 따른 전체 읽기 선언이며 별도 문단별 목록은 요구하지 않았다. 이러한 선언은 의미를 빠짐없이 이해했다는 증명은 아니다.

**C02의 필수성 이견은 미해결이다.** 작성기 전 잠정 참조는 핵염기를 유전정보를 저장하는 더 큰 DNA/RNA 분자의 구성 요소로 명료화해야 한다고 판단했다. 작성기는 이를 교정하지 않았다. 두 최종 감사는 기존 부정확성이 남았다고 보면서도, 실제 DNA/RNA를 발견하지 않았다는 후속 문장이 오해를 완화한다며 필수 독자 답변 미충족을 보고하지 않았다. 잠정 참조는 정답표가 아니지만 이 차이는 교정 완결성 주장에 영향을 준다. 안전한 교정 1개가 필요 교정 전부를 발견했다는 뜻은 아니다. 종합 점수나 참조 일치율을 만들지 않는다.

18개 작성기 전 잠정 보존 항목에 대한 별도 이차 감사: **{result['secondary_coverage_status']}**. 이 감사는 기존 두 최종 감사와 구분하며 게이트나 원래 판정을 소급 변경하지 않는다.

범위·수집 한계: Reuters 발행은 2025-01-29 16:08 UTC, 표시된 갱신일은 같은 날이다. NASA 발행은 2025-01-29, 최종 갱신은 2025-02-03이며 현재 저장본 수집일은 2026-10-02다. 공급 문서 전체라는 말은 공식 요약 전체를 뜻하고, 논문 두 편·부록·원자료 전체 또는 독립 과학 검증을 뜻하지 않는다. 이미지·영상의 픽셀이나 음성은 공급하지 않았고 표시된 캡션은 포함했다. 최초 후보 ScienceAlert의 연구자 설명문은 제외했다. Reuters 일반 HTTP 경로는 401이었으나 직접 페이지 도구는 본문과 말미 취재·편집 표기까지 반환했다. 인증 우회나 검색 요약 대체는 없었다. 전체 원문과 긴 근거는 비공개로 보존한다.
'''
 topics=['시료·임무·화학 성분 발견','채취와 지구 귀환의 구분','두 분석의 발표·학술지','아미노산·핵염기 수와 생물학적 집합','구성 요소와 DNA/RNA 비검출','증발 염수의 과거 환경','지구 생명 원료 공급 가설','지구 밖 생명의 가능성','이전 검출·오염·직접 채취','Glavin의 신뢰 발언과 귀속','모천체와 현재 Bennu의 연대 구분','모천체 크기·파괴 시기의 불확실성','얼음 용융과 염수의 역사적 추론','McCoy의 가능한 전생물 화학 해석','단순 성분과 살아 있는 체계의 차이','Dworkin의 유기화학 맥락 발언','화학 성분과 더 큰 생물 분자의 관계','초기 태양계 충돌·전달 맥락']
 translate={'agree':'동의','challenge':'필수 포함 이의','covered':'의미 포함','supported':'뒷받침','partial':'부분 뒷받침'}
 if len(coverage_public)==2:
  report+='\n## 이차 항목별 진단\n\n각 칸은 필수성 / 후보문 내 의미 존재 / 공식 출처 뒷받침 순서다. 부분 뒷받침은 NASA가 Reuters 고유의 세부사항·인용을 독립 확인하지 못한다는 뜻으로, 거짓 판정이 아니다. 필수 포함 이의는 모든 세부의 무조건 포함에 대한 이의이며, 남겨 둔 진술의 조건·귀속을 지워도 된다는 뜻이 아니다. 항목 수를 정확도나 종합점수로 환산하지 않는다.\n\n| ID | 잠정 보존 의미 | G0 후보 감사 | G1 후보 감사 |\n|---|---|---|---|\n'
  for index,topic in enumerate(topics):
   cells=[' / '.join(translate[coverage_public[g]['items'][index][k]] for k in ['requiredness','candidate_presence','source_support']) for g in ['G0','G1']]
   report+=f'| R{index+1:02} | {topic} | {cells[0]} | {cells[1]} |\n'
  report+='\nR10·R12·R16·R18은 두 감사 모두 개별 발언·세부 역사를 무조건 포함해야 한다는 해석에 이의를 제기했다. R17은 G0 감사가 상세 설명 전체의 필수성에 이의를 제기하고, G1 감사는 핵심 분자 구분의 필수성에 동의하되 특정 설명 문구는 필수가 아니라고 한 차이가 있다. R07은 G0 감사가 증거의 비교 우위까지 포함해 부분 뒷받침으로, G1 감사는 가설 지지 자체를 뒷받침으로 기록했다. G1 감사도 비교 순위의 독립 입증은 인정하지 않았다. 이 차이를 임의로 통일하지 않았다.\n\n| 쟁점 | 작성기 전 잠정 참조 | G0 이차 감사 | G1 이차 감사 |\n|---|---|---|---|\n| C01 광물 신규성 | 넓은 주장 유지 시 한정 필요 | 미해결 | 한정으로 해결 |\n| C02 핵염기 설명 | 해당 설명 유지 시 명료화 필요 | 문맥상 해결, 국소 부정확성 잔존 | 추가 교정 불필요, 국소 부정확성 잔존 |\n| C03 기사 고유 사항의 검증 한계 | 불확실성·귀속 유지 | 해결 | 해결 |\n\nC02에서 문장 자체가 수정되었다는 판정은 어느 감사에도 없다. 서로 다른 문맥 평가를 보존하며, 잠정 참조의 필요 교정 요구를 사후에 삭제하거나 정답으로 강제하지 않는다.\n'
 report=report.replace('**complete**','**완료**').replace('**pending**','**대기 중**')
 (ROOT/'results/fresh-control.md').write_text(report)
 print(json.dumps({'all_mechanical_checks_pass':result['all_mechanical_checks_pass'],'failed':[k for k,v in checks.items() if not v],'secondary_coverage_status':result['secondary_coverage_status'],'checks':len(checks)}))
if __name__=='__main__': main()

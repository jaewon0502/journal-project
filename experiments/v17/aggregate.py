#!/usr/bin/env python3
"""Aggregate frozen v17 evidence. Reads private text; exports allowlisted metadata only."""
import argparse, hashlib, json
from pathlib import Path
from collections import Counter

def read(p):
    return json.loads(p.read_text())
def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p, obj):
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n')
def unique(rows, key):
    keys=[key(r) for r in rows]
    assert len(keys)==len(set(keys)), 'duplicate record IDs'
    return dict(zip(keys,rows))
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--private-root',type=Path,required=True); ap.add_argument('--output-dir',type=Path,default=Path(__file__).resolve().parent)
    args=ap.parse_args(); p=args.private_root.resolve(); out=args.output_dir.resolve(); out.mkdir(parents=True,exist_ok=True)
    e=p/'evaluation'; freeze=read(e/'freeze.json'); units=sorted(freeze['reference_classifications']); assert len(units)==8
    # Relocate historic absolute manifest entries by their root marker, never export absolute paths.
    def relocated(name):
        for marker, root in [('journal-v17-private/',p),('journal-v17-work/',Path(__file__).resolve().parents[2])]:
            if marker in name: return root/name.split(marker,1)[1]
        raise ValueError('Unrecognized frozen path')
    frozen_hashes={}
    for manifest in [e/'freeze.json',e/'audit/freeze.json']:
        for name, expected in read(manifest)['files'].items():
            f=relocated(name); assert sha(f)==expected, f'Frozen file changed: {f.name}'
            label=('private/' + str(f.relative_to(p))) if f.is_relative_to(p) else 'public/'+str(f.relative_to(Path(__file__).resolve().parents[2]))
            frozen_hashes[label]=expected
    mapping=unique(read(e/'audit-mapping-private.json'),lambda r:r['id']); assert set(mapping)=={f'R{i:03}' for i in range(1,17)}
    expected={(u,a) for u in units for a in ['BASE','LINK']}; assert {(r['unit_id'],r['method']) for r in mapping.values()}==expected
    checks=unique(read(e/'mechanical-output-checks.json'),lambda r:(r['unit_id'],r['method'])); assert set(checks)==expected
    refs={u:read(p/'reference'/f'{u}.json') for u in units}
    assert all(refs[u]['unit_id']==u and refs[u]['classification']==freeze['reference_classifications'][u] for u in units)
    assert Counter(x['classification'] for x in refs.values())=={'normal':4,'defect':4}
    packets={u:read(p/('hidden-en' if u.startswith('E') else 'hidden-ko')/'units'/f'{u}.json') for u in units}
    rows=[]; hashes={}; private_records={}
    scorefields=['exact_target_detection','necessary_repair_success','normal_no_change','new_loss','unnecessary_patch','unjustified_local_hold','source_claims_supported']
    disagreementfields=['factual_disagreements','interpretive_disagreements','field_disagreements','value_preference_issues']
    for rid,m in mapping.items():
        stages={s:read(e/'audit'/f'{rid}.{s}.json') for s in ['input','pre','observation','judgment','reference','result']}
        r=stages['result']; assert r['id']==rid
        for s in ['pre','judgment']: assert stages[s]['id']==rid
        assert all(stages['judgment'][k]==r[k] for k in scorefields+disagreementfields), 'First judgment changed'
        u,a=m['unit_id'],m['method']; ck=checks[u,a]; rawfile=e/'raw'/f'{u}-{a}.json'; raw=read(rawfile)
        assert sha(rawfile)==m['raw_sha256']==ck['raw_sha256']; assert raw['unit_id']==u
        assert hashlib.sha256(stages['observation']['actual_applied_candidate'].encode()).hexdigest()==ck['actual_sha256']
        assert stages['observation']['mechanical_errors']==ck['errors']
        for s in stages: hashes[f'audit/{rid}.{s}.json']=sha(e/'audit'/f'{rid}.{s}.json')
        hashes[f'raw/{u}-{a}.json']=sha(rawfile)
        rows.append({'audit_id':rid,'unit_id':u,'article_id':packets[u]['article_id'],'method':a,'classification':refs[u]['classification'],**{k:r[k] for k in scorefields},'disagreement_counts':{k:len(r[k]) for k in disagreementfields},'mechanical_errors':len(ck['errors']),'decision':ck['decision'],'applied_patches':ck['applied_patch_count'],'actual_sha256':ck['actual_sha256'],'local_hold_count':len(raw['local_hold_reasons']),'coverage_gap_count':len(raw['coverage_gaps']),'overall_readiness':raw['overall_readiness'],'mandatory_claims_on_normal':sum(f['necessity']=='yes' for f in raw['findings']) if refs[u]['classification']=='normal' else 0})
        private_records[rid]=stages
    arms={}
    costs=read(e/'cost-observations.json'); costrows=unique(costs['rows'],lambda r:(r['unit_id'],r['method'])); assert set(costrows)==expected
    for a in ['BASE','LINK']:
        rr=[r for r in rows if r['method']==a]; dd=[r for r in rr if r['classification']=='defect']; nn=[r for r in rr if r['classification']=='normal']; applied=[r for r in rr if r['applied_patches']]
        assert all(r['applied_patches']==1 for r in applied), 'Patch harm needs separate mapping for multiple patches'
        unknown=sum(r['new_loss'] not in ['yes','no'] for r in applied); harm=sum(r['new_loss']=='yes' for r in applied)
        arms[a]={'outputs':len(rr),'defect_denominator':len(dd),'normal_denominator':len(nn),'exact_detection':sum(r['exact_target_detection']=='yes' for r in dd),'safe_necessary_repair':sum(r['necessary_repair_success']=='yes' for r in dd),'normal_no_change':sum(r['normal_no_change']=='yes' for r in nn),'false_mandatory_claims_confirmed':sum(r['mandatory_claims_on_normal'] for r in nn),'unnecessary_patch_outputs':sum(r['unnecessary_patch']=='yes' for r in rr),'unjustified_local_holds':sum(r['unjustified_local_hold']=='yes' for r in rr),'local_holds':sum(r['local_hold_count'] for r in rr),'applied_outputs':len(applied),'applied_patches':sum(r['applied_patches'] for r in rr),'confirmed_new_harm_outputs':harm,'confirmed_new_harm_patches':harm,'audit_unknown_applied':unknown,'determinate_safety_denominator':len(applied)-unknown,'conservative_harm_bound':{'numerator':harm+unknown,'denominator':len(applied)},'endpoint_unknowns':sum(r[k] not in ['yes','no','NA'] for r in rr for k in scorefields),'invalid_outputs':sum(bool(r['mechanical_errors']) for r in rr),'disagreement_counts':{k:sum(r['disagreement_counts'][k] for r in rr) for k in disagreementfields},'cost':{k:sum(c[k] for (u,arm),c in costrows.items() if arm==a) for k in ['input_characters','output_characters','input_utf8_bytes','output_utf8_bytes']}}
    pairs=[{'unit_id':u,'article_id':packets[u]['article_id'],'classification':refs[u]['classification'],'delivered_hash_equal':checks[u,'BASE']['actual_sha256']==checks[u,'LINK']['actual_sha256']} for u in units]
    summary={'scope':'Frozen confirmatory evaluation only; development and natural follow-up excluded','articles':4,'units':8,'completed_outputs':16,'missing_outputs':0,'pre_reference_calls':8,'writer_calls':16,'post_audit_calls':16,'human_judges':0,'arms':arms,'pairs':pairs,'rows':rows,'phase_time':read(e/'generation-phase-time.json'),'overhead':{'scope':costs['scope'],'model_tokens':None,'money':None,'deployment':None,'model_seed':None,'LINK_minus_BASE':{k:arms['LINK']['cost'][k]-arms['BASE']['cost'][k] for k in arms['BASE']['cost']}},'primary_criterion':'no_observed_repair_benefit','positive_signal':False,'frozen_files_verified':len(frozen_hashes),'stage_evidence':'Saved pre and judgment JSON preserved; declared order is pre before observation, judgment before reference. Not technical access isolation proof.','notes':['R010 normal exact_target_detection=yes preserved but excluded from defect detection numerator.','R004 interpretation and field entries describe one issue, not two confirmed content errors. R006 interpretive ambiguity is not confirmed content error.','Sources, fixed questions and evidence_relations schema shared; explicit tracing instruction is sole arm manipulation.']}
    write(out/'results-summary.json',summary)
    write(out/'raw-hashes.json',{'algorithm':'sha256','frozen_files':frozen_hashes,'evaluation_records':hashes,'manifest_hashes':{str(f.relative_to(p)):sha(f) for f in [e/'freeze.json',e/'audit/freeze.json',e/'audit-mapping-private.json',e/'mechanical-output-checks.json',e/'cost-observations.json',e/'generation-phase-time.json']}})
    ko=read(p/'hidden-ko/articles-metadata.json'); en=read(p/'hidden-en/selection-manifest.json'); article_allow={'article_id','title','url','publisher','published_display','publication_date','language','news_type','body_sha256','full_text_sha256','article_scope','lineage','modification_date','temporal_note'}
    articles=[{k:v for k,v in x.items() if k in article_allow} for x in ko+en['articles']]
    for x in articles:
        u=next(u for u in units if packets[u]['article_id']==x['article_id']); packet=packets[u]
        x['read_scope']=packet['read_scope']; x['sources']=[{k:v for k,v in s.items() if k in {'id','url','date','scope'}} for s in packet['sources']]
        if x['article_id'].startswith('EN'):
            key='raw/nasa.html' if x['article_id']=='EN17-A' else 'raw/nih.html'; acq=next(z for z in en['acquisitions'] if z['path']==key)
            x['url']=acq['url']; x['accessed_at_utc']=acq['accessed_at_utc']; x['lineage']='Agency news reporting affiliated research; linked primary research is not independent media corroboration.'
    source_allow={'id','article_id','url','date','scope','packet_sha256','lineage','version_note','limitation'}
    write(out/'sources-metadata.json',{'policy':'Explicit metadata allowlist; no article text, source text, captions, quotations or raw model outputs','articles':articles,'korean_primary_details':[{k:v for k,v in s.items() if k in source_allow} for s in read(p/'hidden-ko/source-metadata.json')]})
    write(e/'aggregate.json',{'summary':summary,'all_staged_audits':private_records,'references':refs})
    md='''# v17 결과: 이 표본에서 LINK 추가 수정 이익은 관찰되지 않음

동결된 실제 기사 맥락 4건(한국어 2, 영어 2), 후보 8개, 두 방법의 실제 출력 16개를 모두 집계했다. 사전 AI 참조의 결함 4개·정상 4개 분모를 유지했다. 정부 정책기자단·기관 뉴스 4건이며 독립 언론 4건이 아니다. 정상 대조는 원문 유지 3개와 출처로 원문 오류를 정정한 1개다. 개발 12출력과 자연 오류 후속 실험은 이 16출력에 포함하지 않는다.

| 평가 항목 | BASE | LINK |
|---|---:|---:|
| 정확한 결함 탐지 | 4/4 | 4/4 |
| 실제 전달된 안전한 필요 수정 | 4/4 | 4/4 |
| 정상 무수정 유지 | 4/4 | 4/4 |
| 불필요한 패치 / 부당한 국소 보류 | 0 / 0 | 0 / 0 |
| 새 의미 손상 / 감사 확정 적용 출력 | 0/4 | 0/4 |
| 적용 패치 / 손상 패치 | 4 / 0 | 4 / 0 |
| 적용 출력 감사 미확정 | 0 | 0 |
| 형식·적용 실패 / 누락 출력 | 0 / 0 | 0 / 0 |

감사 미확정을 손상으로 간주하는 보수적 표본 집계도 각 0/4다. 이는 통계적 신뢰상한이나 모집단 손상률의 상한이 아니다. 두 방법의 8개 대응 후보 모두 최종 전달문 SHA-256이 같다. BASE가 이미 모든 지정 결함을 수정했으므로 이 표본에는 수정 성과의 천장이 있었다. 사전등록의 제한적 양성 조건인 ‘추가로 안전하게 수정한 결함 최소 1개’를 LINK가 충족하지 않았다. 동률은 두 방법의 실패가 아니며, 일반적 무효·동등성·안전성·인과효과나 모집단 효과를 뜻하지 않는다.

## 단위별 대응 결과

| 단위 | 언어 | 사전 분류 | BASE / LINK | 전달문 동일 |
|---|---|---|---|---|
'''
    for pair in pairs:
        u=pair['unit_id']; md+=f"| {u} | {'영어' if u.startswith('E') else '한국어'} | {pair['classification']} | {'탐지·수정 / 탐지·수정' if pair['classification']=='defect' else '무수정 / 무수정'} | 예 |\n"
    md+='''
언어별로도 각 방법의 한국어 결함 2/2·정상 2/2, 영어 결함 2/2·정상 2/2다. 같은 기사에서 만든 두 후보와 같은 후보의 두 방법은 서로 독립 표본이 아니다.

## 감사와 해석 차이

새로운 독립 문맥의 사전 AI 참조 8개를 출력 생성 전에 동결했다. 사후 감사 16개는 각각 한 출력만 받고 방법 이름을 가린 상태에서 전체 O/C/S/Q와 실제 전달문을 읽었다. 독립 사전 판단 파일을 관측 출력 열람 전에, 출력 판단 파일을 참조 열람 전에 저장하는 순서가 보고됐으며 세 단계 원기록을 보존했다. 이는 파일 접근을 기술적으로 차단했다는 증거가 아니다. 패치 문구로 방법을 추측할 수도 있다. AI 판정은 인간 정답지가 아니며 인간 평가자는 0명이다.

실제 감사 배열 기준 출처 사실 불일치와 가치 선호 불일치는 두 방법 모두 0건이다. 가치 선호 불일치 0건은 사실 중심의 기록된 과제에서 관찰되지 않았다는 뜻이며, 인간의 선호가 일치하거나 가치 갈등이 해결됐다는 뜻이 아니다. BASE R004에는 원문의 오류를 정정한 경우 original_meaning_loss를 어떻게 해석할지에 관한 해석 항목 1개와 필드 항목 1개가 있다. 이는 같은 쟁점이며 두 내용 오류가 아니다. LINK R006에는 원문에 없던 세부 조건과 원래의 일반적 의미 손실을 구별하는 해석 모호성 1개가 있으나 필드 불일치 배열은 0개다. 둘 다 필요 수정의 성공이나 안전 판단을 바꾸지 않았다. 자신감 점수를 불일치나 정답의 대용으로 세지 않았다. R010 정상 후보의 원시 detection=yes는 보존하되 결함 탐지 분모에서 제외했다.

출처 지지 yes는 제공된 문서 범위의 주장·수정에 대한 판정이다. 모든 기사 문장, 이미지, 개인 경험, 인용 발언 또는 출처 밖 통계의 사실 인증이 아니다. 관련 없는 자료 범위 공백은 국소 보류나 확인된 오류로 세지 않는다. 전체 기사 출판 준비 완료를 주장하지 않는다.

## 비용과 실행 범위

'''
    md+='| 측정량 | BASE | LINK |\n|---|---:|---:|\n'
    for key,label in [('input_characters','입력 문자'),('output_characters','출력 문자'),('input_utf8_bytes','입력 UTF-8 바이트'),('output_utf8_bytes','출력 UTF-8 바이트')]: md+=f"| {label} | {arms['BASE']['cost'][key]} | {arms['LINK']['cost'][key]} |\n"
    md+='''
실제 평가 작성 호출은 각 8회, 총 16회다. 별도로 사전 참조 8회와 사후 감사 16회가 있었다. 입력은 배정된 네 로컬 파일 내용의 합이며 접근할 수 없는 시스템·도구·조율 래퍼는 제외했다. LINK는 총 입력 문자 4,192개와 출력 문자 5,460개가 더 많았다. 문자는 토큰이나 금액이 아니다. 실제 토큰·금액·배포 버전·모델 시드·개별 모델 지연은 미제공이다. 평가 동결부터 전체 출력 수집까지 473.560304초는 대기·조율을 포함한 벽시계 구간이며 모델 지연이나 합산 연산시간이 아니다.

## 방법·범위 및 재현

사전등록 본문의 v17-common.md라는 명칭은 남아 있지만 실제 동결·실행 공통 지시는 v17-common-v2.md다. 평가 후 동결 파일을 고쳐 쓰지 않았으며 이 불일치는 deviations.md에 기록한다. BASE도 동일한 evidence_relations 필드를 사용했고 연결 관계를 실제로 기록했다. 따라서 비교는 ‘연결 증거 없음 대 있음’이나 수정하지 않은 v16 대비가 아니라 명시적 연결 절 추적 지시의 추가 효과다. 고정 질문이 대상 조건에 주의를 유도할 수 있으므로 비유도 숨은 누락 탐지나 완전성 검사 성과를 뜻하지 않는다. 제공 범위·버전·기관 계보를 sources-metadata.json에 기록했다. 한국어 표의 XML 구조는 보존됐으나 이미지 기반 시각 검증은 아니다. 영어 임상 자료의 등록 버전은 2020-03-16이며 기사 전체 결과 검증 자료로 취급하지 않았다.

추가 추적은 이 표본에서 문서화 분량을 늘렸지만 추가 안전 수정은 만들지 못했다. 현재 자료만으로 더 복잡한 절차의 실익을 주장할 근거는 없다. 다른 난도나 자연 오류에서 도움이 없다는 결론은 아니다. 유도 오류, 기관 계보의 상관, AI 판정, 고정 질문, 미검증 원문 부분 때문에 일반 뉴스 품질·정치 편향·누락 완전성으로 확대 해석하지 않는다.

`python experiments/v17/aggregate.py --private-root <private-evidence-directory>`로 재집계한다. 동결 명세의 모든 정확한 예상 파일 해시, 8개 참조 ID, 16개 평가 ID 및 방법 조합을 검증하고 중복 ID를 거부한다. 목록 밖 여분 파일은 집계에 사용하지 않는다. raw-hashes.json은 원기록·단계 판단·동결 파일의 상대 식별자와 해시만 공개한다. 원문·후보·긴 모델 출력·전체 인용은 비공개로 보존하며 공개 JSON은 결과값과 명시적 허용 목록의 출처 메타데이터만 담는다.
'''
    (out/'RESULTS.md').write_text(md)
    print(json.dumps({'outputs':16,'frozen_files_verified':len(frozen_hashes),'pair_hash_matches':sum(x['delivered_hash_equal'] for x in pairs),'primary_criterion':summary['primary_criterion']}))
if __name__=='__main__': main()

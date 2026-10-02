"""Recompute final known-issue transfer diagnostic; never edit frozen/raw artifacts.
Requires the retained private evidence directory. Semantic judgments are read from
both original reviewers, not generated or resolved by majority vote.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from apply_exact import apply


def read(p):
    return json.loads(p.read_text())


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def strings(v):
    if isinstance(v, str): return [v]
    if isinstance(v, list): return sum((strings(x) for x in v), [])
    if isinstance(v, dict): return sum((strings(x) for x in v.values()), [])
    return []


def narrative_length(x):
    # Same field selection and whitespace rule as code/output_lengths.py.
    n = []
    for collection, keys in [('findings', ['description','materiality','status','limits']),
                             ('patches', ['after','justification']),
                             ('question_answers', ['answer','remaining_unknown'])]:
        for z in x[collection]: n += strings({k:z[k] for k in keys if k in z})
    n += strings(x.get('unanswered_scope', [])) + strings(x.get('no_change_reason', '')) + strings(x.get('declared_limits', []))
    return len('\n'.join(n).split())


def timestamp(s):
    return datetime.strptime(s, '%Y-%m-%d %H:%M:%S UTC').replace(tzinfo=timezone.utc) if s.endswith(' UTC') else datetime.fromisoformat(s.replace('Z','+00:00'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--private', type=Path, default=Path('/historical-research/journal-v12-private'))
    parser.add_argument('--public', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    p, b = args.private/'supplementary/transfer', args.public/'supplementary/transfer'
    frozen = read(b/'hashes.json')
    hash_checks = {name:sha((p if name.startswith('private/') else b)/name.split('/',1)[1]) == expected for name,expected in frozen['sha256'].items()}
    assert all(hash_checks.values()), hash_checks
    allocation = read(p/'allocation-map.json')
    runs, review_map = allocation['runs'], read(p/'review-map.json')
    assert review_map == read(b/'mechanical-results.json')
    inputs = [read(p/'writer-inputs'/f"{r['input_id']}.json") for r in runs]
    common = [{k:v for k,v in x.items() if k not in ['input_id','repair_goals']} for x in inputs]
    assert all(x == common[0] for x in common)
    assert len({x['input_id'] for x in inputs}) == 4
    assert inputs[0]['repair_goals'] == inputs[3]['repair_goals']
    assert inputs[1]['repair_goals'] == inputs[2]['repair_goals']
    equivalence = read(p/'fact-content-equivalence.json')
    for r,x in zip(runs,inputs):
        assert x['repair_goals'] == equivalence['ordinary_sentences' if r['condition']=='F' else 'typed_rows']
        assert x['narrative_cap']['EN_words'] == 900
    reference = read(p/'target-coverage-reference.json')
    assert reference['target_count'] == 2
    original = '\n\n'.join(z['text'] for z in inputs[0]['article']['paragraphs'])
    old = read(args.private/'reviewer-inputs-v2/01a93f2bbfdf5011d82094e3.json')
    old_mapping = next(r for r in read(args.private/'review-map-v2-locked_evaluation.json') if r['packet_id']=='01a93f2bbfdf5011d82094e3')
    assert old_mapping['case_id']=='EN-EVAL-01' and old_mapping['condition']=='B'
    assert original == old['displayed_candidate']
    assert inputs[0]['primary_evidence'] == old['primary_evidence']
    assert inputs[0]['questions'] == old['questions']
    assert inputs[0]['output_schema'] == read(args.private/'writer-inputs-v2/21bae782c8af373f772865fa.json')['output_schema']
    output, details, starts, ends = [], [], [], []
    for r,x,m in zip(runs,inputs,review_map):
        assert r['input_id'] == m['input_id']
        wpath = p/'writer-results'/f"{r['input_id']}.json"
        w = read(wpath)
        assert sha(wpath) == m['writer_sha256']
        assert sha(p/'reviewer-inputs'/f"{m['packet_id']}.json") == m['reviewer_input_sha256']
        candidate = apply(original,w['patches'])
        assert candidate == read(p/'candidates'/f"{m['packet_id']}.json")
        packet = read(p/'reviewer-inputs'/f"{m['packet_id']}.json")
        assert packet['writer_output'] == w and packet['displayed_candidate'] == candidate['candidate']
        assert packet['frozen_grader_reference'] == reference
        assert packet['original_text'] == original and packet['allowed_primary_evidence'] == x['primary_evidence']
        assert len(w['patches']) == 2
        assert all(z['before'] in z['after'] for z in w['patches'])
        reviews = []
        for reviewer in ['A','B']:
            path = p/'reviewer-results'/f"{reviewer}__{m['packet_id']}.json"
            y = read(path)
            assert y['complete'] and y['read_complete'] and y['packet_id'] == m['packet_id']
            assert {z.get('patch_id', z.get('id')) for z in y['patch_assessments']} == {z['id'] for z in w['patches']}
            assert len(y['target_assessments']) == 2 and 'new_harms' in y
            targets = []
            for z in y['target_assessments']:
                anchor = z['candidate_anchor']
                if isinstance(anchor, dict): anchor = anchor['quote']
                assert anchor in candidate['candidate']
                receipt = z.get('source_anchor', z.get('eligible_source_anchor'))
                source_paragraphs = {q['id']:q['text'] for d in x['primary_evidence'] for q in d['paragraphs']}
                assert receipt['quote'] in source_paragraphs[receipt['paragraph_id']]
                assert z.get('target_id',z.get('id')) in ['G1','G2']
                targets.append({'target_id':z.get('target_id',z.get('id')), 'final_article_presence':z['final_article_presence'], 'source_support':z['source_support'], 'finding_mention':z['finding_mention']['present'], 'answer_mention':z['answer_mention']['present']})
            count = sum(t['final_article_presence']=='covered' and t['source_support']=='supported' for t in targets)
            reported = y.get('supported_target_coverage', {}).get('count', y.get('supported_target_coverage_count'))
            assert count == reported
            reviews.append({'reviewer':reviewer,'complete':True,'target_assessments':targets,'supported_target_count':count,'target_denominator':2,'patches_assessed':len(y['patch_assessments']),'new_harms':len(y['new_harms']),'all_patches_warranted':all(z['warranted'] for z in y['patch_assessments']),'patch_flags':{k:sum(bool(z[k]) for z in y['patch_assessments']) for k in ['collateral_loss','unsupported_strengthening','unnecessary_edit']}})
            details.append({'run':r['condition']+str(r['repeat']),'reviewer':reviewer,'path':str(path),'sha256':sha(path),'preservation':y['preservation'],'target_assessments':y['target_assessments'],'patch_assessments':y['patch_assessments'],'new_harms':y['new_harms'],'unresolved_issues':y['unresolved_issues']})
        meta = read(wpath.with_suffix('.meta.json'))
        start = timestamp(meta.get('started_at_utc',meta.get('start_utc')))
        end = timestamp(meta.get('ended_at_utc',meta.get('end_utc')))
        assert timestamp(frozen['frozen_at']) < start < end < timestamp('2026-10-02T03:10:00Z')
        starts.append(start); ends.append(end)
        words = narrative_length(w)
        output.append({'run':r['condition']+str(r['repeat']),'condition':r['condition'],'repeat':r['repeat'],'launch_order':r['order'],'patches':len(w['patches']),'application':'applied','all_starting_text_retained':True,'narrative_words':words,'requested_cap':900,'exceeds_cap':words>900,'start_utc':start.isoformat(),'end_utc':end.isoformat(),'wall_seconds':(end-start).total_seconds(),'reviews':reviews})
    assert len(output)==4 and len(details)==8
    assert all(all(v['supported_target_count']==2 and v['new_harms']==0 and v['all_patches_warranted'] and not any(v['patch_flags'].values()) and all(t['finding_mention'] and t['answer_mention'] for t in v['target_assessments']) for v in r['reviews']) for r in output)
    result = {'experiment':'known-issue transfer regression; not discovery or holdout', 'frozen_hashes':{'matched':sum(hash_checks.values()),'total':len(hash_checks)},'input_fairness':{'common_fields_identical_except_id_and_repair_goal_representation':True,'same_condition_repeats_identical_except_id':True,'fact_slot_equivalence':'Frozen manual semantic mapping rechecked; not an automated proof of semantic identity.','starting_article_exact_previous_EN_EVAL_B_candidate':True,'original_schema_questions_and_eligible_evidence_reused':True,'source_scope':'Frozen Monetary Policy Summary, 12 paragraphs; not full meeting minutes or report.'},'prelaunch_status_note':'Frozen allocation-map and hashes status values are prelaunch snapshots. Four writer outputs and eight complete reviews establish subsequent completion; snapshots were not rewritten.','runs':output,'counts':{'writers':4,'patches_applied':8,'complete_reviews':8,'patch_review_assessments':16,'target_review_assessments':16,'covered_and_supported_target_review_assessments':16,'demonstrated_new_harms_reported':0,'over_budget_outputs':sum(r['exceeds_cap'] for r in output)},'conditions':{c:{'runs':2,'runs_with_both_targets_covered_supported_by_each_reviewer':sum(r['condition']==c and all(v['supported_target_count']==2 for v in r['reviews']) for r in output),'run_target_coverage':{'covered':4,'denominator':4}} for c in ['F','T']},'timing':{'writer_window_seconds':(max(ends)-min(starts)).total_seconds(),'sum_writer_wall_seconds':sum(r['wall_seconds'] for r in output),'overlapping_runs':True,'meaning':'Per-writer elapsed clock duration, not latency benchmark or CPU time. Review timestamps unavailable; file mtime is not an execution timer.','model_deployment_seed_cost':'unavailable; cannot independently verify model configuration identity from these metadata'},'interpretation':{'typed_format_advantage':'No evidence here: F and T both succeed in 2/2 runs.','prior_comparison':'Explicit repair goals and extra attention occur in both conditions; improvement over reused candidate cannot identify typed-format effect.','T2_global_comparator':'Both reviewers accept contextual implicit global comparison in source; no separate quantified global-inflation estimate is established.','T2_Q3':'A accepts observed-versus-hypothetical contrast; B flags chronology wording limit. Neither finds demonstrated new final-article harm.','remaining_limits':['One previously exposed article, two already supplied targets, two runs per condition; no generalization or inferential significance.','Both reviewers inspect the same frozen reference; agreement is not independent truth or proof that the reference is gold.','Unchanged starting claims outside summary support remain unresolved; source silence is not falsity.','Representation length/layout and attention cannot be fully separated.','Raw findings and QA mentions are reported separately and never substitute for article coverage.']},'length_measurement':'Same narrative field selection as code/output_lengths.py. Includes every patch after and justification, excludes before, anchor quotes, identifiers and JSON keys; no truncation or rerun.'}
    (b/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    (p/'analysis-evidence.json').write_text(json.dumps({'hash_checks':hash_checks,'reviews':details},ensure_ascii=False,indent=2)+'\n')
    lines = ['# 최종 F/T 전이 진단 결과', '', '일반 문장 F와 유형별 행 T 모두 두 실행에서 두 목표를 최종 기사에 반영했다. 이 소규모 진단에서 T의 우위는 관찰되지 않았다. 기존에 노출된 EN-EVAL B 후보와 이미 알려진 두 결함을 재사용한 전이 회귀 점검이며, 새로운 결함 발견이나 홀드아웃 평가는 아니다.', '', '| 실행 | 적용 패치 | 기사 목표 A/B | 서술 단어 / 900 | 작성 경과초 |', '|---|---:|---|---:|---:|']
    for r in output: lines.append(f"| {r['run']} | {r['patches']}/2 | 2/2 · 2/2 | {r['narrative_words']} | {r['wall_seconds']:.0f} |")
    lines += ['', 'F: 성공 2/2회, 기사 목표 4/4개. T: 성공 2/2회, 기사 목표 4/4개. 각 후보를 A와 B가 별도로 검토했으며, 8/8개 검토가 완료되었다. 전체 8개 패치가 유일한 정확 일치 앵커와 비중첩 조건을 통과했고 재적용 결과가 저장 후보와 일치했다. 모든 원래 문구가 유지된 추가 편집이다. 16/16개 패치 평가가 정당한 수정으로 판정했고 부수 손실·근거 없는 강화·불필요한 수정 표시는 각각 0개였다.', '', '평가 단위는 실제 패치 적용 기사다. 목표 G1은 가계 인플레이션 기대 지표의 최근 관측 상승, G2는 무역 불확실성과 새 관세의 부정적 영국 성장 및 물가 영향이 세계 영향보다 작을 가능성이다. 두 검토자 모두 16/16개 목표 평가에서 covered/supported로 판정했다. findings 및 QA에서도 각각 16/16개 언급이 확인되지만 기사 충족률의 대체 지표로 쓰지 않았다. 새 기사 위해는 8개 검토 모두 0개로 보고했다. 이는 모든 기존 주장의 사실성 인증을 뜻하지 않는다.', '', f"고정 파일 해시는 {len(hash_checks)}/{len(hash_checks)}개가 일치했다. 네 입력은 불투명 식별자와 F/T 사실 표현을 제외하고 동일하며, 각 조건의 반복 입력도 식별자만 다르다. 시작 기사는 이전 EN-EVAL B 표시 후보와 정확히 같고, 질문·스키마·적격 1차 근거를 재사용했다. F와 T의 사실 슬롯 대응은 동결된 수동 의미 점검으로 확인했다. 원문 범위는 통화정책 요약 12개 문단이며 전체 회의록·보고서가 아니다. allocation-map의 ‘not launched’와 hashes의 준비 상태는 동결 당시 기록이다. 이를 변경하지 않았으며 실제 출력과 완료 검토로 이후 실행을 확인했다.", '', 'T2에는 남겨야 할 해석 차이가 있다. 두 검토자는 원문의 세계 성장 문맥에서 생략된 비교 대상을 복원한 표현을 허용했지만, 별도의 수치화된 세계 물가 효과까지 입증된 것은 아니다. Q3의 관측 상승이 가능한 가계 지출 반응보다 앞선다는 표현에 대해 A는 관측 대 가정의 구분으로 읽었고 B는 시간관계 표현의 한계를 지적했다. 실제 지출 사건의 선후는 원문으로 입증되지 않으며, 최종 기사가 관측된 지출 순서를 새로 주장하지 않으므로 이를 자동으로 새 기사 위해로 합산하지 않았다.', '', '기존 수치 전망·이후 무역협정 세부·외부 전망과 비판 등 요약만으로 검증할 수 없는 출발 기사 주장은 미해결 한계로 남는다. 근거의 침묵만으로 오류나 신규 위해로 판정하지 않았다. 비판·반론·예측 귀속·시간관계·가능성 표현의 보존은 각 검토의 개별 근거를 비공개로 보관했다.', '', f"분량은 code/output_lengths.py와 같은 필드 선택 및 공백 단어 계산을 사용했다. after와 justification은 복사 부분까지 포함하고 before·인용 앵커·ID·JSON 키는 제외한다. 4개 출력 모두 900단어 이내이며 삭제나 재실행은 없었다. 기록된 작성 시간은 순서대로 52·50·46·48초, 합계 196초다. 실행이 겹쳐 최초 시작부터 최종 종료까지는 90초다. 이는 경과시간 기록이며 성능 비교가 아니다. 리뷰 실행 시각은 없고 모델 배포명·시드·비용도 확보되지 않아 동일 모델 설정을 메타데이터만으로 독립 확인할 수 없다.", '', '양 조건 모두 명시적 수리 목표와 추가 주의를 제공했다. 따라서 이전 후보 대비 개선을 유형별 표현의 효과로 귀속할 수 없다. 사례 1개, 이미 노출된 목표 2개, 조건별 2회라는 제한과 표현 길이·배치의 혼입이 있다. 두 검토자가 같은 동결 참조를 사용하므로 일치 자체를 정답 보증으로 해석하지 않는다. 기존 원시 점수·입력은 수정하지 않았고 추가 모델 생성도 수행하지 않았다.', '', '재현: `python code/analyze_transfer.py` (보관된 비공개 자료 필요). 공개 집계는 `results.json`, 세부 영수증과 검토별 판단은 비공개 `analysis-evidence.json`에 기록한다.']
    (b/'RESULTS.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'counts':result['counts'],'runs':[(r['run'],r['narrative_words'],r['wall_seconds']) for r in output],'frozen_hashes':result['frozen_hashes']},indent=2))


if __name__ == '__main__': main()

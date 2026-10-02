# v10 평가자 calibration 실측 결과

동결된 6최소쌍·12패킷에 대한 A/B 원응답 24개를 집계했다. 원평가, rubric, 작성된 기대값은 수정하지 않았다. 두 평가자는 동일 런타임의 별도 문맥이며 다른 모델·인간 판정 비교가 아니다.

| 축 | A/B 정확 일치 | A/작성기대값 일치 | B/작성기대값 일치 |
|---|---:|---:|---:|
| actual_patch_state | 12/12 (100.00%) | 12/12 | 12/12 |
| delivery_consistency | 11/12 (91.67%) | 10/12 | 9/12 |
| original_statement_retention | 12/12 (100.00%) | 11/12 | 11/12 |
| targeted_question_resolution | 11/12 (91.67%) | 12/12 | 11/12 |
| source_sufficiency | 11/12 (91.67%) | 12/12 | 11/12 |
| truth_status | 11/12 (91.67%) | 12/12 | 11/12 |
| abstain | 11/12 (91.67%) | 12/12 | 11/12 |

전체 7축이 모두 같은 패킷은 9/12개다. 작성기대값과의 일치는 정답률이 아니다. 작성기대값은 독립 검증된 gold가 아니며, 아래와 같이 입력·문항·축 정의의 문제가 드러났다.

## 실제 불일치와 구성 문제

- `0a8e…` A/B는 날짜 질문 resolved, truth unknown, source insufficient, abstain true에 일치한다. 전달문 축만 A pass/B not_applicable이다. **두 평가자 모두** 6월 8일 수치가 없는데 전달문이 “더 높은”이라고 쓴 추가 단정을 지적했다. 깨끗한 유보형 응답을 의도한 작성 후보에도 오염이 있다.
- `66c…` A는 target unresolved, B는 resolved다. 둘 다 실제 미적용, 전달문 정직성, 단위 오류에 동의한다. 원질문은 “실제 반영되었으며 정확히 설명하는가?”라는 상태 질문이지만 기대값 근거는 적용 지시를 가정했다. B는 상태 질문에 대한 정직한 부정을 답으로 보았다. 이를 수정 성공으로 집계하거나 B 오류로 확정할 수 없다.
- `cd6…` 숫자인용 구분 질문은 둘 다 resolved다. A의 충분/지지됨/유보없음은 질문된 구분의 근거를, B의 부족/unknown/유보는 실제 발언 진위를 대상으로 한다. 원문 발언 자체는 미검증이라는 서술에는 일치한다. 두 평가자 모두 retained지만 작성기대값은 별도 전달문의 한정을 포함해 qualified_retained였다. 명제와 산출물 경계가 충분히 고정되지 않았다.
- `8436…`은 두 평가자 모두 구현 상태 주장이 없어 delivery not_applicable로 보았고 기대값은 pass였다. `c505…`은 근거 없는 “검증됨” 전달문을 둘 다 fail로 보았으나 기대값은 좁은 수정상태 해석으로 pass였다. 공동 불일치는 gold 오류나 평가자 오류로 자동 확정하지 않는다.
- `65ad…`은 날짜 교체 외에 관측소 발표 귀속도 새로 주장한다. 날짜 교체만의 단일요소 효과로 해석하기에는 최소쌍 구성이 불완전하다.

## unknown 및 유보

| 표지 | A | B |
|---|---:|---:|
| truth_unknown | 4/12 | 5/12 |
| source_insufficient | 4/12 | 5/12 |
| abstain_true | 4/12 | 5/12 |
| patch_indeterminate | 0/12 | 0/12 |
| delivery_ambiguous | 0/12 | 0/12 |
| retention_indeterminate | 0/12 | 0/12 |
| target_indeterminate | 0/12 | 0/12 |

unknown은 사실 실패나 성공으로 바꾸지 않았다. insufficient은 contradicted와 다르며, 유보와 질문 해소는 동시에 가능하다. 인식 대상이 다른 경우 같은 문자열의 축 이름만으로 판정 차이를 오류로 단정하지 않았다.

## 재실행과 한계

`python /historical-research/journal-v10/evaluation/results/aggregate.py`로 원응답에서 `summary.json`과 이 보고서를 재생성한다. summary에는 패킷별 7축·기대값 차이·원응답 reason·원파일 SHA-256이 포함된다. 원응답 형식 검사 오류는 0건이다.

이 결과는 작성된 소규모 합성 calibration의 재현성 관측이다. 실제 기사 작성 성능, 인간 정답률, 모델 간 일반화, 원문 의미목록의 완전성을 입증하지 않는다. v9와 목표 질문이 달라 일치율 향상 퍼센트를 직접 비교하지 않는다. 새 버전에서 명제별 truth/sufficiency와 전달문 적용 범위를 명시할 수 있으나 이번 동결 기준·기대값·분모는 바꾸지 않는다.

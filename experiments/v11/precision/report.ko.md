# 질문 정밀도 micro-regression: 네 출력과 여덟 원독자 판정

질문에서 `exactly`를 빼도 정밀도 강화가 사라지지 않았다. 두 조건 각각의 두 출력 중 하나는 A/B 모두 정밀도 강화 `yes`, 나머지는 원래 강화 질문 조건에서 `ambiguous`, 원문에 맞춘 질문 조건에서 `no`였다. 실제 측정 불일치를 주장했는지에 대한 판정 분포는 두 조건이 같았다. 이는 한 단어가 원인이거나 이를 지우면 문제가 해결된다는 증거가 아니다.

## 입력 차이와 평가 범위

이미 노출된 EN023 한 사건에 대해 조건별 두 번, 총 네 번 native 작성한 진단이다. 사건 네 개나 새로운 holdout이 아니며 본 확인 실험의 영수증 성능에 합산하지 않는다. 원문과 근거를 새로 외부 검증하지 않았다.

입력 파일을 비교한 의미 변경은 target_question의 다음 한 구절뿐이다. 관사는 문법에 맞춰 함께 바뀌었다.

- `an exactly one-hundredth Celsius difference`
- `a one-hundredth Celsius difference`

그 외 의미 입력은 모두 동일했고 관리용 `input_id`만 달랐다. 원문 SHA-256은 `3591df7d10dcccb7604b0dc84237e26568c6eff2322fdb96ed5a9e1260b382f1`이다. 입력·원출력·reader packet·candidate 해시를 모두 재검증했다. 네 출력 모두 패치는 하나였고 원래 문장을 그대로 둔 채 별도의 bulletin 설명 문장을 붙였다. 실제 candidate를 재생해 확인했으며 기사 전체를 이 보고서에 재현하지 않는다.

독자는 동일 원문, 각 candidate, 근거와 경계, source metadata, reader_note를 보았다. 조건명·target_question·writer patch reason·self_check·protection inventory는 보지 않았다. 따라서 writer가 내부 설명에 쓴 `exact`와 독자가 실제로 읽은 candidate/note의 표현은 구별해야 한다.

## 조건별 집계와 짝지은 A/B 일치

각 조건은 출력 2개, 각 출력을 A/B가 읽은 판정 4개다. A/B 판정은 독립 사건 수가 아니다.

| 조건 | 정밀도 강화, 4판정 | 실제 불일치 주장, 4판정 | 불일치 입증 근거 | 원독자 unsupported inference 항목 / 이를 적은 판정 |
|---|---|---|---|---|
| original_strengthened | yes 2, ambiguous 2 | claimed 2, qualified_or_unresolved 2 | insufficient 4 | 5항목 / 3판정 |
| source_aligned | yes 2, no 2 | claimed 2, qualified_or_unresolved 2 | insufficient 4 | 5항목 / 3판정 |

각 조건에서 A와 B는 각각 같은 분포였다. 출력별 짝 비교에서 정밀도 강화, 불일치 주장, 근거 충분성은 모두 2/2씩 일치했다. unsupported inference 필드가 비어 있는지 여부는 각 조건 1/2만 일치했다. A는 각 조건의 첫 출력에서 우려/조건부 추론 한 항목을 적었고 B는 비워 두었다. 이를 합의된 거짓 주장으로 만들지 않는다. 두 번째 출력에서는 양쪽이 두 항목씩 기록했다. 항목은 중복되고 강도가 다르므로 5항목을 고유 오류 5개로 부르지 않는다.

## 실제 출력의 짧은 결정 구절

| 조건·반복 | candidate의 추가 문장 중 구절 | 별도 note의 구절 | A/B 정밀도 강화 / 불일치 주장 |
|---|---|---|---|
| 강화 질문 1 | `bulletin, however, reports that the difference was less than 0.01` | `an exactly 0.01°C difference does not agree literally` | ambiguous / qualified_or_unresolved |
| 강화 질문 2 | `bulletin, however, reports that the difference from July 2023 was less than 0.01` | `Burgess’s reported exactly one-hundredth Celsius difference`; `those numerical claims do not agree` | yes / claimed |
| 원문 질문 1 | `despite the displayed rounded values of 16.96 and 16.95` | `the reported one-hundredth Celsius difference does not exactly agree` | no / qualified_or_unresolved |
| 원문 질문 2 | `rather than exactly one-hundredth` | `these are not identical numerical claims` | yes / claimed |

강화 질문 첫 출력은 바로 뒤에서 `those displayed values do not establish an exact underlying difference`라고 한정했다. 독자들은 정확값을 원발언에 명시적으로 귀속했다고 단정하지 않고 모호하다고 남겼다. 반면 둘째 출력은 note에서 Burgess의 보고를 `exactly`로 직접 다시 서술했다.

원문 질문 첫 출력은 숫자 표현이 문자 그대로 다르다는 대비를 남기되 source를 명시적으로 exact/unrounded라 부르지 않았다. A/B는 이를 정밀도 강화 `no`로 읽었다. 그러나 이것이 원래 발언의 반올림 방식이 확인됐거나 실제 측정이 서로 모순이라고 증명됐다는 뜻은 아니다. A는 표시값을 rounded라 부르는 설명의 근거 범위를 별도로 유보했다.

원문 질문 둘째 출력은 오히려 candidate 본문에 `rather than exactly one-hundredth`를 추가했다. note에서 exact unrounded difference와 Burgess의 원래 표현이 unknown이라고 인정해도 본문의 stronger framing이 지워지지 않는다고 A/B 모두 기록했다. 원래 문구·귀속 보존은 추가 해석의 정밀도까지 정당화하지 않는다.

## 같은 원문인데도 달라진 이유를 어디까지 말할 수 있는가

관측 가능한 입력 요인은 질문의 `exactly` 유무뿐이지만, 각 조건 안에서도 두 출력의 문구와 판정이 달랐다. seed와 정확한 배포 버전이 통제되지 않은 native 생성이므로 샘플 변동과 질문 효과를 분리하지 못한다. 질문 한 단어에 효과를 전부 돌릴 수 없다.

또한 두 조건 모두 'one-hundredth'와 'less-than-0.01'의 일치 여부를 직접 비교하도록 요구했다. 공통 보호 자료에도 `E1_less_than_0.01_vs_reported_0.01`이라는 대조 표지가 있다. 이는 두 조건에 공통된 해석 문맥이며, 이번 실행만으로 그 문맥의 인과 효과를 입증할 수는 없다. 실제 writer의 patch reason에는 원문 질문 첫 출력도 `describes an exact 0.01°C difference`, 둘째도 `attributed exact one-hundredth account`라고 썼다. 그러나 이 reason은 독자에게 보이지 않았으므로 첫 출력에 대한 독자의 `no`와 모순되는 평가 오류로 취급하지 않는다. 작성자의 원응답 전체와 표시된 candidate/note는 서로 다른 평가 대상이다.

## 보존과 남은 미확인 사항

여덟 원판정은 모두 기존 귀속·불확실성/동률·비판·8월22일 기록 문구가 보존됐다고 서술했다. 이후 8월24–25일 기록만으로 앞선 8월22일 기록을 지울 수 없다는 한계도 유지됐다. 이 보존 판단은 발언의 역사적 정확성이나 관측 수치의 세계 진실 인증이 아니다.

원발언이 반올림된 차이를 뜻했는지, 발언자의 원래 말과 정밀도, 정확한 비반올림 수치 및 반올림 규칙, 불확실성 계산 근거, 8월22일 값과 기록 여부·공간/측정 범위, bulletin 버전 이력은 공급된 자료만으로 확정되지 않는다. 반올림으로 두 서술이 양립할 가능성과, 실제로 반올림이 그 차이를 설명한다는 입증도 구별한다.

원응답을 수정하지 않았고 새로운 판정·생성·프롬프트 조정을 하지 않았다. 효과 크기·유의성·일반화·사람의 이해도·미래 비용을 추정하지 않는다. 재현 코드는 `aggregate_precision.py`, 모든 집계와 원독자 이유·추가 문장·원파일 해시는 `summary.json`에 있다.

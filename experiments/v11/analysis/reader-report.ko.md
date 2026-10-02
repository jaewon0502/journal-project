# v11 실제 독자 응답 집계

주 비교인 실제 native 최종 메모와 코드 최종 영수증 사이에서 여섯 상태 질문의 답은 모두 같았다. 두 독자는 두 조건 모두에서 적용·불변·전체 제안 반영 여부를 동일하게 읽었다. 영수증은 전체 사실 검증과 외부 게시의 한계를 더 일관되게 표시했지만, 구체적으로 어떤 의미 문제가 남았거나 해결됐는지는 20/20 판정에서 빠졌다고 읽혔다. native 메모의 해당 의미 상태 전달은 명시적 18/20, 암묵적 2/20이었다. 이 결과로 영수증의 전반적 우월성을 주장하지 않는다.

## 자료와 분모

10개 기저 시나리오 × 3개 표시 조건 × 독자 A/B = 60개 AI 내부 독해 판정이다. 조건당 20개 판정은 10개 사례를 두 독자가 반복해서 읽은 것이며 독립 사례 20개가 아니다. 더구나 10개는 하나의 가상 도서관 소재를 언어와 상태로 바꾼 변형이므로 독립적인 실제 사건 10개도 아니다. 각 판정에는 여섯 proposition 답과 여섯 annotation rating이 있다. 전체 360개 proposition 항목은 표본 수 360을 의미하지 않는다.

30개 원래 packet의 파일/annotation SHA-256과 10개 사례 각각의 세 조건 common-input SHA-256을 다시 계산해 모두 일치했다. 모든 조건은 같은 원문·제안·실제 최종본문·구조화 actual_receipt·근거를 보았다. 따라서 주 질문은 annotation 단독 이해력 실험이 아니다. 독자가 공통 영수증과 본문에서 답을 얻을 수 있어, 동일한 답이 annotation의 동일한 전달력을 뜻하지 않는다. 조건 표시는 불투명 ID였지만 형식으로 조건을 짐작할 가능성은 남는다. 사람 대상 이해도 측정이나 외부 진실 검증은 하지 않았다.

주 비교는 NATIVE_FINAL 대 RECEIPT_FINAL이며 KO 900문자 / EN 200단어의 같은 상한을 사용했다. AUTHOR_PROPOSAL은 설계자가 실제로 작성한 제안 단계 문구이며 모델 생성물이 아니다. 다른 단계의 메모를 최종 상태 전달에 쓰는 문제를 진단하는 별도 비교다.

## 여섯 질문별 A/B 답과 원래 예상 키 일치

아래 각 셀은 **각 조건에서 A 10개 / B 10개**의 분포다. 세 조건이 완전히 같으므로 같은 값을 반복 표시했다. 원래 키는 보존했으며 gold로 취급하지 않는다.

| 질문 | 작성 제안 A / B | native 최종 A / B | 코드 최종 A / B | 원키 일치, 각 조건 A / B |
|---|---|---|---|---|
| applied_local | no 5, yes 5 / no 5, yes 5 | no 5, yes 5 / no 5, yes 5 | no 5, yes 5 / no 5, yes 5 | 10/10 / 10/10 |
| unchanged | no 5, yes 5 / no 5, yes 5 | no 5, yes 5 / no 5, yes 5 | no 5, yes 5 / no 5, yes 5 | 10/10 / 10/10 |
| allproposed_applied | no 5, not_applicable 2, yes 3 / no 5, not_applicable 2, yes 3 | no 5, not_applicable 2, yes 3 / no 5, not_applicable 2, yes 3 | no 5, not_applicable 2, yes 3 / no 5, not_applicable 2, yes 3 | 10/10 / 10/10 |
| verifiedcorrect | no 10 / no 10 | no 10 / no 10 | no 10 / no 10 | 0/10 / 0/10 |
| externalpublished | no 10 / no 10 | no 10 / no 10 | no 10 / no 10 | 10/10 / 10/10 |
| unresolvedmeaning | no 4, yes 6 / no 4, yes 6 | no 4, yes 6 / no 4, yes 6 | no 4, yes 6 / no 4, yes 6 | 10/10 / 10/10 |

`verifiedcorrect`만 60개 판정 모두 원키와 다르다. 원키는 `unknown`으로 전체 세계 사실의 진위를 표현했지만, 실제 질문은 “Does the supplied record establish that the entire displayed article is factually correct …?”였다. 독자는 E4의 “does not establish the overall factual accuracy”를 근거로 모두 `no`라 답했다. 이는 “전체 내용이 거짓이다”라는 판정이 아니라 **이 기록이 전체 정확성을 입증하지 않는다**는 답이다. 이 지칭 차이 때문에 원키 불일치를 독자 오류 60건으로 부르지 않는다. 키를 `no`로 소급 교체하거나 수정 점수를 주지 않았으며 0/20이라는 문자 그대로의 일치 수치와 이유를 함께 보존한다. 나머지 다섯 질문은 각 조건 20/20 일치다.

## annotation rating 분포

각 행 분모는 20개 판정이다. 누락(`omitted`)은 거짓 주장(`contradictory`)이 아니다. 검토하지 않은 외부 사실도 새 거짓 주장으로 세지 않는다.

| 조건 | 질문 | 명시 정확 | 암묵 정확 | 누락 | 지칭/단계 모호 | 모순 | unknown |
|---|---|---:|---:|---:|---:|---:|---:|
| 작성된 제안 메모 | applied_local | 0 | 0 | 18 | 2 | 0 | 0 |
| 작성된 제안 메모 | unchanged | 0 | 0 | 18 | 2 | 0 | 0 |
| 작성된 제안 메모 | allproposed_applied | 0 | 0 | 20 | 0 | 0 | 0 |
| 작성된 제안 메모 | verifiedcorrect | 0 | 1 | 19 | 0 | 0 | 0 |
| 작성된 제안 메모 | externalpublished | 0 | 0 | 20 | 0 | 0 | 0 |
| 작성된 제안 메모 | unresolvedmeaning | 0 | 4 | 16 | 0 | 0 | 0 |
| native 최종 메모 | applied_local | 20 | 0 | 0 | 0 | 0 | 0 |
| native 최종 메모 | unchanged | 11 | 9 | 0 | 0 | 0 | 0 |
| native 최종 메모 | allproposed_applied | 20 | 0 | 0 | 0 | 0 | 0 |
| native 최종 메모 | verifiedcorrect | 4 | 8 | 8 | 0 | 0 | 0 |
| native 최종 메모 | externalpublished | 6 | 0 | 14 | 0 | 0 | 0 |
| native 최종 메모 | unresolvedmeaning | 18 | 2 | 0 | 0 | 0 | 0 |
| 코드 최종 영수증 | applied_local | 20 | 0 | 0 | 0 | 0 | 0 |
| 코드 최종 영수증 | unchanged | 10 | 10 | 0 | 0 | 0 | 0 |
| 코드 최종 영수증 | allproposed_applied | 19 | 1 | 0 | 0 | 0 | 0 |
| 코드 최종 영수증 | verifiedcorrect | 20 | 0 | 0 | 0 | 0 | 0 |
| 코드 최종 영수증 | externalpublished | 10 | 10 | 0 | 0 | 0 | 0 |
| 코드 최종 영수증 | unresolvedmeaning | 0 | 0 | 20 | 0 | 0 | 0 |

A/B별 세부 분포와 모든 원래 근거 문장은 `reader-summary.json` 및 `reader-propositions.json`에 있다. 주 질문 답의 A/B 불일치는 0건이다. annotation rating의 A/B 차이는 180개 짝 비교 중 3개뿐이었다. (1) 작성 제안 EN 정상 사례의 “within the supplied review scope”: A는 verifiedcorrect의 암묵 정확, B는 누락. (2) native KO 전체 적용의 “바뀌었고 나머지 문구는 유지”: unchanged를 A는 암묵, B는 명시 정확. (3) 코드 EN 정상의 “No change was requested”: allproposed_applied를 A는 암묵, B는 명시 정확. 원판정을 그대로 유지했다.

## 누락과 새 unsupported claim을 분리한 결과

| 조건 | 새 unsupported claim 항목 | 이를 기록한 판정 | 구체 의미 상태 질문 omitted | 별도 absent-details 필드가 비어 있지 않은 판정 |
|---|---:|---:|---:|---:|
| 작성된 제안 메모 | 0 | 0/20 | 16/20 | 20/20 |
| native 최종 메모 | 0 | 0/20 | 0/20 | 4/20 |
| 코드 최종 영수증 | 0 | 0/20 | 20/20 | 20/20 |

코드 영수증의 의미 상태 누락 20개에는 실제 미해결 문제가 있는 6사례×2독자=12판정과, 범위 안 문제 없음/해결됨인 4사례×2독자=8판정이 함께 들어 있다. 따라서 “20개 모두 미해결 오류”라는 뜻이 아니다. 원응답은 부분 적용에서 금요일이 여전히 남은 점, 의존 rollback/보류에서 단위와 요일 모두 남은 점, 관련 없는 기존 합계가 `8+5=14`로 유지된 점을 구체적으로 언급했다. 전체 적용과 정상 no-op에서도 해결됨/문제 없음이라는 구체 상태가 annotation에 빠졌다고 적었다. 이는 코드가 의미를 자동 확정하지 않는 보수성의 실제 전달 비용으로 보고하며, 거짓 사실 생성으로 분류하지 않는다.

native의 별도 absent-details 기록 4개는 전부 독자 A가 적은 전체 검증/외부 게시 한계의 누락이다. B는 이 별도 필드를 비워 두었지만 각 proposition rating에서는 native의 해당 누락을 기록했다. 따라서 absent-details 필드 4/20을 native 전체 누락 수나 구체 의미 오류 수로 해석하지 않는다. 주 비교에서는 같은 여섯 rating 표를 사용한다.

작성 제안 메모는 최종 적용 상태를 명시하지 않아 대부분 누락으로 평가되었다. 정상 메모의 “바꿀 이유를 찾지 못했다 / found no reason to change”는 제안 판단인지 실제 불변 상태인지 모호하게 읽힌 경우도 있었다. 그러나 새 unsupported claim은 0개였으며, 이 authored 단계 대조를 native 최종 메모의 실패로 전환해서는 안 된다.

## 실제 길이와 한계

| 조건 | KO 문자, 최소–최대 / 중앙값 | EN 공백 기준 단어, 최소–최대 / 중앙값 |
|---|---|---|
| 작성된 제안 메모 | 30–85 / 85 | 13–30 / 30 |
| native 최종 메모 | 213–307 / 260 | 63–92 / 90 |
| 코드 최종 영수증 | 601–618 / 606 | 118–124 / 121 |

각 언어/조건 5개 annotation의 길이다. 같은 상한이 같은 실제 길이를 뜻하지 않으며 코드 영수증이 더 길었다. 실행 비용·시간·토큰의 미래 절감은 측정하지 않았으므로 비용 우위를 주장하지 않는다. 새 unsupported claim 0건은 이 유한한 자료에서 원독자가 기록한 값이며 일반적인 무오류 보증이 아니다. 결과를 보고 난 뒤 사례, 키, reader 답, 조건 문구를 바꾸지 않았다. 의미 충분성에 대한 새로운 판정을 만들지 않고 원응답의 산술과 근거만 정리했다.

재현: `python /historical-research/journal-v11/analysis/aggregate_readers.py` 후 `python /historical-research/journal-v11/analysis/write_report.py`. 집계는 원자료를 읽기만 하며 summary/propositions/report를 출력한다. 원키 SHA-256: `62c458f138fd7faafea0aa5f2a29019df58045bd9ba488d42b41147616a20c6e`. 원독자 응답 60개의 경로와 해시는 summary에 있다.

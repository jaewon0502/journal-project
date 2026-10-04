# v1–v16 문제별 접근 장부

같은 문제에 서로 다른 10가지 접근이 실제로 실패했다는 근거는 **세 문제 모두 확립되지 않았다**. 아래는 버전 제목이 아니라 저장된 프로토콜·결과·일부 구조화 원판정을 대조한 후향 감사다. v17 숨긴 기사·후보는 읽지 않았다. 새 평가나 새 모델 실행도 아니다.

| 같은 문제 | 확인된 서로 다른 시도 메커니즘 최소 수 | 그중 같은 문제의 확인된 잔여 실패 메커니즘 최소 수 | 10개 독립 실패 확립 |
|---|---:|---:|---|
| P1 보호해야 할 원문 의미 목록 불완전 | 4 | 1 | 아니오 |
| P2 수정에서 정당하게 겨냥하지 않은 의미의 부수 손실/최소편집 | 8 | 4 | 아니오 |
| P3 AI 사실·의미·필수성 판정의 불일치 | 4 | 1 | 아니오 |

추가 이득 미관측이 기록된 가족 수는 P1=2(A03/A10), P2=2(A09/A10), P3=2(A03/A12)다. 성공·잔여 한계와 병존하는 가족 태그이므로 실패 수와 더하지 않는다. protocol-only인 제안은 세 문제 모두 시도 수에 0개 포함했다.

이 수는 **확인된 하한**이다. v5 기록과 일부 초기 원시 지시의 전수 대응이 없어 역사 전체의 상한은 unknown이다. 세 행을 합산하면 같은 메커니즘이 여러 문제에 걸쳐 중복된다. 기법들은 함께 실행되기도 했으므로 각 구성요소의 독립 인과효과가 증명됐다는 뜻도 아니다. 목록을 더 잘게 나누면 숫자가 늘 수 있어, 자유 최소편집/바이트 guard와 의존성 계약 수정은 각각 같은 가족으로 묶었다. 엄격한 잔여 실패 수는 모든 기능적 보류나 완전성 미입증을 포함하지 않는다.

접근은 작업 메커니즘으로 센다. 문구 수정·재시도·평가자 추가·새 버전·기사 수·출력 수는 새 접근이 아니다. `확인된 잔여 실패`, `추가 이득 미관측`, `완전성 미입증`, `국소 수리/성공`은 서로 다른 주장이고 한 가족 안에 함께 존재할 수 있다. AI 판정과 출처 충실도 관측을 보고하는 것이며 인간 gold를 새로 확보한 것이 아니다.

## A01 — 구조화 보호목록·고정 질문

대상: P1. 계보: legacy/v1-v4, v8, v10.

원자 항목·귀속·시점·범위를 목록으로 만들고 고정 분모로 보존을 검사한다.

상태: 확인된 잔여 실패, 국소 수리/성공, 완전성 미입증.

항목 수·세부 체크리스트·v1/v2 재작성은 한 가족. v8의 위치 정정만으로 의미 누락을 세지 않으며 EN001/EN007의 새 주장 발견을 근거로 삼음.

근거:

- [experiments/v8/data/dev-errata.json](../v8/data/dev-errata.json): EN001, EN007: supplemental_claim_count=1 각각
- [experiments/legacy/repair-v3/minimum-wage-consistency.json](../legacy/repair-v3/minimum-wage-consistency.json): DEV01/F7 하위조건과 후속 재평가
- [experiments/v10/protocol/writer-v1.md](../v10/protocol/writer-v1.md): protection_inventory/source_anchor/outside_reference

같은 문제 실패 최소 수에 포함: P1.

## A02 — 원문–후보 양방향 의미감사

대상: P1, P2. 계보: v10, v12 B-v1, v15.

전체 원문과 실제 후보를 양방향 비교하며 수치·귀속·조건·시점·인접 관계를 확인한다.

상태: 확인된 잔여 실패, 완전성 미입증.

A03은 후보 보기 전 독립 질문 생성이라는 추가 조작만 별도. 단순 역방향 지시 반복은 A02.

근거:

- [experiments/v10/protocol/writer-v1.md](../v10/protocol/writer-v1.md): procedure (5), complete original against candidate in both directions
- [experiments/v12/REPORT.md](../v12/REPORT.md): 개발 실패: EN-DEV B-v1 P7 수치·타우·비교 삭제; P8 귀속 삭제

같은 문제 실패 최소 수에 포함: P2.

## A03 — 원문 선행 독립 질문·반례 감사

대상: P1, P3. 계보: v12 third-audit/H1, v15 H-S/S-B.

기존 목록·후보를 보기 전에 원문에서 질문/답/앵커를 저장하고 양방향 반례로 의미를 대조한다.

상태: 추가 이득 미관측, 국소 수리/성공, 완전성 미입증.

v15 source-first는 v12의 새 원리가 아니다. 사전 목록 개선과 최종 검출 개선을 분리.

근거:

- [experiments/v12/protocol/third-audit.md](../v12/protocol/third-audit.md): First read...Save...before opening candidate
- [experiments/v12/hidden-pairs/H1_method.txt](../v12/hidden-pairs/H1_method.txt): source_answer/exact_source_anchor; both directions
- [experiments/v12/REPORT.md](../v12/REPORT.md): 숨긴 최소쌍: H0/H1 같은 결과; 제3 감사 중대 공동미탐 새 확정 없음
- [experiments/v15/micro-results.md](../v15/micro-results.md): S-A/S-B M15 M92 M38 M67; 목록 필수8중 누락4→0, 최종7필드 동일

## A04 — 자유 최소패치·정확 범위·복원

대상: P2. 계보: legacy/v3-v4, v7 free, v8 local, v9 BASE, v10, v12 A.

자유 생성 수정안을 원문 앵커 범위로 제한하고 범위 밖 바이트 보존 및 롤백을 적용한다.

상태: 확인된 잔여 실패, 국소 수리/성공, 완전성 미입증.

앵커·해시 구현의 버전/자료형/경로 수리는 독립 의미해법으로 가산하지 않음. 자유 최소편집과 그 기계 guard를 보수적으로 한 가족으로 합침.

근거:

- [experiments/legacy/README.md](../legacy/README.md): repair-v4: 두 span씩, byte retention≠semantic completeness
- [experiments/v7/results.md](../v7/results.md): EVAL01–04 자유4/4
- [experiments/v9/results/followup-concern.json](../v9/results/followup-concern.json): REG_EN023 BASE; removal_as_demonstrated_correction=insufficiently_justified
- [experiments/v12/REPORT.md](../v12/REPORT.md): EN-DEV A P6 부수 삭제

같은 문제 실패 최소 수에 포함: P2.

## A05 — 유형 슬롯 렌더러

대상: P2. 계보: v7 typed v1/v2.

승인된 오류유형과 슬롯을 결정론적 템플릿으로 조립한다.

상태: 국소 수리/성공, 완전성 미입증.

유형 추가는 같은 메커니즘 수리. WHO 보류는 복구 실패지만 새 부수 의미손실이 확인된 실패는 아니므로 P2 실패 수에는 제외.

근거:

- [experiments/v7/protocol.md](../v7/protocol.md): T 세 방법; 초기6유형 및 v2 추가
- [experiments/v7/results.md](../v7/results.md): DEV v1 0/2→v2 2/2; EVAL03 WHO 원문 없는 제외조건 요구, 평가3/4

## A06 — 원문 연속구간 그대로 삽입

대상: P2. 계보: v7 source insert.

수정 없이 정확한 원자료 연속구간을 문맥 적합성 심사 후 삽입한다.

상태: 국소 수리/성공, 완전성 미입증.

인용 삽입의 문맥 보류는 기능적 복구 실패로 별도 기록; 부수손실 발생으로 바꾸지 않음.

근거:

- [experiments/v7/protocol.md](../v7/protocol.md): T 원문 구간 삽입
- [experiments/v7/results.md](../v7/results.md): EVAL02 NASA 마침표/세미콜론 문맥 부적합 보류; 평가3/4

## A07 — 발언 유지·자료 정정 분리 주석

대상: P2. 계보: v9 NOTE, v10.

원 발언을 귀속 그대로 남기고 별도 귀속된 자료 설명을 붙인다.

상태: 국소 수리/성공, 완전성 미입증.

v9 BASE의 날짜 삭제를 NOTE 실패로 전가하지 않음. v10 연결은 재발견이 아닌 후속 회귀.

근거:

- [experiments/v9/README.md](../v9/README.md): BASE/NOTE 조건 설명; 정상·동등·시점4/4
- [experiments/v10/results/report.md](../v10/results/report.md): 기후 회귀: 8월22일 기록 유지, 0.01/미만 별도 구분

## A08 — 절별 보존·반박·미확인 경계 게이트

대상: P2. 계보: v12 B-v2, v16 conflict v1/v2.

수정 경계에 걸린 각 주장을 분류하고 근거의 정확한 강도·범위와 인접 관계를 확인해 축소/복원한다.

상태: 확인된 잔여 실패, 국소 수리/성공, 완전성 미입증.

확인 실패는 KO 반박 근거 과장. EN 비교의 완전동치 미확정만으로 확정 손실을 세지 않음. v16 한 문장 지시 수리는 새 원리/별도 실패 접근이 아님.

근거:

- [experiments/v12/protocol/B-v2-boundary-gate.txt](../v12/protocol/B-v2-boundary-gate.txt): PRESERVE/REFUTED/UNVERIFIED; source silence is not refutation
- [experiments/v12/REPORT.md](../v12/REPORT.md): B-v2 KO 장애 완화 설명 과잉 반박; EN 정성 비교 동치 미확정
- [experiments/v16/conflict-controls-results-v2.md](../v16/conflict-controls-results-v2.md): 노출 오류2/2 및 새 합성1/1 근거 대안수정; 원문 오류 복원 안 함

같은 문제 실패 최소 수에 포함: P2.

## A09 — 선택 복원·필수 의존폐쇄·전체 후보 감사

대상: P2. 계보: v9 SELECTIVE, v13 G1, v14, v15 H-D.

독립 승인 수정을 살리고 필수 의존 성분만 함께 보류하며 선택 적용한 전체 후보를 감사한다.

상태: 확인된 잔여 실패, 국소 수리/성공, 추가 이득 미관측, 완전성 미입증.

v14 related union 결함과 v15 방향간선·실물 O+P/O+P+Q 증거는 같은 선택 의존 가족의 계약 수리. v13 양태 손실은 확인되나 중대성/전달 판단은 이견. K01은 부수손실보다 과잉보류 계약문제.

근거:

- [experiments/v13/v13/protocol/REVIEW_INSTRUCTIONS.md](../v13/v13/protocol/REVIEW_INSTRUCTIONS.md): dependencies; exact source/original anchors; full simultaneous candidate
- [experiments/v13/v13/results/RESULTS.md](../v13/v13/results/RESULTS.md): 영어 P7/P8, C3 may→단정 출처 충실도 손실; 별도 posthoc_operational_repair
- [experiments/v15/method-research.md](../v15/method-research.md): K01 P5/P2 related를 required로 전파한 계약불일치
- [experiments/v15/micro-results.md](../v15/micro-results.md): D M71 M24 M83 M46; A/B 의존성 판단 동일

같은 문제 실패 최소 수에 포함: P2.

## A10 — 전체 원문–후보 결정론적 대응표 가시화

대상: P1, P2. 계보: v16 M1.

동일 전체문서 입력에 span 대응표만 추가해 누락·부수손실의 가시성을 높인다.

상태: 추가 이득 미관측, 국소 수리/성공, 완전성 미입증.

A02 양방향 검사 계보이나 구체적 결정론적 표시 조작은 별도 메커니즘. 24출력은2방법×12단위이며 24접근이 아님.

근거:

- [experiments/v16/PREREGISTRATION.md](../v16/PREREGISTRATION.md): M0/M1 표시 조작
- [experiments/v16/RESULTS.md](../v16/RESULTS.md): 12단위 행동/전달해시 동일; 훼손6/6 복구, 정상4/4; U101/U206
- [experiments/v16/results-summary.json](../v16/results-summary.json): unit-level 결과

## A11 — 가린 별도 문맥·축별 평가와 재감사

대상: P3. 계보: legacy/v3-v4, v6, v9, v10, v12, v13, v15, v16.

조건명/상대 판정을 가리고 근거·보존·필수성·문맥을 별도 축으로 비교한다.

상태: 확인된 잔여 실패, 완전성 미입증.

평가자 추가·라벨 누출 수정·재시도는 같은 가족. 미가린 최초판정을 가린 실험으로 소급하지 않음.

근거:

- [experiments/v10/results/report.md](../v10/results/report.md): 판정 불일치: 전체7축 일치9/12,6/9
- [experiments/v12/REPORT.md](../v12/REPORT.md): 동일 KO 원문 R09 충족9/14 vs8/14; 45 필드 차이
- [experiments/v15/RESULTS.md](../v15/RESULTS.md): E1 necessity yes/unknown; unknown+accept 계약 불일치; 라벨 제거 재감사
- [experiments/v16/synthetic/v2/audit-result.json](../v16/synthetic/v2/audit-result.json): observations_with_field_disagreement=2, unsupported_finding_fields=3

같은 문제 실패 최소 수에 포함: P3.

## A12 — 고정 질문·삭제 반례로 필수성 분해

대상: P3. 계보: v12 necessity, v15 H-N/N-B.

원문 손실/자료 충돌/필수 답 부재/선택 배경을 나누고 같은 후보의 질문 대체 및 조건 삭제를 대조한다.

상태: 국소 수리/성공, 추가 이득 미관측, 완전성 미입증.

짧은 합성에서 성공. M62/M05 직접 모순 vs 조건 누락은 정의 경계여서 확정 추론 오류로 세지 않음. v15는 재현/구조화 확장.

근거:

- [experiments/v12/supplementary/necessity/protocol.md](../v12/supplementary/necessity/protocol.md): 세 최소쌍·고정 정의
- [experiments/v12/supplementary/necessity/RESULTS.md](../v12/supplementary/necessity/RESULTS.md): 3기반6문항12출력 잠정기대 일치
- [experiments/v15/micro-results.md](../v15/micro-results.md): N M54/M19 질문대체; M62/M05 conflict 해석 이견

## A13 — 모든 판정 일치시 전체 묶음 허용

대상: P3. 계보: v12 strict, v13 G0.

불일치·unknown이 하나라도 남으면 묶음 전체를 보류한다.

상태: 확인된 운영 한계, 완전성 미입증.

판정 이견 해결이 아니라 전파 차단. 보류10개=한 접근10결정. 유용수정 차단은 확인된 운영 한계지만 사실판정 오답10건이 아님.

근거:

- [experiments/v12/REPORT.md](../v12/REPORT.md): 실제10출력 전부 hold
- [experiments/v12/results/release-gate-results.json](../v12/results/release-gate-results.json): 실제 gate 재생
- [experiments/v13/v13/results/RESULTS.md](../v13/v13/results/RESULTS.md): G0 채택0; G1 대비 통과 수정도 보류

## 세 가지 불일치를 분리한다

- **사실/근거 충돌**: 같은 주체·시점·단위·범위에서 상충 명제를 실제 근거로 판정. 근거 미확인을 거짓으로 바꾸지 않음. 사례: v16 conflict v2 근거 대안수정3개, v9 REG_EN023 기존 날짜 반증 없음.
- **의미·필수성·중대성 해석**: 암묵적 조건·문맥 충분성·고정 질문에 대한 필수 여부 및 손상 크기. 근거 충실도 손실 인정과 중대성 이견을 함께 기록. 사례: v12 R09/R13, v13 영어 C3 양태, v15 E1/K15Q, v16 U101/U206.
- **가치/문체 선호**: 정책 동의·부정 어조·비판 불편·표현 취향만으로 반박이나 삭제를 정당화하지 않음. 의미 변화는 의미축으로 재분류. 사례: v13 REVIEW_INSTRUCTIONS preference_differences 규칙, v15 M38/M67 비판 보존 정상대조.

순수 가치/문체 이견의 발생 빈도를 이 기록에서 추정하지 않는다. v13 규칙은 선호를 별도 기록하라고 이미 명시했다. 실제로 남은 E1·K15Q의 필수성 이견을 정치적 가치 편향이나 확정 사실 오류로 단정하지 않는다. v16의 필드 분류 이견도 필요한 실제 수정 행동의 실패와 다르다.

## 이미 존재한 원문 절–근거 연결 원칙

- **v10** 작성 프로토콜은 원문 `source_anchor`, patch `before/after`, `evidence_ids`, 비보호표 항목 발견, 전체 원문–후보 양방향 비교를 요구했다.
- **v12** B-v2는 건드리는 각 절의 PRESERVE/REFUTED/UNVERIFIED와 정확한 강도·범위의 근거를 요구했다. H1은 원문 질문별 `source_answer`/`exact_source_anchor` 및 양방향 반례를 썼다.
- **v13** 검토 지시는 patch마다 원문 또는 source 문단 ID/정확 인용, 실제 동시 적용 후보와 주변 문맥, 필수 의존성, 이후 전체 후보 감사를 요구했다.

따라서 v17이 “처음 원문 절과 근거를 연결한다”, “처음 실제 수정문을 검사한다”, “처음 보존과 진실을 나눈다”라고 주장하면 안 된다. 새 기여가 있다면 기존 요소와 달리 추가한 정보·판정 규칙·표시/순서 조작을 명확히 고정하고, 실제 대조에서 확인한 범위만 말해야 한다.

## 최소값에서 제외하거나 기존 가족에 합친 실행

- **legacy A/B/C/D 전체 요약·중립화·다중자료**: 목표/정보 접근 함께 변한 기준군; 구조화 검증은 A01로 합침. 각 조건을 동일 최소편집 문제의 별도 실패로 세지 않음.
- **v6 새 문맥 C0/C1·의미영향 D0/D1**: 가린 축별 판단 A11 계보. D0/D1 실제 후보 결정 모두 같음; 추가 실패 접근 아님. 근거: `experiments/v6/README.md`.
- **v7 J 원자료 지지구간 삭제**: 근거 민감성 진단이며 평가자간 불일치를 해소하는 독립 방법 검증이 아님;4사건 지지/부족/지지. 근거: `experiments/v7/protocol.md`.
- **v11 최종 상태 메모·receipt**: 전달상태 지칭 문제; 세 의미문제와 동일 실패로 세지 않음. 근거: `experiments/v11/protocol/native-memo-v1.md`.
- **v12 source-scope 확대·v15 판결 전문 추가**: 자료 부족 해소라는 입력 개입. 추가 고유 방법 후보지만 세 문제 직접 메커니즘 최소값에서는 보수적으로 제외. 특정수치교정 성공/필수성이견 존속을 모든 접근 실패로 세지 않음. 근거: `experiments/v12/supplementary/scope/RESULTS.md; experiments/v15/RESULTS.md`.
- **v12 F/T 알려진 목표 본문 반영**: A04 최소수정의 명시 목표 회귀; F/T 둘다2/2이며 표의 우위 없음. 근거: `experiments/v12/supplementary/transfer/RESULTS.md`.

v16 conflict v1→v2는 보류 규칙 한 문장 수리 후 노출 합성 오류 2/2·새 합성 1/1이 복구된 별도 성공이다. 이 기록을 “모든 과거 제안 실패”에 포함하지 않는다. v13 may 복원도 사후 운영 수리 성공이며 기존 동결 gate가 양태 강화를 허용한 관측을 지우지 않는다. v15 K01의 관련성/필수성 계약 수리도 일반 보호목록 완전성 해결로 세지 않는다.

## 감사 범위와 계속할 문제

공개 파생본의 프로토콜·실제 집계·사례별 필드를 읽었으며, v14 K01 P2/P5의 두 원검토와 gate를 추가 대조했다. 초기 private 장부의 proposal-only 표기는 현재 결과로 보완했다. 공개 파일의 근거 경로와 ID를 [JSON 장부](approach-ledger.json)에 보존했다. 비공개 원자료를 전부 재판정한 감사가 아니며, 과거 접근의 효능을 새 실험 없이 재추정하지 않았다.

동일 문제에 대한 서로 다른 10가지 실제 실패는 세 문제 모두 확립되지 않았다. 실패 횟수를 채우기 위한 강제 반복이나 전면 포기 근거가 아니다. 확인된 잔여 문제를 다음 독립 검증 대상으로 유지한다.

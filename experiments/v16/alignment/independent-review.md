# v16 alignment 독립 감사

2026-10-03 UTC. 감사 대상 구현 SHA-256:
`332cd84522935d944f207c359ff937af90f02e94ef82bcb44cff44e69043bc95`.

범위: `alignment.py`, 기존 `test_alignment.py`, `prior-and-rules.md`의 대응표 조작 관련 문장. private/숨긴 자료, development 모델 출력, 개발 fixture/정답은 읽지 않았다. 테스트는 별도로 만든 짧은 합성 문자열만 사용했다. 구현 수정은 하지 않았다.

## 판단

M0/M1 모두 전체 O/C를 받고 M1에만 결정론적 표가 추가되는 조작에서, equal text가 원문/후보 전체에 이미 있으므로 표에서 생략하는 것 자체는 결함이 아니다. `all_segments`의 모든 equal/change 범위와 변경 인용을 조합하면 정상 생성 결과는 재구성 가능하다. 표 생성 함수만 검사했으므로 실제 호출의 조건 간 동일 입력/모델/예산은 이 감사에서 확인하지 않았다.

정상 생성기의 재구성 오류는 발견하지 못했다. 그러나 `replay()`를 외부/저장 artifact의 전체 대응표 검증기로 사용할 경우 아래 두 검증 공백이 존재한다. 현재 생성기가 잘못된 표를 자연 발생시킨다는 증거는 아니다.

## R1 — 전체 구간 대응표가 검증되지 않음

`alignment.py:37–57`의 replay는 `all_segments`를 읽지 않는다. O=`abc`, C=`axc`의 정상 artifact에서 `all_segments=[]`로 바꾸거나 equal 구간을 음수/범위초과/잘못된 타입 offset으로 바꾸어도 같은 C를 반환한다. O/C digest는 문서만 보호하므로 이 변조를 잡지 못한다. `build_alignment()`의 생성 시 coverage 검사는 저장 후 훼손을 검출하지 않는다.

영향: replay 통과를 '전체 대응표의 coverage 및 위치가 유효함'으로 해석하면 누락되거나 잘못된 위치 정보가 M1에 제공될 수 있다. 생성 직후의 신뢰된 artifact를 그대로 사용하는 경우에는 이 재현이 직접적인 생성 실패를 뜻하지 않는다.

## R2 — 반복 인용/삭제의 잘못된 후보 offset 수용

`alignment.py:53–56`는 후보 slice가 candidate_span과 같은지만 검사하고, 원문 위치와 앞선 삽입/삭제로 결정되는 정확한 후보 위치는 검증하지 않는다.

- O=`abc`, C=`XabcX`: 마지막 삽입의 후보 `[4,5)`를 `[0,1)`로 바꿔도 replay가 성공한다. 첫 X와 마지막 X가 동일하기 때문이다.
- O=`abc`, C=`ac`: 삭제 위치의 후보 `[1,1)`를 `[0,0)`로 바꿔도 replay가 성공한다. 빈 span은 모든 빈 구간에서 일치한다.

영향: 문서는 정확히 복원되어도 표가 지시하는 변경 위치는 틀릴 수 있다. 후보 offset의 단조성 검사만 추가해도 삭제의 잘못된 위치 문제는 남으므로, 실제 편집 진행 위치 또는 결정론적으로 재생성한 canonical 대응표와 대조해야 한다.

## 실행 증거

저장소 루트에서 `python -m unittest discover -s experiments/v16/alignment -p 'test*.py' -v`

12 tests passed (기존 5 + 독립 7, 0.007s). 독립 테스트에는 225개의 짧은 문자열 쌍에 대한 재구성/coverage/결정론성 확인, 반복 문구, emoji/ZWJ, 조합형 Unicode, CRLF, NUL, digest 및 기본 원문 offset 변조 검사가 포함된다. Unicode 정규화는 하지 않으며 Python code point offset이라는 표시는 구현과 일치한다.

주의: `test_repro_r1_*`, `test_repro_r2_*`의 PASS는 잘못된 artifact를 현재 코드가 수용한다는 재현 성공이다. 결함이 해결됐다는 의미가 아니다. 수정 후에는 이 재현을 보존하고 별도 거부 회귀검사로 확인할 수 있다.

안전한 로컬 합성 테스트 실행과 기계적 재구성 확인만 수행했다. 이는 AI 의미판정의 안전성, 의미 동등성, 오류 탐지 성능 또는 M1의 효과를 보장하지 않는다. 두 검증 공백은 수정/재검증 전까지 남아 있다.

## 수정 후 재검토 1

root가 schema 2, context_characters, canonical rows/all_segments 재생성 비교를 추가한 구현을 독립 재검토했다. 초기 양성 재현 파일은 `reproduction_before_fix.py`에 그대로 보존했다. 이 파일은 수정 전 구현 대상으로 실행해야 하며 기본 unittest 검색 대상이 아니다. `test_independent_review.py`의 초기 재현 3개는 ValueError 거부 회귀검사로 전환했다.

R1/R2의 원래 재현은 모두 거부된다. 그러나 추가한 3개 거부 검사에서는 다음 잔여 문제가 확인됐다 (총 15개 중 12 PASS, 3 FAIL).

- R3: canonical Python dict/list 비교는 값의 엄격한 타입까지 검증하지 않는다 (`True == 1 == 1.0`). `abc`→`axc`에서 변경 row의 candidate_start=True 또는 1.0, 첫 segment의 original_end=1.0 또는 candidate_end=True, equal 생략 flag=1이 수용된다. 실제 정수 slice 소비자에서는 float offset으로 예외가 나거나 타입 계약을 위반할 수 있다. offset 전체의 strict int, flag의 strict bool 검사가 필요하다.
- R4: `offset_unit`은 검증하지 않는다. `🙂abc`→`🙂axc` artifact에서 표시 단위를 `UTF-8 bytes`로 바꾸어도 통과한다. 실제 offset은 Python code point이므로 표를 잘못 해석할 수 있다. 고정 단위 문자열을 검증해야 한다.

새 테스트 이름: `test_r3_candidate_offsets_require_strict_integer`, `test_r3_segment_offsets_and_flags_require_strict_types`, `test_r4_wrong_unicode_offset_unit_rejected`. 구현은 이 감사자가 수정하지 않았다. 숨긴/development 자료는 여전히 읽지 않았다.

## 수정 후 재검토 2 — 최종 결과

root의 후속 수정은 `offset_unit` 고정 문자열을 검사하고 rows/all_segments를 `json.dumps(sort_keys=True, ensure_ascii=False, allow_nan=False)`로 canonical 직렬화한 결과와 비교한다. 이 방법으로 이번 bool/int/float 혼동 재현이 거부되는 것을 확인했다. 정상적인 JSON artifact 범위에서 R1–R4 재현은 모두 해결됐다. 추가적인 실제 결함은 이번 한정된 재검토에서 발견하지 못했다.

최종 대상 `alignment.py` SHA-256:
`41af0323bfa99016ad5508b271120263019f3ca1859f5afd1456a375c2224dd9`.

동일 unittest discover 명령 결과: **15 tests PASS, 0.022s** (기존 5 + 독립 10). 초기 양성 재현은 `reproduction_before_fix.py`에 보존되어 있으며 현재 회귀검사는 변조 거부를 검증한다. 위 초기 감사/재검토 1의 미해결 표시는 각 당시 구현에 대한 역사적 결과이고, 최종 상태는 이 절을 기준으로 한다.

현재 범위에서 알려진 미해결 차단 사항은 없다. 재구성 및 표 무결성 검사의 통과는 의미안전 또는 실험 효과의 보장이 아니다. 실제 조건 입력/모델 실행의 통제 준수 여부는 이 코드 감사 범위 밖이다.

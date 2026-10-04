# v19 현재 실행 경로 종료 적합성 코드 감사

새 기사나 숨긴 평가 입력을 열지 않고 공개 합성 fixture만 사용했다. 원문·모델 실행·평가 기록·과거 코드는 바꾸지 않았다. 확인한 새 결함은 **현재 안내된 v15 완료 평가 집계 경로의 realization 중복 ID 덮어쓰기**다. 이는 새 편집 방법이나 새 모델 실험이 아니다.

## 실제 재현과 수리

`v15/code-audit/aggregation/score_T_checked.py:89–110`은 blind/raw/mapping ID를 검사한 뒤 동결 v7 scorer를 호출한다. `v7/tools/score_T.py:73`은 같은 보고서의 `(case_id, method)`가 반복되면 마지막 record로 덮어쓴다. 따라서 기존 판단 ID 수리만으로 전체 집계 입력의 유일성이 보장되지 않는다.

합성 입력은 original=`draft`, revised=`fixed`이며 완성문·mapping·returned SHA-256은 모두 일치한다. 같은 free record를 `applied`, `model_hold` 상태로 중복한 뒤 순서만 바꾸면 v15 checked는 둘 다 승인하지만 repair_success가 false/true로 달라진다. `record-order-evidence.json`이 실제 실행 결과다. 보존된 실제 실험이 오염되었다는 증거는 아니다.

별도 `score_T_checked_v2.py`는 할당 case ID의 타입·공백·중복, 보고서별 realization key 중복, 알려지지 않은 case/method, free 후속 보고서의 범위, 누락된 할당 key 및 선언된 prepared hash를 먼저 검사한다. 동일한 record의 반복도 거부한다. 오류면 결과를 쓰지 않는다. 원래 상태의 의미나 평가 라벨은 변경하지 않는다. 실제 producer(`v7/tools/realize_T.py:163–169`)는 첫 보고서에서 세 방법을, 명시적 free 후속에서 free만 생성하므로 **서로 다른 두 단계의 정상 free 갱신은 유지**한다. 이를 보고서 내부의 중복과 혼동하지 않는다. 선언하지 않은 prepared hash를 새 필수 필드로 만들지는 않았다.

```bash
python experiments/v19/code-audit/reproduce_record_order.py
python -m unittest discover -s experiments/v19/code-audit -p 'test_scoring_paths.py' -v
python experiments/v19/code-audit/score_T_checked_v2.py --phase PHASE --root PUBLIC_ROOT --private PRIVATE_ROOT --output NEW_RESULT.json
```

## 현재 실행과 역사 재생의 경로

| 용도 | 실제 경로 | 판정 |
| --- | --- | --- |
| v18 원실험 재생 | `v18/aggregate.py:28` → `v18/code/check_output.py` → v17 checker | 의도적으로 동결됨. 원래 순환 의존 실패도 보존 |
| 새 전체 기사 원자 동시 적용 | `v19/code-audit/check_output_strict.py` → `v18/code/check_output_v3.py` → 동결 checker | 엄격 식별자 검사 후 모든 선언 패치 적용; 필요 상대 누락·부분 완성문 거부 |
| 새 receipt 생성 | `v15/code-audit/receipt/patch_engine.py` | 기존 경로 충돌 수리 유지; 기존 파일 비절단 |
| v7 완료 평가의 새 집계 | 기존 v15 checked → 새 v19 checked_v2 | 이번 결함이 실제 도달하는 경로. v18 aggregate는 이 scorer를 호출하지 않음 |
| 저장 산출물/합성 CI | `tools/run_checks.py` | v15 수리와 v17/v18 검사를 실행. 새 v19 집계·입력 검사 모음도 연결 |

writer-v2는 original_quote와 candidate_quote **모두 입력 O=C의 인용**이라고 명시한다. 수정문 인용을 이 필드에서 거부하는 것은 현재 결함이 아니다. 새 단어는 patches.after와 full_edited_article에만 놓는다. 최종문은 모든 패치를 원문 위치로 동시 적용한 결과와 일치해야 한다. 현 v3 테스트와 추가 matrix는 필요 상대 누락, 부분 출력, 겹치는 앵커, 수정 후 만들어진 앵커, 출처 ID 불일치, 잘못된 output 타입을 거부함을 확인했다.

## 범위와 남은 한계

`checker-matrix.json`은 v3가 공백 unit ID, 공백 source ID, 사용되지 않는 숫자 source ID, 중복 protection ID를 받아들임도 기록한다. 이는 입력/선언 식별자 검증의 공백이다. 잘못된 기사 적용 또는 실제 결과 오염을 보인 사례와 구분한다. 별도 `check_output_strict.py`가 이 ID들을 거부하고 입력·출처 text/container 타입도 검사한다. v18 checker는 수정하지 않았다. 유효 입력의 완성문은 v3와 동일하며 입력 객체도 변하지 않는다. 이 어댑터는 별도 호출 경로이고 새 기사 실행 엔진에 자동 적용하지 않았다.

receipt 수리의 20개 CLI 경로와 집계의 full candidate/mapping hash 결합을 다시 검사했다. receipt README가 이미 밝힌 I/O 실패의 빈 receipt/부분 신규 출력 가능성은 새로 발견한 결함으로 세지 않는다. 성공 종료를 요구해야 하며 두 파일 트랜잭션이라는 보장은 없다. source support, 보존목록의 완전성, 의미적 정확성은 이 기계 검사로 증명하지 않는다.

`focused-tests.txt`: v17 10, v18 19, receipt 1(내부 20 CLI 사례), v15 집계 15, 새 집계 12, 엄격 입력 9 = **66 테스트 메서드 통과**. 기존 기사·평가 총계를 다시 계산하지 않았다. 외부 호출·유료 API·새 모델 호출은 0이다.

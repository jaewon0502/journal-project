# v15: unexpected judged ID 집계 결함 검증

실제 결함을 확인했다. `experiments/v7/tools/score_T.py:114`는 blind input에 속하는지와 무관하게 중복되지 않은 모든 raw judgment를 `unique_judged_outputs`에 더한다. `unexpected_judgment_ids`를 별도 표시하지만 정상 결과 파일도 저장한다. 따라서 synthetic blind output 1개에 unknown ID 하나를 추가하면 unique judged 수가 1에서 2로 늘어난다. semantic event/method 행은 mapping으로 연결하므로 이 unknown ID가 semantic 성공 수나 assigned event/case/method 분모를 직접 늘리지는 않는다. 이 결함은 출력별 판정 수와 이를 후속 분모·완료율로 사용하는 경우에 영향을 준다.

## 수정 범위와 동결 보존

v7 README는 원 알고리즘 보존을 명시하고 `code-provenance.json`이 코드 계보를 기록한다. 따라서 v7 코드, 결과, 입력, 평가를 수정하지 않았다. 새 `score_T_checked.py`가 완료된 평가의 identity 검사를 먼저 수행한 뒤 기존 scorer를 호출한다. 유효한 입력에서는 전체 결과가 기존 scorer와 같음을 테스트했다. 기존 v7 CLI 자체의 동작은 바뀌지 않으므로 새 완료 평가에는 아래 검사 버전을 사용해야 한다.

- unknown extra: 현재 blind ID에 없고 확인 가능한 다른 phase에도 없는 ID.
- wrong phase: 현재 blind ID에 없지만 실제 다른 phase blind input에 있는 ID. 문자열 모양으로 phase를 추정하지 않는다.
- duplicate: raw judgment 및 blind input 각각에서 ID 중복을 검출한다.
- missing: 현재 blind input에 있으나 raw judgment에 없는 ID.

어느 하나라도 있으면 구조화된 진단을 담은 `JudgmentIdentityError`를 발생시키고 결과 파일을 쓰지 않는다. 잘못된 ID를 조용히 버리거나, 임의 분모에 더하지 않는다. extra와 missing이 서로 상쇄해 총개수가 같은 경우도 실패한다. 이 버전은 완료된 평가를 위한 검사이므로 기존 scorer의 pending/missing 허용 흐름을 대체하지 않는다. 다른 phase 자료가 없으면 외부 ID의 phase를 확정할 수 없어 unknown extra로 분류하되 동일하게 거부한다.

```bash
python experiments/v15/code-audit/aggregation/score_T_checked.py \
  --phase eval --root /path/to/public-run \
  --private /path/to/private-inputs --output /path/to/new-result.json
```

기존 scorer의 의미 판정·mapping·해시 검증은 그대로 사용한다. ID는 공백 이외 문자가 하나 이상 있는 문자열이어야 한다. 숫자·boolean·null·빈 문자열·공백만 있는 문자열·list·dict는 Counter나 집합 구성 전에 구조화된 진단으로 거부한다. 다른 phase blind/raw ID도 같은 규칙으로 검사한다. 문자열은 강제 변환하거나 trim하지 않는다. mapping의 ID 집합은 blind 집합과 같아야 하고, prepared의 모든 case/method 조합을 중복 없이 정확히 포함해야 한다. 이 검사는 전반적인 JSON schema나 의미 판정을 검증하는 새 평가기가 아니다. 입력을 읽는 동안 다른 프로세스가 파일을 바꾸는 경우까지 보호하지 않으며, 동결 입력을 전제로 한다.

## 실제 실행 증거

실행일: 2026-10-03. 모든 재현 입력은 임시 디렉터리의 합성이며 연구 표본이나 모델 실행 수에 포함하지 않는다.

```bash
AGGREGATION_BACKEND=legacy python experiments/v15/code-audit/aggregation/test_aggregation.py
# exit 1: 8개 중 6개 실패 (before-tests.log)
python experiments/v15/code-audit/aggregation/test_aggregation.py
# exit 0: 8개 통과 (after-tests.log)
python experiments/v15/code-audit/aggregation/reproduce.py
# reproduction.json: 기존 judged=2, 기대=1, 새 버전 결과 저장 없음
python experiments/v15/code-audit/aggregation/audit_existing.py
# existing-impact.json: 공개 동결 결과의 읽기 전용 재집계
python experiments/v15/code-audit/aggregation/audit_private_ids.py \
  --root /path/to/original-v7 --private /path/to/original-v7-private
# private-id-impact.json: 원본 blind/raw/mapping 읽기 전용 ID 감사
python -m unittest discover -s experiments/v7/tools -p 'test_*.py'
# exit 0: 기존 테스트 21개 통과 (legacy-regression.log)
```

## 기존 결과 영향

`existing-impact.json`에 각 동결 summary 및 기존 scorer의 SHA-256, 공개행의 unique ID 수, metadata 진단, semantic 재집계 수치를 기록했다. v7 dev-v1/dev-v2/eval의 공개 unique judged 수는 각각 10/10/20이며 공개행에서 복원한 수와 같다. 세 결과 모두 unexpected/duplicate/missing 목록이 비어 있고 event 및 assigned-method 분모도 공개행과 일치한다. 공개 의미 결과 재집계도 통과했다. 따라서 **공개된 세 결과에서 이 결함으로 인한 수치 불일치는 관측하지 못했다.**

추가로 작업환경에 유지된 원 private blind inputs/mapping, 원 raw judgment 및 원 summary를 **읽기 전용으로** 전수 확인했다. `private-id-impact.json`은 원문·판정문·opaque ID·비공개 경로 없이 count/hash/boolean만 저장한다. 세 phase blind/raw는 각각 10/10, 10/10, 20/20이며 unknown extra, wrong-phase extra, duplicate, missing은 모두 0이다. mapping case/method 쌍 18/18/36은 중복 없이 공개행과 일치한다. 원 summary의 판정 전체가 raw와 같고 raw SHA-256은 원 summary provenance와 일치한다. 공개 summary는 source evidence/read_scope를 비공개 처리하므로 원 raw 전체 dict와 비교하지 않고, `outcome()`이 실제 사용하는 판정 필드 및 ID 전부를 비교했으며 일치했다.

따라서 유지된 원본 세 phase에도 이 ID 집계 결함으로 인한 결과 변경은 없다. 원본 데이터를 수정하거나 새 사실성 판단을 실행하지 않았다. private 자료는 공개 저장소에 배포하지 않으므로 공개 사용자에게 제공되는 재현 범위는 합성 회귀 검사와 공개 summary 재집계이며, 원본 감사 결과는 해시와 집계 증거로 제공한다.

## 독립 검토 후 강화

독립 검토가 추가로 제시한 malformed ID 재현을 `adversarial_reproduction.py`로 보존했다. `adversarial-before.json`은 최초 wrapper에서 null/boolean/number/빈 문자열이 승인되거나 list/dict가 일반 TypeError가 되는 실제 실행 기록이다. 수정 뒤 `adversarial-after.json`은 7개 모두 구조화된 `JudgmentIdentityError` 및 결과 미저장을 보인다. 빈 mapping과 일부 case/method 누락도 거부하도록 검사했다. 기존 결과 파일이 있는 경우 실패해도 바이트가 그대로 보존됨을 확인했다.

`adversarial-regression-after.log`: 확장된 회귀 테스트 **15개 통과**. 초기 8개 테스트의 before/after 로그는 덮어쓰지 않고 보존했다. 원 private 감사도 강화된 ID 타입 규칙으로 다시 실행했으며, 모든 원 blind/raw ID는 공백만이 아닌 문자열이고 기존 ID 검사도 전부 통과했다.

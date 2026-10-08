# 별도 계정의 원격 변경 확인

2026-10-03 v16 출력·사전참조 동결 뒤 [PR 4](https://github.com/jaewon0502/journal-project/pull/4)의 실제 files diff와 공개 README·human-reference.json을 읽었다. 22개 변경 파일을 확인했다. `tools/run_checks.py`에 별도 source-evidence-ai-review 재집계·검사가 추가됐으며 v15 경로와 legacy 결함 구현은 변경 목록에 없다. v6 README·해시 목록에는 후속 자료 안내가 추가됐다.

이는 다른 계정 h2g0219-ops의 공개 작업이다. 우리가 v15를 공개·푸시했다는 뜻이 아니다. 현재 로컬 실험은 기존 base를 유지했고 원격 변경을 병합하거나 덮어쓰지 않았다. 향후 통합 시 검사 실행기의 새 블록을 양쪽 모두 보존해야 한다. 현재 패키지의 `tools/run_checks.py`를 최신 main에 통째로 덮어쓰면 그쪽 새 검사가 사라질 수 있으므로 그대로 적용하면 안 된다.

별도 자료는 현재 숨긴 실험의 입력·분모·참조에 혼입하지 않았다. 해당 README는 법원 자료6개·후속 답안12개·위치55개, 재사용 원문 기반 합성18문장 및 적응적 후속 확인을 설명한다. 이를 v16의 새로운 실제 기사나 미사용 평가로 합산하지 않는다. 역사적 v6 점수와 미복구 obligation mapping도 이번 변경으로 해결됐다고 보지 않는다.

공개 인간참조 파일은 과거 참여자1명의 부분 중요도 응답3개를 기록하지만 원문 독해 확인·이유·공개 raw 응답·기술적 가림이 없다. 이번 새 인간 응답은0이다. v14·v15·v16의 사람 평가0은 유지하되 프로젝트 전체 인간 응답0이라고 확대하지 않는다.

검토 링크: [별도 패키지 README](https://github.com/jaewon0502/journal-project/blob/ef6c19127df471401e6bc5411047c773a48b7b0f/experiments/source-evidence-ai-review/README.md), [부분 인간참조](https://github.com/jaewon0502/journal-project/blob/ef6c19127df471401e6bc5411047c773a48b7b0f/experiments/source-evidence-ai-review/data/human-reference.json).

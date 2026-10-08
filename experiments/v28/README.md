# v28 재감사 패키지

RESULTS.md는 정정/현재 판정, METHOD.md는 실험 범위, LINEAGE.md는 중복 가설 검토, SOURCES.md와 source-manifest.json은 원문 링크/수집 버전이다. input-checks.json은 원출력 동일성, local-patch.json은 실제 국소 수정 구간이다. private-artifact-manifest.json은 전체 입력/원감사/표적진단의 해시다. 기사 전문과 전체 최종문은 공개하지 않았다.

재실행: `python3 experiments/v28/replay.py PRIVATE_DIR V27_RAW_DIR`

원문 보존과 부록 제거/정확 패치 적용을 확인한다. 동일 문맥 AI의 의미 판단을 재현하거나 사실성을 보증하지 않는다. 전체 검증에는 승인된 비공개 입력과 동일 원자료 버전이 필요하다. 공개 패키지 단독으로 원문 의미검증을 재현할 수 없음을 명시한다.

v27 원보고서/출력/평가를 바꾸지 않았다. v28 결과를 v27 원점수의 대체값으로 사용하지 않는다. 이전 새 기사도 이번에는 노출 사례다. 새 계열 접근/신규 실제 사건 추가0. 원자료 접근/형식검사/의미감사를 단일 점수로 합산하지 않는다.

재현성 보완: [REPRODUCIBILITY-CORRECTION.md](REPRODUCIBILITY-CORRECTION.md). replay는 V27_RAW_DIR 옆 inputs 디렉터리의 원기사/자료도 대조하며 다른 위치는 `--v27-input-dir PATH`로 지정한다. 공개 local-patch.json을 replay.py와 같은 디렉터리에 유지한다. 합성 변조 검사: `python3 experiments/v28/test_replay.py`. 일반/최적화 Python 모두 검사하며 원기사 전문 없이 실행할 수 있다.

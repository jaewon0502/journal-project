# v16 원문 보존·최소수정·평가 불일치

- [한국어 핵심 결론과 실행 절차](SUMMARY.md)
- [실제 기사 기반 24출력 결과](RESULTS.md), [사전등록](PREREGISTRATION.md)
- [근거 위치·최소 수정 예](protection-examples.md), [사용 절차·중단 기준](usable-procedure.md)
- [원자료 후속 조사](primary-followup.md), [실제 후보의 독립 감사와 재수정](primary-followup-audit.md)
- [불확실 사례 진단](uncertainty-followup.md)
- [합성 충돌 대조 v1](conflict-controls-results-v1.md), [규칙 수정·회귀·새 합성 전이 v2](conflict-controls-results-v2.md)
- [별도 원격 PR과의 통합 주의](remote-integration-note.md)

`python tools/run_checks.py`는 저장소 루트에서 공개 파생본과 합성·기계 검사만 실행한다. 실제 AI를 새로 호출하거나 비공개 기사 전문의 의미를 다시 평가하지 않는다. `python experiments/v16/synthetic/replay.py`는 공개 합성 원출력 파생본의 해시·적용 계약·행동 개수를 확인한다. 해당 자료의 문장은 허구이며 실제 기사 원문이 아니다.

실제 기사 입력·긴 후보·긴 원자료는 공개본에 포함하지 않았다. 그 자료를 보유한 경우에만 `aggregate.py --private-root PATH`로 동결 해시와 실제 저장 평가를 재집계할 수 있다. exact 배포 버전·seed·비용은 unknown이며 사람 평가는0이다.

규칙 v2의 사전등록은 공개 `synthetic/v2/prereg.md`에 보존했다. v1의 실패 기준을 바꿔 성공으로 만들지 않았다. 준비 단계 검사기의 'No writers executed' 출력은 준비 당시 고정 안내문이며 이후 모델 실행 여부를 동적으로 확인하지 않는다. 이번 실행 건수는 실제 저장 원출력과 해시에서 별도로 확인했다.

현재 패키지를 최신 원격 main에 통째로 덮어쓰면 별도 PR4의 실행기 추가 사항이 사라질 수 있다. 새 디렉터리에서 독립 재현하거나 통합 전에 실제 diff를 확인해야 한다. 이 회차에서 원격 push·merge·배포는 하지 않았다.

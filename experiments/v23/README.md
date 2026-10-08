# v23 결과 안내

- [한국어 종합](SUMMARY.md)
- [통제 비교](MAIN-RESULTS.md), [자동 질문 회귀](AUTO-QUESTION-RESULTS.md)
- [신규 실제 전이 실패](TRANSFER-RESULTS.md), [후속 수리](REPAIR-RESULTS.md)
- [사전 설계](PREREGISTRATION.md), [독립 접근 계보](APPROACH-LEDGER.md)
- [평가 일탈](PROTOCOL-DEVIATIONS.md), [검사기 정정](CHECKER-CORRECTION.md)
- [방법 리서치](LITERATURE.md)

재실행: 저장소 루트에서 `python tools/run_checks.py`. v23만은 `python experiments/v23/replay.py`와 `python experiments/v23/binding-controls/replay.py`.
이는 저장된 합성 산출물의 문자 패치 재현이며 새 AI 실행/사실 검증이 아니다. 별도 AI 재실행은 동결 정책과 입력을 새 문맥에 전달해야 하며, 같은 출력 재현을 보장하지 못한다. 저작권 있는 기사/원자료 전문과 긴 원출력은 비공개 로컬에 보존했다. 공개 입력으로 실제 기사 실험 전체를 재실행할 수 있다는 뜻은 아니다.

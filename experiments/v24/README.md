# v24 결과 패키지

- [한국어 종합](SUMMARY.md), [접근 횟수](APPROACH-COUNTS.md)
- [원실험 결과](MAIN-RESULTS.md), [실행기 수정/회귀](CODE-FOLLOWUP.md), [SI 단위 전이](SI-RESULTS.md)
- [원 사전계획](PREREGISTRATION.md), [후속 사전계획](FOLLOWUP-PREREG.md)
- [관련 원논문 리서치](METHOD-RESEARCH.md), [접근 불가 논문 기록](BLOCKED-PAPER.md)
- cases/와 certificates/: 명시적 합성 원자료·AI 비교장부. edited/: 실제 AI 편집 출력. delivered/와 v2-replay/: 기계적 파생본/보조 재생. oracle.json: 생성자 기대이며 독립 평가 대신 쓰지 않음.

저장소 루트에서 `python tools/run_checks.py`. 이 회차만 `python experiments/v24/replay.py`, `python -m unittest discover -s experiments/v24/code_v2 -v`. 기존 실행기 반례는 `python experiments/v24/code-audit-replay.py`, 수정 후 독립 재검사는 `python experiments/v24/code-audit-v2-replay.py`.

재생은 저장 결과 일치/구조 계약을 확인한다. 새 AI 실행이나 사실·의미 검증이 아니다. 새 실행은 동결된 정책/합성입력을 별도 문맥에 제공해야 하며 결과 동일성을 보장하지 못한다. 기존 원실험/원평가와 접근 불가 실제 논문의 미확인 상태를 보존했다.

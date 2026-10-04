# v21 후보 선택과 후보 없는 발견 비교

이번 회차는 v20에서 미실행이던 고정 패치 선택 비교를 실제 실행하고, 차이가 없자 원문에서 후보 없이 사실 차이를 기록하는 비교까지 이어갔다. 기존 점수·출력을 소급 변경하지 않았다. [핵심 결과](SUMMARY.md), [선택 실험](SELECTION-RESULTS.md), [발견 개발](DISCOVERY-DEVELOPMENT-RESULTS.md), [발견 이식](DISCOVERY-TRANSFER-RESULTS.md).

- [선택 사전 기준](PREREGISTRATION.md), [발견 사전 기준](DISCOVERY-PREREGISTRATION.md), 실제 사용 지시문 `policies/`.
- 선택16개 사례 출력은 4개 별도 선택 문맥에서 생성했다. 발견8개 사례 출력은 6개 별도 문맥에서 생성했다. 반복 수나 파일 수를 사건 수로 세지 않는다.
- 각 모듈의 개발/이식에 독립 AI 평가 문맥1개씩, 총4개. 각각 원문 선행 PRE를 저장한 후 익명 출력을 평가했다. 출력 형태/분량에서 방법을 추측할 가능성은 남는다. 인간 검증 아님.
- 2개 새로운 기사/원자료 맥락: 벌 사회학습과 DART 초기 결과. 실제 기사에 연구자가 넣은 오류/미확인 변형과 순수 합성 경계를 구별한다.

공개 패키지는 전문을 포함하지 않는다. 실제 원문·긴 모델 출력·감사 원기록은 비공개 작업 폴더에 보존했고 해시를 공개했다. 같은 원자료가 없는 환경에서 해시만으로 전체 의미 감사를 재현할 수는 없다. 새로 수집한 페이지는 판본이 바뀔 수 있다.

```bash
python tools/run_checks.py
python experiments/v21/replay_selection.py --private-root PRIVATE_ROOT --output selection-replay.json
python experiments/v21/replay_discovery.py --private-root PRIVATE_ROOT --output discovery-replay.json
```

뒤 두 명령은 허가된 비공개 기록이 있어야 한다. 파일 동일성·정확한 문자열 치환·근거 구간 존재를 확인할 뿐 새 모델 생성이나 의미 재판정을 하지 않는다. 새 생성은 같은 입력/정책을 별도 문맥에 제공하고 새 버전과 실제 출력을 저장해야 한다. 현재 runtime 배포버전/seed/비용은 미통제. 추가 유료 API·새 인증·원격 push·Page 수정·외부 연락 없음.

# v17 원자료 관계와 최소 수정 연구

기존 원실험을 보존한 후속 회차다. 동일 자료에서 BASE와 명시적 관계 추적 LINK를 비교하고, 실제 원문 오류를 별도로 국소 수정했다. 보호목록의 완전성을 보장하거나 정치 편향 감소를 입증한 연구가 아니다.

- [통합 판단과 남은 문제](SUMMARY.md)
- [실제 평가 16출력의 결과·분모·비용](RESULTS.md)
- [실제 NASA 원문 오류의 수정 전후](natural-followup.md)
- [바로 사용하는 절차와 보류 기준](usable-procedure.md)
- [사전등록](PREREGISTRATION.md), [방법 설계](method-design.md), [변경·차이 기록](deviations.md)
- [개발 실패와 노출 회귀 점검](development-results.md)
- [v1–v16 접근 장부](approach-ledger.md)
- [표지 해석 후속](annotation-results.md) — 6개 국소 기록의 별도 두 평가자 검증, 원점수 재채점 아님
- [출처와 실제 읽은 범위](sources-metadata.json), [집계값](results-summary.json), [원기록 해시](raw-hashes.json)

공개 패키지는 분석·검사 코드·짧은 사례 설명·메타데이터를 제공한다. 수집 기사 및 원자료 전문, 실제 기사 전체를 포함하는 입력·적용문·긴 원출력은 비공개 보존하며 공개 전재하지 않는다. `aggregate.py --private-root <private-evidence-directory>`는 보존된 비공개 증거가 있어야 실제 결과를 재집계한다. 공개 코드만으로 새로운 모델 생성을 재현했다거나 모든 실제 입력을 배포했다는 뜻은 아니다.

검사는 `python -m unittest discover -s experiments/v17/code -p 'test_*.py'`로 실행한다. 이는 구조·앵커·참조·적용 계약의 소프트웨어 검사이며 AI 의미 판단의 정확성 검사와 구분한다. 새 모델 호출이나 비용을 유발하지 않는다. 전체 저장소 검사 수는 실행 확인 후 상위 보고서에 기록한다.

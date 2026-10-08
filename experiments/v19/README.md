# Journal v19 재현 패키지

[요약](SUMMARY.md) → [실제 결과](RESULTS.md) → [후속 롤백·합성 시험](followup-results.md) → [자료](source-access.md) → [코드 감사](code-audit/README.md) → [종료 범위](CLOSURE.md).

사전 설계는 PREREGISTRATION.md와 protocol, 실제 실행 변경은 iteration-ledger.md에 있다. 원문 전문·실제 자연 기사 전체 출력은 공개하지 않는다. 원자료 링크와 입력/출력/평가 해시를 남기고 비공개 원기록을 보존했다. 합성 입력·실제 합성 모델출력·감사는 공개해 재생할 수 있다.

```bash
python tools/run_checks.py
python experiments/v19/synthetic/replay.py
python experiments/v19/code-audit/reproduce_record_order.py
```

위 명령은 저장 기록과 합성 코드 fixture를 검사한다. 새 모델 생성 실험이 아니다. 자연 기사 출력의 재집계는 승인된 비공개 기록을 가진 환경에서만 가능하다.

```bash
python experiments/v19/aggregate.py --private-root PRIVATE_ROOT --output NEW_RESULT.json
```

같은 원문을 다시 수집해도 웹 수정으로 해시가 달라질 수 있다. 새 원문 버전·모델 출력은 별도 회차로 기록한다. 새 문맥의 모델 실행은 공개 코드만으로 자동 API 재현되지 않는다. 정확한 배포 모델·seed·비용은 미통제다. 지시·입력·분모·문장별 판단을 재검토할 수 있는 수준의 재현성과 완전히 결정적인 모델 재현을 구분한다.

로컬 연구 스냅숏이다. 원격 main의 별도 변경을 통합하지 않았으므로 이 패키지로 원격 저장소를 덮어쓰지 않는다. 새 디렉터리에 풀어 검사한다. 이전 회차의 원점수와 실패 기록은 불변이며 후속 검증으로 소급 변경하지 않는다.

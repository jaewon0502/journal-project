# Journal v20 실패 단계·검사 범위 진단

[현재 상태](STATUS.md), [재현 실패 목록](FAILURE-REGISTER.md), [접근 횟수](APPROACH-COUNTS.md), [외부 자료 식별](EXTERNAL-INPUTS.md), [가설](HYPOTHESES.md).

실제 4조건 [진단 설계](DIAGNOSTIC-PREREGISTRATION.md)·[결과](DIAGNOSTIC-RESULTS.md), 새 관계 4조건 [이식 설계](TRANSFER-PREREGISTRATION.md)·[결과](TRANSFER-RESULTS.md). 이 8개는 기준 작성 출력이며 새 기사 수정문 8개가 아니다. 원기록·분모 불변, AI 내부 평가, 인간 참가자 없음.

코드 확인: [234 검사 범위](TEST-SCOPE.md), [과거 집계 영향](HISTORICAL-IMPACT.md), [sidecar 연결 수리](code-audit/sidecar/README.md). 전체 검사:

```bash
python tools/run_checks.py
python experiments/v20/code-audit/replay/verify_saved_v19.py
```

권한 있는 비공개 기록으로 고정 진단 결과를 재생할 때:

```bash
python experiments/v20/replay_diagnostics.py --private-root PRIVATE_ROOT --output NEW_SUMMARY.json
```

재생은 새 모델 생성이나 독립 의미 재채점이 아니다. 원자료 재수집·새 모델 실행은 별도 버전으로 기록해야 한다. 기사 전문·변형 전문·전체 실제 참조 출력은 공개하지 않고 링크·해시·자체 분석을 제공한다. 정확한 배포 모델/seed/비용은 미통제다.

로컬 연구 스냅숏이다. 원격 PR4/PR5를 통합하지 않았으며 main을 덮어쓰면 안 된다. 푸시·병합·배포·공유 Page·계정 설정 변경 없음. 다음 자동 실행 가설이 남아 있음을 STATUS.md에 명시했다.

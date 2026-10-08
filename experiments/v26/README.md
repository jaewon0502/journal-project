# v26 통합 회귀 감사

SUMMARY.md, REGRESSION-RESULTS.md, FOLLOWUP-RESULTS.md 순서로 읽는다. 과거 행별 대응은 regression-matrix.json, 재사용 범위는 SCOPE-AND-REUSE.md, 사전 기준은 두 PREREGISTRATION 문서다.

공개 재생: `python experiments/v26/replay.py`.
비공개 입력/원출력 폴더 보유 시: `python experiments/v26/replay.py --private PRIVATE_ROOT`.

8개 실제 자율 생성 결과와 2개 실제 선택 결과를 보존했다. 선택 후 최종문 2개는 결정론적으로 적용한 파생문이며 새 모델 작성으로 세지 않는다. 모든 사례는 개발에 노출된 회귀이며 새 holdout이 아니다.

공개 파일은 입력/출력 해시, 위치, 판정 투영, 최소한의 예시와 원문 링크를 담는다. 많은 패치의 before/after를 합하면 기사 전문이 재현되므로 패치 전체 문구도 공개 투영에서는 해시·문자 수·위치로 대체했다. 전문 원출력, 전체 입력 및 PRE/POST는 비공개 보존했다. 공개 ZIP만으로 기사 전문을 재생할 수는 없다.

재생은 새 모델 실행이나 의미 정답 검증이 아니다. 새 실행에는 해시에 맞는 같은 자료·policy.txt와 각각 분리된 문맥이 필요하다. 정확한 배포 모델/seed를 고정할 수 없어 같은 생성 결과를 보장하지 않는다. 과거 페이지·원격 저장소·다른 세션은 수정하지 않았다.

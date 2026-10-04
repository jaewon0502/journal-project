# Journal v25 — 원출판 표 맥락 비교

읽기 순서: SUMMARY.md → RESULTS.md → METHOD-AND-LIMITS.md. 사전 기준은 PREREGISTRATION.md, 원방법 조사는 LITERATURE.md, 기존 접근 계보는 NOVELTY-AUDIT.md다.

- projections/: 실제 8개 모델 출력의 공개 투영. 전문·장문 인용을 제거했으며 원출력의 대체물이 아니다.
- audit-projection.json / summary.json: 별도 PRE·POST 판정의 공개 투영과 계산 집계.
- freeze.json / private-artifact-hashes.json: 입력·원출력·감사 해시. 해시는 근거 진실을 보증하지 않는다.
- source-metadata.json / source-access-*.json / native-images-manifest.json: 접근 범위·날짜·버전·원문 링크.
- questions.json / editor-policy.txt: 질문과 공통 작성 규칙.

공개 집계 재검사: `python experiments/v25/replay.py`. 비공개 원자료 폴더를 가진 경우 `python experiments/v25/replay.py --private PRIVATE_ROOT`로 원출력 해시와 문자 패치를 재생한다. 이 검사는 새 모델 생성이나 의미 정답 재검증이 아니다.

모델 재실행에는 원문 링크의 해당 버전·해시를 다시 확보하고 동일 전문 입력을 구성해야 한다. 각 언어×변형×조건을 새 문맥으로 실행하고, 출력 전 근거감사를 저장한 별도 평가자가 조건명 없이 후검사한다. exact deployment/seed를 고정할 수 없어 동일 출력 재생은 보장되지 않는다. 공개 패키지는 저작권 자료 전문과 원표 전체 이미지를 재배포하지 않으므로 자체 완결된 모델 입력 패키지가 아니다. 해당 전문은 승인된 현 작업의 비공개 raw/input 폴더에 보존했다.

# Journal v27 재실행

RESULTS.md: 한국어 판정과 실패. METHOD.md: 통제와 한계. SOURCES.md/source-manifest.json: 원문 링크·버전. selection-results.json: 실제15출력 선택/결과 해시. private-artifact-manifest.json: 비공개 입력·분해·원출력·감사 증거 해시. 이전 원평가와 산출물은 수정하지 않았다.

코드 검사: `python3 -m unittest discover -s experiments/v27/code -p 'test_*.py' -v`.

`code/groups.py`의 apply_groups는 원문/동결 그룹/선택ID를 받아 결과문을 재구성한다. validate_partition으로 전체 선택이 고정 제안문과 일치하는지 확인한다. code/token_groups.py는 T인코딩을 만든다. 전체 재실행에는 비공개 입력/raw와 동일 원문 버전이 필요하며 기사 전문은 배포하지 않는다. 분해/선택/의미 감사는 런타임 AI 판단이므로 결정적으로 재현되지 않는다.

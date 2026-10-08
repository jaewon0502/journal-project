# Independent review — 2026-10-03

독립 검토에서 원래 두 결함의 재현과 수정 범위를 확인했다. 동결 코드는 변경하지 않았고 합성 추가 검사는 별도 비공개 작업 디렉터리에서만 작성·실행했다. 이 검토는 경로 충돌과 판정 ID 집계의 정확성에 한정하며 새 의미 평가나 모델 비교가 아니다.

- Receipt: 제공된 20개 CLI 경로 시나리오가 모두 통과했다. 별도 8개 검사에서도 양쪽 목적지 동시 존재, 부모 symlink 별칭, 비정상 편집값·경로·spec, 비 UTF-8 입력, source/evidence 해시 불일치를 새 파일 생성이나 기존 파일 변경 없이 거부했다. 기존 7개 회귀 검사도 통과했다.
- Aggregation: 제공된 8개 검사는 모두 통과했다. 별도 9개 unknown/wrong-phase/duplicate/missing/비정상 ID 검사에서 기존 결과 파일이 바이트 단위로 보존되었다. 기존 v7 회귀 21개도 통과했다.
- 추가 발견: 최초 검토판은 ID의 자료형을 검증하지 않아 blind와 raw 양쪽에 `null`, boolean, 숫자 또는 빈 문자열을 동일하게 넣으면 ID 검사를 통과했다. 합성 빈 mapping으로 전체 scorer 실행 시 이 다섯 종류 모두 judged count 1인 결과를 저장했다. 배열·객체 ID는 예외로 거부했다. 수정 담당에게 재현을 전달했으며 최초 실패 증거는 별도 보존했다. 수정 후 동일한 7종 입력 전부가 구조화된 `JudgmentIdentityError`로 결과 저장 없이 거부됨을 독립 재현했다. 확장된 15개 집계 회귀 검사와 추가 17개 검사도 다시 통과했다. ID 형식 검증 및 빈/불완전 mapping의 거부로 재현된 허점은 해결되었다.
- 동결 보존: legacy/v7의 HEAD 대비 diff가 없었다. receipt 원코드 SHA-256은 `6be5edc905bf62daafeb26e383f0fe7ede0167acf3a0912c10b1f0e002c7b6a8`, v7 scorer는 `8586ea284cdb5e3f933474990a0ed63bcdd9f7d7fbb8f35b1cb284e4f4070226`으로 영향 보고와 일치했다. archive 138개 inventory hash 검사도 재통과했다.
- 기존 영향: 공개 archive/aggregation 감사와 유지된 private receipt/ID 감사를 각각 독립 재실행했다. 네 재실행 결과 모두 배포된 해당 impact JSON과 바이트 단위로 일치했다. 원문·opaque ID·private 경로는 이 보고에 포함하지 않는다. 유지된 원본에서 해당 두 결함에 의한 손상을 관측하지 못했다는 제한된 결론을 지지한다. 폐기되거나 보존되지 않은 실행까지 일반화하지 않는다.

Receipt의 exclusive creation은 기존 파일을 덮어쓰지 않지만 두 파일의 원자적 게시를 보장하지 않는다. I/O 실패나 경합으로 비어 있는 새 receipt/부분 새 output이 남을 수 있다는 README 제한과 구현이 일치한다. Aggregation은 이제 mapping ID 집합과 배정 case/method 쌍의 완전성도 검사한다. 동결 입력을 전제로 하며 전체 JSON schema나 의미 판단을 검증하는 도구는 아니다. 검토한 최종판에 대해 요청 범위 내 미해결 재현 결함은 없다.

원문 O, 후보 C, 근거 S, 질문 Q를 읽고 실제로 필요한 최소 수정만 제안하세요. 원문 자체를 세계의 진실 gold로 간주하지 마세요. 원문에서 후보로 새로 생긴 의미손실과 원문부터 있던 오류, 자료에만 있는 선택 배경을 분리하세요. 제목·부제·본문·캡션의 전체문맥을 고려하세요. 자료가 모든 주장을 독립 검증하지 못한다는 사실만으로 보존 업무 전체를 보류하지 마세요. 무수정 승인은 이 보존 업무 범위의 판정이며 기사 전체 사실 인증이 아닙니다.

실질 판정:
- factual_error: 동일 주체·시점·단위·귀속에서 자료가 후보 명제를 직접 반박할 때 yes. 자료의 부재는 오류 증거가 아닙니다. 발언했다는 사실과 발언 내용의 진실을 구별하세요.
- conclusion_changing_omission: 잃은 조건·부정·양태·대상·분모·시간·귀속 때문에 고정 Q의 답이나 책임·허용범위가 달라지는 구체 명제를 원문과 후보 인용으로 보일 때 yes. 다른 문맥이 분명히 복원하면 no, 두 해석이면 unknown. 외부 사실을 지어 반례를 만들지 마세요.
- optional_clarification: 더 자세한 설명이 지지되지만 전체문맥의 답·범위·강도·귀속이 이미 유지되면 yes. 도움이 됨은 필수성의 증거가 아닙니다.
- original_meaning_loss: 원문에 있던 의미의 실제 손실. source-only 내용 부재와 구별하고, 원문 오류의 정당한 교정은 별도 설명하세요.
- required_answer_missing: Q의 필수 답 부재. 모든 근거의 상세를 강제로 추가하지 마세요. 원문부터 없었다면 inherited로 표시하세요.

변경 위치 표가 입력에 있으면 위치 확인 보조일 뿐 오류 판정이나 중요도 정답이 아닙니다. 문자 차이는 정상일 수 있고 같은 문장은 외부 사실 검증 완료를 뜻하지 않습니다. 표와 무관한 전체문맥도 읽으세요.

국소 action: 확인된 새 손실/필수 정정이 있고 안전하게 복구 가능할 때만 patch. 선택적 명료화 또는 문제 없음은 no_change. 해당 국소 쟁점의 필수성·증거·의미보존·문맥안전 중 하나라도 unknown/no이면 hold. '원문 의미를 복구할 근거'와 '그 발언이 실제로 참이라는 근거'는 다른 차원입니다. 관련 없는 자료 공백은 coverage로 별도 기록하고 국소 보류로 전파하지 마세요. 비판이나 단정적인 발언은 그 존재·주체·강도를 보존하되 내용 자체를 입증된 사실로 승격하지 마세요.

필요한 절만 exact before→after로 수정하세요. 원문 오류의 복구가 자료와 충돌하면 그 원문으로의 복구는 금지하며, 동일 주체·시점·단위·범위에서 자료가 대안 정정을 직접 지지하고 necessity·evidence_support·preserves_other_meaning·context_safe가 모두 yes일 때만 그 대안으로 최소 수정하세요; 그렇지 않으면 hold하고 설명하세요. 문체·친절함만을 위한 수정 금지. 같은 쟁점의 patch가 중복·중첩되지 않게 하세요. 원문과 후보에 주어진 자료만 사용하고 검색/다른파일은 금지합니다.

출력: unit별 JSON 객체. 개발 입력에 여러 unit가 있으면 같은 순서 JSON 배열.
{
 "unit_id":"...",
 "findings":[{"id":"F1","origin":"new_from_edit|inherited|source_only","original_meaning_loss":"yes|no|unknown","factual_error":"yes|no|unknown","conclusion_changing_omission":"yes|no|unknown","optional_clarification":"yes|no|unknown","required_answer_missing":"yes|no|unknown","original_quote":"exact short quote or empty","candidate_quote":"exact short quote or empty","source_refs":["id"],"source_quote":"exact short quote or empty","changed_proposition_or_counterexample":"grounded difference, not imagined external facts","necessity":"yes|no|unknown","evidence_support":"yes|no|unknown","preserves_other_meaning":"yes|no|unknown","context_safe":"yes|no|unknown","local_action":"patch|no_change|hold","reason":"..."}],
 "patches":[{"id":"P01","finding_id":"F1","before":"exact unique candidate span","after":"minimal replacement"}],
 "preservation_decision":"no_change|repair|hold",
 "local_hold_reasons":[{"code":"H-E|H-N|H-S|H-D|H-X","related_finding":"F1","reason":"..."}],
 "coverage_gaps":[{"code":"H-C","scope":"...","relation_to_local_action":"linked|unrelated|unknown","reason":"..."}],
 "overall_readiness":"ready|not_ready|unknown",
 "overall_reason":"separate from local preservation task",
 "read_scope":"what was actually read"
}
선택적 사항도 기록 가능하지만 findings 수를 늘리기 위해 쟁점을 만들지 마세요. 확인된 쟁점이 없으면 findings와 patches를 비워 두어도 됩니다. patch가 있는 finding의 네 축 모두 yes여야 하며, 불확실성은 설명으로 덮지 마세요. 전체 ready를 강요하지 않으며 원문의 모든 주장을 세계의 사실로 인증하지 마세요. 후보 전체를 다시 쓰지 않고 패치만 반환하세요.

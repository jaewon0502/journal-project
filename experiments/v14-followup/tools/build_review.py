"""Build the offline v14 supplementary draft form from preserved public excerpts.

No original file, human response, model, network, or execution result is created.
The target digest is SHA-256 of sorted-key, compact UTF-8 JSON (ensure_ascii=False).
"""
from hashlib import sha256
from html import escape
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "experiments/v14-followup/review.html"
ORIGINAL_REPORT_SHA256 = "7f21c0556ac549b3385dbcd562feccd93589f7cde6438d4c7471e35a647292cf"
TARGET = {
    "reviewTarget": "K01/P3",
    "articleUrl": "https://www.babytimes.co.kr/news/articleView.html?idxno=67598",
    "sourceExcerptLocation": "A04",
    "sourceExcerpt": "2명일 경우 20만원에서 30만원",
    "proposedText": "기본공제 대상인 8세 이상 자녀 또는 손자녀에 대한 자녀세액공제금액을 1인당 10만원씩 확대한다. 첫째는 15만원에서 25만원으로, 둘째는 20만원에서 30만원으로, 셋째 이후는 인당 30만원에서 40만원으로 늘어나는 안으로, 2025년 1월 1일 이후 발생하는 소득분부터 적용할 계획이다.",
    "evidenceLocator": "S1 PDF 50쪽 / 인쇄 40쪽: 첫째 15→25만원, 둘째 20→30만원, 셋째 이후 1명당 30→40만원. 대상 연령·적용시점은 같은 쪽 참조.",
    "sourceUrl": "https://mofe.go.kr/com/cmm/fms/FileDown.do?atchFileId=ATCH_000000000026722&fileSn=11",
}
AI_REVIEWERS = [
    "necessity=yes / evidence_support=yes / preserves_other_meaning=yes / context_safe=yes / reason=자녀 수별 가구 총액처럼 읽히는 2명 20→30만원을 둘째 자녀 금액으로 바로잡는 핵심 정정이다. 3명 이상 전원 40만원이라는 오독도 해소한다. 기본공제·연령·시행시점 추가는 별도로는 유용한 보충. S3는 후속 확인이지 당시 인지 증거가 아니다.",
    "necessity=yes / evidence_support=yes / preserves_other_meaning=yes / context_safe=yes / reason=2명일 경우를 둘째로, 3명 이상을 셋째 이후로 고치는 핵심은 필수다. 순서별 shorthand라는 독해도 가능하지만 가족 총액으로 읽히는 문법과 충돌한다. 연령·손자녀·시행소득 추가는 근거 있는 보충이지 각각 필수수정은 아니다. S2의 8~20세와 S1의 기본공제 대상 8세 이상은 대상조건이 달라 보이는 표현일 뿐 직접 반증이 아니다. related_patches는 관련 문맥의 수정 묶음이며 목록 전부를 기계적 선행조건으로 해석하지 않는다.",
]
OPTIONS = {
    "necessity": ["필요", "불필요", "불확실"],
    "meaning": ["보존됨", "보존되지 않음", "불확실"],
    "evidence": ["충분", "불충분", "불확실"],
    "contextSafety": ["안전함", "안전하지 않음", "불확실"],
    "preservationImportance": ["높음", "낮음", "불확실"],
}
LABELS = {
    "necessity": "수정 필요성 — AI necessity에 대응",
    "meaning": "다른 의미의 보존 — AI preserves_other_meaning에 대응",
    "evidence": "근거 충분성 — AI evidence_support에 대응",
    "contextSafety": "문맥 안전성 — AI context_safe에 대응",
    "preservationImportance": "원문 표현의 보존 중요도 — 별도 사람 판단",
}
OUTSTANDING = [
    ("발표안의 최종성", "원표 1·6·9행; S1/S2-pdf001-p01, 두 PDF 표지", "2024-07-25 위원회 이후 기재부 최종 발표본·의결자료 또는 변경사항 공지", "사전배포본 변경 가능성 경고와 최종안의 동일성 미확인. 후일 통과법률로 대체하거나 당시 기사에 소급할 수 없음. 국소수정의 안전성을 자동 부정하는 근거충돌은 아님."),
    ("회의와 사진 행사", "원표 2·7·10행; A02 / CAPTIONS", "2024-07-25 회의 공지·보도자료·회의록, 2024-07-22 사전브리핑 원본 사진 설명", "회의 일시·장소·김범석 1차관 주재, 사진 행사·인물 위치를 확인해야 함. 기사 속 서술·귀속과 실제 행사 사실은 별도."),
    ("정부 추산 인원", "원표 3·7·11행; A16 / 공급 277문단에서 해당 근거 미확인", "당시 기재부 문답자료·추산 원표·인원 산출표 또는 브리핑 발언록 해당 대목", "과표조정 8만3000명·최고세율 인하 2400명의 발언 존재, 모집단·산출과정 미확인. 정부 귀속의 재전달은 내용의 독립 검증이 아님."),
    ("법적 공제·경영 요건", "원표 4·8·12행; A18 / A26", "2024-07-25 당시 상속증여세법·시행령의 배우자공제와 가업상속공제 조문 및 공식 설명", "배우자공제 5억~30억원·피상속인 10년 이상 경영요건 전문이 부족함. 제공 표의 기초공제·가업기간별 한도로 이 세부 요건까지 확정할 수 없음."),
    ("과표·세율 개정 연혁", "원표 5·8·13행; A03 / A13", "1999~2024 상속증여세 과표·세율 개정연혁 또는 당시 기재부의 명시적 연혁 설명", "1999년 이후/25년 만이라는 주장 미확인. 현행·개정 수치 비교만으로 기간 전체의 개정 이력을 확정할 수 없음."),
]

TEMPLATE = r'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Journal v14 후속 보충 · K01/P3 사람 검토 초안</title>
<style>
*{box-sizing:border-box}html{font:16px/1.65 system-ui,-apple-system,sans-serif;background:#edf2f6;color:#172737}body{margin:0}header,main,footer{max-width:1060px;margin:auto;padding:24px}header{padding-top:40px}h1{font-size:clamp(1.7rem,4vw,2.5rem);line-height:1.3}h2{font-size:1.4rem}section{background:white;border:1px solid #cad6df;border-radius:10px;padding:24px;margin:20px 0}a{color:#07579a;text-underline-offset:3px}.note,small{color:#42586a}.status{padding:14px;border-left:4px solid #176485;background:#eef6fa}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.94rem}td,th{border:1px solid #cbd6df;text-align:left;vertical-align:top;padding:12px;min-width:130px;overflow-wrap:anywhere}th{background:#edf4f8}code{overflow-wrap:anywhere;word-break:break-word}fieldset{border:1px solid #bdcbd6;border-radius:6px;padding:14px;margin:18px 0}legend{font-weight:650}.options{display:flex;gap:12px 24px;flex-wrap:wrap}label{cursor:pointer}textarea,input,select,button{font:inherit;max-width:100%}textarea{display:block;width:100%;min-height:95px;padding:10px;margin:6px 0 18px}input[type=text],select{display:block;width:100%;padding:9px;margin:6px 0 18px}button{padding:9px 14px;margin:5px 8px 5px 0;border:1px solid #135a86;border-radius:5px;color:#124b70;background:#f3f8fc;cursor:pointer}details{border-top:1px solid #ccd5dd;padding-top:14px;margin-top:24px}summary{cursor:pointer;font-weight:650;padding:8px}*:focus-visible{outline:3px solid #b94800;outline-offset:3px}.skip{position:absolute;left:-9999px}.skip:focus{left:10px;top:10px;background:white;padding:10px}@media(max-width:600px){header,main,footer{padding:14px}section{padding:16px}}@media print{html{background:white}button{display:none}section{border:0}.table-wrap{overflow:visible}td,th{min-width:0}tr{break-inside:avoid}}
</style></head><body><a class="skip" href="#main">본문 바로가기</a>
<header><p>Journal 연구 · v14 후속 보충 · schemaVersion 2</p><h1>K01/P3 직접 검토 초안</h1><p>원본 보고서를 보존한 별도 보충본 · 원자료 대조와 사람 판단의 기록 양식</p></header>
<main id="main"><section><h2>이 보충본의 범위와 현재 상태</h2>
<p class="status"><strong>확인된 실제 사람 응답 0건 · 사람과 AI 비교 미실행.</strong><br>빈 양식입니다. 입력·저장·복원·내보내기 또는 AI 판정 열기는 완료나 인간 응답의 검증을 뜻하지 않습니다.</p>
<p>원본 v14 보고서가 기록한 <strong>적용 6건·보류 12건·필수항목 완전보존 31/31</strong>은 과거 보고 수치입니다. 이 보충 작업은 당시 모델 실행이나 전체 기계 게이트를 독립 재실행하지 않았으며, 이 수치를 새 결과로 갱신하지 않습니다. 31개 잠정 항목의 보존은 기사 전체 진실성이나 목록 완전성의 인증이 아닙니다.</p>
<p>여기서는 원본에 실제 수정문이 공개된 <strong>K01/P3 한 건</strong>만 다룹니다. P2·P17은 원본 산출물을 확보하지 않아 검토 대상으로 확대하지 않습니다. 이 페이지는 <strong>원자료를 먼저 읽고 중요도를 독립 선정하는 검증이 아니며, 실제 사람 응답이 존재한다는 증거도 아닙니다.</strong> 원문 표현 보존 중요도와 수정 후 의미 보존은 서로 다른 질문입니다.</p>
<p>아래 사람 양식의 대상은 원본 P3 제안(B)입니다. 후속의 최소수정 후보(A)와 원본 제안(B)을 대조하는 별도 AI 검토와는 대상·기록이 다르며, 이 양식 입력을 A의 평가로 사용하지 않습니다.</p>
<p class="note">원본 <code>journal-v14-korean-report.html</code>은 수정하지 않았습니다. 기준 원본 SHA-256: <code>@@ORIGINAL_HASH@@</code>. 참조 링크의 현재 접근성이나 원자료의 진실성은 이 보충본에서 새로 확인하지 않았습니다.</p></section>
<section id="human-review" aria-labelledby="review-title"><h2 id="review-title">검토 자료 — K01/P3</h2>
<p>기사 게시 2024-07-31 11:42 KST · 사건 2024-07-25 · 원본 보고서의 수집 표기 2026-10-02 UTC. 공개본에는 짧은 구간만 있으므로 실제 판단 전 기사 링크에서 주변 문맥을 확인하세요. 당시 개정안 자료이며 현재 세금 안내가 아닙니다.</p>
<div class="table-wrap"><table><thead><tr><th>원문 위치 / 짧은 구간</th><th>수정 제안 전체 — 원본 문구</th><th>원자료 비교 위치 — 원본 표기</th></tr></thead><tbody><tr><td>A04 · <q id="source-excerpt">@@EXCERPT@@</q></td><td id="proposed-text">@@PROPOSED@@</td><td id="evidence-locator">@@LOCATOR@@</td></tr></tbody></table></div>
<p><a href="@@ARTICLE_URL@@" target="_blank" rel="noopener noreferrer">기사 전체 읽기</a> · <a href="@@SOURCE_URL@@" target="_blank" rel="noopener noreferrer">S1 · 당시 개정안 상세 원자료</a></p>
<p>정확한 검토 대상 해시: <code id="target-hash">@@TARGET_HASH@@</code>. <code>reviewTarget</code>, 기사 URL, 원문 위치·구간, 제안 전문, 근거 위치, 원자료 URL의 키를 정렬한 공백 없는 UTF-8 JSON에 SHA-256을 적용했습니다. 이는 대상 문자열 고정용이며 근거의 정확성 인증이 아닙니다.</p>
<h3>직접 입력하는 판단</h3><p>선택·텍스트·검토 시각·사전 AI 노출 자기보고는 모두 빈 값으로 시작합니다. 사람 판단을 AI로 채우거나 채점하지 않습니다.</p>
@@FIELDS@@
<p class="note">문맥 안전성은 주변 문장·대상·조건·시간·귀속과 충돌하는지를 묻습니다. 보존 중요도는 원문 표현을 남겨야 할 필요에 대한 별도 판단이며, 의미 보존으로 대체하거나 AI 4축과 자동 비교하지 않습니다.</p>
<label for="reviewedAt">검토 시각 — 직접 기록한 시각, 시간대 포함 (선택 입력)</label><input id="reviewedAt" type="text" placeholder="예: 2026-10-03T15:00:00+09:00" autocomplete="off" aria-describedby="time-note"><small id="time-note">ISO 8601 형식. 입력하지 않으면 null. 저장/내보내기 시각을 검토 시각으로 자동 사용하지 않습니다.</small>
<label for="priorAiExposure">이 페이지에서 판단하기 전에 이 수정의 AI 판단을 본 적이 있습니까? — 자기보고</label><select id="priorAiExposure"><option value="">미입력</option><option value="no">아니요</option><option value="yes">예</option><option value="unsure">기억나지 않음 / 불확실</option></select>
<label for="unverified">미확인 사항 / 필요한 추가 자료</label><textarea id="unverified" placeholder="확인하지 못한 내용이나 추가로 필요한 자료를 직접 적어 주세요."></textarea>
<label for="comments">자유 의견 / 판단 이유</label><textarea id="comments" placeholder="판단 이유와 수정 제안 등을 직접 적어 주세요."></textarea>
<div aria-label="초안 관리"><button type="button" id="save">이 브라우저에 초안 저장</button><button type="button" id="restore">저장 초안 복원</button><button type="button" id="export">초안 JSON 내보내기</button></div>
<p id="message" role="status" aria-live="polite">아직 저장하거나 복원하지 않았습니다.</p>
<p class="note">서버 전송·자동 저장·자동 복원은 없습니다. 저장은 기존 v1과 다른 localStorage 키를 사용합니다. 유효한 저장 초안을 명시적으로 복원하면 현재 입력을 덮어씁니다. 대상 ID·해시 또는 필수 구조가 다르면 현재 입력을 유지합니다. 파일 열기 방식·비공개 모드·설정에 따라 localStorage를 사용할 수 없을 때는 JSON 내보내기를 이용하세요.</p>
<details id="ai-review"><summary>AI 판정 펼치기 — 열기 시점이 기록됩니다</summary><p class="note">아래는 원본의 두 P3 판정을 그대로 옮긴 과거 AI 응답입니다. 새 AI 판정이 아닙니다. 영역을 연 사실은 읽음·이해·비교 완료를 증명하지 않습니다.</p><div class="table-wrap"><table><thead><tr><th>검토자</th><th>원본 P3 판정</th></tr></thead><tbody>@@AI_ROWS@@</tbody></table></div></details>
<p id="interaction-status" class="note" aria-live="polite"></p>
<p class="note">상호작용 기록은 각 브라우저 세션에서 최초 직접 판단 입력(선택 또는 비어 있지 않은 서술)과 최초 AI 영역 열기의 순서, AI를 연 뒤의 직접 판단·서술·검토 시각/노출 자기보고 변경 횟수만 관찰합니다. 서술 변경 횟수는 입력 이벤트 수이며 독립 판단 수가 아닙니다. 복원 값은 새 직접 판단으로 세지 않으며, 복원 전 세션 기록과 현재 세션을 구분해 내보냅니다. 페이지 밖의 노출·신원·실제 검토를 검증하지 못하고 저장 JSON도 수정 가능하므로 <strong>블라인딩의 증거가 아닙니다.</strong></p>
<noscript><p>JavaScript가 꺼져 있어 저장·복원·내보내기 및 노출 순서 기록을 사용할 수 없습니다.</p></noscript></section>
<section><h2>미확인 자료 — 원본 13행을 5개 주제로 합침</h2><p>중복 주제만 합쳤습니다. 원문 위치, 필요한 당시 자료, 자료의 시간적 한계를 유지합니다. 아래 항목의 사실확인은 여전히 미완료입니다.</p><div class="table-wrap"><table><thead><tr><th>주제</th><th>원본 행 / 근거 위치</th><th>필요한 자료와 시점</th><th>아직 확인하지 못한 범위</th></tr></thead><tbody>@@OUTSTANDING@@</tbody></table></div>
<p><a href="@@SOURCE_URL@@" target="_blank" rel="noopener noreferrer">S1 · 2024-07-25 상세본</a> · <a href="https://mofe.go.kr/com/cmm/fms/FileDown.do?atchFileId=ATCH_000000000026722&amp;fileSn=4" target="_blank" rel="noopener noreferrer">S2 · 2024-07-25 개정안</a> · <a href="https://www.korea.kr/news/policyNewsView.do?newsId=148932921" target="_blank" rel="noopener noreferrer">S3 · 2024-08-22 후속 설명</a></p>
<p>S1/S2는 위원회 변경 가능성을 경고하는 사전 자료입니다. S3는 기사 이후 자료이므로 당시 기자가 알았다고 소급하지 않습니다. 세 자료는 같은 정책 발표에서 파생되어 세 독립 증거를 뜻하지 않습니다.</p></section>
</main><footer><p>로컬 보충 양식 · 연구 응답 수집 완료 주장 없음 · UI 시험의 합성 입력은 사람 연구 응답에서 제외</p></footer>
<script id="review-target" type="application/json">@@TARGET_JSON@@</script>
<script>
(() => {
  'use strict';
  const KEY = 'journal-v14-followup-K01-P3-human-draft-schema2';
  const HASH = '@@TARGET_HASH@@';
  const OPTIONS = @@OPTIONS@@;
  const $ = id => document.getElementById(id);
  const notify = message => { $('message').textContent = message; };
  const now = () => new Date().toISOString();
  const session = {
    sessionId: now() + '-' + Math.random().toString(36).slice(2), startedAt: now(),
    firstJudgmentAt: null, aiFirstOpenedAt: null, aiFirstOpenPhase: null,
    judgmentChangesAfterAiOpened: 0, narrativeChangesAfterAiOpened: 0, metadataChangesAfterAiOpened: 0,
    lastJudgmentChangeAt: null, lastNarrativeChangeAt: null, lastMetadataChangeAt: null, restoredDraftCount: 0
  };
  let restoredSessions = [];
  const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  const iso = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
    const [year, month, day, hour, minute, second] = value.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})/).slice(1).map(Number);
    const zone = value.match(/[+-](\d{2}):(\d{2})$/);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour < 24 && minute < 60 && second < 60 && (!zone || (Number(zone[1]) <= 23 && Number(zone[2]) < 60)) && Number.isFinite(Date.parse(value));
  };
  const nullableIso = value => value === null || iso(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  function validSession(value) {
    const keys = ['sessionId','startedAt','firstJudgmentAt','aiFirstOpenedAt','aiFirstOpenPhase','judgmentChangesAfterAiOpened','narrativeChangesAfterAiOpened','metadataChangesAfterAiOpened','lastJudgmentChangeAt','lastNarrativeChangeAt','lastMetadataChangeAt','restoredDraftCount'];
    if (!exactKeys(value, keys) || typeof value.sessionId !== 'string' || !value.sessionId || !iso(value.startedAt) || ![value.firstJudgmentAt,value.aiFirstOpenedAt,value.lastJudgmentChangeAt,value.lastNarrativeChangeAt,value.lastMetadataChangeAt].every(nullableIso) || ![value.judgmentChangesAfterAiOpened,value.narrativeChangesAfterAiOpened,value.metadataChangesAfterAiOpened,value.restoredDraftCount].every(integer)) return false;
    if (value.aiFirstOpenedAt === null) return value.aiFirstOpenPhase === null && value.judgmentChangesAfterAiOpened === 0 && value.narrativeChangesAfterAiOpened === 0 && value.metadataChangesAfterAiOpened === 0;
    if (!['before_first_judgment','after_first_judgment'].includes(value.aiFirstOpenPhase)) return false;
    if (value.aiFirstOpenPhase === 'after_first_judgment' && value.firstJudgmentAt === null) return false;
    if (value.judgmentChangesAfterAiOpened > 0 && value.lastJudgmentChangeAt === null) return false;
    return (value.narrativeChangesAfterAiOpened === 0 || value.lastNarrativeChangeAt !== null) && (value.metadataChangesAfterAiOpened === 0 || value.lastMetadataChangeAt !== null);
  }
  function valid(data) {
    return exactKeys(data, ['schemaVersion','documentId','recordType','reviewTarget','reviewTargetHash','reviewedAt','priorAiExposureSelfReport','judgments','unverified','comments','interactionSessions','exportedOrSavedAt','note']) &&
      data.schemaVersion === 2 && data.documentId === 'journal-v14-followup' && data.recordType === 'human-review-draft' && data.reviewTarget === 'K01/P3' && data.reviewTargetHash === HASH &&
      nullableIso(data.reviewedAt) && [null,'yes','no','unsure'].includes(data.priorAiExposureSelfReport) && exactKeys(data.judgments, Object.keys(OPTIONS)) &&
      Object.entries(OPTIONS).every(([name, values]) => data.judgments[name] === null || values.includes(data.judgments[name])) &&
      typeof data.unverified === 'string' && typeof data.comments === 'string' && iso(data.exportedOrSavedAt) && data.note === '사용자가 직접 입력한 초안. 실제 사람 응답·검토 완료·비교 완료·블라인딩을 증명하지 않음.' &&
      Array.isArray(data.interactionSessions) && data.interactionSessions.length > 0 && data.interactionSessions.every(validSession) && new Set(data.interactionSessions.map(item => item.sessionId)).size === data.interactionSessions.length;
  }
  function collect() {
    const data = {
      schemaVersion: 2, documentId: 'journal-v14-followup', recordType: 'human-review-draft', reviewTarget: 'K01/P3', reviewTargetHash: HASH,
      reviewedAt: $('reviewedAt').value.trim() || null, priorAiExposureSelfReport: $('priorAiExposure').value || null,
      judgments: Object.fromEntries(Object.keys(OPTIONS).map(name => [name, document.querySelector('input[name="' + name + '"]:checked')?.value ?? null])),
      unverified: $('unverified').value, comments: $('comments').value,
      interactionSessions: [...restoredSessions, {...session}], exportedOrSavedAt: now(),
      note: '사용자가 직접 입력한 초안. 실제 사람 응답·검토 완료·비교 완료·블라인딩을 증명하지 않음.'
    };
    if (!valid(data)) throw new Error('검토 시각은 시간대가 포함된 유효한 ISO 8601 형식으로 입력하거나 비워 주세요.');
    return data;
  }
  function showInteraction() {
    const phase = session.aiFirstOpenPhase === null ? '아직 열지 않음' : session.aiFirstOpenPhase === 'before_first_judgment' ? '이 세션의 첫 직접 판단 입력 전 열림' : '이 세션의 첫 직접 판단 입력 후 열림';
    $('interaction-status').textContent = '현재 세션 관찰: AI 영역 ' + phase + ' · AI 열기 이후 판단 변경 ' + session.judgmentChangesAfterAiOpened + '회 · 서술 변경 ' + session.narrativeChangesAfterAiOpened + '회 · 시각/노출 자기보고 변경 ' + session.metadataChangesAfterAiOpened + '회 · 초안 복원 ' + session.restoredDraftCount + '회. 노출 자기보고는 별도입니다.';
  }
  function observeAiOpen() {
    if ($('ai-review').open && session.aiFirstOpenedAt === null) {
      session.aiFirstOpenedAt = now();
      session.aiFirstOpenPhase = session.firstJudgmentAt === null ? 'before_first_judgment' : 'after_first_judgment';
      showInteraction();
    }
  }
  $('ai-review').addEventListener('toggle', observeAiOpen);
  Object.keys(OPTIONS).forEach(name => document.querySelectorAll('input[name="' + name + '"]').forEach(input => input.addEventListener('change', () => {
    observeAiOpen();
    session.firstJudgmentAt ??= now(); session.lastJudgmentChangeAt = now();
    if (session.aiFirstOpenedAt !== null) session.judgmentChangesAfterAiOpened++;
    showInteraction();
  })));
  ['unverified','comments'].forEach(id => $(id).addEventListener('input', () => {
    observeAiOpen(); session.lastNarrativeChangeAt = now();
    if ($(id).value.trim()) session.firstJudgmentAt ??= now();
    if (session.aiFirstOpenedAt !== null) session.narrativeChangesAfterAiOpened++;
    showInteraction();
  }));
  [['reviewedAt','input'],['priorAiExposure','change']].forEach(([id, event]) => $(id).addEventListener(event, () => {
    observeAiOpen(); session.lastMetadataChangeAt = now();
    if (session.aiFirstOpenedAt !== null) session.metadataChangesAfterAiOpened++;
    showInteraction();
  }));
  $('save').addEventListener('click', () => {
    observeAiOpen();
    let data;
    try { data = collect(); } catch (error) { notify(error.message); return; }
    try { localStorage.setItem(KEY, JSON.stringify(data)); notify('초안을 이 브라우저에 저장했습니다. 검토·비교 완료를 뜻하지 않습니다.'); }
    catch (_) { notify('브라우저 저장에 실패했습니다. JSON 내보내기를 이용하세요. 현재 입력은 유지됩니다.'); }
  });
  $('restore').addEventListener('click', () => {
    observeAiOpen();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === null) { notify('저장 초안이 없습니다. 현재 입력은 유지됩니다.'); return; }
      const data = JSON.parse(raw);
      if (!valid(data)) throw new Error('invalid');
      Object.keys(OPTIONS).forEach(name => document.querySelectorAll('input[name="' + name + '"]').forEach(input => { input.checked = input.value === data.judgments[name]; }));
      $('reviewedAt').value = data.reviewedAt ?? ''; $('priorAiExposure').value = data.priorAiExposureSelfReport ?? '';
      $('unverified').value = data.unverified; $('comments').value = data.comments;
      restoredSessions = data.interactionSessions.filter(item => item.sessionId !== session.sessionId);
      session.restoredDraftCount++; showInteraction();
      notify('초안을 복원했습니다. 복원값은 새 직접 판단으로 세지 않으며 검토·비교 완료를 뜻하지 않습니다.');
    } catch (_) { notify('대상·해시·필수 형식이 다르거나 저장 데이터에 접근할 수 없어 복원하지 못했습니다. 현재 입력은 유지됩니다.'); }
  });
  $('export').addEventListener('click', () => {
    observeAiOpen();
    let data;
    try { data = collect(); } catch (error) { notify(error.message); return; }
    let url;
    try {
      url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], {type:'application/json;charset=utf-8'}));
      const link = document.createElement('a'); link.href = url; link.download = 'journal-v14-K01-P3-review-draft-schema2.json';
      document.body.appendChild(link); link.click(); link.remove();
      notify('초안 JSON 내보내기를 요청했습니다. 다운로드 목록을 확인하세요. 검토·비교 완료를 뜻하지 않습니다.');
    } catch (_) { notify('JSON 내보내기에 실패했습니다. 현재 입력은 유지됩니다.'); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 1000); }
  });
  showInteraction();
})();
</script></body></html>
'''


def build():
    canonical = json.dumps(TARGET, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    target_hash = sha256(canonical.encode("utf-8")).hexdigest()
    fields = "\n".join(
        '<fieldset><legend>' + LABELS[name] + '</legend><div class="options">' +
        "".join(f'<label><input type="radio" name="{name}" value="{value}"> {value}</label>' for value in values) +
        '</div></fieldset>' for name, values in OPTIONS.items()
    )
    replacements = {
        "ORIGINAL_HASH": ORIGINAL_REPORT_SHA256, "TARGET_HASH": target_hash,
        "TARGET_JSON": canonical.replace("<", "\\u003c"),
        "OPTIONS": json.dumps(OPTIONS, ensure_ascii=False), "FIELDS": fields,
        "EXCERPT": escape(TARGET["sourceExcerpt"]), "PROPOSED": escape(TARGET["proposedText"]),
        "LOCATOR": escape(TARGET["evidenceLocator"]), "ARTICLE_URL": escape(TARGET["articleUrl"], quote=True),
        "SOURCE_URL": escape(TARGET["sourceUrl"], quote=True),
        "AI_ROWS": "".join(f'<tr><td>{index}</td><td>{escape(text)}</td></tr>' for index, text in enumerate(AI_REVIEWERS, 1)),
        "OUTSTANDING": "".join('<tr>' + ''.join('<td>' + escape(text) + '</td>' for text in row) + '</tr>' for row in OUTSTANDING),
    }
    output = TEMPLATE
    for key, value in replacements.items():
        output = output.replace("@@" + key + "@@", value)
    if "@@" in output:
        raise ValueError("Unresolved template marker")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(output, encoding="utf-8")
    print(f"Built {OUTPUT.relative_to(ROOT)}; target SHA-256 {target_hash}")


if __name__ == "__main__":
    build()

const test = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const report = require('../docs/reader/editor-study-report.js');

function studySummary() {
  return {
    editors:{enrolled:8,included:8,completeBlocks:2}, includedTasks:32,
    time:{editors:4,tasks:16,manualMeanSeconds:40,journalMeanSeconds:32,reductionPct:20,
      manualSecondsPerVerified:80,journalSecondsPerVerified:64,
      verifiedTrials:{manual:{verified:4,tasks:8},journal:{verified:4,tasks:8}}},
    verdictAndEvidence:{manual:{verified:10,tasks:16},journal:{verified:12,tasks:16}},
    unsupportedAcceptance:{manual:{accepted:4,eligible:8},journal:{accepted:4,eligible:8}},
    partyLabelAcceptanceGap:{manualPp:50,journalPp:25,reductionPp:25},
    partyLabelGapAndQuality:{cases:4,narrowed:2,narrowedUnsafeEligible:1,narrowedWithMoreUnsafe:1,
      narrowedWithMoreUnsafeBothLabels:0,narrowedWithFewerVerified:1}
  };
}

test('공유 결과표에 표본과 실제 분모, 판본별 집계를 담고 원문 응답은 넣지 않는다', () => {
  const overall = studySummary(), model = studySummary();
  const stamp = 'abcd'.repeat(16), secret = 'private-reason-token-example';
  model.partyLabelGapAndQuality.narrowedWithMoreUnsafe = 0;
  const html = report.html({kind:'demo',scope:secret,overall:{...overall,records:[{reason:secret}]},
    observedEditions:[{...model,kitVersion:stamp}],assignedMatchedEditions:[{...model,kitVersion:secret}]});
  const dom = new JSDOM(html), doc = dom.window.document;
  try {
    assert.equal(doc.title,'가상 편집자 실험 결과표');
    const first = doc.querySelector('section');
    assert.match(first.textContent,/판정 비교 8명 · 32과제\. 시간 비교 4명 · 16과제/);
    assert.match(first.textContent,/잘못된 사실 채택이 늘어난 기사는 1\/1건/);
    assert.match(doc.querySelector('details').textContent,/잘못된 사실 채택이 늘어난 기사는 0\/1건/);
    assert.match(first.querySelector('tbody').textContent,/10\/16 \(62.5%\).*12\/16 \(75%\)/);
    assert.equal(doc.querySelectorAll('details').length,2);
    assert.ok(html.includes(stamp)); assert.ok(!html.includes(secret));
    assert.equal(doc.querySelectorAll('script,form,iframe,[src],a[href]').length,0);
  } finally {dom.window.close();}
});

test('격차 축소 0건, 오승인 대상 0건, 자료 부족을 서로 구분한다', () => {
  const base = studySummary();
  const show = joint => report.html({kind:'editor',overall:{...base,partyLabelGapAndQuality:joint}});
  const joint = base.partyLabelGapAndQuality;
  assert.match(show({...joint,narrowed:0}),/격차가 줄어든 기사가 없습니다/);
  assert.match(show({...joint,narrowedUnsafeEligible:0}),/비교할 대상이 없습니다/);
  assert.match(show(null),/네 명이 네 과제를 모두 끝낸/);
  assert.match(show(null),/편집자 실측 결과표/);
  assert.throws(()=>report.html({kind:'other'}),/실측 또는 가상/);
});

test('주 시간 분석 밖의 개인 완주자까지 보면 더 느린 편집자가 많아진 사례를 보인다', () => {
  const individualCompletionTiming = {completedEditors:10,outsideCompleteBlocks:6,
    directions:{faster:4,slower:6,unchanged:0,unknown:0}};
  const html = report.html({kind:'demo',overall:{...studySummary(),individualCompletionTiming}});
  assert.match(html,/완주 10명 중 시간이 단축된 사람 4명, 증가한 사람 6명/);
});

test('성공당 시간에는 그 시간 표본의 성공 건수를 사용한다', () => {
  const overall = studySummary();
  overall.time.manualSecondsPerVerified = null;
  overall.time.verifiedTrials.manual.verified = 0;
  overall.verdictAndEvidence.manual.verified = 8;
  const dom = new JSDOM(report.html({kind:'demo',overall}));
  try {
    const rows = [...dom.window.document.querySelectorAll('tbody tr')];
    const timed = rows.find(r=>r.cells[0].textContent==='검증 성공 한 건당 투입 시간');
    const all = rows.find(r=>r.cells[0].textContent.includes('전체 판정 표본'));
    assert.equal(timed.cells[1].textContent,'미산출성공 0/8건');
    assert.equal(all.cells[1].textContent,'8/16 (50%)');
  } finally {dom.window.close();}
});

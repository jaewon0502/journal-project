const test = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const report = require('../docs/reader/editor-study-report.js');
const study = require('../docs/reader/editor-study-core.js');

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

test('공유용 결과는 판정·근거 조합의 차이를 전체 기사 수로 보여 주고 개인 응답을 내보내지 않는다', () => {
  const association = {comparedCases:4,manual:{differentCases:0,equalMarginalsWithGap:0},
    journal:{differentCases:2,equalMarginalsWithGap:1},cases:[{verdict:'PRIVATE-receipt',sourceId:'PRIVATE-source'}]};
  const base = studySummary();
  const render = value => report.html({kind:'editor',overall:{...base,partyLabelVerdictSourceAssociation:value}});
  const html = render(association);
  const dom = new JSDOM(html);
  try {
    const heading = [...dom.window.document.querySelectorAll('h3')].find(h=>h.textContent.includes('어떤 근거'));
    const rows = [...heading.nextElementSibling.tBodies[0].rows];
    assert.deepEqual(rows.map(r=>[r.cells[1].textContent,r.cells[2].textContent]),[['0/4개','2/4개'],['0/4개','1/4개']]);
    assert.doesNotMatch(html,/PRIVATE-/);
  } finally { dom.window.close(); }
  assert.match(render(undefined),/조합을 비교한 기록이 없습니다/);
  assert.match(render(null),/묶음이 있어야 두 정당 표기의 응답을 비교/);
  for (const journal of [{differentCases:1,equalMarginalsWithGap:2},{differentCases:5,equalMarginalsWithGap:0},
    {differentCases:'PRIVATE-forged-count',equalMarginalsWithGap:0}]) {
    const result = render({...association,journal});
    assert.match(result,/방식별 건수를 확인할 수 없어/);
    assert.doesNotMatch(result,/PRIVATE-/);
  }
});

test('기사별 결과표는 전체 성공률이 같아도 시간이 줄면서 검증에 실패한 기사를 표시한다', () => {
  const overall = studySummary();
  overall.time.caseVerification = study.analyze(study.caseVerificationDemoRecords(), 'demo').caseVerification;
  const cases = overall.time.caseVerification.cases;
  cases.push({...cases[0], caseId:'PRIVATE-ARTICLE-IDENTIFIER'});
  cases[0].title = 'PRIVATE-EDITOR-TITLE';
  const html = report.html({kind:'demo',overall});
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    const table = [...doc.querySelectorAll('table')].find(t => t.querySelector('th').textContent === '기사');
    const rows = [...table.tBodies[0].rows];
    assert.equal(rows.length,4);
    assert.match(doc.body.textContent,/시간이 짧아진 기사는 1개.+응답도 줄어든 기사는 1\/1개/);
    const filing = rows.find(r => r.cells[0].textContent.startsWith('사업비 자료 제출'));
    assert.deepEqual([...filing.cells].map(cell=>cell.textContent),['사업비 자료 제출시간 단축 · 성공 감소','60초성공 2/2건','5초성공 0/2건']);
    assert.doesNotMatch(html,/PRIVATE-/);
    const shared = report.html({kind:'editor',overall});
    assert.match(shared,/응답도 줄어든 기사는 <strong>1\/1개/);
    assert.doesNotMatch(shared,/사업비 자료 제출|PRIVATE-/);
    overall.time.caseVerification = null;
    assert.match(report.html({kind:'editor',overall}),/검토 시간이 모두 기록된 균형 묶음이 있어야 기사를 비교/);
    delete overall.time.caseVerification;
    assert.match(report.html({kind:'editor',overall}),/기사별 시간과 검증 성공 건수가 기록되지 않았습니다/);
  } finally { dom.window.close(); }
});

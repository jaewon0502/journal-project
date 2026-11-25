const {test} = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const blind = require('../docs/reader/blind-revision.js');
const {compare, comparedFacts} = require('../docs/reader/revision-agreement.js');
const {summarize, validRow, auditFacts} = require('../docs/reader/revision-facts.js');
const rubric = require('../docs/reader/article-rubric.js');
const series = require('../docs/reader/revision-series.js');
const retention = require('../docs/reader/retention-case.js');

const sources = [
  {id:'minutes', title:'회의록', url:'https://assembly.example/minutes', version:'확정본',
    locator:'발언 1', excerpt:'위원장은 지난해 실제 집행액이 20억 원이었다고 말했다.'},
  {id:'audit', title:'결산표', url:'https://audit.example/accounts', version:'확정본',
    locator:'표 1', excerpt:'지난해 실제 집행액은 10억 원이었다.'}
];
const quoted = '위원장은 “지난해 실제 집행액은 20억 원이었다”고 말했다.';
const mixedText = '시청은 시범 운영을 마쳤고, 사업은 기대 이상이다.';
const mixed = {status:'mixed', factSpan:'시청은 시범 운영을 마쳤고', opinionSpan:'사업은 기대 이상이다.'};
const partial = {status:'partial', factSpan:mixed.factSpan};
const attribution = contentStatus => ({status:'attribution', contentStatus, contentChecked:true,
  contentReason:'회의록의 발언과 별도로 내용을 검토했다.',
  contentSourceIds:['source-2']});
const fact = (outcome, flag = 'none') => ({outcome, flag});
const ratio = (numerator, denominator) => ({numerator, denominator, pct:denominator ? 100 * numerator / denominator : null});

function manuscript(rows, catalog) {
  const article = rows.map(([text]) => text).join('\n');
  return {format:workspace.schema, article, articleDraft:article, sources:catalog, demo:true, receipts:[], rowDrafts:[],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(key => [key, '']))}};
}

// Exercise the public distribution and recovery paths. Each row has a passage followed by each editor's decision.
async function assess(before, after = [['수정본의 확인이 남았다.', null, null]], edit = () => {}, catalog = sources) {
  const reviews = [];
  for (let editor = 0; editor < 2; editor++) {
    const {key, packets} = await blind.prepare(manuscript(before, catalog), manuscript(after, catalog));
    for (const [role, rows] of Object.entries({before, after})) {
      const work = packets[key.mapping[role].slot];
      const report = engine.report(work.article, work.sources);
      assert.deepEqual(report.rows.map(row => row.text), rows.map(([text]) => text));
      work.receipts = report.rows.flatMap((row, index) => {
        const value = rows[index][editor + 1];
        if (!value) return [];
        const decision = typeof value === 'string' ? {status:value} : value;
        return [engine.decide(row, {acknowledged:true, sourceIds:['source-1'], reason:'편집자 ' + editor + '의 독립 기록.',
          ...decision}, work.sources)];
      });
      edit(work, role, editor, reviews[0]);
    }
    reviews.push({key, ...await blind.resolve(key, packets.A, packets.B)});
  }
  return {reviews, joint:compare(...reviews)};
}

test('원본과 수정본의 독립 판정은 본문 순서대로 사실 전체, 한정된 지지, 두 종류의 충돌과 미결을 구분한다', async () => {
  const rows = [
    ['예산은 10억 원이다.', 'fact', 'fact'],
    ['위원장은 “예산은 10억 원이었다”고 말했다.', attribution('supported'), attribution('supported')],
    [mixedText, mixed, mixed],
    ['위원장은 “무책임하다”고 말했다.', attribution('opinion'), attribution('opinion')],
    ['집행액은 20억 원이다.', 'contradicted', 'contradicted'],
    ['의원은 “예산은 20억 원이었다”고 말했다.', attribution('contradicted'), attribution('contradicted')],
    ['이 결정은 무책임하다.', 'opinion', 'opinion'],
    ['시범 노선은 승인됐고, 전 노선은 검토 중이다.', {status:'partial', factSpan:'시범 노선은 승인됐고'}, 'held'],
    ['의원은 “집행액은 10억 원이었다”고 말했다.', attribution('unverified'), attribution('unverified')]
  ];
  const {joint} = await assess(rows, [[mixedText, partial, partial], ['집행액은 10억 원이다.', 'fact', 'fact']]);
  assert.deepEqual(joint.facts.before, [fact('supported'), fact('supported'), fact('limited'), fact('limited'),
    fact('contradicted', 'article'), fact('quotedConflict', 'quote'), fact('excluded'), fact('pending'), fact('pending')]);
  assert.deepEqual(joint.facts.after, [fact('pending'), fact('supported')]);
  const summary = summarize(joint.facts.before);
  assert.deepEqual(summary.support, ratio(2, 3));
  assert.deepEqual(summary.coverage, ratio(6, 8));
});

test('편집자 한쪽의 충돌과 두 편집자가 확인한 구절의 차이를 보존한다', async () => {
  const rows = [
    ['집행액은 20억 원이다.', 'contradicted', null],
    [quoted, attribution('contradicted'), 'contradicted'],
    [mixedText, 'fact', mixed],
    ['사업은 기대 이상이다.', 'opinion', 'contradicted'],
    ['위원장은 “예산은 20억 원이었다”고 말했다.', attribution('contradicted'), attribution('supported')],
    ['다른 구간도 의견이다.', 'opinion', null],
    ['의원은 “집행액은 10억 원이었다”고 말했다.', attribution('contradicted'), attribution('unverified')],
    ['시범 노선은 개통됐고, 수요는 충분하며, 운영은 기대 이상이다.',
      {status:'mixed', factSpan:'시범 노선은 개통됐고', opinionSpan:'수요는 충분하며, 운영은 기대 이상이다.'},
      {status:'mixed', factSpan:'시범 노선은 개통됐고, 수요는 충분하며', opinionSpan:'운영은 기대 이상이다.'}]
  ];
  const {reviews, joint} = await assess(rows);
  const expected = [fact('pending','article'), fact('disputed','both'), fact('disputed'), fact('disputed','article'),
    fact('disputed','quote'), fact('pending'), fact('pending','quote'), fact('disputed')];
  assert.deepEqual(joint.facts.before, expected);
  assert.deepEqual(compare(reviews[1], reviews[0]).facts, joint.facts);
  const summary = summarize(expected);
  assert.deepEqual([summary.articleFlagged, summary.quoteFlagged, summary.flagged], [3,3,5]);
  assert.deepEqual(summary.support, ratio(0,0));
  assert.deepEqual(summary.coverage, ratio(0,8));
});

test('검증한 동일 기록은 독립 판정에서 빼고 작성 중·변조된 상대 판정은 미결로 남긴다', async () => {
  const rows = [
    ['집행액은 10억 원이다.', 'fact', 'fact'],
    ['예산은 20억 원이다.', 'contradicted', 'contradicted'],
    [quoted, attribution('contradicted'), attribution('contradicted')],
    ['추가 예산은 30억 원이다.', 'contradicted', 'contradicted'],
    ['당해 예산은 10억 원이다.', 'contradicted', 'contradicted']
  ];
  const {joint, reviews} = await assess(rows, undefined, (work, role, editor, previous) => {
    if (role !== 'before' || !editor) return;
    for (const index of [0,1,2]) work.receipts[index] = structuredClone(previous.before.receipts[index]);
    work.receipts[3].reason = '저장 후 바꾼 문구';
    work.rowDrafts.push({rowId:work.receipts[4].rowId, data:{status:'fact', reason:'다시 작성 중',
      sourceIds:['source-1'], factSpan:'', opinionSpan:''}});
  });
  const expected = [fact('shared'), fact('shared','article'), fact('shared','quote'), fact('pending','article'), fact('pending','article')];
  assert.deepEqual(joint.facts.before, expected);
  assert.equal(reviews[1].before.receipts[2].contentStatus, 'contradicted');
  assert.deepEqual(summarize(expected).coverage, ratio(0,5));
  joint.facts.before[0].outcome = 'supported';
  comparedFacts(joint, reviews[0].key).before.length = 0;
  for (const review of reviews) assert.deepEqual(comparedFacts(joint, review.key).before, expected);
  assert.throws(() => comparedFacts({...joint}, reviews[0].key), /대응표/);
  assert.throws(() => comparedFacts(joint, {...reviews[0].key, demo:false}), /대응표/);
});

test('독립적으로 확인한 의견만 검토율 분모에서 빼고 복사한 의견 기록은 분모에 남긴다', async () => {
  const rows = [
    ['예산은 10억 원이다.', 'fact', 'fact'],
    ['정책은 바람직하다.', 'opinion', 'opinion'],
    ['결정은 무책임하다.', 'opinion', 'opinion']
  ];
  const {joint, reviews} = await assess(rows, undefined, (work, role, editor, previous) => {
    if (role === 'before' && editor === 1) work.receipts[2] = structuredClone(previous.before.receipts[2]);
  });
  const observations = comparedFacts(joint, reviews[1].key).before;
  assert.deepEqual(observations, [fact('supported'), fact('excluded'), fact('shared')]);
  assert.deepEqual(summarize(observations).coverage, ratio(1,2));
});

test('구간 기록은 허용된 판정·충돌 조합만 받고 분모가 비면 비율을 비워 둔다', () => {
  const flags = ['none','article','quote','both'];
  const allowed = {
    supported:['none'], limited:['none'], contradicted:['article'], quotedConflict:['quote'], excluded:['none'],
    shared:['none','article','quote'], pending:['none','article','quote'], disputed:flags
  };
  for (const [outcome, accepted] of Object.entries(allowed)) {
    for (const flag of flags) assert.equal(validRow({outcome, flag}), accepted.includes(flag));
  }
  for (const row of [null, [], {}, {outcome:'supported'}, {...fact('supported'), text:'기사 비공개 원문'}, fact('__proto__'), fact('pending', true)]) {
    assert.equal(validRow(row), false);
    assert.throws(() => summarize([row]), /구간별 공동 사실/);
  }
  assert.deepEqual(summarize([]).support, ratio(0,0));
  assert.deepEqual(summarize([fact('excluded')]).coverage, ratio(0,0));
});

test('원본 핵심 사실의 유지와 수정본 충돌의 전후 상태를 대응 구간별로 센다', () => {
  const facts = {
    before: [fact('supported'), fact('supported'), fact('supported'), fact('shared', 'article'),
      fact('limited'), fact('supported'), fact('pending'), fact('excluded')],
    after: [fact('disputed', 'both'), fact('supported'), fact('pending', 'quote'), fact('contradicted', 'article'),
      fact('quotedConflict', 'quote'), fact('pending'), fact('shared')]
  };
  const context = {beforeCore: [2, 2, 2, 2, 2, 1, 0, 2], afterCore: [2, 0, 2, 1, 0, 2, 0],
    matches: [[0, 1], [1, 0], [3, 2], [4, 3], [5, 5], [6, 6]]};
  assert.deepEqual(auditFacts(facts, context), {
    core: {total: 3, retained: 1, changed: 1, unmatched: 1},
    flags: {total: 4, previouslyFlagged: 1, previouslySupported: 1, previouslyUnflagged: 1, unmatched: 1, core: 2}
  });
});

test('두 편집자의 독립 지정부터 내보내기까지 같은 종전 기록에서 서로 다른 핵심 보존 결과를 회수한다', async () => {
  const before = ['첫 번째 보도다.', '회의가 열렸다.', '자료는 공개됐다.', '예산은 10억 원이다.'];
  const after = [...before.slice(0, -1), '참석자는 30명이었다.'];
  const rows = texts => texts.map(text => [text, 'fact', 'fact']);
  const records = [];
  for (const coreIndex of [0, 3]) {
    const {joint, reviews} = await assess(rows(before), rows(after), (work, role, editor, previous) => {
      if (role === 'before' && editor === 1) work.receipts[1] = structuredClone(previous.before.receipts[1]);
      const observed = engine.report(work.article, work.sources, work.receipts);
      const row = observed.rows[0], source = work.sources[0];
      work.articleAssessment = rubric.save(observed, work.sources, {
        coreRowIds: role === 'before' ? [observed.rows[coreIndex].id, observed.rows[1].id] : [],
        ratings: {wording: {level: role === 'before' ? 2 : 0, rowId: row.id, quote: row.text, sourceId: source.id,
          sourceQuote: source.excerpt, reason: '원자료와 해당 구절의 표현을 대조했다.', impact: '예산에 대한 인상이 달라질 수 있다.'}}
      });
    });
    records.push(series.makeRecord(joint, reviews[0].key));
  }
  assert.equal(series.reviewId(records[0], 3), series.reviewId(records[1], 3));
  assert.notEqual(series.reviewId(records[0]), series.reviewId(records[1]));
  for (const [i, exported] of records.entries()) {
    const result = series.summarize([JSON.parse(JSON.stringify(exported))]);
    assert.equal(result.facts.audit.improvedArticles, 1);
    assert.equal(result.articles[0].facts.before.shared, 1);
    assert.deepEqual(result.facts.audit.core, {total: 1, retained: 1 - i, changed: 0, unmatched: i});
  }
});

test('예비비 사례의 배포 파일로 양쪽에 같은 검토 기록을 회수하면 공동 사실 확인 건수는 0이다', async () => {
  const before = require('../experiments/cross-party-review/reconstructed-before.json');
  const after = require('../experiments/cross-party-review/reconstructed-after.json');
  const reviews = [];
  for (let i = 0; i < 2; i++) {
    const {key, packets} = await blind.prepare(before, after);
    const recover = (work, role) => ({...work, blindReview:packets[key.mapping[role].slot].blindReview});
    reviews.push({key, ...await blind.resolve(key, recover(after,'after'), recover(before,'before'))});
  }
  const {facts} = compare(...reviews);
  for (const rows of [facts.before, facts.after]) {
    const result = summarize(rows);
    assert.deepEqual([result.shared, result.pending, result.supported], [5,1,0]);
    assert.deepEqual(result.coverage, ratio(0,6));
  }
  assert.deepEqual([summarize(facts.before).articleFlagged, summarize(facts.after).articleFlagged], [2,0]);
});

test('전년에 비해 늘어난 회계가 달라지면 두 판본이 각각 사실이어도 핵심 사실을 수동 대조한다', async t => {
  const fixture = require('../experiments/evidence-retrieval-transfer/fiscal-tables/fixture.json');
  const table = fixture.documents.settlement.lines, source = fixture.sources.settlementReport;
  const catalog = [2, 3].map(i => ({id:'row-' + i, title:source.title, url:source.url, version:source.published,
    locator:'인쇄본 4쪽 ' + table[i].split('\t')[0] + ' 행', excerpt:[table[0], table[i]].join('\n')}));
  function rows(account, decisionSource, last) {
    const decision = {status:'fact', sourceIds:[decisionSource]};
    return [[account + '의 2024회계연도 결산이다.'], ['국회예산정책처 표에서 전년과 비교했다.'],
      ['해당 회계의 지출은 전년보다 늘었다.', decision, decision], ['비교 기준은 결산액이다.'], [last, 'fact', 'fact']];
  }
  const before = rows('일반회계', 'source-1', '2024회계연도 일반회계 결산액은 344.5조 원이었다.');
  const after = rows('특별회계', 'source-2', '일반회계의 2024회계연도 결산 지출액은 344.5조 원이었다.');
  const {reviews, joint} = await assess(before, after, (work, role) => {
    const observed = engine.report(work.article, work.sources, work.receipts);
    const row = observed.rows[2], ref = work.sources[role === 'before' ? 0 : 1];
    work.articleAssessment = rubric.save(observed, work.sources, {coreRowIds:[row.id], ratings:{
      wording:{level:role === 'before' ? 2 : 0, rowId:row.id, quote:row.text, sourceId:ref.id, sourceQuote:ref.excerpt,
        reason:'결산표의 전년 대비 열을 대조했다.', impact:'어떤 회계에서 지출이 늘었는지에 영향을 준다.'}
    }});
  }, catalog);
  const record = series.makeRecord(joint, reviews[0].key);
  assert.deepEqual(record.factMatches, [[2,null],[4,null]]);
  assert.deepEqual(record.facts.before[2], fact('supported'));
  assert.deepEqual(record.facts.after[2], fact('supported'));
  const {facts, articles} = series.summarize([JSON.parse(JSON.stringify(record))]);
  assert.equal(articles[0].sourceChanged, false);
  assert.equal(facts.audit.improvedArticles, 1);
  assert.deepEqual(facts.audit.core, {total:1, retained:0, unmatched:1, changed:0});
  const changed = {before:2, after:2, status:'changed', reason:'자료에서 가리키는 대상이 일반회계에서 특별회계로 바뀌었다.'};
  assert.deepEqual(retention.summarize(record, [changed]), {total:2, autoRetained:0, manualRetained:0, changed:1, notFound:0, open:1});
  const items = reviews.flatMap((review, editor) => ['key','before','after'].map(role => ({name:editor + '-' + role + '.json', data:review[role]})));
  const fresh = await retention.create(record, items, [changed]);
  assert.deepEqual(retention.verify(fresh, record), [changed]);

  // Recreate the historical archive identity for these six files under the immediate-neighbor matcher.
  const historical = {...structuredClone(record), version:4};
  delete historical.biasEvidenceSha256;
  historical.factMatches[0][1] = 2;
  historical.factContext.matches.unshift([2,2]);
  const kept = {before:4, after:4, status:'retained', reason:'일반회계 결산액 344.5조 원을 대조했다.'};
  const reviewId = series.reviewId(historical);
  const archive = {format:fresh.format, version:2, reviewId, evidenceDigest:fresh.evidenceDigest, items:fresh.items, notes:[kept], checksum:engine.digestValue([
    fresh.format, 2, reviewId, fresh.evidenceDigest, [[4,4,'retained',kept.reason]]])};
  const stored = retention.read(archive);
  assert.deepEqual(stored.notes, [kept]);
  const recovered = await blind.resolveBundle(stored.items);
  const rebuilt = series.makeRecord(compare(...recovered), recovered[0].key);
  assert.deepEqual(rebuilt, record);
  assert.throws(() => retention.verify(archive, rebuilt), error => error.code === 'legacy-review-changed');
  assert.throws(() => retention.summarize(historical, stored.notes));
  assert.equal(retention.summarize(rebuilt, []).open, 2);
  await assert.rejects(() => retention.create(historical, items, stored.notes), /다시 계산한 평가/);

  await t.test('이전 요약 링크에서 대조 파일 하나를 열면 여섯 파일로 다시 계산하고 예전 수기 판정을 별도로 표시한다', async t => {
    const fs = require('node:fs'), path = require('node:path'), {JSDOM} = require('jsdom');
    const reader = path.join(__dirname, '../docs/reader');
    const dom = new JSDOM(fs.readFileSync(path.join(reader, 'article-compare.html'), 'utf8'), {
      url:'file:///reader/article-compare.html#review=' + archive.reviewId + '&focus=retention', runScripts:'outside-only'});
    t.after(() => dom.window.close());
    const window = dom.window, document = window.document;
    window.TextEncoder = TextEncoder;
    Object.defineProperty(window, 'crypto', {value:require('node:crypto').webcrypto});
    for (const script of document.querySelectorAll('script[src]')) window.eval(fs.readFileSync(path.join(reader, script.getAttribute('src')), 'utf8'));
    const picker = document.querySelector('#blind-bundle-files');
    Object.defineProperty(picker, 'files', {value:[{name:'종전-대조.json', text:async () => JSON.stringify(archive)}]});
    picker.dispatchEvent(new window.Event('change'));
    await t.waitFor(() => assert.match(document.querySelector('#review-target-status').textContent, /작업 파일 6개를 열어 현재 기준으로 다시 계산/));
    const facts = document.querySelector('#joint-facts'), output = document.querySelector('#output');
    assert.equal(document.querySelector('#result').hidden, false);
    assert.match(facts.querySelector('[data-retention-summary]').textContent, /자동 대응으로 확인 0개.*진행자가 유지 확인 0개.*검토 남음 2개/);
    assert.equal(facts.querySelector('[data-retention-before="2"] [data-retention-state]').value, '');
    assert.equal(facts.querySelector('[data-retention-before="4"] [data-retention-reason]').value, '');
    const prior = [...output.querySelectorAll('details')].find(group => group.firstElementChild.textContent.includes('이전 기준으로 기록한 사후 판단'));
    assert.ok(prior);
    assert.ok(prior.textContent.includes(kept.reason));
    assert.ok(!facts.contains(prior));
    const recovery = [...output.querySelectorAll('details')].find(group => group.firstElementChild.textContent.includes('대응표 2개 꺼내기'));
    const buttons = recovery.querySelectorAll('button');
    assert.equal(buttons.length, 6);
    let blob, filename;
    window.Blob = Blob;
    window.URL.createObjectURL = data => { blob = data; return 'blob:extracted'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
    buttons[1].click();
    assert.equal(filename, archive.items[1].name);
    assert.deepEqual(JSON.parse(await blob.text()), archive.items[1].data);
    assert.doesNotMatch(document.querySelector('#review-target-status').textContent, /요약과 일치/);
  });
});

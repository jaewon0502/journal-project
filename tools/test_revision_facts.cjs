const {test} = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const blind = require('../docs/reader/blind-revision.js');
const {compare, comparedFacts} = require('../docs/reader/revision-agreement.js');
const {summarize, validRow} = require('../docs/reader/revision-facts.js');

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

function manuscript(rows) {
  const article = rows.map(([text]) => text).join('\n');
  return {format:workspace.schema, article, articleDraft:article, sources, demo:true, receipts:[], rowDrafts:[],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(key => [key, '']))}};
}

// Exercise the public distribution and recovery paths. Each row has a passage followed by each editor's decision.
async function assess(before, after = [['수정본의 확인이 남았다.', null, null]], edit = () => {}) {
  const reviews = [];
  for (let editor = 0; editor < 2; editor++) {
    const {key, packets} = await blind.prepare(manuscript(before), manuscript(after));
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

const {test} = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const {proposals, apply} = require('../docs/reader/revision-draft.js');

const sources = [
  {id:'budget', title:'의결서', url:'https://council.example/budget', locator:'표 2', version:'1판', excerpt:'사업비 10억 원'},
  {id:'report', title:'결산서', url:'https://audit.example/report', locator:'표 3', version:'확정본', excerpt:'사업비는 10억 원이다.'}
];
const original = '사업비는 20억 원이다.';
const replacement = '사업비는 10억 원이다.';
function review(article, decisions, catalog = sources) {
  const first = engine.report(article, catalog);
  const receipts = decisions.map(([index, decision]) => engine.decide(first.rows[index], {
    status:'contradicted', sourceIds:['budget'], reason:'확정 의결서에서 금액을 대조했다.', acknowledged:true, ...decision
  }, catalog));
  return engine.report(article, catalog, receipts);
}
const correction = {correction:replacement, correctionChecked:true};

test('반복된 같은 행에서도 선택한 위치만 바꾸고 CRLF·탭·보조 평면 문자와 다른 문장 속 같은 표현을 보존한다', () => {
  const prefix = '🗞 머리말.\r\n\t';
  const suffix = '\r\n야당은 “' + original + '”라고 주장했다.\r\n\r\n다음 문단이다.  ';
  const text = prefix + original + '  ' + original + suffix;
  const report = review(text, [[1, correction]]);
  const [first, second] = proposals(report);
  assert.equal(report.rows[1].positions.length, 2);
  assert.equal(first.rowId, second.rowId);
  assert.deepEqual([first.start, second.start], [prefix.length, prefix.length + original.length + 2]);
  assert.equal(apply(report, [second]), prefix + original + '  ' + replacement + suffix);
  assert.equal(apply(report, [second, first]), prefix + replacement + '  ' + replacement + suffix);
  assert.equal(report.article, text);
});

test('다른 길이의 여러 정정문과 문자 그대로의 치환 기호를 원문 좌표로 적용한다', () => {
  const next = '지급 대상은 20명이다.';
  const fixed = '위원회가 확정한 지급 대상은 15명이다. ($& 포함)';
  const report = review(original + '\n\t' + next, [[0, correction], [1, {correction:fixed, correctionChecked:true}]]);
  const items = proposals(report);
  assert.equal(items.length, 2);
  assert.equal(apply(report, [items[1], items[0]]), replacement + '\n\t' + fixed);
  assert.equal(engine.report(apply(report, items), sources).rows.every(row => !row.receipt), true);
});

test('현재 검증한 충돌 판정 중 정정문까지 확인한 기록만 쓰고 편집 중인 판단은 제외한다', () => {
  const text = [original, '집행액은 12억 원이다.', '회의는 5일 열렸다.', '지급 인원은 20명이다.'].join('\n');
  const report = review(text, [[0, correction], [1, {}], [2, {status:'fact'}]]);
  const first = report.rows[0];
  const draft = workspace.activeReport(text, sources, report.rows.flatMap(row => row.receipt ? [row.receipt] : []),
    new Map([[first.id, {...first.receipt, reason:'금액을 다시 대조 중'}]]));
  assert.equal(proposals(report).length, 1);
  assert.deepEqual(proposals(draft), []);
  const proposed = proposals(report);
  assert.throws(() => apply(draft, proposed));
  for (const difference of [{correction:''}, {correction:'  '}, {correction:'  ' + original},
    {correctionChecked:false}, {status:'fact'}, {rowId:'다른 구간'}, {binding:'다른 자료'}, {articleBinding:'다른 판본'}]) {
    const damaged = structuredClone(report);
    Object.assign(damaged.rows[0].receipt, difference);
    assert.deepEqual(proposals(damaged), []);
  }
});

test('문구와 위치가 같아도 앞뒤 문맥이나 판정에 사용한 원자료가 달라지면 옛 선택을 거절한다', () => {
  const text = '여당 설명.\n' + original;
  const before = review(text, [[1, correction]]), selection = proposals(before);
  const changed = text.replace('여당', '야당');
  const catalogue = [{...sources[0], version:'2판'}, sources[1]];
  const oldReceipt = before.rows[1].receipt;
  assert.deepEqual(proposals(engine.report(changed, sources, [oldReceipt])), []);
  assert.deepEqual(proposals(engine.report(text, catalogue, [oldReceipt])), []);
  for (const current of [review(changed, [[1, correction]]), review(text, [[1, correction]], catalogue),
    review(text, [[1, {...correction, sourceIds:['report']}]]),
    review(text, [[1, {...correction, correction:'확정 사업비는 10억 원이다.'}]])]) {
    const actual = proposals(current);
    assert.equal(actual[0].start, selection[0].start);
    assert.equal(actual[0].original, selection[0].original);
    assert.throws(() => apply(current, selection), /다시 선택/);
    assert.ok(apply(current, actual).includes(actual[0].replacement));
  }
});

test('빈 선택, 중복, 겹치거나 벗어난 범위, 원문이나 정정문을 바꾼 선택을 거절한다', () => {
  const report = review(original + ' ' + original, [[0, correction]]);
  const [a,b] = proposals(report);
  for (const selection of [[], null, a, [null], [a,a], [a,{...b,start:a.end-1}], [{...a,start:-1}],
    [{...a,end:report.article.length+1}], [{...a,end:a.start}], [{...a,original:replacement}],
    [{...a,replacement:''}], [{...a,rowId:b.rowId+'x'}], [{...a,binding:null}]]) {
    assert.throws(() => apply(report, selection));
  }
  const damaged = structuredClone(report);
  damaged.rows[0].positions[0].end += 1;
  assert.throws(() => proposals(damaged), /위치/);
  assert.equal(apply(report, [b]), original + ' ' + replacement);
});

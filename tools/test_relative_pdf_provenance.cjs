const {test} = require('node:test');
const assert = require('node:assert/strict');
const {prepare, decide, report, sourceTarget, sameSourceDocument} = require('../docs/reader/factcheck-engine.js');

const article = '의원은 “집행액은 20억 원이었다”고 말했다.';
const speech = {id:'speech', url:'https://archive.example/records/minutes.pdf', version:'확정본', locator:'의원 발언',
  excerpt:'의원은 집행액이 20억 원이라고 말했다.'};
const audit = {id:'doc', url:'https://archive.example/reader/viewer.html?file=..%2Frecords%2Fminutes.pdf#page=4',
  version:'확정본', locator:'표 2', excerpt:'당해 연도 집행액 20억 원'};
const judgment = {status:'attribution', sourceIds:['speech'], reason:'회의 발언을 대조했다.', acknowledged:true,
  contentStatus:'supported', contentSourceIds:['doc'], contentChecked:true, contentReason:'지출 명세를 대조했다.'};
const view = (base, file, part = '?') => base + part + new URLSearchParams({file}).toString();

test('상대 PDF 경로는 해당 뷰어의 위치를 기준으로 비교하고 실제 열기 주소를 보존한다', () => {
  const base = 'https://archive.example/reader/viewer.html';
  for (const [direct, viewer, same] of [
    [speech.url, audit.url, true],
    [speech.url, view(base, '/records/minutes.pdf#page=3', '#'), true],
    [speech.url, view(base, './files/../../records/minutes.pdf'), true],
    ['https://archive.example/reader/minutes.pdf', view(base, 'minutes.pdf'), true],
    ['https://archive.example/reader/annual%20report.pdf', view(base, 'annual%20report.pdf?utm_medium=pdf'), true],
    [speech.url, view(base, './minutes.pdf'), false],
    [speech.url, view('https://other.example/reader/viewer.html', '../records/minutes.pdf'), false],
    [speech.url, view(base, '../records/audit.pdf'), false],
    ['https://archive.example/reader/A', view(base, 'A'), false],
    [speech.url, view(base, '%2Frecords%2Fminutes.pdf'), false],
    [speech.url, view(base, '../records/minutes.pdf') + '&edition=draft', false]
  ]) {
    const refs = [{...speech, url:direct}, {...audit, url:viewer}];
    assert.equal(sameSourceDocument(refs, ...refs), same, viewer);
    assert.equal(sourceTarget(refs[1]).href, viewer);
    const row = prepare(article, refs).rows[0];
    for (const contentStatus of ['supported', 'contradicted']) {
      const save = () => decide(row, {...judgment, contentStatus}, refs);
      if (same) assert.throws(save, /다른 원자료/, viewer);
      else assert.equal(save().contentStatus, contentStatus, viewer);
    }
  }
});

test('최초 원문이 같은 PDF의 상대 뷰어로 연결되면 그 보도를 발언 내용의 별도 근거로 승인할 수 없다', () => {
  const copy = {...audit, url:'https://press.example/report', originUrl:audit.url};
  const refs = [speech, copy];
  assert.throws(() => decide(prepare(article, refs).rows[0], judgment, refs), /다른 원자료/);
});

test('같은 PDF의 상대 경로를 독립 자료로 기록했던 작업을 열면 재검토 대상으로 돌아간다', () => {
  // Saved by 1df5945 with these exact sources.
  const saved = {...judgment, protocol:'journal-review/1', rowId:'unit-0', recordedAt:'2026-11-25T01:18:20.431Z',
    articleBinding:'a8958025b6999a121525ee48258a3b8b504278f65eb96835e1708bce1ddbdfdb',
    binding:'9eda6455a9bfa81d0aa5bee6e0174b7c1435b532e42780bae5769bbe22bc053c',
    references:'a1d9bf3c2def1d5a6b353d2eb6ef9c5adbe512f3c2b7c7a210b63a84a87a5cab',
    checksum:'b16f7240b67b7d4ff99aea1ed7ddcd64f11fd9ede152382309e6294cf26be9b8'};
  const row = report(article, [speech, audit], [saved]).rows[0];
  assert.equal(row.articleBinding, saved.articleBinding);
  assert.equal(row.binding, saved.binding);
  assert.equal(row.status, 'pending');
  assert.equal(row.receipt, null);
  assert.equal(row.priorDecision, null);
});

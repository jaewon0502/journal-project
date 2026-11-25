const {test} = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const rubric = require('../docs/reader/article-rubric.js');
const {compare, compareSources} = require('../docs/reader/revision-bias-evidence.js');

const article = '상인 설문에서 휴업 사유를 물었다.\n주민 설문에서 이사 사유를 물었다.\n조사는 화요일에 끝났다.';
const shops = {id:'shops', title:'상인 설문', url:'https://office.example/shops', version:'초판',
  locator:'설문지 1번', excerpt:'상인에게 휴업 사유와 휴업 기간을 물었다.'};
const residents = {id:'residents', title:'주민 설문', url:'https://office.example/residents', version:'초판',
  locator:'설문지 2번', excerpt:'주민에게 이사 사유와 이사 시기를 물었다.'};

function paper(text = article, sources = [shops, residents]) {
  return {format:workspace.schema, article:text, articleDraft:text, demo:false, sources, receipts:[], rowDrafts:[],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(key => [key, '']))}};
}
function anchor(view, row, source, quote = view.rows[row].text, sourceQuote = view.sources[source].excerpt) {
  return {rowId:view.rows[row].id, quote, sourceId:view.sources[source].id, sourceQuote};
}
function rating(main, other, level = 2) {
  return {level, ...main, reason:'기사 구절과 설문 기록을 대조했다.', impact:'독자가 조사의 대상을 다르게 해석한다.',
    ...(other ? {compareRowId:other.rowId, compareQuote:other.quote, compareSourceId:other.sourceId,
      compareSourceQuote:other.sourceQuote} : {})};
}
function evaluated(work, dimension, score) {
  const report = engine.report(work.article, work.sources);
  const saved = rubric.save(report, work.sources, {coreRowIds:[], ratings:{[dimension]:score}});
  const view = workspace.read({...work, articleAssessment:saved});
  return {view, rating:view.assessment.bias.items.find(item => item.id === dimension).rating};
}
function check(method, a, b, dimension, expected) {
  assert.deepEqual(method(a.rating, b.rating, a.view, b.view, dimension), {category:expected});
  assert.deepEqual(method(b.rating, a.rating, b.view, a.view, dimension), {category:expected});
}

test('두 사람이 지목한 기사 구절과 설문을 판본별로 확인하고 수정 전후에 선택한 자료 교체도 검출한다', () => {
  const first = paper(), revised = paper(article.replace('화요일', '수요일'));
  const original = workspace.read(first), after = workspace.read(revised);
  const editorA = evaluated(first, 'wording', rating(anchor(original, 0, 0)));
  const editorB = evaluated(first, 'wording', rating(anchor(original, 1, 1)));
  const editorAAfter = evaluated(revised, 'wording', rating(anchor(after, 1, 1), null, 0));
  const editorBAfter = evaluated(revised, 'wording', rating(anchor(after, 0, 0), null, 0));
  check(compare, editorA, editorB, 'wording', 'different');
  check(compare, editorAAfter, editorBAfter, 'wording', 'different');
  check(compareSources, editorA, editorAAfter, 'wording', 'different');
  check(compareSources, editorB, editorBAfter, 'wording', 'different');
  check(compareSources, editorA, editorBAfter, 'wording', 'aligned');
  check(compare, editorA, editorBAfter, 'wording', 'unresolved');
  // Both reviewers can also agree within each edition but jointly switch surveys.
  check(compare, editorA, editorA, 'wording', 'aligned');
  check(compare, editorAAfter, editorAAfter, 'wording', 'aligned');
});

test('같은 위치 안의 인용 범위와 다른 지역 식별자를 비교하고, 맞닿은 선택과 단어 끝만의 겹침을 구분한다', () => {
  const sameWithOtherId = {...shops, id:'local-copy', title:'이름 변경'};
  const left = workspace.read(paper()), right = workspace.read(paper(article, [sameWithOtherId, residents]));
  const a = {view:left, rating:rating(anchor(left, 0, 0, '상인 설문에서 휴업', '상인에게 휴업 사유와'))};
  const b = {view:right, rating:rating(anchor(right, 0, 0, '설문에서 휴업 사유를', '휴업 사유와 휴업'))};
  check(compare, a, b, 'wording', 'aligned');
  check(compare, a, {view:right, rating:{...b.rating, quote:'사유를 물었다.'}}, 'wording', 'different');
  check(compareSources, a, {view:right, rating:{...b.rating, sourceQuote:' 휴업 기간을 물었다.'}}, 'wording', 'different');
  check(compareSources, a, {view:right, rating:{...b.rating, sourceQuote:'와 휴업 기간'}}, 'wording', 'unresolved');
  check(compare, a, {view:left, rating:{...a.rating, rowId:left.rows[1].id, quote:'사유를 물었다.'}}, 'wording', 'different');
});

test('기사 위치나 등록 발췌 속 선택이 여러 번 나오거나 유효 점수가 없으면 일치를 단정하지 않는다', () => {
  const duplicate = workspace.read(paper('같은 문장이다.\n같은 문장이다.\n다른 문장이다.'));
  const row = anchor(duplicate, 0, 0);
  assert.equal(duplicate.rows[0].positions.length, 2);
  const a = {view:duplicate, rating:rating(row)};
  check(compare, a, a, 'omission', 'unresolved');
  check(compareSources, a, a, 'omission', 'aligned');
  const twice = workspace.read(paper('예산 예산 기준이다.'));
  const ambiguous = {view:twice, rating:rating(anchor(twice, 0, 0, '예산'))};
  check(compare, ambiguous, ambiguous, 'wording', 'unresolved');
  const duplicateSource = {view:twice, rating:rating(anchor(twice, 0, 0, '기준이다', '휴업'))};
  check(compareSources, duplicateSource, duplicateSource, 'wording', 'unresolved');
  for (const absent of [null, {level:'na'}, {level:4}]) {
    for (const method of [compare, compareSources]) check(method, a, {view:duplicate, rating:absent}, 'standards', 'unresolved');
  }
});

test('다른 등록 발췌의 상대 위치와 공통 숫자는 합치지 않으며 실제 PDF 판본과 쪽을 구별한다', () => {
  const catalog = [
    {...shops, excerpt:'상인 10명은 계속 영업한다.'},
    {...shops, id:'other-clip', excerpt:'주민 10명은 계속 거주한다.'},
    {...shops, id:'copy', url:'https://mirror.example/shops', originUrl:shops.url, excerpt:'상인 10명은 계속 영업한다.'},
    {...shops, id:'another', url:'https://office.example/other-survey', excerpt:'상인 10명은 계속 영업한다.'}
  ];
  const view = workspace.read(paper(article, catalog));
  const at = i => ({view, rating:rating(anchor(view, 0, i, view.rows[0].text, '10명'))});
  check(compareSources, at(0), at(1), 'wording', 'unresolved');
  check(compareSources, at(0), at(2), 'wording', 'unresolved');
  check(compareSources, at(0), at(3), 'wording', 'different');

  const pdf = {...shops, url:'https://office.example/list.pdf', pdfPage:'1', pdfSha256:'a'.repeat(64)};
  const pages = [pdf, {...pdf, id:'mirror', url:'https://archive.example/file.pdf'},
    {...pdf, id:'next', pdfPage:'2'}, {...pdf, id:'other-version', pdfSha256:'b'.repeat(64)}];
  const pageView = workspace.read(paper(article, pages));
  const page = i => ({view:pageView, rating:rating(anchor(pageView, 0, i))});
  check(compareSources, page(0), page(1), 'wording', 'aligned');
  check(compareSources, page(0), page(2), 'wording', 'different');
  check(compareSources, page(0), page(3), 'wording', 'different');
});

test('당사자별 기사·자료 연결을 두 개 모두 보존하며 판본 간 자료 집합은 순서와 무관하게 비교한다', () => {
  const work = paper(), view = workspace.read(work);
  const a = anchor(view, 0, 0), b = anchor(view, 1, 1);
  const first = evaluated(work, 'standards', rating(a, b));
  const reverse = evaluated(work, 'standards', rating(b, a));
  const crossed = evaluated(work, 'standards', rating({...a, sourceId:b.sourceId, sourceQuote:b.sourceQuote},
    {...b, sourceId:a.sourceId, sourceQuote:a.sourceQuote}));
  check(compare, first, reverse, 'standards', 'aligned');
  check(compare, first, crossed, 'standards', 'different');
  check(compareSources, first, reverse, 'standards', 'aligned');
  check(compareSources, first, crossed, 'standards', 'aligned');
  check(compareSources, first, {view, rating:{...reverse.rating, compareSourceId:''}}, 'standards', 'unresolved');
});

test('제목·도입 평가의 두 기사 구절과 공통 원자료 한 곳을 비교한다', () => {
  const work = paper(), view = workspace.read(work);
  const a = anchor(view, 0, 0), b = anchor(view, 1, 0), c = anchor(view, 2, 0);
  const first = evaluated(work, 'framing', rating(a, b));
  const reversed = evaluated(work, 'framing', rating(b, a));
  const other = evaluated(work, 'framing', rating(a, c));
  check(compare, first, reversed, 'framing', 'aligned');
  check(compare, first, other, 'framing', 'different');
  check(compare, first, {view, rating:{...first.rating, compareRowId:''}}, 'framing', 'aligned');
  check(compareSources, first, other, 'framing', 'aligned');
});

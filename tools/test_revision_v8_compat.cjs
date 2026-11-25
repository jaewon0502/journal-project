const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const workspace = require('../docs/reader/workspace-snapshot.js');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const retention = require('../docs/reader/retention-case.js');

async function inputs() {
  function manuscript(scope) {
    const article = ['조사 대상: ' + scope, '올해 수치를 집계했다.', '고용률은 62.7%였다.', '표 설명은 끝났다.'].join('\n');
    return {format:workspace.schema, demo:true, article, articleDraft:article, receipts:[], rowDrafts:[],
      sources:[{id:'report', title:'검토용 통계표', url:'https://example.invalid/data', version:'초판',
        locator:'2쪽', excerpt:'고용률은 62.7%였다.'}],
      sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(field => [field, '']))}};
  }
  const items = [];
  for (const editor of [1, 2]) {
    const {key, packets} = await blind.prepare(manuscript('15세 이상 전체'), manuscript('15~64세'));
    items.push({name:'대응표-' + editor, data:key});
    for (const role of ['before', 'after']) {
      const copy = packets[key.mapping[role].slot];
      const row = engine.prepare(copy.article, copy.sources).rows[2];
      copy.receipts = [engine.decide(row, {status:'fact', sourceIds:[copy.sources[0].id], acknowledged:true,
        reason:'검토자 ' + editor + '가 통계표의 수치를 확인했다.'}, copy.sources)];
      const report = engine.report(copy.article, copy.sources, copy.receipts);
      copy.articleAssessment = rubric.save(report, copy.sources, {coreRowIds:[row.id], ratings:{wording:{
        level:role === 'before' ? 2 : 0, rowId:row.id, quote:row.text, sourceId:copy.sources[0].id, sourceQuote:row.text,
        reason:'표현의 강도를 비교했다.', impact:'조사 결과의 규모가 다르게 읽힌다.'}}});
      items.push({name:'작업-' + editor + '-' + role, data:copy});
    }
  }
  const reviews = await blind.resolveBundle(items);
  return {items, joint:agreement.compare(...reviews), key:reviews[0].key};
}

function page(t, name, hash = '') {
  const dir = path.join(__dirname, '../docs/reader');
  const dom = new JSDOM(fs.readFileSync(path.join(dir, name), 'utf8'),
    {url:'file:///reader/' + name + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const {window} = dom, {document} = window;
  window.TextEncoder = TextEncoder;
  Object.defineProperty(window, 'crypto', {value:webcrypto});
  for (const script of document.querySelectorAll('script[src]')) {
    window.eval(fs.readFileSync(path.join(dir, script.getAttribute('src')), 'utf8'));
  }
  function select(id, items) {
    const field = document.getElementById(id);
    const files = items.map(({name, data}) => ({name, text:async () => JSON.stringify(data)}));
    Object.defineProperty(field, 'files', {configurable:true, value:files});
    field.dispatchEvent(new window.Event('change'));
  }
  return {window, document, select};
}

test('이전 연결은 당시 식별값으로만 중복을 확인하고 현행 보존율과 집계를 분리한다', async () => {
  const {joint, key} = await inputs();
  const current = series.makeRecord(joint, key);
  const prior = [5, 6, 7].map(version => series.makeLegacyMatchRecord(joint, key, version));
  const v7 = prior[2];
  // Generated independently by the released v7 writer at 4a4c2c4.
  assert.equal(series.reviewId(v7), '78731c70a15468ce9eccbfb758018cf45ca65d38e73e00b4f7b3c60b7662480a');
  assert.equal(current.version, 8);
  assert.deepEqual(v7.factMatches, [[2,2]]);
  assert.deepEqual(current.factMatches, [[2,null]]);
  assert.deepEqual(current.priorReviewIds, prior.map(record => [record.version, series.reviewId(record)]));
  assert.notEqual(series.reviewId(current, 7), series.reviewId(v7));
  for (const records of [[...prior, current], [current, ...prior], [v7, current, prior[0], prior[1]]]) {
    const report = series.summarize(JSON.parse(JSON.stringify(records)));
    assert.equal(report.duplicateCount, 3);
    assert.equal(report.facts.matchBasis, 'current');
    assert.deepEqual(report.facts.audit.core, {total:1, retained:0, unmatched:1, changed:0});
  }
  const oldOnly = series.summarize([v7]);
  assert.equal(oldOnly.facts.matchBasis, 'historical');
  assert.equal(oldOnly.facts.priorMatchArticles, 1);
  assert.equal(oldOnly.facts.audit.core.retained, 1);
  const differentCase = structuredClone(v7);
  differentCase.before.articleSha256 = '1'.repeat(64);
  differentCase.after.articleSha256 = '2'.repeat(64);
  const mixed = series.summarize([differentCase, current]);
  assert.deepEqual([mixed.facts.priorMatchArticles, mixed.facts.priorAudit.core.retained,
    mixed.facts.audit.core.total, mixed.facts.audit.core.retained], [1,1,1,0]);
  for (const edit of [
    record => { record.factContext.beforeCore[2] = 0; },
    record => { record.factMatches = current.factMatches; record.factContext = current.factContext; },
    record => { record.factContext.matches.pop(); }
  ]) {
    const wrong = structuredClone(v7);
    edit(wrong);
    for (const records of [[wrong,current], [current,wrong]]) assert.throws(() => series.summarize(records), /구절 대응|핵심 주장/);
  }
  const changedCore = structuredClone(v7);
  changedCore.factContext.beforeCore[2] = 0;
  const falseHistory = structuredClone(current);
  falseHistory.priorReviewIds.at(-1)[1] = series.reviewId(changedCore);
  assert.throws(() => series.summarize([changedCore, falseHistory]), /핵심 주장/);
  const malformed = structuredClone(current);
  malformed.priorReviewIds[0][1] = '누구나 적은 값';
  assert.throws(() => series.summarize([malformed]), /이전 요약/);
});

test('이전 요약의 수동 판단은 기준이 달라지면 현재 기사로 옮기기 전에 다시 확인한다', async () => {
  const {joint, key, items} = await inputs();
  const current = series.makeRecord(joint, key), prior = series.makeLegacyMatchRecord(joint, key, 7);
  const archive = await retention.create(prior, items, []);
  assert.equal(archive.reviewId, series.reviewId(current));
  const projected = {...current, version:7};
  delete projected.priorReviewIds;
  await assert.rejects(retention.create(projected, items, []), /다시 계산한 평가/);
  const note = {before:2, after:2, status:'changed', reason:'조사 대상이 달라졌다.'};
  await assert.rejects(retention.create(prior, items, [note]), /다시 대조한 뒤/);
  const updated = await retention.create(current, items, [note]);
  assert.deepEqual(retention.verify(updated, current), [note]);
  const wrongId = series.reviewId(projected);
  const falseArchive = {...archive, version:5, reviewId:wrongId,
    checksum:engine.digestValue([archive.format, 5, wrongId, archive.evidenceDigest, [], []])};
  assert.throws(() => retention.verifyAll(falseArchive, current), err => err.code === 'legacy-review-changed');
  assert.throws(() => retention.verifyLegacyMatchNotes(falseArchive, prior), /일치하지/);
});

test('v7 공개 요약에서 원래 파일이나 당시 진행자 기록을 열어 변경된 수치 문맥을 확인하고 v8을 저장한다', async t => {
  const {joint, key, items} = await inputs();
  const current = series.makeRecord(joint, key);
  const prior = series.makeLegacyMatchRecord(joint, key, 7);
  const {evidenceDigest, format} = await retention.create(current, items, []);
  const reviewId = series.reviewId(prior);
  const archive = {format, version:5, reviewId, evidenceDigest, items, notes:[], contextNotes:[],
    checksum:engine.digestValue([format, 5, reviewId, evidenceDigest, [], []])};
  const dashboard = page(t, 'revision-series.html');
  dashboard.select('series-files', [{name:'수치 재검토.json', data:prior}]);
  const link = () => dashboard.document.querySelector('#legacy-numeric-check a');
  await t.waitFor(() => assert.ok(link()));
  assert.equal(link().hash, '#review=' + reviewId + '&focus=numeric-check');
  assert.match(dashboard.document.querySelector('#series-core-audit').textContent, /이전 기준만으로 계산한 요약 1건/);
  for (const input of [items, [{name:'이전 진행자 파일.json', data:archive}]]) {
    const compare = page(t, 'article-compare.html', link().hash);
    compare.select('blind-bundle-files', input);
    const counter = () => compare.document.querySelector('[data-numeric-check-count]');
    await t.waitFor(() => assert.ok(counter()));
    assert.match(counter().textContent, /자동 대응에서 뺀 원본 구절 1개/);
    const row = compare.document.querySelector('[data-retention-before="2"]');
    assert.ok(row && row.open);
    let blob;
    const {window} = compare;
    window.Blob = Blob;
    window.URL.createObjectURL = file => { blob = file; return 'blob:summary'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = () => {};
    const save = [...compare.document.querySelectorAll('#output button')].find(button => button.textContent === '현재 기준의 기사별 평가 요약 저장');
    save.click();
    assert.deepEqual(JSON.parse(await blob.text()), current);
  }
  const wrong = {...prior, factMatches:current.factMatches, factContext:current.factContext};
  const compare = page(t, 'article-compare.html', '#review=' + series.reviewId(wrong) + '&focus=numeric-check');
  compare.select('blind-bundle-files', items);
  await t.waitFor(() => assert.match(compare.document.getElementById('blind-bundle-status').textContent, /일치하지 않/));
  assert.equal(compare.document.querySelector('[data-numeric-check-count]'), null);
});

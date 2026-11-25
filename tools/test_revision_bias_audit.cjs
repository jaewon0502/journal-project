const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const {audit} = require('../docs/reader/revision-bias-audit.js');
const blind = require('../docs/reader/blind-revision.js');
const rubric = require('../docs/reader/article-rubric.js');
const engine = require('../docs/reader/factcheck-engine.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const retention = require('../docs/reader/retention-case.js');

const pack = path.join(__dirname, '../experiments/bias-citation-audit');
const reader = path.join(__dirname, '../docs/reader');
const names = ['aligned', 'different'];
const contents = name => readFileSync(path.join(pack, name + '.json'), 'utf8');
const records = names.map(name => JSON.parse(contents(name + '-summary')));
const archives = names.map(name => JSON.parse(contents(name + '-case')));
const both = {articles:2, improved:2, aligned:1, different:1, unresolved:0, unopened:0,
  checkedArchives:2, duplicateArchives:0};

test('공개 요약의 전체 개선 수를 유지하고 선택한 비공개 기록의 결과만 한 번씩 센다', async () => {
  assert.deepEqual(await audit(records, []),
    {...both, aligned:0, different:0, unopened:2, checkedArchives:0});
  assert.deepEqual(await audit(records, [archives[1]]),
    {...both, aligned:0, unopened:1, checkedArchives:1});
  assert.deepEqual(await audit(records, archives), both);
  const renamed = structuredClone(archives[1]);
  renamed.items.reverse().forEach((item, index) => { item.name = '개인 작업 파일 ' + index; });
  assert.deepEqual(await audit([...records, records[1]], [renamed, archives[0], archives[1]]),
    {...both, duplicateArchives:1});
});

test('선택한 공개 기사와 짝이 맞지 않는 기록, 뒤섞인 파일 및 변경한 인용을 거부한다', async () => {
  await assert.rejects(audit([records[0]], [archives[0], archives[1]]),
    error => error.archiveIndex === 1 && /짝이 맞지/.test(error.message));
  await assert.rejects(audit(records, [records[1]]),
    error => error.archiveIndex === 0 && /진행자용/.test(error.message));
  const tampered = structuredClone(archives[1]);
  const returned = tampered.items.find(item => item.data.articleAssessment);
  returned.data.articleAssessment.ratings.wording.sourceQuote = '변경한 비공개 인용';
  await assert.rejects(audit(records, [archives[0], tampered]),
    error => error.archiveIndex === 1 && /무결성|확인할 수 없/.test(error.message));
});

test('같은 기사·평점으로 다른 구절을 정상 평가한 기록도 원래 공개 요약에 단독 대체할 수 없다', async () => {
  assert.equal((await audit([records[0]], [archives[0]])).aligned, 1);
  // If both reviewers select the new passage, even the public counts would look identical.
  for (const [editors, expected] of [[['editor-2'], 'different'], [['editor-1', 'editor-2'], 'aligned']]) {
    const items = structuredClone(archives[0].items);
    let changed = 0;
    for (const {name, data:work} of items) {
      if (!work.articleAssessment || !editors.some(editor => name.includes(editor))) continue;
      const report = engine.report(work.article, work.sources, work.receipts);
      const row = report.rows[0], score = work.articleAssessment.ratings.wording;
      assert.notEqual(row.id, score.rowId);
      work.articleAssessment = rubric.save(report, work.sources, {coreRowIds:[], ratings:{
        wording:{...score, rowId:row.id, quote:row.text}
      }});
      changed++;
    }
    assert.equal(changed, 2 * editors.length);
    const pair = await blind.resolveBundle(items);
    const revised = series.makeRecord(agreement.compare(...pair), pair[0].key);
    const alternative = await retention.create(revised, items, []);
    assert.deepEqual(revised.dimensions.map(({id, first, second}) => [id, first, second]),
      records[0].dimensions.map(({id, first, second}) => [id, first, second]));
    assert.equal((await audit([revised], [alternative]))[expected], 1);
    for (const [record, archive] of [[records[0], alternative], [revised, archives[0]]]) {
      await assert.rejects(audit([record], [archive]), error => error.archiveIndex === 0);
    }
  }
});

test('두 공개 사례와 진행자 기록을 화면에서 열고 일치 1개·차이 1개인 숫자 전용 파일을 저장한다', async t => {
  const dom = new JSDOM(readFileSync(path.join(reader, 'revision-series.html'), 'utf8'), {
    url:'file:///reader/revision-series.html', runScripts:'outside-only'
  });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w, 'crypto', {value:webcrypto});
  for (const script of doc.querySelectorAll('script[src]')) {
    w.eval(readFileSync(path.join(reader, script.getAttribute('src')), 'utf8'));
  }
  function select(id, suffix) {
    const input = doc.getElementById(id);
    const files = names.map(name => new w.File([contents(name + suffix)], name + suffix + '.json', {type:'application/json'}));
    Object.defineProperty(input, 'files', {configurable:true, value:files});
    input.dispatchEvent(new w.Event('change'));
  }
  select('series-files', '-summary');
  await t.waitFor(() => assert.match(doc.getElementById('series-improved')?.textContent || '', /100%2\/2/));
  select('series-bias-archives', '-case');
  const panel = doc.getElementById('series-bias-verified');
  await t.waitFor(() => assert.match(panel.textContent, /공통 개선 2개 중.*모두 겹친 항목 1개/));
  assert.match(panel.textContent, /서로 다른 인용 확인 1개.*인용 위치 미확정 0개.*미대조 0개/);
  const notice = doc.querySelector('#series-bias-audit [role="status"]');
  assert.match(notice.textContent, /진행자 기록 2건을 검증/);
  let saved;
  w.Blob = Blob;
  w.URL.createObjectURL = blob => { saved = blob; return 'blob:counts'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  panel.querySelector('button').click();
  const share = JSON.parse(await saved.text());
  assert.deepEqual(share, {format:'journal-bias-citation-counts-v1', demo:true, ...both});
  // A subsequent invalid selection must clear the earlier downloadable result.
  select('series-bias-archives', '-summary');
  await t.waitFor(() => assert.ok(notice.classList.contains('error')));
  assert.equal(panel.textContent, '');
  assert.equal(panel.querySelector('button'), null);
});

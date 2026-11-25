const {test} = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const workspace = require('../docs/reader/workspace-snapshot.js');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const blind = require('../docs/reader/blind-revision.js');
const agreement = require('../docs/reader/revision-agreement.js');
const series = require('../docs/reader/revision-series.js');
const cases = require('../docs/reader/retention-case.js');

const dir = path.join(__dirname, '../docs/reader');
const quote = '“이번 예산안은 무책임하다.”';
const privateReason = '비공개 진행 메모. 위원회 표결 자료로 사업비 문장을 다시 대조했다.';

function manuscript(budget, speaker, statement) {
  const article = [budget, speaker, '다음은 논평 전문이다.', statement, '논평 끝.'].join('\n');
  return {format:workspace.schema, article, articleDraft:article, demo:true, receipts:[], rowDrafts:[],
    sources:[
      {id:'budget',title:'비공개 예산 표결표',url:'https://desk.invalid/budget',version:'초판',locator:'1쪽',excerpt:'의회는 10억 원을 배정했다.'},
      {id:'minutes',title:'비공개 논평 사본',url:'https://desk.invalid/minutes',version:'초판',locator:'논평',
        excerpt: speaker + '\n' + statement}
    ],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(field => [field,'']))}};
}

async function reviewedEditions(legacyVersion = 5) {
  const supported = legacyVersion === 6;
  const statement = supported ? '“사업비는 10억 원이다”라고 강조했다.' : quote;
  const original = manuscript('의회는 10억 원을 배정했다.', '야당 대변인의 서면 논평', statement);
  const revised = manuscript('시의회는 이 사업에 10억 원을 배정했다.', '여당 대변인의 서면 논평', statement);
  const items = [];
  for (const editor of [1, 2]) {
    const {key, packets} = await blind.prepare(original, revised);
    items.push({name:'대응표-' + editor + '.json',data:key});
    for (const [slot, copy] of Object.entries(packets)) {
      const rows = engine.prepare(copy.article, copy.sources).rows;
      copy.receipts = [
        engine.decide(rows[0], {status:'fact',sourceIds:[copy.sources[0].id],acknowledged:true,
          reason:'편집자 ' + editor + '의 예산 원표 대조'}, copy.sources),
        engine.decide(rows[3], {status:'attribution',sourceIds:[copy.sources[1].id],acknowledged:true,
          reason:'편집자 ' + editor + '의 논평 확인',contentChecked:true,
          ...(supported ? {contentStatus:'supported',contentReason:'사업비 10억 원을 원표에서 확인했다.',contentSourceIds:[copy.sources[0].id]} :
            {contentStatus:'opinion',contentReason:'정치적 평가를 담은 논평이다.'})}, copy.sources)
      ];
      copy.articleAssessment = rubric.save(engine.report(copy.article, copy.sources, copy.receipts),
        copy.sources, {coreRowIds:supported ? [rows[1].id] : [rows[3].id],ratings:{}});
      items.push({name:'편집자-' + editor + '-' + slot + '.json',data:copy});
    }
  }
  const reviews = await blind.resolveBundle(items);
  const joint = agreement.compare(...reviews);
  const legacy = series.makeLegacyMatchRecord(joint, reviews[0].key, legacyVersion);
  const current = series.makeRecord(joint, reviews[0].key);
  assert.equal(legacy.version, legacyVersion);
  assert.deepEqual(legacy.factMatches, supported ? [[0,null],[3,3]] : [[0,null]]);
  assert.deepEqual(current.factMatches, supported ? [[0,null],[3,null]] : [[0,null]]);
  assert.equal(new Map(legacy.factContext.matches).get(3), 3);
  assert.equal(new Map(current.factContext.matches).has(3), false);
  const {format, evidenceDigest} = await cases.create(current, items, []);
  const note = {before:0, after:0, status:'retained', reason:privateReason};
  const reviewId = series.reviewId(legacy);
  const version = legacyVersion - 2;
  const payload = [format, version, reviewId, evidenceDigest, [[0,0,'retained',privateReason]]];
  const archive = {format, version, reviewId, evidenceDigest, items, notes:[note]};
  if (version === 4) {
    const reason = '이전 메모에서 논평 작성 정당의 변경을 확인했다.';
    archive.contextNotes = [{before:1, after:1, status:'changed', reason}];
    payload.push([[1,1,'changed',reason]]);
  }
  archive.checksum = engine.digestValue(payload);
  assert.deepEqual(cases.verifyLegacyMatchNotes(archive, legacy), [note]);
  return {items, current, legacy, archive};
}

function page(t, name, hash = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(dir,name),'utf8'),
    {url:'file:///reader/' + name + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const {window} = dom;
  const {document} = window;
  window.TextEncoder = TextEncoder;
  Object.defineProperty(window, 'crypto', {value:webcrypto});
  for (const script of document.querySelectorAll('script[src]')) {
    window.eval(fs.readFileSync(path.join(dir, script.getAttribute('src')), 'utf8'));
  }
  function select(id, items) {
    const field = document.getElementById(id);
    const files = items.map(({name,data}) => ({name,text:async () => JSON.stringify(data)}));
    Object.defineProperty(field, 'files', {configurable:true,value:files});
    field.dispatchEvent(new window.Event('change'));
  }
  async function downloadSummary() {
    const button = [...document.querySelectorAll('#output button')].find(b => b.textContent === '현재 기준의 기사별 평가 요약 저장');
    assert.ok(button);
    assert.equal(button.disabled, false);
    let blob;
    window.Blob = Blob;
    window.URL.createObjectURL = file => { blob = file; return 'blob:summary'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = function () {};
    button.click();
    assert.ok(blob);
    return JSON.parse(await blob.text());
  }
  return {document,select,downloadSummary};
}

async function seriesLink(t, legacy) {
  const p = page(t, 'revision-series.html');
  p.select('series-files', [{name:'이전 요약.json',data:legacy}]);
  const link = () => p.document.querySelector('#legacy-quote-check a');
  await t.waitFor(() => assert.ok(link()));
  assert.equal(link().getAttribute('href'), 'article-compare.html#review=' + series.reviewId(legacy) + '&focus=quote-check');
  return link().hash;
}

test('v6에서 유지로 집계한 비핵심 직접 인용의 발언자가 달라지면 두 판본의 공동 지지와 구별해 재검토한다', async t => {
  const {items, current, legacy, archive} = await reviewedEditions(6);
  // Independently produced from these six inputs by the released v6 writer.
  assert.equal(series.reviewId(legacy),'93db89441b1fb077f47a914bdd3190fea869b873dda9cdb149dce5e165762532');
  for (const record of [legacy,current]) {
    assert.equal(record.facts.before[3].outcome,'supported');
    assert.equal(record.facts.after[3].outcome,'supported');
  }
  assert.equal(series.summarize([legacy]).articles[0].factTrace.retained,1);
  assert.equal(series.summarize([current]).articles[0].factTrace.retained,0);
  assert.throws(() => cases.verifyAll(archive,current), error => error.code === 'legacy-review-changed');
  const target = await seriesLink(t,legacy);
  for (const input of [items,[{name:'이전 진행자 기록.json',data:archive}]]) {
    const p = page(t,'article-compare.html',target);
    p.select('blind-bundle-files',input);
    const counter = () => p.document.querySelector('[data-quote-check-count]');
    await t.waitFor(() => assert.ok(counter()));
    assert.match(counter().textContent,/그 밖의 공동 지지 구절 1개/);
    const row = p.document.querySelector('[data-retention-before="3"]');
    assert.ok(row.open && row.parentElement.open);
    assert.equal(row.querySelector('[data-retention-state]').value,'');
    assert.deepEqual(await p.downloadSummary(),current);
    if (input.length === 1) {
      const history = [...p.document.querySelectorAll('#output details')].find(d => d.firstElementChild.textContent.includes('이전 기준으로 기록한 핵심 맥락'));
      assert.ok(history?.textContent.includes(archive.contextNotes[0].reason));
      assert.ok(!p.document.querySelector('#joint-facts').contains(history));
    }
  }
});

test('집계의 v5 링크에서 여섯 원자료와 구형 진행자 파일 모두 바뀐 화자의 핵심 인용 하나만 열고 익명 v8 요약을 저장한다', async t => {
  const {items, current, legacy, archive} = await reviewedEditions();
  const target = await seriesLink(t, legacy);
  const archiveFile = {name:'이전 진행자 기록.json',data:archive};
  for (const input of [items,[archiveFile]]) {
    const p = page(t, 'article-compare.html', target);
    p.select('blind-bundle-files', input);
    const doc = p.document;
    await t.waitFor(() => assert.ok(doc.querySelector('[data-quote-check-count]')));
    assert.match(doc.querySelector('[data-quote-check-count]').textContent, /핵심 구절 1개$/);
    const row = doc.querySelector('[data-core-context-before="3"]');
    assert.ok(row.open && row.parentElement.open);
    assert.equal(doc.activeElement, row.querySelector('summary'));
    assert.ok(row.textContent.includes(quote));
    const reason = doc.querySelector('[data-retention-before="0"] [data-retention-reason]');
    assert.equal(reason.value, '');
    assert.match(doc.querySelector('[data-retention-summary]').textContent, /진행자가 유지 확인 0개/);
    if (input.length === 1) {
      const history = [...doc.querySelectorAll('details')].find(d => d.firstElementChild?.textContent.includes('이전 기준으로 기록한 사후 판단'));
      assert.ok(history?.textContent.includes(privateReason));
    } else {
      assert.equal(doc.getElementById('output').textContent.includes(privateReason), false);
    }
    const downloaded = await p.downloadSummary();
    assert.deepEqual(downloaded, current);
    assert.equal(downloaded.version, 8);
    assert.equal(new Map(downloaded.factContext.matches).has(3), false);
    for (const text of [privateReason, quote, '비공개 논평 사본', '편집자 1의 논평 확인']) {
      assert.equal(JSON.stringify(downloaded).includes(text), false);
    }
  }
  const focused = page(t, 'article-compare.html', '#review=' + series.reviewId(current) + '&focus=core-context');
  focused.select('blind-bundle-files', [archiveFile]);
  const group = () => focused.document.querySelector('.core-context[open]');
  await t.waitFor(() => assert.ok(group()));
  assert.equal(focused.document.querySelector('.fact-retention'), null);
  assert.equal(focused.document.activeElement, group().querySelector('[data-core-context-before="3"][open] > summary'));
  assert.match(focused.document.getElementById('output').textContent, new RegExp(privateReason));
  const wrong = page(t, 'article-compare.html', '#review=' + '0'.repeat(64) + '&focus=quote-check');
  wrong.select('blind-bundle-files', [archiveFile]);
  await t.waitFor(() => assert.match(wrong.document.getElementById('blind-bundle-status').textContent, /일치하지 않습니다/));
  assert.equal(wrong.document.getElementById('result').hidden, true);
  assert.equal(wrong.document.getElementById('output').textContent, '');
});

test('예전 연결이 여전히 유효한 연습 기사도 같은 링크에서 재검토 0개와 새 요약 저장을 표시한다', async t => {
  const legacy = require('../experiments/core-quote-revision/series-summary.json');
  const archive = require('../experiments/core-quote-revision/coordinator-case.json');
  const p = page(t, 'article-compare.html', await seriesLink(t, legacy));
  p.select('blind-bundle-files', [{name:'연습 기사 진행자 기록.json',data:archive}]);
  const count = () => p.document.querySelector('[data-quote-check-count]');
  await t.waitFor(() => assert.ok(count()));
  assert.match(count().textContent, /핵심 구절 0개$/);
  assert.equal(p.document.activeElement, count());
  const downloaded = await p.downloadSummary();
  assert.equal(downloaded.version, 8);
  assert.deepEqual(downloaded.factContext.matches, legacy.factContext.matches);
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const dir = path.join(__dirname, '../docs/reader');

function workspace(article) {
  return {format:'journal-local-factcheck-v1', article, articleDraft:article, sources:[], receipts:[], rowDrafts:[],
    demo:false, sourceDraft:{fields:{title:'', url:'', locator:'', excerpt:'', version:''}}};
}
function page(t, hash = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(dir,'article-compare.html'),'utf8'), {url:'file:///reader/article-compare.html' + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w, 'crypto', {value:require('node:crypto').webcrypto});
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(fs.readFileSync(path.join(dir,script.getAttribute('src')), 'utf8'));
  const el = id => w.document.getElementById(id);
  function selectFiles(id, files) {
    const field = el(id);
    Object.defineProperty(field,'files',{configurable:true, value:files});
    field.dispatchEvent(new w.Event('change'));
  }
  const select = (id, name, content) => selectFiles(id, [{name, text:()=>Promise.resolve(content)}]);
  const load = (side, name, content) => select('file-' + side, name, content);
  function reviewers() {
    const radio = w.document.querySelector('[value=reviewers]');
    radio.click();
  }
  const settled = () => new Promise(resolve => setImmediate(resolve));
  return {w, el, load, select, selectFiles, reviewers, settled};
}

function captureDownload(t, view) {
  let downloaded;
  view.w.Blob = Blob;
  view.w.URL.createObjectURL = value => { downloaded = value; return 'blob:local-file'; };
  view.w.URL.revokeObjectURL = () => {};
  view.w.HTMLAnchorElement.prototype.click = function () {};
  return async button => {
    downloaded = null;
    button.click();
    await t.waitFor(() => assert.ok(downloaded));
    return JSON.parse(await downloaded.text());
  };
}

test('집계에서 선택한 익명 요약이 일치해야 수정본의 충돌 구절과 두 사람의 근거를 연다', async t => {
  const example = require('../docs/reader/revision-evidence-example.js');
  const blind = require('../docs/reader/blind-revision.js');
  const compare = require('../docs/reader/revision-agreement.js').compare;
  const {makeRecord, reviewId} = require('../docs/reader/revision-series.js');
  const items = await example.files();
  const pair = await blind.resolveBundle(items);
  const record = makeRecord(compare(...pair), pair[0].key);
  const id = reviewId(record);
  const p = page(t, '#review=' + id);
  assert.equal(p.el('inputs').hidden, true);
  assert.equal(p.el('review-target').hidden, false);
  assert.equal(p.el('result').hidden, true);
  assert.equal(p.w.document.activeElement, p.el('blind-bundle-files'));
  const upload = files => p.selectFiles('blind-bundle-files', files);
  const files = items.map(item => ({name:item.name, text:async () => item.raw}));
  upload(files);
  await t.waitFor(() => assert.equal(p.el('result').hidden, false));
  const group = p.el('joint-facts').querySelector('.fact-alerts[data-edition="after"]');
  assert.equal(group.open, true);
  assert.equal(group.querySelector('details').open, true);
  assert.equal(p.w.document.activeElement, group.querySelector('details').firstElementChild);
  assert.match(group.textContent, /80곳/);
  assert.match(group.textContent, /20개/);
  assert.equal(group.querySelectorAll('.pair > div').length, 2);
  assert.equal(p.el('agreement-export'), null);
  p.el('blind-bundle-clear').click();
  assert.equal(p.el('result').hidden, true);
  assert.doesNotMatch(p.el('review-target-status').textContent, /일치합니다/);
  const changed = structuredClone(record);
  changed.dimensions[0].first.before = changed.dimensions[0].first.before === 2 ? 3 : 2;
  const nextTarget = new Promise(resolve => p.w.addEventListener('hashchange', resolve, {once:true}));
  p.w.location.hash = '#review=' + reviewId(changed);
  await nextTarget;
  upload(files);
  await t.waitFor(() => assert.match(p.el('blind-bundle-status').textContent, /일치하지 않습니다/));
  assert.equal(p.el('result').hidden, true);
  assert.equal(p.el('output').textContent, '');
  p.w.location.hash = '#review=' + reviewId(record, 2) + '&example=library';
  await t.waitFor(() => assert.equal(p.el('result').hidden, false));
  assert.match(p.el('result-title').textContent, /가상 예시/);
  assert.equal(p.el('blind-bundle-picker').hidden, true);
  p.w.location.hash = '#review=잘못된주소';
  await t.waitFor(() => assert.match(p.el('review-target-status').textContent, /식별할 수 없는/));
  assert.equal(p.el('result').hidden, true);
  assert.equal(p.el('output').textContent, '');
  p.el('review-release').click();
  await t.waitFor(() => assert.equal(p.el('inputs').hidden, false));
  assert.equal(p.el('review-target').hidden, true);
  assert.equal(p.el('blind-revision').contains(p.el('blind-bundle-picker')), true);
  assert.equal(p.el('result').hidden, true);
});

test('집계에서 지정한 편향 기준은 같은 판본과 익명 판정이 확인된 뒤 네 근거와 키보드 초점을 연다', async t => {
  const example = require('../docs/reader/revision-evidence-example.js');
  const blind = require('../docs/reader/blind-revision.js');
  const agreement = require('../docs/reader/revision-agreement.js');
  const series = require('../docs/reader/revision-series.js');
  const items = await example.files();
  const reviews = await blind.resolveBundle(items);
  const record = series.makeRecord(agreement.compare(...reviews), reviews[0].key);
  const link = (id, axis, sample = false) => '#review=' + id + '&focus=bias-' + axis + (sample ? '&example=library' : '');
  const p = page(t, link(series.reviewId(record), 'omission'));
  const upload = () => p.selectFiles('blind-bundle-files', items.map(f => ({name:f.name, text:async () => f.raw})));
  assert.equal(p.el('result').hidden, true);
  upload();
  async function checkAxis(axis) {
    await t.waitFor(() => assert.ok(p.el('output').querySelector('details[data-bias-axis="' + axis + '"][open]')));
    const [card] = p.el('output').querySelectorAll('details');
    assert.equal(p.el('output').querySelectorAll('details').length, 1);
    assert.equal(p.w.document.activeElement, card.firstElementChild);
    assert.equal(card.querySelectorAll('.pair > div').length, 2);
    assert.match(card.textContent, /첫 편집자.*수정 전.*수정 후.*둘째 편집자.*수정 전.*수정 후/);
    return card;
  }
  const card = await checkAxis('omission');
  assert.match(card.textContent, /판단 이유.*원자료/s);
  assert.ok(card.querySelectorAll('blockquote').length >= 8);
  p.w.location.hash = link(series.reviewId(record, 2), 'framing', true);
  await checkAxis('framing');
  p.w.location.hash = link(series.reviewId(record), 'standards', true);
  assert.match((await checkAxis('standards')).textContent, /저장된 단계가 없습니다/);
  const changed = structuredClone(record);
  changed.dimensions[0].first.before = changed.dimensions[0].first.before === 3 ? 2 : 3;
  p.w.location.hash = link(series.reviewId(changed),'wording',true);
  await t.waitFor(() => assert.match(p.el('review-target-status').textContent, /일치하지 않습니다/));
  assert.equal(p.el('output').textContent, '');
  p.w.location.hash = link(series.reviewId(record),'unregistered',true);
  await t.waitFor(() => assert.match(p.el('review-target-status').textContent,/식별할 수 없는/));
  assert.equal(p.el('result').hidden, true);
});

async function viewpointFixture() {
  const blind = require('../docs/reader/blind-revision.js');
  const agreement = require('../docs/reader/revision-agreement.js');
  const series = require('../docs/reader/revision-series.js');
  const quote = '의원은 “참담하다”고 말했다.';
  const revised = '위원장은 “최대의 치적이다”라고 말했다.';
  const body = '사업비는 10억 원이다.';
  const manuscript = speech => ({...workspace(body + '\n' + speech), sources:
    ['회의 속기록', '공개 영상 대본'].map((title, i) => ({id:'source' + i, title, version:'초판',
      url:'https://example.invalid/minutes/' + i, locator:'첫 발언', excerpt:[body, quote, revised].join(' ')}))});
  const items = [];
  for (const editor of [0, 1]) {
    const {key, packets} = await blind.prepare(manuscript(quote), manuscript(revised));
    for (const role of ['before', 'after']) {
      const work = packets[key.mapping[role].slot];
      work.receipts = engine.prepare(work.article, work.sources).rows.map((row, i) =>
        engine.decide(row, {status:i ? 'attribution' : 'fact', sourceIds:[work.sources[editor].id], acknowledged:true,
          reason:'편집자 ' + (editor + 1) + '의 원자료 대조', ...(i ? {contentStatus:'opinion', contentChecked:true,
            contentReason:'발언자의 평가다.'} : {})}, work.sources));
      const report = engine.report(work.article, work.sources, work.receipts);
      work.articleAssessment = rubric.save(report, work.sources, {coreRowIds:report.rows.map(row => row.id), ratings:{}});
    }
    for (const [name, data] of Object.entries({key, ...packets})) items.push({name:name + editor + '.json', data});
  }
  const pair = await blind.resolveBundle(items);
  const record = series.makeRecord(agreement.compare(...pair), pair[0].key);
  return {items, record, body, quote, revised};
}

test('같은 핵심 발언에 대응할 수정본 구절이 없으면 원본 위치와 두 판정의 실제 발언 근거, 수정본 전문을 연다', async t => {
  const blind = require('../docs/reader/blind-revision.js');
  const agreement = require('../docs/reader/revision-agreement.js');
  const series = require('../docs/reader/revision-series.js');
  const {items, record, body, quote, revised} = await viewpointFixture();
  assert.deepEqual(record.facts.before.map(r => r.outcome), ['supported', 'limited']);
  const link = id => '#review=' + id + '&focus=core-context';
  const p = page(t, link(series.reviewId(record)));
  const upload = () => p.selectFiles('blind-bundle-files', items.map(item => ({name:item.name, text:async () => JSON.stringify(item.data)})));
  async function assertContext() {
    upload();
    await t.waitFor(() => assert.ok(p.el('output').querySelector('.core-context[open]')));
    const group = p.el('output').querySelector('.core-context');
    const [item, full] = group.querySelectorAll(':scope > details');
    assert.equal(group.querySelectorAll(':scope > details').length, 2);
    assert.equal(item.open, true);
    assert.equal(p.w.document.activeElement, item.firstElementChild);
    assert.equal(item.querySelector('mark').textContent, quote);
    assert.match(item.firstElementChild.textContent, /원본 2번/);
    const sides = [...item.querySelectorAll('.pair > div')];
    assert.equal(sides.length, 2);
    assert.ok(sides.every(side => side.textContent.includes('발언 사실 확인 · 내용은 의견이나 전망')));
    assert.match(sides[0].textContent, /^첫 편집자/);
    assert.match(sides[1].textContent, /^둘째 편집자/);
    assert.ok(sides.some(side => /편집자 1의 원자료 대조.*원발언 · 회의 속기록/.test(side.textContent)));
    assert.ok(sides.some(side => /편집자 2의 원자료 대조.*원발언 · 공개 영상 대본/.test(side.textContent)));
    assert.equal(full.querySelector('blockquote').textContent, body + '\n' + revised);
    assert.doesNotMatch(group.textContent, /삭제됨|삭제됐|유지 확인/);
  }
  assert.equal(p.el('result').hidden, true);
  await assertContext();
  async function navigate(id) {
    const moved = new Promise(resolve => p.w.addEventListener('hashchange', resolve, {once:true}));
    p.w.location.hash = link(id);
    await moved;
    assert.equal(p.el('output').textContent, '');
  }
  await navigate(series.reviewId(record, 4));
  await assertContext();
  const changed = structuredClone(record);
  changed.factContext.beforeCore[1] = 1;
  for (const id of [series.reviewId(record, 3), series.reviewId(changed)]) {
    await navigate(id);
    upload();
    await t.waitFor(() => assert.match(p.el('blind-bundle-status').textContent, /요약과 일치하지 않습니다/));
    assert.equal(p.el('result').hidden, true);
  }
  const example = await blind.resolveBundle(await require('../docs/reader/revision-evidence-example.js').files());
  const noTarget = series.makeRecord(agreement.compare(...example), example[0].key);
  p.w.location.hash = link(series.reviewId(noTarget)) + '&example=library';
  await t.waitFor(() => assert.match(p.el('review-target-status').textContent, /다시 대조할 원본 핵심 구절이 없습니다/));
  assert.equal(p.el('result').hidden, true);
  assert.equal(p.el('output').textContent, '');
});

test('핵심 발언만 열어 판단을 저장해도 다른 화면의 사실 대조와 공개 점수는 보존된다', async t => {
  const retention = require('../docs/reader/retention-case.js');
  const series = require('../docs/reader/revision-series.js');
  const {items, record} = await viewpointFixture();
  const notes = [{before:0, after:0, status:'retained', reason:'두 판본이 같은 사업비 10억 원을 제시한다.'}];
  const archive = await retention.create(record, items, notes);
  const open = (view, value) => view.select('blind-bundle-files', '대조기록.json', JSON.stringify(value));
  const focused = page(t, '#review=' + series.reviewId(record) + '&focus=core-context&example=quote');
  assert.equal(focused.el('blind-bundle-picker').hidden, false);
  open(focused, archive);
  const output = focused.el('output');
  await t.waitFor(() => assert.ok(output.querySelector('[data-core-context-state]')));
  assert.equal(output.querySelector('.fact-retention'), null);
  const reason = '비판한 의원 대신 다른 위원장의 지지 발언을 실었다.';
  for (const [name, value, event] of [['state','changed','change'], ['target','2','input'], ['reason',reason,'input']]) {
    const field = output.querySelector('[data-core-context-' + name + ']');
    field.value = value;
    field.dispatchEvent(new focused.w.Event(event, {bubbles:true}));
  }
  const saved = await captureDownload(t, focused)(output.querySelector('[data-retention-save]'));
  assert.deepEqual(retention.verifyAll(saved, record), {notes, contextNotes:[{before:1, after:1, status:'changed', reason}]});
  const fresh = page(t, '#blind-revision');
  open(fresh, saved);
  await t.waitFor(() => assert.ok(fresh.el('agreement-export')));
  assert.equal(fresh.el('output').querySelector('[data-retention-reason]').value, notes[0].reason);
  assert.match(fresh.el('output').querySelector('[data-core-context-summary]').textContent, /대조 완료 1.1개.*남은 구절 0개/);
  assert.deepEqual(await captureDownload(t, fresh)(fresh.el('agreement-export')), record);
});

test('중요한 왜곡의 전후 개수를 같은 네 점수로 비교하고 경계 안에서 반대로 움직인 항목을 센다', async t => {
  const items = await require('../docs/reader/revision-evidence-example.js').files();
  const keys = items.map(item => item.data).filter(data => data.mapping);
  const profiles = [
    {before:[3,3,1], after:[2,0,0]},
    {before:[2,3,0], after:[3,0,1]}
  ];
  for (const {data} of items) {
    if (!data.blindReview) continue;
    const editor = keys.findIndex(key => key.pairId === data.blindReview.pairId);
    const role = keys[editor].mapping.before.slot === data.blindReview.slot ? 'before' : 'after';
    for (const [i, id] of ['wording','framing','omission'].entries()) {
      const rating = data.articleAssessment.ratings[id];
      rating.level = profiles[editor][role][i];
      rating.impact = '원자료가 나타내는 대상과 범위를 비교했다.';
    }
  }
  const p = page(t);
  const upload = () => p.selectFiles('blind-bundle-files',items.map(item=>({name:item.name,text:async()=>JSON.stringify(item.data)})));
  upload();
  await t.waitFor(() => assert.ok(p.el('joint-severity')));
  assert.match(p.el('joint-severity').textContent, /원본 2\/3개 → 수정본 1\/3개/);
  assert.match(p.el('joint-severity').textContent, /다른 편집자는 높인 항목 2개.*경계를 넘지 않은 항목 2개/);
  assert.equal(p.el('revision-agreement').querySelectorAll('details[data-bias-axis]').length, 4);
  p.el('blind-bundle-clear').click();
  for (const {data} of items) if (data.articleAssessment) delete data.articleAssessment;
  upload();
  await t.waitFor(() => assert.ok(p.el('joint-severity')));
  assert.match(p.el('joint-severity').textContent, /비교 대기/);
  assert.doesNotMatch(p.el('joint-severity').textContent, /0개|0%/);
});

test('두 사람의 공동 개선 범위와 같은 항목의 상대 변화를 실제 배정 파일로 표시한다', async t => {
  const fixtures = await require('../docs/reader/revision-evidence-example.js').files();
  async function open(profiles) {
    const items = structuredClone(fixtures);
    const keys = items.map(item => item.data).filter(data => data.mapping);
    for (const {data} of items) {
      if (!data.blindReview) continue;
      const editor = keys.findIndex(key => key.pairId === data.blindReview.pairId);
      const role = keys[editor].mapping.before.slot === data.blindReview.slot ? 'before' : 'after';
      const ratings = data.articleAssessment.ratings;
      for (const [i, id] of ['wording','framing','omission'].entries()) {
        const score = profiles[editor][role][i];
        if (score === null) delete ratings[id];
        else Object.assign(ratings[id], {level:score, impact:'원자료가 나타내는 대상과 범위를 비교했다.'});
      }
    }
    const p = page(t);
    p.selectFiles('blind-bundle-files', items.map(({name, data}) => ({name, text:async () => JSON.stringify(data)})));
    await t.waitFor(() => assert.ok(p.el('joint-improvement-range')));
    return p;
  }

  const partial = await open([{before:[3,3,3], after:[0,2,null]}, {before:[3,3,3], after:[1,null,0]}]);
  assert.match(partial.el('revision-agreement').textContent, /두 사람 모두 개선으로 판정100%1 \/ 1개/);
  const range = partial.el('joint-improvement-range').textContent;
  assert.match(range, /원본 3개 중 두 사람 모두 개선 확인 1개 \(33.3%\)/);
  assert.match(range, /가능한 개선율 33.3% ~ 66.7%.*추가로 개선을 확인할 수 있는 항목 1개/);
  assert.match(range, /수정본에 한 사람이라도 2~3단계를 매긴 항목 1개/);
  assert.match(partial.el('joint-net-change').textContent, /원본 1\/1개 → 수정본 0\/1개 · 100%p 감소 · 원본 대비 100% 감소/);

  const worsening = await open(Array(2).fill({before:[3,0,1], after:[3,2,3]}));
  assert.match(worsening.el('joint-net-change').textContent, /원본 1\/3개 → 수정본 3\/3개 · 66.7%p 증가 · 원본 대비 200% 증가/);

  const absent = await open(Array(2).fill({before:[0,0,0], after:[3,0,0]}));
  assert.match(absent.el('joint-net-change').textContent, /33.3%p 증가 · 두 편집자가 두 판본을 모두 채점한 항목 중 원본에 함께 2~3단계를 매긴 항목이 없어 상대 변화율 산출 불가/);
  assert.match(absent.el('joint-improvement-range').textContent, /개선율을 계산할 수 없습니다/);

  const na = await open(Array(2).fill({before:[0,3,0], after:[0,'na',0]}));
  assert.match(na.el('joint-improvement-range').textContent, /원본 1개 모두 수정본에 ‘해당 없음’ 판정이 있어 개선 여부를 판단할 수 없습니다/);
  assert.doesNotMatch(na.el('joint-improvement-range').textContent, /0%/);
  assert.match(na.el('joint-net-change').textContent, /원본 0\/2개 → 수정본 0\/2개.*두 편집자가 두 판본을 모두 채점한 항목 중 원본에 함께 2~3단계를 매긴 항목이 없어 상대 변화율 산출 불가/);
});

test('원본 사실 대조 링크는 같은 문구라도 문맥이 바뀐 위치와 양쪽 근거를 열고 구형·불일치 요약을 거절한다', async t => {
  const example = require('../docs/reader/revision-evidence-example.js');
  const blind = require('../docs/reader/blind-revision.js');
  const agreement = require('../docs/reader/revision-agreement.js');
  const series = require('../docs/reader/revision-series.js');
  const bundles = await blind.resolveBundle(await example.files());
  const record = series.makeRecord(agreement.compare(...bundles), bundles[0].key);
  const target = id => '#review=' + id + '&focus=retention&example=library';
  const p = page(t, target(series.reviewId(record)));
  await t.waitFor(() => assert.equal(p.el('result').hidden, false));
  const group = p.el('joint-facts').querySelector('.fact-retention');
  const row = group.querySelector('details');
  assert.equal(group.open && row.open, true);
  assert.equal(p.w.document.activeElement, row.firstElementChild);
  assert.match(row.textContent, /원본 2번.*20곳.*수정본 2번.*앞뒤 문맥/s);
  assert.equal(row.querySelectorAll('.pair > div').length, 4);
  for (const side of row.querySelectorAll('.pair > div')) {
    assert.match(side.textContent, /원자료 · 가상 도서관 주말 운영 조사표.*표 1/);
    assert.match(side.querySelector('blockquote').textContent, /100개.*20개/);
  }
  assert.match(p.el('joint-facts').textContent, /수정본 전문 보기.*조사 도서관 100곳 중 20곳/);
  p.w.location.hash = target(series.reviewId(record, 3));
  await t.waitFor(() => assert.ok(p.el('joint-facts')?.querySelector('.fact-retention[open]')));
  const altered = structuredClone(record);
  altered.factContext.beforeCore[0] = (altered.factContext.beforeCore[0] + 1) % 3;
  for (const invalid of [series.reviewId(record, 2), series.reviewId(altered)]) {
    const changed = new Promise(resolve => p.w.addEventListener('hashchange', resolve, {once:true}));
    p.w.location.hash = target(invalid);
    await changed;
    await t.waitFor(() => assert.match(p.el('review-target-status').textContent, /일치하지 않습니다/));
    assert.equal(p.el('result').hidden, true);
    assert.equal(p.el('output').textContent, '');
  }
});

test('사후 대조한 개인 파일 하나로 이어 열고 두 편집자의 익명 요약을 그대로 내보낸다', async t => {
  const example = require('../docs/reader/revision-evidence-example.js');
  const series = require('../docs/reader/revision-series.js');
  const p = page(t, '#blind-revision');
  const items = await example.files();
  p.selectFiles('blind-bundle-files', items.map(item => ({name:item.name, text:async () => item.raw})));
  await t.waitFor(() => assert.ok(p.el('agreement-export')));
  const download = captureDownload(t, p);
  const original = await download(p.el('agreement-export'));
  const row = p.el('joint-facts').querySelector('[data-retention-before="1"]');
  const reason = '두 판본 모두 조사한 도서관 100곳 중 20곳으로 같은 대상과 수치를 명시했다.';
  const edit = (el, value, event) => {
    el.value = value;
    el.dispatchEvent(new p.w.Event(event, {bubbles:true}));
  };
  edit(row.querySelector('[data-retention-state]'), 'retained', 'change');
  edit(row.querySelector('[data-retention-target]'), '2', 'input');
  edit(row.querySelector('[data-retention-reason]'), reason, 'input');
  const saved = await download(p.el('joint-facts').querySelector('[data-retention-save]'));
  assert.equal(saved.items.length, 6);
  assert.deepEqual(saved.notes, [{before:1, after:1, status:'retained', reason}]);
  const file = value => ({name:'진행자용 대조 기록.json', text:async () => JSON.stringify(value)});
  const fresh = page(t, '#blind-revision');
  fresh.selectFiles('blind-bundle-files', [file(saved)]);
  await t.waitFor(() => assert.ok(fresh.el('agreement-export')));
  const summary = fresh.el('joint-facts').querySelector('[data-retention-summary]');
  assert.match(summary.textContent, /자동 대응으로 확인 0개.*진행자가 유지 확인 1개.*검토 남음 0개/);
  assert.equal(fresh.w.document.activeElement, summary);
  assert.equal(fresh.el('joint-facts').querySelector('[data-retention-reason]').value, reason);
  assert.deepEqual(await captureDownload(t, fresh)(fresh.el('agreement-export')), original);
  assert.equal(JSON.stringify(original).includes(reason), false);

  const linked = page(t, '#review=' + series.reviewId(original) + '&focus=retention');
  const bad = structuredClone(saved);
  bad.notes[0].reason = '파일에 기록된 판단을 바꿈';
  linked.selectFiles('blind-bundle-files', [file(bad)]);
  await t.waitFor(() => assert.ok(linked.el('blind-bundle-status').classList.contains('error')));
  assert.equal(linked.el('result').hidden, true);
  linked.el('blind-bundle-clear').click();
  linked.selectFiles('blind-bundle-files', [file(saved)]);
  await t.waitFor(() => assert.ok(linked.el('joint-facts')));
  assert.equal(linked.el('joint-facts').querySelector('[data-retention-reason]').value, reason);
  assert.equal(linked.el('agreement-export'), null);
  const practice = page(t, '#review=' + series.reviewId(original) + '&focus=retention&example=library');
  await t.waitFor(() => assert.ok(practice.el('joint-facts')));
  practice.el('review-example-resume').click();
  assert.equal(practice.w.document.activeElement, practice.el('blind-bundle-files'));
  practice.selectFiles('blind-bundle-files', [file(saved)]);
  await t.waitFor(() => assert.match(practice.el('review-target-status').textContent, /대조 기록을 복원/));
  assert.equal(practice.el('joint-facts').querySelector('[data-retention-reason]').value, reason);
});

test('다른 폴더의 같은 이름 파일도 모아서 비교하고 잘못 고른 한 개만 교체한다', async t => {
  const p = page(t, '#blind-revision');
  const before = require('../experiments/article-review-pilot/a-original.json');
  const after = require('../experiments/article-review-pilot/b-revised.json');
  async function assigned(editor) {
    const {key, packets} = await p.w.JournalBlindRevision.prepare(before, after);
    for (const role of ['before', 'after']) {
      const work = packets[key.mapping[role].slot];
      const row = engine.prepare(work.article, work.sources).rows[0];
      work.receipts.push(engine.decide(row, {status:role === 'before' ? 'contradicted' : 'fact',
        acknowledged:true, sourceIds:[work.sources[0].id], reason:editor + '의 원자료 판정'}, work.sources));
    }
    return [key, packets.B, packets.A].map(data => ({name:'같은 이름.json', text:async () => JSON.stringify(data)}));
  }
  const upload = files => p.selectFiles('blind-bundle-files', files);
  const first = await assigned('가'), second = await assigned('나');
  upload(first);
  assert.match(p.el('blind-bundle-status').textContent, /3\/6/);
  assert.equal(p.el('result').hidden, true);
  upload([second[0], second[1], {name:'깨짐.json', text:async () => '{'}]);
  await t.waitFor(() => assert.match(p.el('blind-bundle-status').textContent, /6번 파일 깨짐.json.*JSON/));
  assert.equal(p.el('agreement-export'), null);
  p.el('blind-bundle-list').querySelectorAll('button')[5].click();
  assert.match(p.el('blind-bundle-status').textContent, /5\/6/);
  upload([second[2]]);
  await t.waitFor(() => assert.ok(p.el('agreement-export')));
  assert.match(p.el('joint-facts').querySelector('[data-fact-row="support"]').textContent, /0% \(0\/1\)100% \(1\/1\)/);
  assert.equal(p.el('joint-facts').querySelectorAll('.fact-alerts[data-edition="before"] .pair > div').length, 2);
  assert.equal(p.el('agreement-held').hidden, true);
  p.el('blind-bundle-clear').click();
  assert.equal(p.el('result').hidden, true);
  assert.equal(p.el('blind-bundle-list').children.length, 0);
  const blank = JSON.parse(await second[2].text());
  blank.receipts = [];
  upload([...first, second[0], second[1], {name:'같은 이름.json', text:async () => JSON.stringify(blank)}]);
  await t.waitFor(() => assert.ok(p.el('missing-returns')));
  assert.match(p.el('missing-returns').textContent, /집계 전에 확인할 파일 1개.*선택 6번 · 같은 이름.json.*저장된 판정이 없습니다/);
  assert.equal(p.el('agreement-export'), null);
  assert.ok(p.el('joint-facts'));
  p.el('blind-bundle-list').querySelectorAll('button')[5].click();
  upload([second[2]]);
  await t.waitFor(() => assert.ok(p.el('agreement-export')));
  p.el('blind-bundle-clear').click();
  let finish;
  upload([...first, ...second.slice(0,2), {name:'늦게 연 파일.json', text:() => new Promise(resolve => { finish = resolve; })}]);
  p.reviewers();
  finish(await second[2].text());
  await p.settled();
  assert.equal(p.el('result').hidden, true);
  assert.equal(p.el('agreement-export'), null);
  assert.equal(p.el('blind-bundle-status').textContent, '');
});

test('반복된 발언은 충돌을 표시한 회의의 기사 원문 위치와 강조 구절을 보여 준다', async t => {
  const p = page(t);
  const q = '시장은 “예산은 20억 원이었다”고 말했다.';
  const source = {id:'doc', url:'https://archive.example/minutes', title:'회의록', version:'1', locator:'부산 회의', excerpt:q};
  const manuscript = article => ({...workspace(article), sources:[source]});
  const before = manuscript('편집 전 기사.');
  const after = manuscript(['서울시 3월 회의.', q, '부산시 4월 회의.', q].join('\n'));
  const files = [];
  for (const editor of ['가', '나']) {
    const {key,packets} = await p.w.JournalBlindRevision.prepare(before, after);
    for (const role of ['before', 'after']) {
      const work = packets[key.mapping[role].slot];
      work.receipts = engine.prepare(work.article, work.sources).rows.map((row, i) => engine.decide(row, {
        status:role === 'after' && i === 3 ? 'contradicted' : 'held',
        sourceIds:[work.sources[0].id], acknowledged:true, reason:editor + '의 모의 대조'
      }, work.sources));
    }
    files.push(...[key,packets.A,packets.B].map(data => ({name:'기사.json', text:async () => JSON.stringify(data)})));
  }
  p.selectFiles('blind-bundle-files', files);
  await t.waitFor(() => assert.ok(p.el('joint-facts')));
  const flagged = p.el('joint-facts').querySelector('.fact-alerts[data-edition="after"] details');
  assert.match(flagged.firstElementChild.textContent, /같은 문구 2곳 중 2번째/);
  const context = flagged.querySelector('blockquote');
  assert.match(context.textContent, /부산시 4월 회의/);
  assert.doesNotMatch(context.textContent, /서울시 3월 회의/);
  assert.equal(context.querySelector('mark').textContent, q);
});

test('판본 확인 이후에만 비교하고 파일을 바꾸거나 잘못 열면 이전 승인과 수치를 걷는다', async t => {
  const p=page(t);
  const original = JSON.stringify(workspace('시는 예산안을 발표했다.'));
  p.load('left','원본.json',original);
  p.load('right','수정안.json',JSON.stringify(workspace('시는 예산안을 의결했다.')));
  await p.settled();
  assert.equal(p.el('compare').disabled,true);
  assert.match(p.el('preview-right').textContent,/수정안.json.*의결했다/);
  p.el('ack').click(); p.el('compare').click();
  assert.equal(p.el('result').hidden,false);
  assert.match(p.el('output').textContent,/산출 대기.*0 \/ 0개/);
  assert.match(p.el('output').textContent,/의견|분모 제외/);
  p.load('right', '깨짐.json','잘못된 데이터');
  assert.equal(p.el('result').hidden,true);
  await p.settled();
  assert.match(p.el('preview-right').textContent,/깨짐.json.*JSON을 읽지 못했습니다/);
  assert.equal(p.el('compare').disabled,true);
  assert.equal(p.el('ack').checked,false);
  p.reviewers(); p.load('right','다른.json',JSON.stringify(workspace('다른 기사를 썼다.')));
  await p.settled(); p.el('compare').click();
  assert.equal(p.el('result').hidden,true);
  assert.match(p.el('status').textContent,/같은 판본/);
  p.load('right','복사본.json',original); await p.settled(); p.el('compare').click();
  assert.match(p.el('output').textContent,/두 작업 파일의 내용이 같습니다/);
});

test('늦게 도착한 이전 파일이 새 파일이나 해당 파일의 오류를 덮어쓰지 않는다', async t => {
  const p = page(t);
  let finish;
  const delayed = new Promise(resolve => {finish = resolve;});
  p.load('left','첫 번째.json', delayed);
  p.load('left','선택한 파일.json','{');
  finish(JSON.stringify(workspace('처음 기사다.')));
  await p.settled();
  assert.match(p.el('preview-left').textContent,/선택한 파일.json.*읽지 못했습니다/);
  assert.doesNotMatch(p.el('preview-left').textContent,/처음 기사/);
});

test('가상 예시를 닫거나 비교 방식을 바꾸면 예시 수치가 지워진다', t => {
  const p=page(t);
  p.el('example').click();
  assert.equal(p.el('result').hidden,false);
  assert.match(p.el('result-title').textContent,/가상 예시.*수정 전후/);
  assert.match(p.el('output').textContent,/중요한 왜곡 개선율/);
  assert.match(p.el('output').textContent,/원본 핵심 주장 1개의 수정 후 위치/);
  p.reviewers();
  assert.equal(p.el('result').hidden,true);
  assert.equal(p.el('output').textContent,'');
  p.el('example').click();
  assert.match(p.el('result-title').textContent,/가상 예시.*두 편집자/);
  assert.match(p.el('output').textContent,/사실 판정 일치도/);
  p.el('example').click();
  assert.equal(p.el('result').hidden,true);
});

function ratedRoutes(article, levels) {
  const source = {id:'doc', title:'시범 원표', url:'https://example.org/records', locator:'표 1', version:'1판', excerpt:'시범 노선 한 곳의 결과다.'};
  const file = workspace(article);
  file.sources = [source];
  const report = engine.report(article, [source], []), [lead, body] = report.rows;
  const rating = level => level === 'na' ? {level, reason:'도입을 분리해 평가하지 않았다.'}
    : {level, rowId:lead.id, quote:lead.text, compareRowId:body.id, compareQuote:body.text,
      sourceId:'doc', sourceQuote:source.excerpt, reason:'조사 범위를 비교했다.', impact:'전체 노선에서 확인한 결과처럼 읽힌다.'};
  const ratings = Object.fromEntries(Object.entries(levels).map(([axis, level]) => [axis, rating(level)]));
  return JSON.stringify({...file, articleAssessment:rubric.save(report, [source], {coreRowIds:[], ratings})});
}

test('본문이 같은 두 파일은 채점 단계가 달라도 기사 수정에 따른 편향 개선이나 악화로 표시하지 않는다', async t => {
  const p = page(t);
  const article = '모든 노선에서 대기 시간이 줄었다.\n시범 노선 하나에서 조사했다.';
  const revised = '시범 노선에서 대기 시간이 줄었다.\n시범 노선 하나에서 조사했다.';
  p.load('left', '원본.json', ratedRoutes(article, {wording:2, framing:0}));
  p.load('right', '재평가.json', ratedRoutes(article, {wording:0, framing:3}));
  await p.settled(); p.el('ack').click(); p.el('compare').click();
  const output = p.el('output');
  assert.match(output.textContent, /두 파일의 기사 본문이 같습니다/);
  assert.match(output.textContent, /2단계 → 0단계/);
  assert.match(output.textContent, /0단계 → 3단계/);
  assert.doesNotMatch(output.textContent, /중요한 왜곡 개선율|중요한 왜곡 악화율|개선 확인/);
  p.reviewers(); p.el('compare').click();
  assert.match(output.textContent, /같은 단계로 판정0%0 \/ 2개/);
  p.w.document.querySelector('[value=revision]').click();
  p.load('right', '수정본.json', ratedRoutes(revised, {wording:0, framing:3}));
  await p.settled(); p.el('ack').click(); p.el('compare').click();
  assert.match(output.textContent, /중요한 왜곡 개선율100%1 \/ 1개/);
  assert.match(output.textContent, /중요한 왜곡 악화율100%1 \/ 1개/);
});

test('악화율 0% 옆에 원본에서 미평가 또는 해당 없음이었던 수정본의 중요한 왜곡을 보여 준다', async t => {
  const p = page(t);
  p.load('left','원본.json', ratedRoutes('모든 노선에서 대기 시간이 줄었다.\n시범 노선 하나에서 조사했다.', {wording:0, framing:'na'}));
  p.load('right','수정본.json', ratedRoutes('모든 노선에서 대기 시간이 줄었다.\n조사는 시범 노선 한 곳에서 진행했다.', {wording:0, framing:3, omission:2}));
  await p.settled(); p.el('ack').click(); p.el('compare').click();
  const output = p.el('output').textContent;
  assert.match(output, /중요한 왜곡 악화율0%.*0 \/ 1개/);
  assert.match(output, /수정본의 중요한 왜곡 2개 중 원본도 2~3단계 0개 · 원본 0~1단계에서 악화 0개 · 원본 단계 비교 불가 2개/);
  assert.match(output, /제목·도입부와 본문 · 원본 해당 없음, 근거 선택과 맥락 누락 · 원본 미평가/);
});

test('인용 속 충돌을 원기사 오류에서 분리하고 독립 편집자의 내용 판단 차이를 비교한다', async t => {
  const p = page(t);
  const article = '의원은 “예산은 20억 원이었다”고 말했다.';
  const old = workspace(article);
  old.sources = [{id: 'speech', url: 'https://assembly.example/minutes', title: '발언록', locator: '2절', version: '1판', excerpt: article},
    {id: 'budget', url: 'https://budget.example/table', title: '확정 예산표', locator: '표 1', version: '1판', excerpt: '같은 사업의 확정 예산은 10억 원이었다.'}];
  const row = engine.prepare(article, old.sources).rows[0];
  const record = {status: 'attribution', sourceIds: ['speech'], acknowledged: true, reason: '속기록과 기사의 인용이 일치한다.'};
  old.receipts = [engine.decide(row, record, old.sources)];
  const other = {...old, receipts: [engine.decide(row, {...record, contentStatus: 'contradicted', contentSourceIds: ['budget'],
    contentReason: '같은 기간에 의결된 예산은 10억 원이었다.', contentChecked: true}, old.sources)]};
  p.load('left', '귀속.json', JSON.stringify(old));
  p.load('right', '내용.json', JSON.stringify(other));
  await p.settled(); p.el('ack').click(); p.el('compare').click();
  let output = p.el('output').textContent;
  assert.match(output, /지지율산출 대기 \(0\/0\)산출 대기 \(0\/0\)/);
  assert.match(output, /판정 완료율0% \(0\/1\)100% \(1\/1\)/);
  assert.match(output, /인용 속 사실 주장 충돌 1개.*원발언 · 발언록.*내용 근거 · 확정 예산표/);
  assert.match(output, /수정 후 원자료와 충돌한 구절 0개/);
  assert.match(output, /수정 후 인용 속 사실 주장 충돌 1개새로 충돌로 판정된 기존 구절 · 1개/);
  const changed = [...p.el('output').querySelectorAll('details')].find(item => item.querySelector('summary').textContent.includes('새로 충돌로 판정된 기존 구절'));
  assert.match(changed.textContent, /수정 전 · 발언 사실 확인 · 담긴 주장 미확인.*원발언 · 발언록.*수정 후 · 발언 귀속 확인 · 인용 속 사실 주장 충돌/);
  assert.match(changed.textContent, /내용을 대조한 인용 구간예산은 20억 원이었다.*내용 근거 · 확정 예산표/);
  p.reviewers(); p.el('compare').click(); output = p.el('output').textContent;
  assert.match(output, /판정 또는 확인 범위가 다른 구절 · 1개/);
  assert.match(output, /담긴 주장 미확인.*인용 속 사실 주장 충돌/);
});

test('이전 버전이 부인 발언에서 잘라낸 숫자 반증은 저장 파일을 열어도 완료율과 편집자 일치율에 들지 않는다', async t => {
  const p = page(t);
  const article = '의원은 “집행액이 20억 원이었다”고 말한 적이 없다고 밝혔다.';
  const old = workspace(article);
  old.sources = [{id:'speech', url:'https://assembly.example/today', version:'1', locator:'1절', excerpt:article},
    {id:'debate', url:'https://studio.example/yesterday', version:'1', locator:'3분', excerpt:'의원은 어제 집행액이 20억 원이었다고 말했다.'}];
  // Exact receipt issued before the speech-act guard. The sources establish
  // that he previously made the statement; neither establishes the amount.
  old.receipts = [{protocol:'journal-review/1', rowId:'unit-0',
    articleBinding:'c8c023710d1c50e7cdc6cf274c3ab329b569ffbcfe62e91aed6ce383e826184f',
    binding:'bb899902f41a10add4a198b8972369bda30e097ad85dc26c69ceef3a8f257d64',
    references:'17a10177599d38ed20c5978bf67613c515e2d6fe98735d1b9acbc36ceba7b647', recordedAt:'2026-11-24T16:01:16.587Z',
    status:'attribution', sourceIds:['speech'], reason:'오늘 부인 발언을 그대로 옮겼다.', acknowledged:true,
    contentStatus:'contradicted', contentChecked:true, contentReason:'어제 토론 영상에 해당 발언이 있다.', contentSourceIds:['debate'],
    contentClaim:'집행액이 20억 원이었다', checksum:'4a81f29c3b94c0084c206f3070489537329a82d77ed53f6539b798e0c8b2a663'}];
  const restored = engine.report(article, old.sources, old.receipts);
  assert.equal(restored.complete, false);
  assert.equal(restored.contentContradictedCount, 0);
  assert.equal(restored.rows[0].priorDecision, null);
  const current = {...old, receipts:[engine.decide(restored.rows[0], {...old.receipts[0], contentStatus:'unverified'}, old.sources)]};
  p.load('left','종전 판정.json',JSON.stringify(old)); p.load('right','귀속 확인.json',JSON.stringify(current));
  await p.settled(); p.el('ack').click(); p.el('compare').click();
  assert.match(p.el('output').textContent, /판정 완료율0% \(0\/1\)0% \(0\/1\)/);
  assert.doesNotMatch(p.el('output').textContent, /인용 속 사실 주장 충돌 1개/);
  p.reviewers(); p.el('compare').click();
  assert.match(p.el('output').textContent, /산출 대기 \(0\/0\)/);
});

test('완료율이 그대로여도 사라진 원본 충돌 구절과 확인한 정정 문구·원문 쪽을 제시한다', async t => {
  const p = page(t);
  const source = {id: 'table', title: '시험 원표', url: 'https://example.org/report.pdf', version: '확정본',
    locator: '지출표', pdfPage: '4', excerpt: '예산안은 10억 원이다. 회의는 열렸다.'};
  function saved(article, states) {
    const file = workspace(article);
    file.sources = [source];
    file.receipts = engine.prepare(article, file.sources).rows.map((row, i) => engine.decide(row, {
      status: states[i], sourceIds: ['table'], acknowledged: true, reason: '확정본의 수치와 대조했다.',
      ...(states[i] === 'contradicted' ? {correction: '예산안은 10억 원이다.', correctionChecked: true} : {})
    }, file.sources));
    return JSON.stringify(file);
  }
  const oldClaim = '예산안은 20억 원이다.';
  p.load('left', '원본.json', saved(oldClaim + '\n회의는 열렸다.', ['contradicted', 'fact']));
  p.load('right', '수정본.json', saved('예산안은 10억 원이다.\n회의는 열렸다.', ['fact', 'fact']));
  await p.settled(); p.el('ack').click(); p.el('compare').click();
  const details = [...p.el('output').querySelectorAll('details')];
  const original = details.find(item => item.querySelector('summary').textContent.includes(oldClaim));
  assert.ok(original);
  assert.match(original.textContent, /대응 구절 미확인/);
  assert.match(original.textContent, /근거와 대조한 정정 문구예산안은 10억 원이다/);
  assert.match(original.textContent, /정정 문구와 일치하는 수정본 구절 · 원자료 지지/);
  assert.match(original.textContent, /이 구절이 원래 주장을 바로잡았는지 대조하세요/);
  assert.equal(original.querySelector('a').href, 'https://example.org/report.pdf#page=4');
  assert.match(p.el('output').textContent, /수정 전 충돌 구절 1개/);
});

test('반복 오류 하나만 고친 뒤 같은 원문이 남은 정확한 위치와 각 수정본 판정만 대조한다', async t => {
  const p = page(t);
  const claim = '청년 고용률은 65.7%였다.';
  const fixed = '청년 고용률은 62.7%였다.';
  const intro = '상반기 수치다.', tail = '기준은 조사일이다.';
  const quote = '의원은 “' + claim + '”라고 말했다.';
  const source = {id:'table', title:'상반기 고용 통계', version:'확정본', locator:'표 4 청년 행', pdfPage:'8',
    url:'https://stats.example/labour.pdf', excerpt:'상반기 청년 고용률은 62.7%로 집계됐다.'};
  function save(lines, decisions) {
    const file = workspace(lines.join('\n'));
    file.sources = [source];
    const {rows} = engine.prepare(file.article, file.sources);
    file.receipts = decisions.map(([i, decision]) => engine.decide(rows[i], {...decision, sourceIds:['table'],
      reason:'조사 기간과 표의 청년 행을 대조했다.', acknowledged:true}, file.sources));
    return JSON.stringify(file);
  }
  const conflict = {status:'contradicted', correction:fixed, correctionChecked:true};
  p.load('left', '원본.json', save([intro, claim, claim, quote, tail], [[1,conflict]]));
  async function compareWith(lines, decisions, total) {
    p.load('right', '수정본.json', save(lines, decisions));
    await p.settled(); p.el('ack').click(); p.el('compare').click();
    const output = p.el('output');
    const list = output.querySelector('.wording-locations');
    assert.ok(list);
    assert.equal(list.firstChild.textContent, '수정본에서 같은 문구가 나온 위치 ' + total + '곳');
    assert.match(list.closest('.pair').parentNode.firstChild.textContent, /대응 구절 미확인/);
    assert.match(list.textContent, /판본 간 대응으로 집계하지 않습니다/);
    list.closest('.pair').parentNode.open = true;
    await t.waitFor(() => assert.equal(list.querySelectorAll('details').length, total));
    return [...list.querySelectorAll('details')];
  }
  const [only] = await compareWith([intro, claim, fixed, quote, tail], [[2,{status:'fact'}]], 1);
  assert.equal(only.open, true);
  const after = only.closest('.pair').lastChild;
  assert.match(after.textContent, /정정 문구와 일치하는 수정본 구절 · 원자료 지지/);
  assert.match(after.querySelector('.rating-passage').textContent, /수정본 · 구간 3 · 앞뒤 문맥/);
  assert.deepEqual([...after.querySelectorAll('mark')].map(mark => mark.textContent), [fixed, claim]);
  assert.equal(after.querySelector('a').href, source.url + '#page=8');
  assert.match(p.el('output').textContent, /근거 지지율0% \(0\/1\)100% \(1\/1\)/);
  assert.match(p.el('output').textContent, /판정 완료율25% \(1\/4\)20% \(1\/5\)/);
  assert.equal(only.firstChild.textContent, '수정본 구간 2 · 같은 문구 1/1 · 미확인');
  assert.equal(only.querySelector('mark').textContent, claim);
  assert.match(only.querySelector('blockquote').textContent, /상반기 수치다.*65\.7%.*62\.7%/s);
  assert.equal(only.querySelector('a'), null);
  // Grouped occurrences and a separate whole row share the wording; the quoted substring is excluded.
  const locations = await compareWith([intro, claim, claim, quote, claim, tail], [[1,conflict]], 3);
  assert.deepEqual(locations.map(d => d.firstChild.textContent), [
    '수정본 구간 2 · 같은 문구 1/3 · 원문이 근거와 충돌', '수정본 구간 2 · 같은 문구 2/3 · 원문이 근거와 충돌',
    '수정본 구간 4 · 같은 문구 3/3 · 미확인']);
  for (const d of locations) assert.equal(d.querySelector('mark').textContent, claim);
  assert.notEqual(locations[0].querySelector('blockquote').textContent, locations[1].querySelector('blockquote').textContent);
  assert.equal(locations[1].querySelector('a').href, source.url + '#page=8');
  assert.ok(locations[1].textContent.includes(source.excerpt));
  assert.equal(locations[2].querySelector('a'), null);
});

test('원래 반박된 인용문이 다른 문맥으로 옮겨지면 발언자까지 같은 문장의 현재 귀속·내용 근거를 직접 대조한다', async t => {
  const p = page(t);
  const quote = '지난해 집행액은 20억 원이었다';
  const speech = '여당 대변인은 “' + quote + '”고 말했다.';
  const changedSpeaker = speech.replace('여당', '야당');
  const transcript = {id:'speech', title:'여당 회견 속기록', url:'https://council.example/briefing.pdf', pdfPage:'12',
    version:'확정본', locator:'대변인 답변 4', excerpt:speech};
  const ledger = {id:'ledger', title:'승인 결산서', url:'https://audit.example/report.pdf', pdfPage:'37',
    version:'의회 승인본', locator:'표 4 집행액', excerpt:'지난해 해당 사업의 집행액은 10억 원이었다.'};
  function saved(lines, status) {
    const file = workspace(lines.join('\n'));
    file.sources = [transcript, ledger];
    const target = engine.report(file.article, file.sources).rows.find(r => r.text === speech);
    if (target) file.receipts = [engine.decide(target, {status:'attribution', sourceIds:['speech'], acknowledged:true,
      reason:'회견 속기록에서 발언자를 확인했다.', contentStatus:status,
      ...(status === 'contradicted' ? {contentSourceIds:['ledger'], contentReason:'같은 사업의 승인 결산을 대조했다.', contentChecked:true} : {})
    }, file.sources)];
    return JSON.stringify(file);
  }
  p.load('left','원본.json',saved(['회의를 열었다.', speech, '논의가 이어졌다.'], 'contradicted'));
  async function compareRevised(lines, status) {
    p.load('right','수정본.json',saved(lines, status));
    await p.settled(); p.el('ack').click(); p.el('compare').click();
    return p.el('output');
  }
  for (const status of ['unverified', 'contradicted']) {
    const out = await compareRevised(['회견이 열렸다.', '여야 의견을 모았다.', speech, changedSpeaker], status);
    const list = out.querySelector('.wording-locations');
    assert.ok(list);
    assert.equal(list.firstChild.textContent, '수정본에서 같은 문구가 나온 위치 1곳');
    assert.match(list.textContent, /발언자를 확인하고.*인용 속 주장을 검토한 근거/);
    const originalItem = list.closest('details');
    assert.match(originalItem.firstChild.textContent, /대응 구절 미확인/);
    originalItem.open = true;
    await t.waitFor(() => assert.ok(list.querySelector('details[open]')));
    const location = list.querySelector('details[open]');
    assert.equal(location.querySelector('mark').textContent, speech);
    assert.match(location.firstChild.textContent, /수정본 구간 3 · 같은 문구 1\/1/);
    const urls = [...location.querySelectorAll('a')].map(a => a.href);
    assert.equal(urls[0], transcript.url + '#page=12');
    assert.match(location.textContent, /원발언 · 여당 회견 속기록/);
    if (status === 'unverified') {
      assert.match(location.firstChild.textContent, /발언 사실 확인 · 담긴 주장 미확인/);
      assert.equal(urls.length, 1);
      assert.doesNotMatch(location.textContent, /내용 근거 ·/);
      assert.match(out.textContent, /수정 후 인용 속 사실 주장 충돌 0개/);
    } else {
      assert.match(location.firstChild.textContent, /발언 귀속 확인 · 인용 속 사실 주장 충돌/);
      assert.equal(urls[1], ledger.url + '#page=37');
      assert.ok(location.textContent.includes('내용을 대조한 인용 구간' + quote));
      assert.ok(location.textContent.includes(ledger.excerpt));
      assert.match(out.textContent, /수정 후 인용 속 사실 주장 충돌 1개원본과 짝을 확인할 수 없는 충돌 구절/);
    }
  }
  const repeated = await compareRevised(['오전 회견이다.', speech, '오후 회견도 열렸다.', speech, changedSpeaker], 'contradicted');
  const locations = repeated.querySelector('.wording-locations');
  assert.equal(locations.firstChild.textContent, '수정본에서 같은 문구가 나온 위치 2곳');
  locations.closest('details').open = true;
  await t.waitFor(() => assert.equal(locations.querySelectorAll('details').length, 2));
  const [morning, afternoon] = locations.querySelectorAll('details');
  assert.match(morning.firstChild.textContent, /구간 2 · 같은 문구 1\/2 · 발언 귀속 확인 · 인용 속 사실 주장 충돌/);
  assert.match(afternoon.firstChild.textContent, /구간 4 · 같은 문구 2\/2 · 미확인/);
  assert.equal(morning.querySelectorAll('a').length, 2);
  assert.equal(afternoon.querySelectorAll('a').length, 0);
  assert.deepEqual([morning, afternoon].map(item => item.querySelector('mark').textContent), [speech, speech]);
  const onlyOtherSpeaker = await compareRevised(['회견이 열렸다.', changedSpeaker], 'unverified');
  assert.equal(onlyOtherSpeaker.querySelector('.wording-locations'), null);
});

test('두 편집자의 판정이 같아도 구절별로 선택한 자료와 발언·내용 근거를 비교한다', async t => {
  const p = page(t);
  const article = '올해 시범 예산은 20억 원이다.\n의원은 “예산은 20억 원이었다”고 말했다.\n의회는 예산을 의결했다.';
  const sources = [
    {id:'plan', title:'예비 예산표', url:'https://budget.example/plan.pdf', version:'예비본', locator:'표 2', pdfPage:'3', excerpt:'예비 심사액은 20억 원이다.'},
    {id:'final', title:'최종 예산표', url:'https://budget.example/final.pdf', version:'확정본', locator:'표 4', pdfPage:'8', excerpt:'최종 의결액은 19억 원이다.'},
    {id:'speech', title:'발언 속기록', url:'https://assembly.example/speech.pdf', version:'1판', locator:'의원 첫 발언', pdfPage:'2', excerpt:'의원은 예산이 20억 원이었다고 말했다.'},
    {id:'audio', title:'토론 녹음', url:'https://audio.example/episode', originUrl:'https://studio.example/episode-1',
      version:'1판', locator:'1분 30초', excerpt:'의원이 발언했다. 예산은 20억 원이었다.'}
  ];
  function saved(side, same) {
    const file = workspace(article);
    file.sources = sources.map(source => ({...source, id:side + source.id, title:side + ' ' + source.title}));
    // The same physical PDF page can be recorded as a URL fragment or a separate field.
    if (side === 'B') {
      const source = file.sources[1];
      source.url += '#page=' + source.pdfPage;
      delete source.pdfPage;
      file.sources.reverse();
    }
    const states = [
      {status:'fact', sourceIds:[same ? 'plan' : 'final']},
      {status:'attribution', sourceIds:[same ? 'speech' : 'audio'], contentSourceIds:[same ? 'final' : 'plan'],
        contentStatus:'contradicted', contentChecked:true, contentReason:'발언 속 금액을 예산표와 대조했다.'},
      {status:'fact', sourceIds:side === 'A' ? ['plan','final'] : ['final','plan']}
    ];
    file.receipts = engine.prepare(article, file.sources).rows.map((row, i) => {
      const decision = states[i];
      return engine.decide(row, {...decision, sourceIds:decision.sourceIds.map(id => side + id),
        ...(decision.contentSourceIds ? {contentSourceIds:decision.contentSourceIds.map(id => side + id)} : {}),
        acknowledged:true, reason:'자료를 대조했다.'}, file.sources);
    });
    return JSON.stringify(file);
  }
  p.reviewers();
  p.load('left','편집자A.json', saved('A', true));
  p.load('right','편집자B.json', saved('B', false));
  await p.settled(); p.el('compare').click();
  const output = p.el('output');
  assert.match(output.textContent, /같은 범위와 판정으로 확인100%3 \/ 3개/);
  assert.match(output.textContent, /판정 또는 확인 범위가 다른 구절 · 0개/);
  const evidence = [...output.querySelectorAll('details')].find(d => d.querySelector('summary').textContent.includes('선택한 근거가 다른 구절'));
  assert.ok(evidence, '같은 판정에서 갈린 근거도 확인할 수 있어야 한다.');
  assert.match(evidence.querySelector('summary').textContent, /2개/);
  assert.match(evidence.textContent, /근거를 선택한 3개 구절/);
  const [budget, quote] = evidence.querySelectorAll('.item');
  assert.match(budget.textContent, /원자료.*편집자 A.*예비 예산표.*표 2.*편집자 B.*최종 예산표.*표 4/);
  assert.deepEqual([...budget.querySelectorAll('a')].map(a => a.href),
    ['https://budget.example/plan.pdf#page=3','https://budget.example/final.pdf#page=8']);
  assert.match(quote.textContent, /원발언.*내용 근거.*편집자 A.*원발언 · A 발언 속기록.*내용 근거 · A 최종 예산표.*편집자 B.*원발언 · B 토론 녹음.*내용 근거 · B 예비 예산표/);
  assert.deepEqual([...quote.querySelectorAll('a')].map(a => a.href), [
    'https://assembly.example/speech.pdf#page=2', 'https://budget.example/final.pdf#page=8',
    'https://audio.example/episode', 'https://studio.example/episode-1', 'https://budget.example/plan.pdf#page=3'
  ]);
  p.load('right','같은 자료로 채점.json', saved('B', true));
  await p.settled(); p.el('compare').click();
  assert.match(output.textContent, /선택한 근거가 다른 구절 · 0개/);
});

test('파일이나 나머지 판정이 달라도 양쪽에 동일한 저장 기록을 찾아 남은 비교 건수를 표시한다', async t => {
  t.mock.timers.enable({apis:['Date'], now:Date.UTC(2026, 10, 24, 10)});
  const p = page(t);
  const file = workspace('시범 구역은 한 곳이다.\n조사 시점은 4월이다.\n의회는 어제 예산안을 의결했다.\n이 결정은 무책임하다.');
  file.sources = [{id:'minutes', title:'회의록', version:'1판', url:'https://assembly.example/minutes',
    locator:'표 1', excerpt:'시범 구역은 한 곳이다. 조사 시점은 4월이다. 의회는 어제 예산안을 의결했다.'}];
  const rows = engine.prepare(file.article, file.sources).rows;
  const decide = (row, status) => engine.decide(row, {status, acknowledged:true, reason:'회의록에서 확인했다.',
    sourceIds:status === 'opinion' ? [] : ['minutes']}, file.sources);
  file.receipts = rows.map((row, i) => decide(row, i === 3 ? 'opinion' : 'fact'));
  const [first, second, third, opinion] = file.receipts;
  const original = JSON.stringify(file);
  // Both source files retain the first judgment and the excluded opinion. A third judgment
  // is disputed, while the second will be independently recorded with the same evidence.
  t.mock.timers.tick(1000);
  const rechecked = decide(rows[1], 'fact');
  assert.notEqual(rechecked.recordedAt, second.recordedAt);
  const modified = {...file, receipts:[first, rechecked, decide(rows[2], 'contradicted'), opinion]};
  p.reviewers();
  p.load('left', '편집자A.json', original);
  p.load('right', '편집자B.json', JSON.stringify(modified));
  await p.settled(); p.el('compare').click();
  const output = p.el('output');
  assert.doesNotMatch(output.textContent, /두 작업 파일의 내용이 같습니다/);
  assert.match(output.textContent, /같은 범위와 판정으로 확인66.7%2 \/ 3개/);
  assert.match(output.textContent, /양쪽에 동일한 판정 기록 · 1\/3개/);
  assert.match(output.textContent, /동일 기록을 제외한 사실 판정 일치율 50% \(1\/2\)/);
  // A differently formatted copy can share every saved decision without being byte-identical.
  p.load('right', '다른서식.json', JSON.stringify(file, null, 2));
  await p.settled(); p.el('compare').click();
  assert.match(output.textContent, /양쪽에 동일한 판정 기록 · 3\/3개/);
  assert.match(output.textContent, /동일 기록을 제외한 사실 판정 일치율 산출 대기 \(0\/0\)/);
  // The checksum of a damaged entry is not a valid shared receipt.
  p.load('right', '손상기록.json', JSON.stringify({...file, receipts:[{...first,reason:'바뀐 이유'}, rechecked, third, opinion]}));
  await p.settled(); p.el('compare').click();
  assert.match(output.textContent, /양쪽에 동일한 판정 기록 · 1\/2개/);
  assert.match(output.textContent, /동일 기록을 제외한 사실 판정 일치율 100% \(1\/1\)/);
  p.load('right', '새로판정.json', JSON.stringify({...file, receipts:rows.map((row,i) => decide(row,i === 3?'opinion':'fact'))}));
  await p.settled(); p.el('compare').click();
  assert.match(output.textContent, /양쪽에 동일한 판정 기록 · 0\/3개/);
  assert.doesNotMatch(output.textContent, /동일 기록을 제외한 사실 판정 일치율/);
});

test('일반 비교에서 반복 구절은 저장한 구간까지만 표시하고 구형 비교 구절은 고유한 원문 범위를 보여 준다', async t => {
  const p = page(t);
  const tag = '<img src=x>';
  function rated(heading) {
    const source = {id:'s', title:'조사표', url:'https://example.org/table', version:'2판', locator:'표 2', excerpt:'조사 결과'};
    const article = [heading, '중간 기록.', '마지막 기록.'].join('\n');
    const work = {...workspace(article), sources:[source]};
    const report = engine.report(article, work.sources, []);
    work.articleAssessment = rubric.save(report, work.sources, {coreRowIds:[], ratings:{framing:{
      level:0, rowId:report.rows[0].id, quote:tag, compareQuote:'중간 기록.\n마지막 기록.',
      sourceId:source.id, sourceQuote:source.excerpt, reason:'두 구간을 확인했다.'
    }}});
    return JSON.stringify(work);
  }
  p.load('left', '원본.json', rated('원본 ' + tag + '와 ' + tag + '.'));
  p.load('right', '수정본.json', rated(['수정본 ' + tag + '.', '수정본 ' + tag + '.'].join('\n')));
  await p.settled();
  p.el('ack').click();
  p.el('compare').click();
  const framing = [...p.el('output').querySelectorAll('details')].find(d => d.firstElementChild.textContent.startsWith('제목·도입부와 본문'));
  for (const [i, side] of [...framing.querySelectorAll('.pair > div')].entries()) {
    const [main, comparison] = side.querySelectorAll('.rating-passage');
    assert.match(main.textContent, /기사 구절 · 구간 1.*정확한 위치를 특정할 수 없습니다/s);
    assert.equal(main.querySelector('mark'), null);
    assert.equal(main.querySelectorAll('img').length, 0);
    assert.equal(main.querySelector('blockquote').textContent, tag);
    assert.match(main.lastElementChild.textContent, i ? /수정본/ : /원본/);
    assert.match(comparison.firstElementChild.textContent, /비교 구절 · 구간 2–3/);
    assert.equal(comparison.querySelector('mark').textContent, '중간 기록.\n마지막 기록.');
    assert.match(side.textContent, /원자료 · 조사표 · 2판 · 표 2/);
  }
});

test('블라인드 회수 뒤 두 편집자가 같은 표현을 고른 네 판정에서 각자 지정한 두 구간을 강조한다', async t => {
  const p = page(t);
  const files = await require('../docs/reader/revision-evidence-example.js').files();
  const works = files.filter(f => f.data.article);
  for (const [i, file] of works.entries()) {
    const work = file.data;
    const report = engine.report(work.article, work.sources, work.receipts);
    const first = [0, 1, 1, 0][i];
    const framing = {...work.articleAssessment.ratings.framing, rowId:report.rows[first].id, quote:'도서관',
      compareRowId:report.rows[1 - first].id, compareQuote:'도서관'};
    work.articleAssessment = rubric.save(report, work.sources, {...work.articleAssessment,
      ratings:{...work.articleAssessment.ratings, framing}});
    file.raw = JSON.stringify(work);
  }
  p.selectFiles('blind-bundle-files', files.reverse().map(f => ({name:f.name, text:async () => f.raw})));
  await t.waitFor(() => assert.ok(p.el('agreement-export')));
  const ratings = p.el('output').querySelectorAll('[data-bias-axis="framing"] .pair > div > div');
  assert.equal(ratings.length, 4);
  for (const [i, rating] of [...ratings].entries()) {
    const article = works[i].data.article;
    const lines = article.split('\n');
    assert.match(rating.firstElementChild.textContent, i % 2 ? /수정 후/ : /수정 전/);
    const passages = rating.querySelectorAll('.rating-passage');
    assert.equal(passages.length, 2);
    for (const [j, passage] of [...passages].entries()) {
      const first = [0, 1, 1, 0][i];
      const line = j ? 1 - first : first;
      assert.ok(passage.firstElementChild.textContent.includes('구간 ' + (line + 1)));
      const mark = passage.querySelector('mark');
      assert.equal(mark.textContent, '도서관');
      const prefix = article.slice(0, article.indexOf(lines[line]) + lines[line].indexOf('도서관'));
      assert.equal(mark.previousSibling.textContent, prefix.replaceAll('\n', ' '));
    }
  }
});

test('진행자가 파일을 따로 저장하고 역순으로 회수해도 실제 판본에 맞춰 채점 결과를 표시한다', async t => {
  const p = page(t, '#blind-revision');
  assert.equal(p.el('blind-revision').open, true);
  const before = require('../experiments/article-review-pilot/a-original.json');
  const after = require('../experiments/article-review-pilot/b-revised.json');
  p.load('left', '원본.json', JSON.stringify(before));
  p.load('right', '수정본.json', JSON.stringify(after));
  await p.settled();
  assert.equal(p.el('blind-prepare').disabled, true);
  p.el('ack').click();
  p.el('blind-prepare').click();
  await t.waitFor(() => assert.equal(p.el('blind-downloads').hidden, false));

  const downloads = [];
  p.w.Blob = Blob;
  let created;
  p.w.URL.createObjectURL = blob => { created = blob; return 'blob:local'; };
  p.w.URL.revokeObjectURL = () => {};
  p.w.HTMLAnchorElement.prototype.click = function () { downloads.push({name:this.download, blob:created}); };
  async function saveSet() {
    downloads.length = 0;
    for (const part of ['a','b','key']) p.el('blind-download-' + part).click();
    const [a, b, key] = await Promise.all(downloads.map(async f => JSON.parse(await f.blob.text())));
    const code = key.pairId.slice(0, 8);
    assert.match(p.el('blind-prep-status').textContent, new RegExp(code));
    assert.deepEqual(downloads.map(f => f.name), ['검토-' + code + '-A.json', '검토-' + code + '-B.json', '진행자전용-대응표-' + code + '.json']);
    assert.equal(a.blindReview.pairId, key.pairId);
    assert.equal(b.blindReview.pairId, key.pairId);
    return {a, b, key};
  }
  const {a, b, key} = await saveSet();
  assert.equal(p.el('blind-next').disabled, false);
  p.el('blind-next').click();
  assert.equal(p.el('blind-downloads').hidden, true);
  p.el('blind-download-key').click();
  assert.equal(downloads.length, 3);
  await t.waitFor(() => assert.equal(p.el('blind-downloads').hidden, false));
  const next = await saveSet();
  assert.notEqual(next.key.pairId, key.pairId);
  assert.deepEqual([a.blindReview.slot, b.blindReview.slot], ['A','B']);
  for (const pack of [a,b]) {
    assert.equal(pack.articleAssessment, null);
    assert.deepEqual(pack.receipts, []);
    assert.equal(pack.mapping, undefined);
  }
  function score(pack, sample, status) {
    // Add the same source to both returned versions to isolate a change since distribution.
    pack.sources.push({id:'extra', title:'별표', url:'https://example.org/table',
      version:'1', locator:'별표 1', excerpt:'출생 통계 집계 범위'});
    const first = engine.prepare(pack.article, pack.sources).rows[0];
    pack.receipts = [engine.decide(first, {status, sourceIds:[pack.sources[0].id],
      reason:'출생 통계 전국 수치와 대조했다.', acknowledged:true}, pack.sources)];
    const report = engine.report(pack.article, pack.sources, pack.receipts);
    const rating = sample.articleAssessment.ratings.framing;
    const source = pack.sources[sample.sources.findIndex(s => s.id === rating.sourceId)];
    pack.articleAssessment = rubric.save(report, pack.sources, {coreRowIds:[first.id],
      ratings:{framing:{...rating, sourceId:source.id}}});
  }
  const original = a.article === before.article ? a : b;
  const revision = original === a ? b : a;
  score(original, before, 'contradicted');
  score(revision, after, 'fact');
  const firstName = '평가-1.json', secondName = '평가-2.json';
  p.select('blind-return-first', firstName, JSON.stringify(revision));
  p.select('blind-return-second', secondName, JSON.stringify(original));
  assert.equal(p.el('blind-resolve').disabled, true);
  p.select('blind-return-key', '진행자.json', JSON.stringify(key));
  p.el('blind-resolve').click();
  await t.waitFor(() => assert.equal(p.el('result').hidden, false));
  const output = p.el('output').textContent;
  assert.match(output, /수정 전 · 평가-2.json \/ 수정 후 · 평가-1.json/);
  assert.match(output, /중요한 왜곡 개선율100%1 \/ 1개/);
  assert.match(output, /양쪽 모두 채점 1\/4개/);
  assert.match(output, /근거 지지율0% \(0\/1\)100% \(1\/1\)/);
  assert.match(output, /평가 중 등록된 원자료가 배포할 때와 달라졌습니다/);
  assert.doesNotMatch(output, /두 판본의 원자료 묶음이 다릅니다/);
  assert.match(p.el('result-title').textContent, /가상 예시 · 수정 전후/);

  p.select('blind-return-second', '같은-배정.json', JSON.stringify(revision));
  assert.equal(p.el('result').hidden, true);
  p.el('blind-resolve').click();
  await t.waitFor(() => assert.match(p.el('blind-return-status').textContent, /같은 배정/));
  p.select('blind-return-second', '다음편집자.json', JSON.stringify(next.a));
  p.el('blind-resolve').click();
  await t.waitFor(() => assert.match(p.el('blind-return-status').textContent, /다른 묶음/));
  p.select('blind-return-second', secondName, JSON.stringify(original));
  p.select('blind-return-key', '다음편집자-대응표.json', JSON.stringify(next.key));
  p.el('blind-resolve').click();
  await t.waitFor(() => assert.match(p.el('blind-return-status').textContent, /다른 묶음/));
  p.select('blind-return-key', '손상.json', '{');
  p.el('blind-resolve').click();
  await t.waitFor(() => assert.match(p.el('blind-return-status').textContent, /손상.json.*JSON을 읽지 못했습니다/));
  assert.equal(p.el('result').hidden, true);

  p.load('left', firstName, JSON.stringify(revision));
  p.load('right', secondName, JSON.stringify(original));
  await p.settled();
  assert.match(p.el('mode-note').textContent, /대응표/);
  assert.equal(p.el('ack-wrap').hidden, true);
  assert.equal(p.el('compare').disabled, true);
  assert.equal(p.el('blind-prepare').disabled, true);
});

test('입력과 화면을 바꾼 뒤 도착한 배정이나 회수 오류를 폐기하고 이전 대응표 다운로드를 숨긴다', async t => {
  const p = page(t);
  const before = JSON.stringify(workspace('시의회에서 올해 예산안을 의결했다.'));
  const after = JSON.stringify(workspace('시의회가 내년 예산안을 의결했다.'));
  p.load('left', '원본.json', before);
  p.load('right', '수정본.json', after);
  await p.settled();
  p.el('ack').click(); p.el('blind-prepare').click();
  await t.waitFor(() => assert.equal(p.el('blind-downloads').hidden, false));
  p.load('right', '재선택.json', after);
  assert.equal(p.el('blind-downloads').hidden, true);
  assert.equal(p.el('blind-prep-status').textContent, '');
  await p.settled();

  let finish;
  const pending = new Promise(r => { finish = r; });
  p.w.JournalBlindRevision = {...p.w.JournalBlindRevision, prepare:() => pending};
  p.el('ack').click(); p.el('blind-prepare').click();
  p.reviewers();
  finish({key:{pairId:'0'.repeat(32)}});
  await p.settled();
  assert.equal(p.el('blind-revision').hidden, true);
  assert.equal(p.el('blind-downloads').hidden, true);
  assert.equal(p.el('blind-prep-status').textContent, '');
  p.w.document.querySelector('[value=revision]').click();

  let fail;
  p.w.JournalBlindRevision = {...p.w.JournalBlindRevision, resolve:() => new Promise((_, reject) => { fail = reject; })};
  p.select('blind-return-first', '평가1.json', before);
  p.select('blind-return-second', '평가2.json', after);
  p.select('blind-return-key', '이전.json', '{}');
  p.el('blind-resolve').click();
  await p.settled();
  p.select('blind-return-key', '재선택.json', '{');
  p.el('blind-resolve').click();
  await p.settled();
  fail(new Error('이전에 선택한 대응표 오류'));
  await p.settled();
  assert.match(p.el('blind-return-status').textContent, /재선택.json/);
  assert.equal(p.el('result').hidden, true);
});

test('따로 배정한 두 편집자의 개선율이 각각 100%여도 개선된 항목이 다르면 공통 비율은 산출 대기다', async t => {
  const p = page(t, '#blind-revision');
  const before = require('../experiments/article-review-pilot/a-original.json');
  const after = structuredClone(require('../experiments/article-review-pilot/b-revised.json'));
  const mixedText = '시청은 시범 운영을 마쳤고, 사업은 기대 이상이다.';
  after.article += '\n' + mixedText;
  after.articleDraft = after.article;
  async function assigned(editor, important) {
    const {key, packets} = await p.w.JournalBlindRevision.prepare(before, after);
    for (const role of ['before', 'after']) {
      const work = packets[key.mapping[role].slot];
      const rows = engine.prepare(work.article, work.sources).rows;
      const [row, other] = rows;
      const source = work.sources[0];
      const status = role === 'before' || editor === '둘째 편집자' ? 'contradicted' : 'fact';
      work.receipts = [engine.decide(row, {status, sourceIds:[source.id], acknowledged:true,
        reason:editor + '의 구절 확인'}, work.sources)];
      if (role === 'after') {
        const choice = editor === '첫 편집자' ? {status:'fact'} : {status:'mixed',
          factSpan:'시청은 시범 운영을 마쳤고', opinionSpan:'사업은 기대 이상이다.'};
        work.receipts.push(engine.decide(rows.at(-1), {...choice, sourceIds:[source.id],
          acknowledged:true, reason:editor + '의 확인 범위 기록'}, work.sources));
      }
      const report = engine.report(work.article, work.sources, work.receipts);
      const ratings = {};
      for (const axis of ['framing', 'omission']) {
        ratings[axis] = {level:role === 'before' && axis === important ? 2 : 0,
          rowId:row.id, quote:row.text, compareRowId:other.id, compareQuote:other.text, sourceId:source.id,
          sourceQuote:source.excerpt, reason:editor + '의 자료 대조', impact:'독자가 모집단을 잘못 알 수 있다.'};
      }
      work.articleAssessment = rubric.save(report, work.sources, {coreRowIds:[], ratings});
    }
    return {key, packets};
  }
  async function restore(set) {
    p.select('blind-return-first', 'B.json', JSON.stringify(set.packets.B));
    p.select('blind-return-second', 'A.json', JSON.stringify(set.packets.A));
    p.select('blind-return-key', '대응표.json', JSON.stringify(set.key));
    p.el('blind-resolve').click();
    await t.waitFor(() => assert.equal(p.el('result').hidden, false));
  }
  const first = await assigned('첫 편집자', 'framing');
  const second = await assigned('둘째 편집자', 'omission');
  await restore(first);
  assert.match(p.el('output').textContent, /중요한 왜곡 개선율100%1 \/ 1개/);
  assert.equal(p.el('agreement-export'), null);
  p.el('agreement-keep').click();
  assert.ok(p.el('agreement-status').textContent.includes(first.key.pairId.slice(0,8)));
  await restore(first);
  assert.match(p.el('revision-agreement').textContent, /같은 배포 묶음/);
  assert.equal(p.el('agreement-export'), null);
  await restore(second);
  const joint = p.el('revision-agreement');
  assert.match(joint.textContent, /두 사람 모두 개선으로 판정산출 대기0 \/ 0개/);
  assert.match(joint.textContent, /네 판정이 모두 있는 항목 2\/4개.*판단이 갈린 항목 2개/);
  assert.match(p.el('output').textContent, /중요한 왜곡 개선율100%1 \/ 1개/);
  const framing = [...joint.querySelectorAll('details')].find(d => d.querySelector('summary').textContent.includes('제목·도입부'));
  assert.match(framing.querySelector('summary').textContent, /첫 편집자 2단계 → 0단계 \(개선\).*둘째 편집자 0단계 → 0단계/);
  assert.match(framing.textContent, /첫 편집자의 자료 대조.*둘째 편집자의 자료 대조/);
  const facts = p.el('joint-facts');
  assert.match(facts.querySelector('[data-fact-row="articleFlagged"]').textContent, /1개1개/);
  assert.match(facts.querySelector('[data-fact-row="support"]').textContent, /0% \(0\/1\)산출 대기 \(0\/0\)/);
  const alert = facts.querySelector('.fact-alerts[data-edition="after"]');
  assert.match(alert.textContent, /첫 편집자 · 원자료 지지.*첫 편집자의 구절 확인.*둘째 편집자 · 원문이 근거와 충돌.*둘째 편집자의 구절 확인/);
  assert.ok(alert.querySelector('a[href]'), '원자료로 가는 링크');
  const scope = facts.querySelector('.fact-disputes[data-edition="after"]');
  assert.equal(scope.querySelectorAll('details').length, 1);
  assert.equal(scope.querySelector('details').querySelector('summary').textContent, mixedText);
  assert.match(scope.textContent, /첫 편집자 · 원자료 지지.*첫 편집자의 확인 범위 기록.*둘째 편집자.*확인 범위시청은 시범 운영을 마쳤고.*둘째 편집자의 확인 범위 기록/);
  for (const editor of scope.querySelector('.pair').children) {
    assert.ok(editor.querySelector('a[href]'), '각 편집자가 사용한 원자료로 가는 링크');
  }
  assert.ok(!alert.textContent.includes(mixedText));
  let exported, filename;
  p.w.Blob = Blob;
  p.w.URL.createObjectURL = value => { exported = value; return 'blob:article-score'; };
  p.w.URL.revokeObjectURL = () => {};
  p.w.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  p.el('agreement-export').click();
  const record = JSON.parse(await exported.text());
  assert.equal(record.demo, true);
  assert.equal(record.version, 7);
  assert.deepEqual(record.facts.before[0], {outcome:'contradicted', flag:'article'});
  assert.deepEqual(record.facts.after[0], {outcome:'disputed', flag:'article'});
  assert.deepEqual(record.facts.after.at(-1), {outcome:'disputed', flag:'none'});
  assert.equal(record.before.articleSha256, first.key.mapping.before.articleSha256);
  assert.equal(record.after.articleSha256, second.key.mapping.after.articleSha256);
  assert.equal(filename, '기사평가-' + record.before.articleSha256.slice(0, 12) + '-' + record.after.articleSha256.slice(0, 12) + '.json');
  const series = p.w.JournalRevisionSeries.summarize([record]);
  assert.equal(series.articleCount, 1);
  assert.equal(series.improved.denominator, 0);
  assert.equal(series.disagreed, 2);
  const text = JSON.stringify(record);
  for (const privateValue of [first.key.pairId, second.key.pairId, '첫 편집자의 자료 대조',
    '둘째 편집자의 자료 대조', before.article, before.sources[0].url]) assert.ok(!text.includes(privateValue));
  p.el('agreement-reset').click();
  assert.equal(p.el('agreement-export'), null);
  assert.equal(p.el('agreement-held').hidden, true);
  assert.equal(p.el('result').hidden, true);
});

test('이전 대조 기록에 한쪽 근거로 매긴 단계만 남아 있어도 원래 작업 파일을 꺼내 보완한다', async t => {
  const example = require('../docs/reader/revision-evidence-example.js');
  const engine = require('../docs/reader/factcheck-engine.js');
  const rubric = require('../docs/reader/article-rubric.js');
  const inputs = await example.files();
  for (const {data:w} of inputs) {
    if (!w.blindReview) continue;
    w.receipts = [];
    const r = engine.report(w.article,w.sources), [a,b] = r.rows, source = w.sources[0];
    w.articleAssessment = rubric.save(r,w.sources,{coreRowIds:[],ratings:{}});
    w.articleAssessment.ratings.standards = {level:2,rowId:a.id,quote:a.text,sourceId:source.id,
      sourceQuote:source.excerpt,reason:'양측에 같은 검증을 요구했는지 확인한다.',impact:'증거의 세기를 다르게 읽을 수 있다.',
      compareQuote:b.text,compareRowId:b.id,direction:''};
  }
  // Produced by the v2 archive writer at e6ed223 from these four original ratings.
  const archive = {format:'journal-retention-case', version:2, items:inputs.map(({name,data})=>({name,data})),notes:[],
    reviewId:'428a1a9c5a488f960ce494cc273b847bbb512abcbc5245daf3c1b0f50385eaee',
    evidenceDigest:'4570341f60613759f74b3cb47fe90fefa7078dc450f6b2ca2926326d376fccd5',
    checksum:'3219fbd4a886a8a578c348ae8695c7ffb596ece0314a94e36b036cc15afc9829'};
  const p = page(t);
  p.select('blind-bundle-files','구판 보관 기록.json',JSON.stringify(archive));
  await t.waitFor(()=>assert.equal(p.el('result').hidden,false));
  assert.match(p.el('blind-bundle-status').textContent,/작업 파일 6개/);
  assert.match(p.el('missing-returns').textContent,/확인할 파일 4개/);
  assert.equal(p.el('agreement-export'),null);
  const files = [...p.el('output').querySelectorAll('details')].find(s=>s.firstElementChild.textContent.includes('대응표 2개 꺼내기'));
  assert.deepEqual([...files.querySelectorAll('button')].map(b=>b.textContent),archive.items.map(i=>i.name+' 저장'));
});

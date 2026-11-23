const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const folder = path.join(__dirname, '../docs/reader');

function open(t) {
  const errors = [], blobs = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(readFileSync(path.join(folder, 'factcheck.html'), 'utf8'), {
    url: 'https://journal.example/factcheck.html', runScripts: 'outside-only', virtualConsole: console
  });
  const w = dom.window, doc = w.document;
  w.TextEncoder = TextEncoder;
  w.confirm = () => true;
  w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:journal'; };
  w.URL.revokeObjectURL = () => {};
  doc.addEventListener('click', event => { if (event.target.closest('a[download]')) event.preventDefault(); });
  for (const script of doc.querySelectorAll('script[src]')) {
    w.eval(readFileSync(path.join(folder, script.getAttribute('src')), 'utf8'));
  }
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  const el = id => doc.getElementById(id);
  const snapshot = () => new Promise((resolve, reject) => {
    const reader = new w.FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blobs.at(-1));
  });
  const set = (id, value) => {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event('input', {bubbles: true}));
  };
  return {w, doc, el, set, snapshot, click: id => el(id).click()};
}

async function loadWorkspace(page, data, accept = true) {
  const {w, el} = page;
  w.confirm = () => accept;
  const input = el('import-file');
  const file = new w.File([JSON.stringify(data)], 'work.json', {type: 'application/json'});
  Object.defineProperty(input, 'files', {value: [file], configurable: true});
  const status = el('file-status');
  const loaded = new Promise((resolve, reject) => {
    const observer = new w.MutationObserver(() => {
      if (!status.textContent) return;
      observer.disconnect();
      w.clearTimeout(timer);
      if (status.textContent.includes('열지 못했습니다')) reject(new Error(status.textContent));
      else resolve();
    });
    const timer = w.setTimeout(() => {
      observer.disconnect();
      reject(new Error('작업 파일 처리 시간 초과'));
    }, 3000);
    observer.observe(status, {childList: true, subtree: true});
  });
  input.dispatchEvent(new w.Event('change'));
  await loaded;
}

test('가상 정치 기사에서 확인한 수치와 발언 속 미확인 주장이 결과와 작업 파일에 구분된다', async t => {
  const {el, click, doc, set, snapshot} = open(t);
  click('load-demo');
  assert.equal(el('row-list').children.length, 5);
  assert.equal(el('verdict').value, '');
  doc.querySelector('#row-sources input[value="vote"]').click();
  set('verdict', 'fact');
  set('reason', '의결록 제3호의 표결 수치와 일치한다.');
  click('acknowledged');
  el('decision-form').requestSubmit();
  assert.equal(el('row-list').children.length, 4);
  assert.match(el('row-text').textContent, /대변인/);

  doc.querySelector('#row-sources input[value="briefing"]').click();
  set('verdict', 'attribution');
  set('reason', '브리핑 속기록에서 대변인의 발언을 확인했다.');
  click('acknowledged');
  el('decision-form').requestSubmit();
  assert.equal(el('row-list').children.length, 4, '내용이 미확인인 발언은 계속 대기');
  assert.match(el('report-rows').textContent, /내용 미확인/);

  click('export-report');
  const text = await snapshot();
  for (const marker of ['모의 원자료', '내용 미확인', '찬성 7표', '제3호 안건', '대변인 발언', '검토 대상 원문']) assert.ok(text.includes(marker), marker);
  click('save-work');
  const json = JSON.parse(await snapshot());
  assert.deepEqual(json.receipts.map(r => r.status), ['fact', 'attribution']);
  assert.equal(json.demo, true);
});

test('자료 찾기에서 원문 전체와 임시 줄 번호가 검증 근거로 자동 등록되지 않는다', async t => {
  const {el, click, set, snapshot} = open(t);
  set('article', '의회는 교육 예산을 편성했다.');
  el('article-form').requestSubmit();
  click('go-find');
  set('document-text', '다른 페이지의 비공개 메모\n교육 예산은 10억 원이다.');
  click('find-passages');
  el('finder-results').querySelector('button').click();
  assert.equal(el('source-excerpt').value, '교육 예산은 10억 원이다.');
  assert.equal(el('source-locator').value, '');
  assert.equal(el('row-list').children.length, 1);
  click('save-work');
  const data = JSON.parse(await snapshot());
  assert.deepEqual(data.sources, []);
  assert.ok(!JSON.stringify(data).includes('비공개 메모'));
});

test('기사 수정으로 위치가 유지된 메모는 초안으로만 이어지고 문맥이 달라지면 취소할 수 있다', t => {
  const {el, set, click, w} = open(t);
  const original = '교육과정은 훌륭하다.\n의회가 예산을 승인했다.';
  set('article', original);
  el('article-form').requestSubmit();
  set('verdict', 'opinion');
  set('reason', '필자의 교육과정 평가다.');
  click('acknowledged');
  const edited = original + '\n통계표가 첨부됐다.';
  set('article', edited);
  el('article-form').requestSubmit();
  assert.equal(el('reason').value, '필자의 교육과정 평가다.');
  assert.equal(el('acknowledged').checked, false);
  assert.match(el('prior-note').textContent, /초안/);
  w.confirm = () => false;
  set('article', '전혀 다른 기사다.');
  el('article-form').requestSubmit();
  assert.equal(el('article').value, edited);
  assert.equal(el('reason').value, '필자의 교육과정 평가다.');
});

test('이미 기록한 판단을 수정하는 중에는 화면과 다운로드에 검토 완료가 남지 않는다', async t => {
  const {el, w, set, click, snapshot} = open(t);
  set('article', '시의회의 결정은 무책임하다.');
  el('article-form').requestSubmit();
  set('verdict', 'opinion');
  set('reason', '시의회에 대한 필자의 평가다.');
  click('acknowledged');
  el('decision-form').requestSubmit();
  assert.match(el('result-tag').textContent, /완료/);
  el('row-filter').value = 'all';
  el('row-filter').dispatchEvent(new w.Event('change'));
  set('verdict', 'held');
  set('reason', '이 표현이 원발언인지 확인 중이다.');
  assert.match(el('result-tag').textContent, /추가 확인/);
  assert.match(el('report-rows').textContent, /판단 작성 중/);
  click('export-report');
  const text = await snapshot();
  assert.match(text, /판단 작성 중/);
  assert.doesNotMatch(text, /의견·가치판단 1개/);
  click('save-work');
  const saved = await snapshot();
  const restored = open(t);
  const file = new restored.w.File([saved], 'work.json', {type: 'application/json'});
  Object.defineProperty(restored.el('import-file'), 'files', {value: [file]});
  const loaded = new Promise(resolve => {
    const observer = new restored.w.MutationObserver(() => {
      if (restored.el('file-status').textContent.includes('작업 파일을 열었습니다')) { observer.disconnect(); resolve(); }
    });
    observer.observe(restored.el('file-status'), {subtree: true, childList: true});
  });
  restored.el('import-file').dispatchEvent(new restored.w.Event('change'));
  await loaded;
  assert.equal(restored.el('row-list').children.length, 1);
  assert.equal(restored.el('reason').value, '이 표현이 원발언인지 확인 중이다.');
  assert.equal(restored.el('acknowledged').checked, false);
});

test('자료 수정 도중 자료 추가를 누르면 기존 문서와 최초 출처를 보존한다', async t => {
  const {el, set, click, snapshot} = open(t);
  click('load-demo');
  el('source-list').querySelector('button').click();
  click('go-add-source');
  for (const [field, value] of Object.entries({title:'감사 보고서', url:'https://city.example/audit',
    originUrl:'https://office.example/data', version:'1판', locator:'2쪽', excerpt:'회계표'})) set('source-' + field, value);
  el('source-form').requestSubmit();
  click('save-work');
  const {sources} = JSON.parse(await snapshot());
  assert.equal(sources.length, 3);
  assert.equal(sources[0].id, 'vote');
  assert.match(sources[0].title, /본회의/);
  assert.equal(sources[2].originUrl, 'https://office.example/data');
});

test('일반 기사에 모의 근거를 연결하면 첫 결과부터 연습 자료로 표시한다', async t => {
  const {el, set, click, snapshot} = open(t);
  set('article','시의회는 예산을 승인했다.');
  el('article-form').requestSubmit();
  for (const [field, value] of Object.entries({title:'예시 기록', url:'https://example.invalid/journal/vote',
    version:'모의 1판', locator:'원표', excerpt:'예산 승인'})) set('source-' + field, value);
  el('source-form').requestSubmit();
  assert.equal(el('result-demo').hidden, false);
  click('export-report');
  assert.match(await snapshot(), /연습 기록/);
});

test('반복된 제목과 본문을 대조한 위치, 평가 단계와 미결 분모가 작업 파일과 결과에 이어진다', async t => {
  const seed = open(t);
  seed.click('load-demo');
  seed.click('save-work');
  const job = JSON.parse(await seed.snapshot());
  job.article = job.articleDraft = '의회가 예산안을 의결했다.\n\n의회가 예산안을 의결했다.';
  const report = seed.w.JournalFactcheck.report(job.article, job.sources, []);
  const [first, second] = report.rows;
  const source = job.sources[0];
  job.articleAssessment = seed.w.JournalArticleRubric.save(report, job.sources, {
    coreRowIds: [first.id],
    ratings: {framing: {
      level: 0, rowId: first.id, quote: first.text, compareRowId: second.id, compareQuote: second.text,
      sourceId: source.id, sourceQuote: source.excerpt, reason: '제목과 도입이 같은 의결 대상을 가리킨다.'
    }}
  });
  const reader = open(t);
  await loadWorkspace(reader, job);
  assert.match(reader.el('article-rubric').textContent, /근거로 채점 1\/4/);
  reader.click('export-report');
  const txt = await reader.snapshot();
  assert.match(txt, /검증 범위 0% \(0\/2\)/);
  assert.match(txt, /핵심 구절 · 미확인 · 의회가/);
  assert.match(txt, /0단계/);
  assert.match(txt, /기사 구절 · 구간 1 · 의회가/);
  assert.match(txt, /비교 구절 · 구간 2 · 의회가/);
  reader.click('save-work');
  const saved = JSON.parse(await reader.snapshot());
  assert.equal(saved.articleAssessment.ratings.framing.compareRowId, second.id);
  const fresh = open(t);
  await loadWorkspace(fresh, job, false);
  assert.match(fresh.el('article-rubric').textContent, /근거로 채점 0\/4/);
  assert.match(fresh.el('article-rubric').textContent, /핵심 구절 미지정/);

  // Even a manually combined workspace must not count a finding under revision.
  const edit = {...job.articleAssessment.ratings.framing, level: '0', reason: '판단을 다시 검토 중'};
  job.articleAssessmentDraft = {binding: job.articleAssessment.binding, activeId: 'framing', entries: {framing: edit}};
  const pending = open(t);
  await loadWorkspace(pending, job);
  assert.match(pending.el('article-rubric').textContent, /근거로 채점 0\/4/);
  pending.click('export-report');
  assert.match(await pending.snapshot(), /제목·도입부와 본문 · 작성 중 · 미평가/);
});

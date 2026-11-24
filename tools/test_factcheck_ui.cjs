const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM, VirtualConsole} = require('jsdom');
const folder = path.join(__dirname, '../docs/reader');

function open(t) {
  const errors = [], blobs = [], filenames = [];
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
  doc.addEventListener('click', event => {
    const link = event.target.closest('a[download]');
    if (link) { event.preventDefault(); filenames.push(link.download); }
  });
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
  return {w, doc, el, set, snapshot, filename: () => filenames.at(-1), click: id => el(id).click()};
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

test('당시 결산표가 인용 내용과 충돌하면 편집 화면·TXT·재개 파일에 귀속과 반증을 함께 남긴다', async t => {
  const p = open(t);
  const article = '위원장은 “지난해 집행액은 20억 원이었다”고 말했다.';
  p.set('article', article);
  p.el('article-form').requestSubmit();
  for (const [title, url, excerpt] of [['속기록', 'https://speaker.example/transcript', article],
    ['결산표', 'https://audit.example/report', '지난해 해당 사업의 실제 집행액 10억 원']]) {
    for (const [field, value] of Object.entries({title, url, locator:'표 1', version:'당시 확정본', excerpt})) p.set('source-' + field, value);
    p.el('source-form').requestSubmit();
  }
  const source = (group, title) => [...p.el(group).querySelectorAll('label')].find(label => label.textContent.includes(title)).querySelector('input');
  source('row-sources', '속기록').click();
  p.set('verdict', 'attribution');
  p.set('reason', '속기록에서 발언자와 정확한 인용을 확인했다.');
  p.set('content-status', 'contradicted');
  assert.equal(p.el('content-sources-part').hidden, false);
  source('content-sources', '결산표').click();
  p.set('content-reason', '같은 사업과 기간의 결산표에는 실제 집행액 10억 원이 기록돼 있다.');
  p.click('content-checked'); p.click('acknowledged');
  p.el('decision-form').requestSubmit();
  p.el('article-rubric').querySelector('[data-core-row]').click();
  assert.match(p.el('result-counts').textContent, /내용 충돌 1개/);
  assert.match(p.el('article-rubric').textContent, /핵심 항목 중 1개에서 발언 귀속을 확인/);
  p.click('export-report');
  const report = await p.snapshot();
  for (const marker of ['근거 일치율 산출 대기 (0/0)', '검증 범위 100% (1/1)', '내용을 대조한 인용 구간 · 지난해 집행액은 20억 원이었다',
    '원발언 · 속기록', '내용 근거 · 결산표']) assert.ok(report.includes(marker), marker);
  p.click('save-work');
  const file = JSON.parse(await p.snapshot());
  const next = open(t);
  await loadWorkspace(next, file);
  assert.match(next.el('report-rows').textContent, /발언 내용 · 독립 원자료와 충돌/);
  const result = next.w.JournalWorkspaceSnapshot.read(file).assessment.accuracy;
  assert.deepEqual([result.adjudicated, result.reviewed, result.quotedConflict, result.coreQuotedConflict.length], [0, 1, 1, 1]);
  next.el('row-filter').value = 'all'; next.el('row-filter').dispatchEvent(new next.w.Event('change'));
  next.el('row-list').querySelector('button').click();
  next.set('content-reason', '다시 대조 중');
  next.click('save-work');
  const draft = JSON.parse(await next.snapshot());
  assert.equal(draft.rowDrafts[0].data.contentStatus, 'contradicted');
  assert.equal(next.w.JournalWorkspaceSnapshot.read(draft).assessment.accuracy.quotedConflict, 0);
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

function recordFirstFact(page) {
  const {doc, el, set, click} = page;
  click('load-demo');
  doc.querySelector('#row-sources input[value="vote"]').click();
  set('verdict', 'fact');
  set('reason', '의결록 제3호 표결 수치와 일치');
  click('acknowledged');
  el('decision-form').requestSubmit();
}

test('인용한 원자료를 수정하면 기록한 판단을 다시 확인할 초안으로 남긴다', async t => {
  const page = open(t);
  const {w, el, set, click, snapshot} = page;
  recordFirstFact(page);
  el('source-list').querySelector('button').click();
  set('source-title', '해솔시의회 본회의 의결록 (모의 자료) 수정');
  el('source-form').requestSubmit();
  assert.match(el('source-status').textContent, /판단 1개를 다시 확인할 초안/);
  el('row-filter').value = 'all'; el('row-filter').dispatchEvent(new w.Event('change'));
  el('row-list').querySelector('button').click();
  assert.equal(el('reason').value, '의결록 제3호 표결 수치와 일치');
  assert.equal(el('verdict').value, 'fact');
  assert.equal(el('acknowledged').checked, false);
  assert.match(el('row-heading').textContent, /판단 작성 중/);
  assert.match(el('prior-note').textContent, /인용한 원자료를 수정/);
  assert.equal(el('result-tag').textContent, '추가 확인 필요');
  set('reason', '수정한 의결록과 다시 대조했다'); click('acknowledged');
  el('decision-form').requestSubmit();
  click('save-work');
  const work = JSON.parse(await snapshot());
  assert.deepEqual(work.receipts.map(r => r.reason), ['수정한 의결록과 다시 대조했다']);
  assert.equal(work.rowDrafts.length, 0);

  // Saving a source without a change keeps the recorded decision.
  el('source-list').querySelector('button').click();
  el('source-form').requestSubmit();
  el('row-list').querySelector('button').click();
  assert.match(el('row-heading').textContent, /사실 확인/);
});

test('기록 전 문장에 입력해도 기사 평가가 남고, 제외된 평가는 확인 없이 지워지지 않는다', async t => {
  const seed = open(t);
  recordFirstFact(seed);
  seed.click('save-work');
  const job = JSON.parse(await seed.snapshot());
  const report = seed.w.JournalFactcheck.report(job.article, job.sources, job.receipts);
  const row = report.rows[0], vote = job.sources.find(s => s.id === 'vote');
  job.articleAssessment = seed.w.JournalArticleRubric.save(report, job.sources, {coreRowIds: [], ratings: {wording: {
    level: 0, rowId: row.id, quote: row.text, sourceId: vote.id, sourceQuote: vote.excerpt, reason: 'RUBRIC-REASON'}}});

  const page = open(t);
  const {w, el, set, click, snapshot} = page;
  await loadWorkspace(page, job);
  const rubricBox = () => el('article-rubric');
  const core = () => rubricBox().querySelector('input[data-core-row]');
  assert.match(rubricBox().textContent, /근거로 채점 1\/4/);
  set('reason', '확');                               // a sentence that was never recorded
  assert.match(rubricBox().textContent, /근거로 채점 1\/4/);
  assert.equal(rubricBox().querySelector(':scope > .callout'), null);
  core().click();
  set('reason', '');
  click('save-work');
  assert.equal(JSON.parse(await snapshot()).articleAssessment.ratings.wording.reason, 'RUBRIC-REASON');

  // Re-opening the recorded sentence hides its decision, so the rating is excluded but kept.
  el('row-filter').value = 'all'; el('row-filter').dispatchEvent(new w.Event('change'));
  el('row-list').querySelector('button').click();
  set('reason', '다시 보는 중');
  assert.match(rubricBox().textContent, /근거로 채점 0\/4/);
  w.confirm = () => false;
  const box = core(), before = box.checked;
  box.click();
  assert.equal(core().checked, before);
  set('reason', '의결록 제3호 표결 수치와 일치');      // back to the recorded decision
  assert.match(rubricBox().textContent, /근거로 채점 1\/4/);
  click('save-work');
  assert.equal(JSON.parse(await snapshot()).articleAssessment.ratings.wording.reason, 'RUBRIC-REASON');
});

test('공식 다운로드 주소에 확인한 PDF 쪽·표·행을 연결하고 복원과 쪽 변경을 검증한다', async t => {
  const a=open(t);
  const raw='https://www.nabo.go.kr/board/file/down.do?fid=33318263';
  a.set('article','정부는 일반회계 예비비를 편성했다.');
  a.el('article-form').requestSubmit();
  const location='예산안 표, 2025년 요구액 행, 인쇄 12쪽';
  for (const [id,val] of Object.entries({title:'예산안 분석',url:raw,version:'심사본',locator:location,pdfPage:'34',excerpt:'일반회계 예비비'}))
    a.set('source-'+id,val);
  a.el('source-form').requestSubmit();
  const sourceLink=a.doc.querySelector('#row-sources .source-page-links > a');
  assert.equal(sourceLink.href,raw+'#page=34');
  assert.match(sourceLink.textContent,/34쪽/);
  assert.ok(!sourceLink.closest('details'));
  assert.ok(a.el('row-sources').textContent.includes(location));
  a.doc.querySelector('#row-sources input').click();
  a.set('verdict','fact');
  a.set('reason','제시한 표의 예비비 행을 대조했다.');
  a.click('acknowledged'); a.el('decision-form').requestSubmit();
  assert.equal(a.doc.querySelector('#report-rows .source-page-links > a').href,raw+'#page=34');
  a.click('export-report'); const txt=await a.snapshot();
  assert.ok(txt.includes(raw+'#page=34')); assert.ok(txt.includes(location));
  a.click('save-work'); const data=JSON.parse(await a.snapshot());
  assert.equal(data.sources[0].pdfPage,'34');
  const b=open(t); await loadWorkspace(b,data);
  assert.equal(b.doc.querySelector('#report-rows .source-page-links > a').href,raw+'#page=34');
  b.el('source-list').querySelector('button').click(); b.set('source-pdfPage','37');
  b.el('source-form').requestSubmit();
  assert.equal(b.el('acknowledged').checked,false);
  assert.equal(b.el('row-list').children.length,1);
  b.click('save-work'); assert.equal(JSON.parse(await b.snapshot()).receipts.length,0);
  b.el('source-list').querySelector('button').click();
  b.set('source-url','https://office.example/changed.pdf');
  assert.equal(b.el('source-pdfPage').value,'');
  b.set('source-pdfPage','17');
  b.click('save-work'); const draft=JSON.parse(await b.snapshot());
  const c=open(t); await loadWorkspace(c,draft);
  assert.equal(c.el('source-pdfPage').value,'17');
});

test('첨부용 PDF는 같은 판본의 여러 쪽에만 연결되고 작업 파일에서는 빠진다', async t => {
  const a=open(t);
  const url='https://office.example/attachment.do?file=3';
  const base={title:'예산서',url,version:'심사본',locator:'예산표 일반회계 행',excerpt:'일반회계 예비비'};
  const sources=[{...base,id:'a',pdfPage:'34'},{...base,id:'b',pdfPage:'37'},
    {...base,id:'c',pdfPage:'34',version:'정정본'}];
  const data={format:'journal-local-factcheck-v1',article:'정부가 예산을 편성했다.',articleDraft:'정부가 예산을 편성했다.',
    demo:false,sources,receipts:[],rowDrafts:[],sourceDraft:{id:null,fields:{title:'',url:'',version:'',locator:'',excerpt:''}}};
  await loadWorkspace(a,data);
  const catalog=a.el('source-list');
  for (const source of sources) {
    const label = a.el('row-sources').querySelector('input[value="' + source.id + '"]').closest('label');
    assert.ok(label.textContent.includes(source.title + ' · ' + source.version));
    assert.equal(label.querySelector('input').checked, false);
  }
  const picker=catalog.querySelector('input[type=file]');
  let revoked=0;
  a.w.URL.revokeObjectURL=()=>revoked++;
  async function select(bytes, filename, message) {
    const status=picker.closest('details').querySelector('[role=status]');
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{observer.disconnect();reject(new Error(status.textContent));},1000);
      const observer=new a.w.MutationObserver(()=>{
        if(status.textContent.includes(message)) {observer.disconnect(); clearTimeout(timer);resolve();}
      });
      observer.observe(status,{childList:true,subtree:true});
    });
    Object.defineProperty(picker,'files',{value:[new a.w.File([bytes],filename)],configurable:true});
    picker.dispatchEvent(new a.w.Event('change'));
    await ready;
  }
  await select('<html>','not-a-pdf.pdf','PDF 형식');
  assert.equal(catalog.querySelectorAll('[data-pdf-key] a').length,0);
  await select('%PDF-1.7','personal-copy.pdf','인용한 문장');
  const localLinks=[...catalog.querySelectorAll('[data-pdf-key] a')].map(a=>a.getAttribute('href'));
  assert.deepEqual(localLinks,['blob:journal#page=34','blob:journal#page=37']);
  a.click('save-work');
  const exported=await a.snapshot();
  assert.doesNotMatch(exported,/personal-copy|blob:journal/);
  await loadWorkspace(a,data);
  assert.equal(catalog.querySelectorAll('[data-pdf-key] a').length,0);
  assert.ok(revoked>0);
});

test('자료 찾기에서 표 제목과 단위를 따로 살피고 선택한 행만 발췌한다', t => {
  const {el, click, set} = open(t);
  const excerpt = '  서울    39,456    0.55';
  set('document-text', ['[표 12] 시군구별 출생아 수와 합계출산율', '(단위: 명)', '지역   출생아 수   합계출산율',
    '가 지역    210    0.81', '나 지역    320    0.92', '다 지역    430    0.73', excerpt,
    '\f', '다음 쪽 다른 자료'].join('\n'));
  set('document-query', '서울 39,456명 0.55명');
  click('find-passages');
  const hit = el('finder-results').querySelector('.source');
  assert.equal(hit.querySelector('blockquote').textContent, excerpt);
  const context = hit.querySelector('details');
  assert.equal(context.open, false);
  assert.match(context.textContent, /표 12.*단위.*합계출산율/s);
  assert.ok(!context.textContent.includes('다음 쪽'));
  assert.equal(context.querySelector('li[value="7"] strong').textContent.trim(), '선택한 문단');
  hit.querySelector('button').click();
  assert.equal(el('source-excerpt').value, excerpt);
  assert.equal(el('source-locator').value, '');
});

test('다른 기간에 같은 숫자가 있을 때 카드에 기준 시점을 표시하고 검색 순위와 발췌문을 보존한다', t => {
  const {el, click, set, w} = open(t);
  const doc = ['[표 1] 월별 생산량', '연월   생산량', '2024년 1월    781    4.5',
    '2024년 2월    905    4.6', '2024년 3월    532    4.4'].join('\n');
  const query = '2024년 2월 생산량은 781개다.';
  set('document-text', doc); set('document-query', query); click('find-passages');
  const cards = [...el('finder-results').querySelectorAll('.source')];
  assert.deepEqual(cards.map(x => x.querySelector('blockquote').textContent),
    Array.from(w.JournalEvidenceFinder.find(doc, query), r => r.text));
  const wrongMonth = cards.find(x => x.querySelector('blockquote').textContent.startsWith('2024년 1월'));
  assert.match(wrongMonth.querySelector('.callout').textContent, /2024년 2월.*2024년 1월/);
  wrongMonth.querySelector('button').click();
  assert.equal(el('source-excerpt').value, '2024년 1월    781    4.5');
  assert.equal(el('source-locator').value, '');
  set('document-query', '2024년 2월 전월 대비 생산량은 781개다.'); click('find-passages');
  assert.equal(el('finder-results').querySelector('.source .callout'),null);
});

test('후보에서 여덟 문단 떨어진 같은 쪽 원문만 선택해 발췌하고 새 검색에서 선택을 지운다', t => {
  const {el, click, set, w} = open(t);
  const lines = ['입구 앞쪽', '고용률 대표문단', ...Array.from({length: 7}, (_, i) => '행 ' + (i+1)),
    '  기준 행    24.5    48.6', '다음 문단', '\f다른 페이지'];
  set('document-text', lines.join('\n'));
  set('document-query', '대표문단');
  click('find-passages');
  const details = el('finder-results').querySelector('.source details');
  details.open = true;
  details.dispatchEvent(new w.Event('toggle'));
  assert.ok(!details.textContent.includes('다른 페이지'));
  const exact = details.querySelector('li[value="10"] input');
  exact.click();
  details.querySelector('button').click();
  assert.equal(el('source-excerpt').value, lines[9]);
  assert.equal(el('source-locator').value, '');
  assert.match(el('source-status').textContent, /10번째/);
  assert.equal(el('source-excerpt').value.startsWith('  '), true);
  set('document-query', '다른 질문');
  assert.equal(el('finder-results').childElementCount, 0);
});

test('날짜가 겹쳐도 자료에 없는 단위를 묻는 질문에는 미확인 안내를 먼저 보여준다', t => {
  const {el, click, set} = open(t);
  const source = '연도\t운영비(천원)\n2023년\t1,200\n2024년\t1,450';
  set('document-text', source);
  set('document-query', '2024년에 도서관을 방문한 사람은 몇 명인가?');
  click('find-passages');
  assert.match(el('finder-status').textContent, /단위 ‘명’.*찾지 못했/);
  const fallback = el('finder-results').firstElementChild;
  assert.equal(fallback.tagName, 'DETAILS');
  assert.equal(fallback.open, false);
  assert.equal(el('source-excerpt').value, '');
  set('document-text', source.replace('운영비(천원)', '방문 인원(명)'));
  click('find-passages');
  assert.doesNotMatch(el('finder-status').textContent, /찾지 못했/);
  assert.match(el('finder-results').querySelector('blockquote').textContent, /2024/);
});

test('짧은 비교 문장에서 실제 기사 첫 줄을 명시하고 해당 지표의 표를 다시 찾는다', t => {
  const {el, click, set} = open(t);
  const title = '2023년 독서실 이용자 증가 2만 1천 명';
  const claim = '증가 폭이 절반 수준으로 줄었습니다.';
  set('article', title + '\n' + claim);
  el('article-form').requestSubmit();
  const row = [...el('row-list').querySelectorAll('button')].find(b => b.textContent.includes('절반'));
  row.click();
  click('go-find');
  set('document-text', ['2023년 연간 통계', '< 서비스 이용 추이 >', ' ’21년  ’22년  ’23년',
    '독서실 이용자(만명, 전년대비증감)    8.4    3.8    2.1',
    '온라인 가입자(만명, 전년대비증감)    8.4    3.8    2.1'].join('\n'));
  click('find-passages');
  assert.ok(el('search-context-options').open);
  assert.match(el('finder-status').textContent, /비교할 지표/);
  assert.equal(el('use-article-title').hidden, false);
  click('use-article-title');
  assert.equal(el('search-context').value, title);
  assert.match(el('finder-status').textContent, /기사 문맥을 함께 사용/);
  assert.match(el('finder-results').querySelector('blockquote').textContent, /독서실 이용자/);
  set('document-query', '다른 기사에서 입력한 질문');
  assert.equal(el('search-context').value, '');
  assert.equal(el('use-article-title').hidden, true);
  assert.equal(el('finder-results').childElementCount, 0);
});

test('연도가 겹친 두 열을 같이 보여 주고 선택한 행의 원문을 보존한다', t => {
  const {el, click, set} = open(t);
  const row = '전체\t38.0\t40.1\t65.0\t67.2';
  set('document-text', ['조사 결과', '2019\t2022\t2019\t2022', row].join('\n'));
  set('document-query', '2022년 전체 수치 67.2는 어느 항목에 해당하나?');
  click('find-passages');
  const card = [...el('finder-results').querySelectorAll('.source')].find(c => c.querySelector('blockquote').textContent === row);
  assert.match(card.textContent, /2022년 · 2번째 수치 열 40.1/);
  assert.match(card.textContent, /2022년 · 4번째 수치 열 67.2/);
  assert.match(card.textContent, /원표에서 각 열의 상위 제목/);
  card.querySelector('button').click();
  assert.equal(el('source-excerpt').value, row);
});

test('원표의 같은 비율과 괄호 증감이 충돌하면 해당 열에서만 알리고 발췌는 직접 선택한다', t => {
  const {el, click, set} = open(t);
  const row = '전체\t30.0\t35.0(+5.0)\t62.1\t62.1(−4.5)';
  set('document-text', ['단위: % / () 증감','일반\t\t정밀\t','구 분','2022\t2024\t2022\t2024',row].join('\n'));
  for (const [label, expected] of [['정밀', true], ['일반', false]]) {
    set('document-query', '2024년 전체 ' + label + ' 점검률은 얼마였나?');
    click('find-passages');
    const card = [...el('finder-results').querySelectorAll('.source')].find(c => c.querySelector('blockquote').textContent === row);
    assert.ok(card);
    assert.equal(card.textContent.includes('두 표시값과 괄호 증감이 어긋납니다'), expected);
    if (expected) assert.match(card.textContent, /2022년 3번째 열은 62.1, 2024년 4번째 열은 62.1\(−4.5\)/);
    assert.equal(el('source-excerpt').value, '');
  }
});

test('중량을 물었을 때 대금만 있는 표와 중량을 다른 단위로 수록한 표를 구분한다', t => {
  const {el, click, set} = open(t);
  set('document-query','2025년에 운송한 화물의 무게는 몇 톤인가?');
  for (const [unit, missing] of [['천원', true], ['kg', false], ['천 톤', false]]) {
    set('document-text', ['구분\t2024년\t2025년', '단위: ' + unit, '화물\t1,200\t1,450'].join('\n'));
    click('find-passages');
    assert.equal(el('finder-status').textContent.includes('단위 ‘중량’'), missing);
    assert.equal(el('finder-results').firstElementChild.tagName === 'DETAILS', missing);
    assert.equal(el('source-excerpt').value, '');
  }
});

test('결과를 뒷받침할 자료가 부족하면 후보를 닫아 두고 편집자가 직접 대조할 수 있다', async t => {
  const {claims, bundles} = require('../experiments/source-order-pilot/holdout.json');
  const claim = claims.find(c => c.type === 'unmeasured downstream outcome');
  const sources = bundles[claim.bundle].map(({key, ...source}) =>
    ({...source, id: key, url: 'https://source-order.invalid/' + key}));
  const p = open(t);
  await loadWorkspace(p, {format:'journal-local-factcheck-v1', article:claim.text, articleDraft:claim.text,
    demo:false, sources, receipts:[], rowDrafts:[], sourceDraft:{id:null,fields:{title:'',url:'',version:'',locator:'',excerpt:''}}});
  const area = p.el('row-sources');
  assert.ok(area.querySelector(':scope > .callout')?.textContent);
  assert.equal(area.querySelectorAll('details[open],input:checked').length, 0);
  const details = area.querySelector('.source details');
  details.open = true;
  assert.ok(details.textContent.includes(sources.find(s => s.id === details.parentElement.querySelector('input').value).excerpt));
  assert.equal(p.el('verdict').value, '');
});

test('근거를 찾던 문장에만 새 자료를 연결하고 기존 이유는 보관하되 판정은 직접 기록한다', async t => {
  const page = open(t);
  const {el, click, set, doc, snapshot} = page;
  set('article', '시의회는 예산을 확정했다.\n예산은 3억 원이다.');
  el('article-form').requestSubmit();
  assert.equal(el('source-save-link').hidden, true);
  set('verdict', 'fact');
  set('reason', '의결된 예산만 확인한다.');
  click('go-find');
  assert.match(el('source-save-link').textContent, /1번/);
  set('document-text', '시의회는 예산을 확정했다.');
  click('find-passages');
  el('finder-results').querySelector('button:last-child').click();
  const fields = {title:'공개 회의록', url:'https://council.example/record.pdf#page=2', version:'확정본', locator:'의결란'};
  for (const [id, value] of Object.entries(fields)) set('source-' + id, value);
  click('source-save-link');
  assert.equal(el('source-count').textContent, '· 1개');
  assert.equal(el('sources-panel').open, false);
  assert.equal(el('verdict'), doc.activeElement);
  assert.equal(doc.querySelector('#row-sources input:checked')?.value, 'source-1');
  assert.equal(el('reason').value, '의결된 예산만 확인한다.');
  assert.equal(el('acknowledged').checked, false);
  click('save-work');
  const work = JSON.parse(await snapshot());
  assert.equal(work.receipts.length, 0);
  const parsed = page.w.JournalWorkspaceSnapshot.read(work);
  assert.equal(parsed.sourceDraftPending, false, '다음 발췌를 위해 남긴 문서 정보는 작성 중인 자료가 아니다');
  assert.equal(parsed.assessment.accuracy.adjudicated, 0);
  const restored = open(t);
  await loadWorkspace(restored, work);
  assert.equal(restored.el('source-url').value, 'https://council.example/record.pdf');
  restored.set('source-excerpt', '추가로 확인 중인 대목');
  restored.click('save-work');
  assert.equal(restored.w.JournalWorkspaceSnapshot.read(JSON.parse(await restored.snapshot())).sourceDraftPending, true);
  click('go-add-source');
  el('row-list').children[1].querySelector('button').click();
  assert.equal(el('source-save-link').hidden, true, '근거 입력 중 다른 문장을 고르면 연결 대상을 해제한다');
  assert.equal(doc.querySelector('#row-sources input:checked'), null);
  el('row-list').children[0].querySelector('button').click();
  click('acknowledged');
  el('decision-form').requestSubmit();
  click('save-work');
  assert.equal(JSON.parse(await snapshot()).receipts[0].status, 'fact');
});

test('먼저 연 큰 파일이 늦게 읽혀도 마지막으로 고른 기사를 덮지 않는다', async t => {
  const page = open(t);
  page.click('load-demo');
  page.click('save-work');
  const initial = JSON.parse(await page.snapshot());
  let finishRead;
  const early = {text: () => new Promise(resolve => { finishRead = resolve; })};
  const input = page.el('import-file');
  Object.defineProperty(input, 'files', {value: [early], configurable: true});
  input.dispatchEvent(new page.w.Event('change'));
  const chosen = {...initial, article:'두 번째로 고른 기사입니다.', articleDraft:'두 번째로 고른 기사입니다.'};
  await loadWorkspace(page, chosen);
  finishRead(JSON.stringify(initial));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.el('article').value, chosen.article);
});

test('아직 제출하지 않은 다른 편집자의 문장 판단도 독립 검토를 선택하면 복원하지 않는다', async t => {
  const author = open(t);
  author.click('load-demo');
  author.set('reason', '이전 편집자가 정리한 예비 결론');
  author.click('save-work');
  const work = JSON.parse(await author.snapshot());
  assert.equal(work.receipts.length, 0);
  assert.equal(work.rowDrafts.length, 1);
  const reviewer = open(t);
  await loadWorkspace(reviewer, work, false);
  assert.equal(reviewer.el('article').value, work.article);
  assert.equal(reviewer.el('reason').value, '');
});

test('독립 평가 파일에는 확정한 기사와 원자료만 남고 판정·초안·추가 입력은 전달되지 않는다', async t => {
  const a = open(t);
  recordFirstFact(a);
  a.click('save-work');
  const seed = JSON.parse(await a.snapshot());
  seed.sources[0].internalNote = '먼저 본 사람의 비공개 메모';
  const owner = open(t);
  await loadWorkspace(owner, seed);
  owner.set('reason', '미완성 판정의 메모');
  owner.set('source-excerpt', '등록하지 않은 발췌');
  owner.click('save-review-input');
  const packed = JSON.parse(await owner.snapshot());
  assert.equal(packed.article, seed.article);
  assert.equal(packed.demo, true);
  assert.deepEqual(packed.sources.map(s => s.excerpt), seed.sources.map(s => s.excerpt));
  for (const value of ['먼저 본 사람의 비공개 메모', '미완성 판정의 메모', '등록하지 않은 발췌', seed.receipts[0].reason]) {
    assert.ok(!JSON.stringify(packed).includes(value));
  }
  assert.deepEqual(packed.receipts, []);
  assert.deepEqual(packed.rowDrafts, []);
  const b = open(t);
  await loadWorkspace(b, packed, false);
  assert.equal(b.el('verdict').value, '');
  assert.equal(b.el('row-list').children.length, 5);
  assert.equal(b.w.JournalWorkspaceSnapshot.read(packed).assessment.accuracy.adjudicated, 0);
  owner.set('article', '수정 중인 기사');
  owner.click('save-review-input');
  assert.match(owner.el('file-status').textContent, /검토 목록을 만든 뒤/);
});

test('A/B 작업 파일은 편집 판단과 중립 표지만 이어 저장하고 독립 평가용 내보내기는 표지를 제거한다', async t => {
  const seed = open(t);
  recordFirstFact(seed);
  seed.set('reason', '별도 근거를 확인 중이다.');
  seed.click('save-work');
  const work = JSON.parse(await seed.snapshot());
  const originalReceipt = {...work.receipts[0]};
  const privateNote = '진행자 전용 역할 메모';
  work.role = privateNote;
  work.sources[0].internalNote = privateNote;
  work.receipts[0].role = privateNote;
  work.rowDrafts[0].data.role = privateNote;
  const editor = open(t);
  for (const slot of ['A', 'B']) {
    const tag = {pairId: '0123456789abcdef0123456789abcdef', slot};
    await loadWorkspace(editor, {...work, blindReview: tag});
    const notice = editor.el('blind-notice');
    assert.ok(!notice.hidden);
    assert.ok(notice.textContent.includes('블라인드 평가 ' + slot + ' · 묶음 01234567'));
    editor.click('save-work');
    assert.equal(editor.filename(), 'journal-work-' + tag.pairId + '-' + slot + '.json');
    const raw = await editor.snapshot();
    assert.ok(!raw.includes(privateNote));
    const returned = JSON.parse(raw);
    assert.deepEqual(returned.blindReview, tag);
    assert.deepEqual(returned.receipts, [originalReceipt]);
    assert.equal(returned.rowDrafts[0].data.reason, '별도 근거를 확인 중이다.');
    await loadWorkspace(editor, returned);
    assert.equal(editor.el('reason').value, '별도 근거를 확인 중이다.');
    editor.click('save-review-input');
    assert.equal(editor.filename(), 'journal-independent-review.json');
    const clean = JSON.parse(await editor.snapshot());
    assert.ok(!Object.hasOwn(clean, 'blindReview'));
    assert.deepEqual(clean.receipts, []);
    assert.deepEqual(clean.rowDrafts, []);
    assert.ok(!JSON.stringify(clean).includes(privateNote));
  }
});

test('A/B 평가에서 원문을 편집 중인 작업을 다시 열고 되돌릴 수 있고 변경 확정 뒤에는 일반 기사로 저장한다', async t => {
  const seed = open(t);
  recordFirstFact(seed);
  seed.click('save-work');
  const tagged = JSON.parse(await seed.snapshot());
  tagged.blindReview = {pairId: 'a'.repeat(32), slot: 'B'};
  const page = open(t);
  await loadWorkspace(page, tagged);
  const replacement = '새 기사입니다.';
  page.set('article', replacement);
  assert.match(page.el('blind-notice').textContent, /원문을 수정 중/);
  page.click('save-work');
  const draft = JSON.parse(await page.snapshot());
  assert.deepEqual(draft.blindReview, tagged.blindReview);
  assert.throws(() => page.w.JournalWorkspaceSnapshot.read(draft), /기사를 수정 중/);
  await loadWorkspace(page, draft);
  assert.equal(page.el('article').value, replacement);
  assert.match(page.el('blind-notice').textContent, /원문을 수정 중/);
  page.w.confirm = () => false;
  page.el('article-form').requestSubmit();
  assert.equal(page.el('article').value, tagged.article);
  assert.doesNotMatch(page.el('blind-notice').textContent, /원문을 수정 중/);
  page.click('save-work');
  assert.deepEqual(JSON.parse(await page.snapshot()).blindReview, tagged.blindReview);
  page.w.confirm = () => true;
  page.set('article', replacement);
  page.el('article-form').requestSubmit();
  assert.match(page.el('review-status').textContent, /A\/B 표지를 해제/);
  assert.ok(page.el('blind-notice').hidden);
  page.click('save-work');
  assert.equal(page.filename(), 'journal-factcheck-work.json');
  assert.ok(!Object.hasOwn(JSON.parse(await page.snapshot()), 'blindReview'));
});

test('연습 기사나 표지 없는 기존 파일을 열면 이전 A/B 표지를 지우고 추가 역할 필드가 있는 표지도 전달하지 않는다', async t => {
  const page = open(t);
  page.click('load-demo');
  page.click('save-review-input');
  const old = JSON.parse(await page.snapshot());
  const tag = {pairId: 'b'.repeat(32), slot: 'A'};
  for (const replace of [
    () => page.click('load-demo'),
    () => loadWorkspace(page, old),
    () => loadWorkspace(page, {...old, blindReview: {...tag, role: 'private-version'}})
  ]) {
    await loadWorkspace(page, {...old, blindReview: tag});
    assert.ok(!page.el('blind-notice').hidden);
    await replace();
    assert.ok(page.el('blind-notice').hidden);
    page.click('save-work');
    assert.equal(page.filename(), 'journal-factcheck-work.json');
    const raw = await page.snapshot();
    assert.ok(!Object.hasOwn(JSON.parse(raw), 'blindReview'));
    assert.ok(!raw.includes('private-version'));
  }
});

test('문장 판정을 편집하다 저장해도 잠시 제외된 편향 평가는 근거가 일치할 때만 복원한다', async t => {
  const a = open(t);
  recordFirstFact(a); a.click('save-work');
  const work = JSON.parse(await a.snapshot());
  const report = a.w.JournalFactcheck.report(work.article, work.sources, work.receipts);
  const row = report.rows[0], vote = work.sources[0];
  work.articleAssessment = a.w.JournalArticleRubric.save(report, work.sources, {coreRowIds: [row.id], ratings: {
    wording: {level: 0, rowId: row.id, quote: row.text, sourceId: vote.id, sourceQuote: vote.excerpt, reason: '원표와 대조함'}
  }});
  const editor = open(t);
  await loadWorkspace(editor, work);
  editor.el('row-filter').value = 'all';
  editor.el('row-filter').dispatchEvent(new editor.w.Event('change'));
  editor.el('row-list').querySelector('button').click();
  editor.set('reason', '근거를 다시 읽는 중');
  editor.click('save-work');
  const paused = JSON.parse(await editor.snapshot());
  const resumed = open(t);
  await loadWorkspace(resumed, paused);
  assert.match(resumed.el('article-rubric').textContent, /근거로 채점 0\/4/);
  resumed.click('export-report');
  assert.ok(!(await resumed.snapshot()).includes('원표와 대조함'));
  resumed.set('reason', work.receipts[0].reason);
  assert.match(resumed.el('article-rubric').textContent, /근거로 채점 1\/4/);
  resumed.click('export-report');
  assert.ok((await resumed.snapshot()).includes('원표와 대조함'));
});

test('연도별 자료에서 선택한 지표의 다른 원문 수치와 위치를 볼 수 있고 판정은 편집자가 한다', t => {
  const {doc, el, set, click} = open(t);
  click('load-demo');
  const before = el('report-rows').textContent;
  const lines = ['발생년\t사고건수\t사망자수', '2023\t198296\t2551', '2024\t196349\t2521'];
  set('document-text', lines.join('\n'));
  set('document-query', '2024년 교통사고 사망자는 2,551명이었다는 주장이 통계와 일치하나?');
  click('find-passages');
  const card = doc.querySelector('#finder-results .source');
  assert.equal(card.querySelector('blockquote').textContent, lines[2]);
  assert.match(card.textContent, /2024년 · 사망자수 · 원문 값 2521/);
  assert.match(card.textContent, /머리글 1문단 · 자료 3문단 · 왼쪽에서 3번째 열/);
  assert.ok(![...doc.querySelectorAll('#finder-results .source')].slice(1).some(c => /원문 값/.test(c.textContent)));
  assert.equal(el('verdict').value, '');
  assert.equal(el('report-rows').textContent, before);
  set('document-query', '2024년 인구 10만 명당 사망자는?'); click('find-passages');
  assert.doesNotMatch(el('finder-results').textContent, /원문 값/);
});

test('연도가 가로인 표에서 선택한 행을 원문 그대로 옮기고 편집자가 적은 위치를 보존한다', async t => {
  const {el, set, click, snapshot} = open(t);
  set('article', '2023년 장비 대여는 87건이었다.');
  el('article-form').requestSubmit();
  click('go-find');
  const lines = ['구분\t2022년\t2023년', '장비 반납(건)\t48\t87', '장비 대여(건)\t29\t31  '];
  set('document-text', lines.join('\n'));
  set('document-query', '2023년 장비 대여는 87건인가?');
  click('find-passages');

  const cards = el('finder-results').querySelectorAll('.source');
  assert.equal(cards[0].querySelector('blockquote').textContent, lines[2]);
  assert.match(cards[0].textContent, /장비 대여\(건\) 행 · 2023년 열 · 원문 값 31/);
  assert.match(cards[0].textContent, /머리글 1문단 · 자료 3문단 · 왼쪽에서 3번째 열/);
  assert.ok([...cards].slice(1).every(card => !card.textContent.includes('원문 값')));
  assert.equal(el('source-excerpt').value, '');
  assert.equal(el('source-locator').value, '');

  const selectRow = cards[0].querySelector(':scope > button');
  assert.equal(selectRow.textContent, '이 행을 발췌하고 표 위치 확인');
  selectRow.click();
  assert.equal(el('source-excerpt').value, lines[2]);
  assert.equal(el('source-locator').value, '‘장비 대여(건)’ 행 · ‘2023년’ 열');
  assert.equal(el('source-locator').readOnly, false);
  assert.equal(el('source-locator').disabled, false);

  const editorLocation = '장비 이용 대장 7쪽, 표 2';
  set('source-locator', editorLocation);
  set('document-query', '2023년 장비 반납은 31건인가?');
  click('find-passages');
  el('finder-results').querySelector('.source > button').click();
  assert.equal(el('source-excerpt').value, lines[1]);
  assert.equal(el('source-locator').value, editorLocation);
  assert.equal(el('verdict').value, '');
  click('save-work');
  const work = JSON.parse(await snapshot());
  assert.deepEqual(work.sources, []);
  assert.deepEqual(work.receipts, []);
});

test('대상 연도의 항목을 펼쳐도 표 전체의 값을 질문의 답으로 제시하거나 판정을 기록하지 않는다', t => {
  const {el, set, click, w} = open(t);
  click('load-demo');
  const lines = ['연도\t지정\t확인\t보유시설수', '2019\t8\t51\t103', '2020\t9\t49\t108'];
  set('document-text', lines.join('\n'));
  set('document-query', '2020년 승인 현황을 확인한 결과 시설이 몇 곳이었나?');
  click('find-passages');
  const lookup = el('finder-results');
  const inspect = [...lookup.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent === '2020년 원표 항목 3개 보기');
  assert.ok(inspect);
  assert.equal(inspect.open,false);
  assert.doesNotMatch(lookup.textContent,/원문 값/);
  const report = el('report-rows').textContent;
  const excerpt = el('source-excerpt').value;
  inspect.open = true;
  inspect.dispatchEvent(new w.Event('toggle'));
  assert.match(inspect.textContent, /머리글 1문단 · 자료 3문단/);
  assert.deepEqual([...inspect.querySelectorAll('li')].map(li => li.textContent),
    ['2열 · 지정 · 9','3열 · 확인 · 49','4열 · 보유시설수 · 108']);
  assert.equal(el('source-excerpt').value,excerpt);
  assert.equal(el('report-rows').textContent,report);
  assert.equal(el('verdict').value,'');
  set('document-query', '2017년 보유 시설은 얼마인가?'); click('find-passages');
  assert.doesNotMatch(lookup.textContent,/원표 항목/);
});

test('직접 고른 표의 좌표는 작업을 다시 열어도 발췌문과 함께 바뀌며 취소하면 둘 다 보존된다', async t => {
  const first = open(t);
  first.set('article', '시설 이용 기록을 확인한다.');
  first.el('article-form').requestSubmit();
  const lines = ['구분\t2023년\t2024년', '평일 이용\t120\t133', '휴일 이용\t59\t72  '];
  function browse(page) {
    page.set('document-text', lines.join('\n'));
    page.set('document-query', '2024년 휴일 이용자 중 어린이는 몇 명인가요?');
    page.click('find-passages');
    const results = page.el('finder-results');
    assert.doesNotMatch(results.textContent, /원문 값/);
    const chooser = [...results.querySelectorAll('details')].find(d =>
      d.querySelector('summary')?.textContent === '원표의 행과 연도 직접 선택');
    chooser.open = true;
    chooser.dispatchEvent(new page.w.Event('toggle'));
    const selects = chooser.querySelectorAll('select');
    const use = chooser.querySelector('button');
    assert.ok(use.disabled);
    const choose = (index, item) => {
      selects[index].selectedIndex = item;
      selects[index].dispatchEvent(new page.w.Event('change'));
    };
    return {choose, use, preview:chooser.querySelector('[aria-live]')};
  }
  let selection = browse(first);
  selection.choose(0, 1);
  assert.ok(selection.use.disabled);
  selection.choose(1, 2);
  assert.match(selection.preview.textContent, /평일 이용.*2024년.*133.*3번째 열/);
  assert.equal(first.el('source-excerpt').value, '');
  selection.use.click();
  first.click('save-work');
  const saved = JSON.parse(await first.snapshot());
  const page = open(t);
  await loadWorkspace(page, saved);
  selection = browse(page);
  selection.choose(0, 2); selection.choose(1, 1);
  page.w.confirm = () => false;
  selection.use.click();
  assert.equal(page.el('source-excerpt').value, lines[1]);
  assert.equal(page.el('source-locator').value, '‘평일 이용’ 행 · ‘2024년’ 열');
  page.w.confirm = () => true;
  selection.use.click();
  assert.equal(page.el('source-excerpt').value, lines[2]);
  assert.equal(page.el('source-locator').value, '‘휴일 이용’ 행 · ‘2023년’ 열');
  selection.choose(1, 2); selection.use.click();
  assert.equal(page.el('source-locator').value, '‘휴일 이용’ 행 · ‘2024년’ 열');
  page.set('document-text', '별도 회의 자료에서 참석자 수를 확인했다.');
  page.set('document-query', '회의 자료'); page.click('find-passages');
  page.el('finder-results').querySelector('.source > button').click();
  assert.equal(page.el('source-locator').value, '');
  assert.equal(page.el('source-excerpt').value, '별도 회의 자료에서 참석자 수를 확인했다.');
  page.click('save-work');
  const changed = JSON.parse(await page.snapshot());
  assert.deepEqual(changed.sources, []); assert.deepEqual(changed.receipts, []);
  assert.equal(page.el('verdict').value, '');
});

test('조건이 붙은 통계는 원표 좌표를 직접 연 뒤에만 숫자를 보여 주고 제목까지 발췌 위치에 보존한다', t => {
  const {set, el, click, doc} = open(t);
  set('article', '1곳당 이용 인원을 검토한다.'); el('article-form').requestSubmit();
  const title = '<표 8> 평일 체육관 한 곳당 이용자 수';
  const line = '남부\t1,125\t1,503';
  set('document-text', [title, '(단위: 명)', '구분\t2022년\t2023년', line, '북부\t1,367\t1,617'].join('\n'));
  set('document-query', '2022년 남부에서 청소년은 한 곳에 몇 명 방문했나요?');
  click('find-passages');
  const area = el('finder-results');
  assert.ok(!area.textContent.includes('원문 값'));
  const openAt = [...area.querySelectorAll('button')].find(b => b.textContent === '‘남부’ 행의 2022년 열 직접 대조');
  const picker = [...area.querySelectorAll('details')].find(d => d.firstElementChild?.textContent === '원표의 행과 연도 직접 선택');
  assert.ok(!picker.open);
  openAt.click();
  assert.ok(picker.open);
  assert.equal(doc.activeElement, picker.querySelectorAll('select')[1]);
  assert.match(picker.querySelector('[aria-live]').textContent, /남부.*2022년.*1,125.*머리글 3문단.*자료 4문단/);
  assert.ok(picker.textContent.includes(title)); assert.ok(picker.textContent.includes('(단위: 명)'));
  assert.equal(el('source-excerpt').value, ''); assert.equal(el('verdict').value, '');
  picker.querySelector('button').click();
  assert.equal(el('source-excerpt').value, line);
  assert.equal(el('source-locator').value, title + ' · ‘남부’ 행 · ‘2022년’ 열');
});

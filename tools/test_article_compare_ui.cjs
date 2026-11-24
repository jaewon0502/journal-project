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
  function select(id, name, content) {
    const field = el(id);
    Object.defineProperty(field,'files',{configurable:true, value:[{name, text:()=>Promise.resolve(content)}]});
    field.dispatchEvent(new w.Event('change'));
  }
  const load = (side, name, content) => select('file-' + side, name, content);
  function reviewers() {
    const radio = w.document.querySelector('[value=reviewers]');
    radio.click();
  }
  const settled = () => new Promise(resolve => setImmediate(resolve));
  return {w, el, load, select, reviewers, settled};
}

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

test('악화율 0% 옆에 원본에서 미평가 또는 해당 없음이었던 수정본의 중요한 왜곡을 보여 준다', async t => {
  const p = page(t);
  const source = {id:'doc', title:'시범 원표', url:'https://example.org/records', locator:'표 1', version:'1판', excerpt:'시범 노선 한 곳의 결과다.'};
  const file = workspace('모든 노선에서 대기 시간이 줄었다.\n시범 노선 하나에서 조사했다.');
  file.sources = [source];
  const report = engine.report(file.article, [source], []), [lead, body] = report.rows;
  const rating = level => ({level, rowId:lead.id, quote:lead.text, compareRowId:body.id, compareQuote:body.text,
    sourceId:'doc', sourceQuote:source.excerpt, reason:'조사 범위를 비교했다.', impact:'전체 노선에서 확인한 결과처럼 읽힌다.'});
  const saved = ratings => JSON.stringify({...file, articleAssessment:rubric.save(report, [source], {coreRowIds:[], ratings})});
  p.load('left','원본.json', saved({wording:rating(0), framing:{level:'na', reason:'도입을 분리해 평가하지 않았다.'}}));
  p.load('right','수정본.json', saved({wording:rating(0), framing:rating(3), omission:rating(2)}));
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
  assert.equal(record.version, 2);
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

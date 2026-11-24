const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const engine = require('../docs/reader/factcheck-engine.js');
const dir = path.join(__dirname, '../docs/reader');

function workspace(article) {
  return {format:'journal-local-factcheck-v1', article, articleDraft:article, sources:[], receipts:[], rowDrafts:[],
    demo:false, sourceDraft:{fields:{title:'', url:'', locator:'', excerpt:'', version:''}}};
}
function page(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(dir,'article-compare.html'),'utf8'), {url:'file:///reader/article-compare.html', runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  w.TextEncoder = TextEncoder;
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(fs.readFileSync(path.join(dir,script.getAttribute('src')), 'utf8'));
  const el = id => w.document.getElementById(id);
  function load(side, name, content) {
    const field = el('file-' + side);
    Object.defineProperty(field,'files',{configurable:true, value:[{name, text:()=>Promise.resolve(content)}]});
    field.dispatchEvent(new w.Event('change'));
  }
  function reviewers() {
    const radio = w.document.querySelector('[value=reviewers]');
    radio.click();
  }
  const settled = () => new Promise(resolve => setImmediate(resolve));
  return {el, load, reviewers, settled};
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
  assert.match(output, /새로 충돌로 판정된 기존 구절 · 0개/);
  p.reviewers(); p.el('compare').click(); output = p.el('output').textContent;
  assert.match(output, /판정 또는 확인 범위가 다른 구절 · 1개/);
  assert.match(output, /담긴 주장 미확인.*인용 속 사실 주장 충돌/);
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

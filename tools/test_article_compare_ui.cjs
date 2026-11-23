const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
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

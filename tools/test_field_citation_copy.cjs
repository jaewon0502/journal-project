const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const folder = path.join(__dirname, '../docs/reader');
const source = {title:'의회 예산표', url:'https://council.example/budget.pdf', version:'2025 결산판',
  locator:'표 2 · 청년수당 행', pdfPage:'9', excerpt:'작업 파일에서만 볼 발췌문이다.'};
const second = {title:'의회 회의록',url:'https://council.example/minutes',version:'확정',locator:'제2항',excerpt:'다른 원문'};
const encoded = 'Journal 근거 위치\nhttps://council.example/budget.pdf#page=9\n표 2 · 청년수당 행 · PDF 9쪽';

function page(t, query = '?field=1') {
  const dom = new JSDOM(readFileSync(path.join(folder, 'factcheck.html'), 'utf8'), {
    url:'https://journal.example/factcheck.html' + query, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const {window} = dom, {document} = window;
  window.TextEncoder = TextEncoder;
  window.confirm = () => true;
  for (const script of document.querySelectorAll('script[src]'))
    window.eval(readFileSync(path.join(folder,script.getAttribute('src')), 'utf8'));
  const id = name => document.getElementById(name);
  function input(name, value) {
    id(name).value = value;
    id(name).dispatchEvent(new window.Event('input', {bubbles:true}));
  }
  function draft(values) {
    for (const [key,value] of Object.entries(values)) input('source-' + key,value);
  }
  function add(values) {
    draft(values);
    id('source-form').requestSubmit();
    id('sources-panel').open = true;
    for (const part of id('source-list').children) part.open = true;
  }
  function copies() {
    return [...id('source-list').querySelectorAll('button')].filter(b => b.textContent === '현장 답안용 위치 복사');
  }
  function clipboard(value) {
    Object.defineProperty(window.navigator,'clipboard',{configurable:true,value});
  }
  input('article','의회는 예산안을 의결했다.');
  id('article-form').requestSubmit();
  return {window,document,id,input,draft,add,copies,clipboard};
}

test('현장 검토용 팩트체크에서 등록한 실제 자료의 주소와 위치만 사용자가 눌러 복사한다', async t => {
  const p = page(t), written = [];
  let reads = 0;
  p.clipboard({writeText:async value => written.push(value), readText:() => { reads++; }});
  p.draft(source);
  assert.equal(p.copies().length,0);
  p.add(source);
  p.draft({locator:'아직 등록하지 않은 위치'});
  assert.deepEqual(written,[]);
  p.copies()[0].click();
  await t.waitFor(() => assert.match(p.id('source-list').textContent,/복사했습니다/));
  assert.deepEqual(written,[encoded]);
  assert.equal(reads,0);
  assert.equal(p.id('source-list').querySelector('textarea'),null);
});

test('클립보드가 없거나 거절되면 같은 텍스트를 선택하고 자료나 작업이 바뀌면 이전 결과를 비운다', async t => {
  const p = page(t);
  p.add(source);
  p.add(second);
  const fallback = () => p.id('source-list').querySelector('textarea[readonly]');
  p.clipboard(undefined);
  p.copies()[0].click();
  assert.equal(fallback().value,encoded);
  assert.equal(p.document.activeElement,fallback());
  assert.equal(fallback().selectionStart,0);
  assert.equal(fallback().selectionEnd,encoded.length);
  p.id('source-list').children[1].querySelector('summary').click();
  assert.equal(fallback(),null);
  let reject;
  p.clipboard({writeText:() => new Promise((_,fail) => { reject = fail; })});
  p.copies()[0].click();
  p.clipboard({writeText:async () => { throw Error('denied'); }});
  p.copies()[1].click();
  await t.waitFor(() => assert.match(fallback()?.value || '',/제2항/u));
  reject(Error('permission denied'));
  await Promise.resolve();
  assert.equal(p.id('source-list').querySelectorAll('textarea').length,1);
  assert.equal(fallback().value,'Journal 근거 위치\nhttps://council.example/minutes\n제2항');
  p.input('article','다른 기사 초안');
  assert.equal(fallback(),null);
  assert.equal(p.id('workspace').hidden,true);
  p.copies()[0].click();
  assert.equal(fallback(),null);
});

test('일반·수동·통제 실험과 가상 원자료 작업에는 현장 복사 기능을 표시하지 않는다', t => {
  for (const query of ['', '?field=0', '?study=1', '?study=1&field=1', '?field=1&method=manual']) {
    const p = page(t,query);
    p.add(source);
    assert.equal(p.copies().length,0,query);
  }
  const p = page(t);
  p.add(source);
  assert.equal(p.copies().length,1);
  p.add({...second,url:'https://example.invalid/mock'});
  assert.equal(p.copies().length,0);
  p.id('load-demo').click();
  assert.equal(p.copies().length,0);
});

test('작업 파일의 미확정 기사에서는 복사할 수 없고 원문을 확정한 뒤 등록 자료만 복사할 수 있다', async t => {
  const p = page(t);
  p.add(source);
  p.clipboard(undefined);
  p.copies()[0].click();
  assert.ok(p.id('source-list').querySelector('textarea[readonly]'));
  const workspace = p.window.JournalWorkspaceSnapshot;
  const work = {format:workspace.schema, article:'', articleDraft:'불러온 미확정 기사', sources:[{id:'one',...second}],demo:false,
    receipts:[],rowDrafts:[],sourceDraft:{id:null,fields:Object.fromEntries(workspace.sourceFields.map(k => [k,'']))}};
  const input = p.id('import-file');
  Object.defineProperty(input,'files',{value:[new p.window.File([JSON.stringify(work)],'draft.json')]});
  input.dispatchEvent(new p.window.Event('change'));
  await t.waitFor(() => assert.match(p.id('file-status').textContent,/작업 파일을 열었습니다/u));
  assert.equal(p.copies().length,0);
  assert.equal(p.id('source-list').querySelector('textarea[readonly]'),null);
  p.id('article-form').requestSubmit();
  p.copies()[0].click();
  assert.equal(p.id('source-list').querySelector('textarea[readonly]').value,'Journal 근거 위치\nhttps://council.example/minutes\n제2항');
});

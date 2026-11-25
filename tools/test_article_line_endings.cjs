const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const engine = require('../docs/reader/factcheck-engine.js');
const workspace = require('../docs/reader/workspace-snapshot.js');

const reader = file => fs.readFileSync(path.join(__dirname, '../docs/reader', file), 'utf8');
const original = '의회의 결정이다.\r\n\t제도가 불공정하다.\r\n\r끝 문장이다.  ';
const visible = original.replace(/\r\n?/g, '\n');
const tag = {pairId:'1'.repeat(32), slot:'B'};
const row = engine.prepare(original).rows[1];
const receipt = engine.decide(row, {status:'opinion', sourceIds:[], reason:'문장에서 제도를 평가하고 있다.', acknowledged:true}, []);
function file(articleDraft = original) {
  return {format:workspace.schema, article:original, articleDraft, sources:[], receipts:[receipt],
    demo:false, rowDrafts:[], blindReview:tag, currentId:row.id,
    sourceDraft:{id:null,fields:Object.fromEntries(workspace.sourceFields.map(key=>[key,'']))}};
}

async function open(t, work) {
  const {window:w} = new JSDOM(reader('factcheck.html'), {url:'https://local.example/factcheck.html',runScripts:'outside-only'});
  t.after(()=>w.close());
  const el = id => w.document.getElementById(id);
  w.TextEncoder = TextEncoder;
  w.confirm = () => true;
  const downloads = [];
  w.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:download'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(reader(script.getAttribute('src')));
  const input = el('import-file');
  Object.defineProperty(input,'files',{value:[{text:async()=>JSON.stringify(work)}]});
  input.dispatchEvent(new w.Event('change'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(el('file-status').textContent,/작업 파일을 열었습니다/);
  const edit = text => {
    el('article').value = text;
    el('article').dispatchEvent(new w.Event('input',{bubbles:true}));
  };
  const save = async id => {
    const count = downloads.length;
    el(id).click();
    return count === downloads.length ? null : JSON.parse(await downloads.at(-1).text());
  };
  return {el, edit, save, submit:()=>el('article-form').requestSubmit()};
}

test('혼합 줄바꿈 기사와 문장 판정은 저장·독립 평가 전달·재확정·재열기 뒤에도 최초 판본과 같다', async t => {
  let p = await open(t,file());
  assert.equal(p.el('article').value,visible);
  const work = await p.save('save-work');
  assert.equal(work.articleDraft,original);
  assert.equal(work.article,original);
  assert.deepEqual(work.receipts,[receipt]);
  assert.deepEqual(work.blindReview,tag);
  assert.doesNotMatch(p.el('blind-notice').textContent,/수정 중/);
  const packet = await p.save('save-review-input');
  assert.equal(packet.article,original);
  assert.equal(packet.articleDraft,original);
  assert.deepEqual(packet.receipts,[]);
  assert.equal(workspace.read(packet).rows[1].articleBinding,receipt.articleBinding);
  assert.equal(workspace.read(work).rows[1].receipt.articleBinding,receipt.articleBinding);
  p = await open(t,work);
  p.edit(visible + 'x');
  assert.equal(p.el('workspace').hidden,true);
  assert.equal(await p.save('save-review-input'),null);
  p.edit(visible);
  assert.equal(p.el('workspace').hidden,false);
  p.submit();
  const reopened = await p.save('save-work');
  assert.equal(reopened.article,original);
  assert.equal(reopened.articleDraft,original);
  assert.deepEqual(reopened.receipts,[receipt]);
  assert.deepEqual(reopened.blindReview,tag);
});

test('가져온 미확정 초안은 원래 줄바꿈으로 보존하며 본문 변경은 독립 내보내기를 막는다', async t => {
  for (const changed of [original.replace('끝 문장','바뀐 문장'), visible]) {
    const p = await open(t,file(changed));
    assert.equal(p.el('workspace').hidden,true);
    assert.equal(await p.save('save-review-input'),null);
    const draft = await p.save('save-work');
    assert.equal(draft.article,original);
    assert.equal(draft.articleDraft,changed);
    p.submit();
    const saved = await p.save('save-work');
    assert.equal(saved.article,changed);
    assert.equal(saved.articleDraft,changed);
    assert.deepEqual(saved.receipts,[]);
    assert.equal(saved.blindReview,undefined);
  }
});

test('검토 목록을 만든 적 없는 초안은 다시 저장해도 독립 평가용 원문으로 승격되지 않는다', async t => {
  const draft = {...file(), article:'', receipts:[]};
  delete draft.blindReview;
  const p = await open(t,draft);
  assert.equal(p.el('workspace').hidden,true);
  assert.equal(await p.save('save-review-input'),null);
  const saved = await p.save('save-work');
  assert.equal(saved.article,'');
  assert.equal(saved.articleDraft,original);
  p.submit();
  assert.equal((await p.save('save-review-input')).article,original);
});

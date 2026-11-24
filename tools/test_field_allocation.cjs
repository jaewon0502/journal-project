const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const reader = path.resolve(__dirname, '../docs/reader');
const fixture = require('../experiments/labour-field-review/blind-tasks.json');

function open(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(reader, 'field-allocation.html'), 'utf8'),
    {url:'https://journal.example/field-allocation.html', runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document, el = id => doc.getElementById(id);
  // This DOM supplies file objects directly; native picker validation runs in the packaged browser check.
  el('allocation-form').noValidate = true;
  w.TextEncoder = TextEncoder;
  Object.defineProperty(w, 'crypto', {value:webcrypto});
  let contents;
  w.URL.createObjectURL = blob => { contents = blob; return 'blob:local'; };
  w.URL.revokeObjectURL = () => {};
  doc.addEventListener('click', e => { if (e.target.closest('a[download]')) e.preventDefault(); });
  for (const s of doc.querySelectorAll('script[src]')) w.eval(fs.readFileSync(path.join(reader,s.getAttribute('src')), 'utf8'));
  const load = async (id, value) => {
    const file = {name:'test.json', text:async () => JSON.stringify(value)};
    Object.defineProperty(el(id), 'files', {value:[file], configurable:true});
    await el(id).onchange();
  };
  const save = async () => {
    el('download').click();
    return JSON.parse(await contents.text());
  };
  return {el, load, save, w};
}

test('모집 순서를 유지해 묶음별로 두 방식을 고루 배정하고, 저장한 원본으로 개인 코드를 다시 전달한다', async t => {
  const p = open(t);
  await p.load('case-file', fixture);
  const codes = Array.from({length:14}, (_,i) => 'E' + (i+1));
  p.el('participant-codes').value = codes.join('\n');
  p.el('allocation-form').requestSubmit();
  assert.equal(p.el('allocations').rows.length,14);
  assert.match(p.el('block-count').textContent,/2개.*2\/6명/);
  const roster = await p.save();
  assert.deepEqual(roster.assignments.map(v=>v.participant),codes);
  const expect = fixture.tasks.flatMap(t=>['manual','journal'].map(m=>t.id+'/'+m)).sort();
  for (const i of [0,6]) assert.deepEqual(roster.assignments.slice(i,i+6).map(v=>v.taskId+'/'+v.method).sort(),expect);
  for (const a of roster.assignments) {
    assert.equal(a.prompt,fixture.tasks.find(x=>x.id===a.taskId).prompt);
    assert.equal(a.articleUrl,fixture.articleUrl);
    assert.deepEqual(Object.keys(a).sort(),['articleUrl','caseId','method','participant','prompt','taskId']);
  }
  const restore = open(t);
  await restore.load('roster-file',roster);
  assert.equal(restore.el('allocations').rows.length,14);
  const cell = restore.el('allocations').rows[0].cells[4];
  await cell.querySelector('button').onclick();
  assert.equal(cell.querySelector('input').value, await restore.w.JournalFieldInvite.encode(roster.assignments[0]));
  assert.deepEqual(await restore.save(),roster);
});

test('같은 익명 코드를 두 번 적거나 배정표 대신 과제 파일을 다시 열면 새 배정이 생기지 않는다',async t=>{
  const p=open(t);
  await p.load('case-file',fixture);
  p.el('participant-codes').value='E1\n E1 ';
  p.el('allocation-form').requestSubmit();
  assert.match(p.el('status').textContent,/중복/);
  assert.equal(p.el('allocations').rows.length,0);
  await p.load('roster-file',fixture);
  assert.match(p.el('status').textContent,/배정표 JSON을 확인/);
  assert.equal(p.el('allocations').rows.length,0);
});

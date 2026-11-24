const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const kit = require('../experiments/labour-field-review/blind-tasks.json');

const key = 'journal-natural-trial-v1';
function tab(t, initial) {
  const read = name => readFileSync(path.join(__dirname,'../docs/reader',name),'utf8');
  const {window:w} = new JSDOM(read('field-review.html'),{url:'https://journal.test/',runScripts:'outside-only'});
  t.after(() => w.close());
  let now = 0;
  Object.defineProperty(w.performance,'now',{value:() => now});
  w.confirm = () => true;
  if (initial) w.localStorage.setItem(key,initial);
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(read(script.getAttribute('src')));
  return {w,el:id => w.document.getElementById(id),time:ms => {now = ms;},
    saved:() => w.localStorage.getItem(key)};
}
async function start(t) {
  const a = tab(t);
  await a.el('case-file').onchange({target:{files:[{text:async () => JSON.stringify(kit)}]}});
  a.el('participant').value = 'E01';
  a.el('participant').oninput();
  a.el('start').click();
  return a;
}
function answer(p) {
  for (const [id,value] of Object.entries({found:'missing',verdict:'insufficient',reason:'자료 위치 확인 보류',journalUse:'no'}))
    p.el(id).value = value;
}

test('휴식 기록을 이어 연 탭의 15초를 오래된 탭이 누락한 채 같은 ID로 제출하지 못한다', async t => {
  const a = await start(t);
  a.time(5000); a.el('pause').click();
  const original = a.saved();
  const b = tab(t,original);
  b.time(10000); b.el('pause').click();
  b.time(25000); b.el('pause').click();
  const newer = b.saved();
  a.w.localStorage.setItem(key,newer);
  a.w.dispatchEvent(new a.w.StorageEvent('storage',{key,storageArea:a.w.localStorage,oldValue:original,newValue:newer}));
  assert.match(a.el('storage-status').textContent,/이 탭의 측정을 중지/);
  for (const id of ['pause','submit','withdraw','answer']) assert.equal(a.el(id).disabled,true,id);
  a.time(40000); a.el('pause').click(); a.time(41000); a.el('withdraw').click();
  assert.equal(a.el('ended').hidden,true);
  assert.equal(a.saved(),newer);
  b.time(60000); b.el('pause').click(); b.time(61000); answer(b); b.el('submit').click();
  const result = JSON.parse(b.saved()).result;
  assert.equal(result.id,JSON.parse(original).base.id);
  assert.equal(result.recovered,false);
  assert.equal(result.phaseMs.search,21000);
});

test('저장 변경 알림보다 제출·중도 종료가 먼저여도 오래된 진행 기록을 확정하지 않는다', async t => {
  for (const action of ['submit','withdraw']) {
    const a = await start(t), b = tab(t,a.saved());
    b.time(1000); b.el('pause').click();
    const newDraft = b.saved();
    a.w.localStorage.setItem(key,newDraft);
    a.time(31000); answer(a); a.el(action).click();
    assert.equal(a.el('ended').hidden,true);
    assert.equal(a.saved(),newDraft);
    assert.equal(a.el('pause').disabled,true);
  }
});

test('다른 탭에서 다운로드 후 새 과제를 열어도 늦게 전달된 같은 참여 기록의 변경을 확인한다', async t => {
  const a = await start(t);
  a.time(5000); a.el('pause').click();
  const original = a.saved(), b = tab(t,original);
  b.time(12000); b.el('pause').click();
  b.time(22000); answer(b); b.el('submit').click();
  const completed = b.saved();
  b.el('next').click();
  assert.equal(b.saved(),null);
  a.w.localStorage.removeItem(key);
  a.w.dispatchEvent(new a.w.StorageEvent('storage',{key,storageArea:a.w.localStorage,oldValue:original,newValue:completed}));
  assert.equal(a.el('pause').disabled,true);
  assert.equal(a.el('withdraw').disabled,true);
  assert.equal(a.el('ended').hidden,true);
});

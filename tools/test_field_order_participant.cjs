const {test} = require('node:test');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const order = require('../docs/reader/field-order.js');

const read = file => fs.readFileSync(path.join(__dirname, '../docs/reader', file), 'utf8');
const key = 'journal-natural-trial-v1';
const kit = 'a'.repeat(64);
const first = {
  format:'journal-field-trial-v1', id:'first-trial', participant:'editor-01', kind:'editor',
  caseId:'case-one', taskId:'check-one', prompt:'먼저 검토한 비공개 질문', method:'manual',
  articleUrl:'https://example.org/first?year=1', status:'completed', recovered:false, split:true,
  kitVersion:'b'.repeat(64), phaseMs:{search:100,locate:100,decide:100},
  found:'found', documentUrl:'https://example.org/private-evidence', locator:'비공개 위치',
  verdict:'supported', journalUse:'no', reason:'첫 과제에만 속하는 비공개 판단 이유'
};
const second = {
  caseId:'case-two', articleUrl:'https://example.org/second', title:'둘째 과제 묶음',
  tasks:[{id:'check-two',prompt:'둘째 과제'}, {id:'check-another',prompt:'다른 과제'}]
};
function page(t, {stored, version = kit} = {}) {
  const {window:w} = new JSDOM(read('field-review.html'), {runScripts:'outside-only', url:'https://local.example/field-review.html'});
  t.after(() => w.close());
  Object.defineProperty(w, 'crypto', {value:webcrypto});
  w.TextEncoder = TextEncoder;
  w.confirm = () => true;
  if (version) {
    const meta = w.document.createElement('meta');
    meta.name = 'journal-field-kit'; meta.content = version; w.document.head.append(meta);
  }
  if (stored) w.localStorage.setItem(key, JSON.stringify(stored));
  for (const name of ['field-review-core.js','field-order.js','field-review.js']) w.eval(read(name));
  const el = id => w.document.getElementById(id);
  function set(id, value) {
    el(id).value = value;
    el(id).dispatchEvent(new w.Event(id === 'participant' ? 'input' : 'change', {bubbles:true}));
  }
  function upload(id, data, contents = () => Promise.resolve(JSON.stringify(data))) {
    const target = el(id);
    Object.defineProperty(target, 'files', {configurable:true,value:[{text:contents}]});
    return target.onchange({target});
  }
  async function prepare(pack = second) {
    await upload('case-file', pack);
    set('participant', first.participant); set('method','journal'); set('kind','editor');
  }
  function finish() {
    for (const [id,value] of Object.entries({found:'found',documentUrl:'https://example.org/local',
        locator:'6쪽',verdict:'supported',reason:'둘째 과제의 이유',journalUse:'yes'})) el(id).value = value;
    el('submit').click();
  }
  const saved = () => JSON.parse(w.localStorage.getItem(key));
  return {w, el, set, upload, prepare, finish, saved};
}
test('두 번째 측정 시작 전에만 첫 완료 파일을 연결하고 첫 응답 내용은 화면과 저장본에서 제외한다', async t => {
  const p = page(t); await p.prepare();
  const expected = await order.receipt(first);
  assert.equal(p.el('previous-completion').hidden,false);
  await p.upload('previous-file',first);
  assert.match(p.el('previous-status').textContent,/참여 코드와 첫 과제 파일을 확인/);
  assert.equal(p.saved(), null);
  assert.ok(!p.w.document.body.textContent.includes(first.reason));
  p.el('start').click();
  assert.deepEqual(p.saved().base.previousCompletion,expected);
  assert.equal(p.el('previous-file').disabled,true);
  assert.ok(!JSON.stringify(p.saved()).includes(first.documentUrl));
  await p.upload('previous-file',{...first,id:'later'});
  p.el('clear-previous').onclick();
  p.finish();
  assert.match(p.el('end-summary').textContent,/첫 과제 완료 기록 연결 포함/);
  const result = p.saved().result;
  assert.deepEqual(result.previousCompletion,expected);
  assert.ok(!JSON.stringify(result).includes(first.reason));
  p.el('next').click();
  await p.prepare(); p.el('start').click(); p.finish();
  assert.ok(!Object.hasOwn(p.saved().result,'previousCompletion'));
});
test('과제·코드·방식·참여 구분을 바꾸거나 첫 파일을 취소하면 시작 시 연결을 남기지 않는다', async t => {
  for (const [id,v] of [['task','check-another'], ['participant','editor-02'], ['method','manual'], ['kind','practice']]) {
    const p = page(t); await p.prepare(); await p.upload('previous-file',first);
    p.set(id,v); p.el('start').click(); assert.ok(!Object.hasOwn(p.saved().base,'previousCompletion'));
  }
  const p=page(t);await p.prepare();await p.upload('previous-file', first);
  p.el('clear-previous').click();p.el('start').click();assert.ok(!Object.hasOwn(p.saved().base,'previousCompletion'));
});
test('다른 참여자·같은 기사·같은 방식·중도 종료·판본 누락을 거부하고 새 과제의 독립 참여는 허용한다', async t => {
  const p=page(t); await p.prepare();
  for (const edit of [{participant:'other'}, {caseId:second.caseId},
    {articleUrl:second.articleUrl+'?utm_campaign=1#local'}, {method:'journal',journalUse:'yes'},
    {status:'withdrawn'}, {kitVersion:null}, {kind:'practice'}, {journalUse:'yes'}, {synthetic:true}]) {
    await p.upload('previous-file',{...first,...edit});
    assert.match(p.el('previous-status').textContent,/연결하지 못했습니다/);
    assert.equal(p.el('start').disabled,false);
  }
  p.el('start').click(); assert.ok(!Object.hasOwn(p.saved().base,'previousCompletion'));
  const u=page(t,{version:null});await u.prepare();assert.equal(u.el('previous-completion').hidden,true);
  await u.upload('previous-file',first); u.el('start').click();assert.ok(!Object.hasOwn(u.saved().base,'previousCompletion'));
});
test('느린 첫 파일 읽기가 끝나도 다른 설정·선택·새 측정을 덮어쓰지 않는다', async t => {
  const p=page(t);await p.prepare();
  let deliver;
  const delayed = () => p.upload('previous-file',null,()=>new Promise(resolve=>{deliver=resolve;}));
  const stale=delayed();
  assert.equal(p.el('start').disabled,true); p.el('start').onclick(); assert.equal(p.saved(),null);
  p.set('participant','editor-02');p.set('participant',first.participant);
  const replacement={...first,id:'second-selection'}; await p.upload('previous-file',replacement);
  deliver(JSON.stringify(first)); await stale;
  p.el('start').click();assert.deepEqual(p.saved().base.previousCompletion,await order.receipt(replacement));

  const n=page(t); await n.prepare();const waiting=n.upload('previous-file',null,()=>new Promise(resolve=>{deliver=resolve;}));
  n.el('clear-previous').click(); n.el('start').click();deliver(JSON.stringify(first));await waiting;
  assert.ok(!Object.hasOwn(n.saved().base,'previousCompletion'));
});
test('일시정지 복원은 시작 때의 연결을 유지하고, 다른 탭이 새 기록을 만든 경우 이전 선택을 해제한다', async t => {
  const p=page(t); await p.prepare(); await p.upload('previous-file',first);p.el('start').click();p.el('pause').click();
  const stored=p.saved(), expected=await order.receipt(first);
  const r=page(t,{stored}); assert.equal(r.el('previous-file').disabled,true);
  await r.upload('previous-file',{...first,id:'late-on-reopen'}); r.el('pause').click();r.finish();
  assert.deepEqual(r.saved().result.previousCompletion,expected);

  const n=page(t);await n.prepare();await n.upload('previous-file',first);
  n.w.localStorage.setItem(key,JSON.stringify(stored));
  n.w.dispatchEvent(new n.w.StorageEvent('storage',{key,newValue:JSON.stringify(stored),storageArea:n.w.localStorage}));
  assert.equal(n.el('previous-completion').hidden,true);
  n.el('start').click();assert.equal(n.el('storage-status').hidden,false);
  assert.equal(n.saved().base.id,stored.base.id);
});

test('첫 파일만 연결하고 떠난 준비 화면은 연결을 보관하지 않고 중도 종료한 둘째 과제는 다음 첫 기록으로 쓸 수 없다', async t => {
  const p=page(t); await p.prepare(); await p.upload('previous-file',first);
  p.w.dispatchEvent(new p.w.Event('pagehide'));p.w.dispatchEvent(new p.w.Event('pageshow'));
  assert.equal(p.saved(),null);p.el('start').click(); assert.ok(!Object.hasOwn(p.saved().base,'previousCompletion'));
  const n=page(t);await n.prepare();await n.upload('previous-file',first);n.el('start').click();n.el('withdraw').click();
  assert.equal(n.saved().result.status,'withdrawn');
  assert.deepEqual(n.saved().result.previousCompletion,await order.receipt(first));
  await assert.rejects(order.receipt(n.saved().result));
});

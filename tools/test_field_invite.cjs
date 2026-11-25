const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const invite = require('../docs/reader/field-invite.js');
const read = name => fs.readFileSync(path.join(__dirname, '../docs/reader', name), 'utf8');
const pack = require('../experiments/labour-field-review/blind-tasks.json');
const row = {participant:'E.편집-1', caseId:pack.caseId, articleUrl:pack.articleUrl, taskId:pack.tasks[1].id,
  prompt:pack.tasks[1].prompt, method:'journal'};
const firstKit = 'ab'.repeat(32), secondKit = 'cd'.repeat(32);

test('한 명에게 주는 코드는 정확한 기사·과제·문장·방식과 연결되며 기사와 문항 원문을 담지 않는다', async () => {
  const code = await invite.encode(row);
  assert.equal(code, await invite.encode({...row, display:'화면용 메모'}));
  const [,id,digest] = code.split('.');
  assert.equal(JSON.parse(Buffer.from(id, 'base64url').toString('utf8')), row.participant);
  assert.match(digest, /^[0-9a-f]{24}$/);
  assert.deepEqual(await invite.match(code, pack, ['manual','journal']), row);
  await assert.rejects(invite.match(code, pack, ['manual']), /일치하지/);
  for (const change of [{caseId:'다른 사례'}, {articleUrl:pack.articleUrl+'#changed'},
    {tasks:pack.tasks.map(t => ({...t, prompt:t.prompt+' 새 판본'}))},
    {tasks:pack.tasks.map(t => ({...t, id:t.id+'-changed'}))}]) {
    await assert.rejects(invite.match(code, {...pack,...change}, ['journal']), /일치하지/);
  }
  const other = await invite.encode({...row, participant:'다른-편집자'});
  await assert.rejects(invite.match('F1.' + other.split('.')[1] + '.' + digest, pack, ['journal']), /일치하지/);
  await assert.rejects(invite.match('F1._.' + digest, pack, ['journal']), /코드/);
  await assert.rejects(invite.encode({...row, participant:' '}), /배정표/);
});

test('F1은 기존 배정 코드 그대로이고 F2는 배포본 판본까지 대조한다', async () => {
  const old = {participant:'A', caseId:'C', articleUrl:'https://example.org/read', taskId:'T', prompt:'질문', method:'manual'};
  const oldPack = {caseId:old.caseId, articleUrl:old.articleUrl, tasks:[{id:old.taskId, prompt:old.prompt}]};
  const oldCode = 'F1.IkEi.c34ff37d6b4843890b78ca55';
  assert.equal(await invite.encode(old), oldCode);
  for (const kit of [undefined, firstKit, secondKit]) assert.deepEqual(await invite.match(oldCode, oldPack, ['manual'], kit), old);
  const bound = await invite.encode({...row, assignedKitVersion:firstKit});
  assert.match(bound, /^F2\.[A-Za-z0-9_-]+\.[a-f0-9]{24}$/u);
  assert.ok(!bound.includes(firstKit) && !bound.includes(row.prompt));
  assert.notEqual(bound, await invite.encode({...row, assignedKitVersion:secondKit}));
  assert.deepEqual(await invite.match(bound, pack, ['journal'], firstKit), row);
  await assert.rejects(invite.match(bound, pack, ['manual'], firstKit), /배포본 판본이 일치하지/);
  await assert.rejects(invite.match(bound, {...pack,tasks:pack.tasks.map(t => ({...t, prompt:t.prompt + ' 변경'}))}, ['journal'], firstKit), /일치하지/);
  await assert.rejects(invite.match(bound, pack, ['journal'], secondKit), /ZIP을 확인/);
  await assert.rejects(invite.match(bound.replace('F2.', 'F1.'), pack, ['journal']), /일치하지/);
  for (const invalid of [undefined, null, '', firstKit.toUpperCase(), firstKit + '\n', 'ab']) {
    await assert.rejects(invite.encode({...row, assignedKitVersion:invalid}), /배정표의 배포본 판본/);
    await assert.rejects(invite.match(bound, pack, ['journal'], invalid), /진행자가 코드와 함께 보낸 ZIP/);
  }
});

function page(t, fixed, version) {
  const w = new JSDOM(read('field-review.html'), {url:'https://local.test/field-review.html',runScripts:'outside-only'}).window;
  t.after(() => w.close());
  const el = id => w.document.getElementById(id);
  if (fixed) {
    el('case-file').dataset.caseId = pack.caseId;
    el('method').replaceChildren(new w.Option(fixed, fixed));
    el('method').disabled = true;
    const data = w.document.createElement('script'); data.id = 'assigned-tasks';
    data.type = 'application/json'; data.textContent = JSON.stringify(pack); w.document.head.append(data);
  }
  if (version) {
    const meta = w.document.createElement('meta');
    meta.name = 'journal-field-kit'; meta.content = version; w.document.head.append(meta);
  }
  w.confirm = () => true;
  Object.defineProperty(w, 'crypto', {value:globalThis.crypto});
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  for (const name of ['field-review-core.js','field-invite.js','field-review.js']) w.eval(read(name));
  function type(id, value) {
    el(id).value = value; el(id).dispatchEvent(new w.Event('input', {bubbles:true}));
  }
  async function load(data) {
    const file = {text:async () => JSON.stringify(data)};
    await el('case-file').onchange({target:{files:[file]}});
  }
  return {w,el,type,load};
}

test('참여자 배포본에서 코드 확인은 과제만 고정한다. 실제 시작과 현업 구분은 참여자가 정한다', async t => {
  const p = page(t,'journal');
  p.type('invite-code', await invite.encode(row));
  await p.el('apply-invite').onclick();
  assert.equal(p.el('participant').value, row.participant);
  assert.equal(p.el('task').value, row.taskId);
  for (const id of ['participant','method','task']) assert.equal(p.el(id).disabled, true);
  assert.equal(p.el('kind').value,'practice'); assert.equal(p.el('kind').disabled,false);
  assert.equal(p.el('work').hidden,true); assert.equal(p.el('question').textContent,'');
  assert.equal(p.el('article-link').children.length,0); assert.equal(p.w.localStorage.length,0);
  p.el('start').click();
  const record=JSON.parse(p.w.localStorage.getItem(p.w.localStorage.key(0))).base;
  for (const [field, value] of Object.entries(row)) assert.equal(record[field],value);
  assert.equal(record.kind,'practice'); assert.equal(p.el('question').textContent,row.prompt);
  p.el('withdraw').click(); p.el('next').click();
  assert.equal(p.el('invite-code').value,''); assert.equal(p.el('participant').value,'');
  assert.equal(p.el('question').textContent,''); assert.equal(p.el('article-link').children.length,0);
  assert.equal(p.el('task').disabled,false); assert.equal(p.el('method').disabled,true);
  assert.equal(p.el('start').disabled,true);
});

test('F2는 시작 전에 실제 배포본을 확인하고, 시작 기록에는 실제 판본만 저장한다', async t => {
  const code = await invite.encode({...row, assignedKitVersion:firstKit});
  for (const version of [secondKit, undefined, firstKit.toUpperCase(), firstKit]) {
    const p = page(t,'journal',version);
    p.type('invite-code',code);
    await p.el('apply-invite').onclick();
    assert.equal(p.el('question').textContent,'');
    assert.equal(p.w.localStorage.length,0);
    if (version !== firstKit) {
      assert.match(p.el('invite-status').textContent,/진행자가 코드와 함께 보낸 ZIP/);
      assert.equal(p.el('start').disabled,true);
      p.el('start').onclick();
      assert.equal(p.el('work').hidden,true);
      assert.equal(p.el('participant').value,'');
      assert.equal(p.w.localStorage.length,0);
    } else {
      assert.equal(p.el('start').disabled,false);
      p.el('start').click();
      const base = JSON.parse(p.w.localStorage.getItem(p.w.localStorage.key(0))).base;
      assert.equal(base.kitVersion,firstKit);
      assert.equal(Object.hasOwn(base,'assignedKitVersion'),false);
      assert.equal(p.el('question').textContent,row.prompt);
    }
  }
});

test('맞지 않는 배포본과 다른 문장을 거절하고 번호 직접 입력을 선택해야 수동으로 시작할 수 있다', async t => {
  const p = page(t,'manual'), code = await invite.encode(row);
  p.type('invite-code',code); await p.el('apply-invite').onclick();
  assert.match(p.el('invite-status').textContent,/일치하지/); assert.equal(p.el('start').disabled,true);
  p.type('invite-code',''); assert.equal(p.el('participant').disabled,true);
  p.el('manual-entry').click(); p.type('participant','직접입력'); p.el('task').value = row.taskId;
  p.el('task').dispatchEvent(new p.w.Event('change')); assert.equal(p.el('start').disabled,false);

  const q = page(t); q.type('invite-code',code); assert.equal(q.el('apply-invite').disabled,true);
  await q.load(pack); await q.el('apply-invite').onclick(); assert.equal(q.el('method').value,'journal');
  await q.load({...pack,tasks:pack.tasks.map(t=>({...t,prompt:t.prompt+' 변경'}))});
  assert.equal(q.el('participant').value,''); assert.equal(q.el('start').disabled,true);
  await q.el('apply-invite').onclick(); assert.match(q.el('invite-status').textContent,/일치하지/);
});

test('늦게 끝난 배정 확인이 새 코드나 새 과제 파일, 직접 입력 선택을 덮지 않는다', async t => {
  for (const change of ['code','case','manual']) {
    const p = page(t,'journal');
    let finish;
    p.w.JournalFieldInvite.match = () => new Promise(resolve => {finish=resolve;});
    p.type('invite-code', await invite.encode(row));
    const pending=p.el('apply-invite').onclick();
    if(change==='code') p.type('invite-code','F1.other');
    if(change==='case') await p.load(pack);
    if(change==='manual') p.el('manual-entry').click();
    finish(row); await pending;
    assert.equal(p.el('participant').value,''); assert.equal(p.el('start').disabled,true);
    assert.equal(p.el('participant').disabled,change!=='manual');
  }
});

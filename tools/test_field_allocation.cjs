const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const reader = path.resolve(__dirname, '../docs/reader');
const fixture = require('../experiments/labour-field-review/blind-tasks.json');

function open(t, catalog) {
  const dom = new JSDOM(fs.readFileSync(path.join(reader, 'field-allocation.html'), 'utf8'),
    {url:'https://journal.example/field-allocation.html', runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document, el = id => doc.getElementById(id);
  if (catalog) {
    const script = doc.createElement('script');
    script.type = 'application/json';
    script.id = 'allocation-catalog';
    script.textContent = JSON.stringify(catalog);
    doc.body.append(script);
  }
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

test('내장 기사로 배정하고 기사·과제·방식이 일치하는 행에서만 참여 ZIP을 받는다', async t => {
  const budget = require('../experiments/cross-party-review/blind-tasks.json');
  const catalog = [budget, fixture].map((material,i) => ({
    material, label: ['예비비','고용'][i], kitVersion:String(i).repeat(64),
    files:{manual:'packet'+i+'-manual.zip', journal:'packet'+i+'-journal.zip'}
  }));
  const p = open(t, catalog);
  assert.equal(p.el('bundled-picker').hidden,false);
  const choose = i => { p.el('bundled-case').value = i; p.el('bundled-case').onchange(); };
  choose('0'); assert.equal(p.el('target-inputs').children.length,2);
  choose('1'); assert.equal(p.el('target-inputs').children.length,3);
  assert.equal(p.el('case-file').required,false);
  p.el('allocation-form').noValidate = false;
  p.el('participant-codes').value = 'A\nB\nC\nD\nE\nF';
  p.el('allocation-form').requestSubmit();
  const roster = await p.save();
  const links = pane => [...pane.el('allocations').rows].map(row=>row.cells[3].querySelector('a'));
  assert.ok(roster.assignments.every(r=>r.assignedKitVersion === catalog[1].kitVersion));
  assert.deepEqual(links(p).map(a=>a.getAttribute('href')),roster.assignments.map(r=>catalog[1].files[r.method]));
  for (const a of links(p)) assert.ok(a.hasAttribute('download'));
  const old = structuredClone(roster);
  old.assignments[0].prompt += ' (이전 과제)';
  old.assignments[1].articleUrl += '?edition=2';
  const restored = open(t, catalog);
  await restored.load('roster-file',old);
  assert.deepEqual(links(restored).map(a=>a?.getAttribute('href') ?? null),
    old.assignments.map((r,i)=>i<2 ? null : catalog[1].files[r.method]));
  const loose = open(t);
  await loose.load('roster-file',roster);
  assert.ok(loose.el('bundled-picker').hidden);
  assert.ok(links(loose).every(a=>!a));
  const otherEdition = open(t,catalog.map(entry=>({...entry,kitVersion:'f'.repeat(64)})));
  await otherEdition.load('roster-file',roster);
  assert.ok(links(otherEdition).every(a=>!a));
  assert.match(otherEdition.el('allocations').textContent,/예정 배포본 111111111111에서 ZIP/);
  const custom = open(t,catalog);
  await custom.load('case-file',fixture);
  custom.el('participant-codes').value = 'E1';
  custom.el('allocation-form').requestSubmit();
  assert.equal(Object.hasOwn((await custom.save()).assignments[0],'assignedKitVersion'),false);
});

test('과제 파일을 읽는 중 내장 기사를 선택하면 늦게 온 파일이 배정을 바꾸지 않는다', async t => {
  const budget = require('../experiments/cross-party-review/blind-tasks.json');
  const p = open(t,[{material:budget,label:'예비비',files:{manual:'m.zip',journal:'j.zip'}}]);
  const wait = Promise.withResolvers();
  Object.defineProperty(p.el('case-file'),'files',{value:[{text:()=>wait.promise}],configurable:true});
  const reading = p.el('case-file').onchange();
  p.el('bundled-case').value = '0'; p.el('bundled-case').onchange();
  wait.resolve(JSON.stringify(fixture)); await reading;
  assert.ok(p.el('case-note').textContent.includes(budget.title));
  assert.equal(p.el('target-inputs').children.length,2);
  await p.load('case-file',fixture);
  assert.equal(p.el('bundled-case').value,'');
  assert.equal(p.el('case-file').required,true);
  assert.equal(p.el('target-inputs').children.length,3);
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const key = require('../experiments/labour-field-review/coordinator-key.json');
const task = key.tasks.find(t => t.id === 'labour-rate');
const reader = file => fs.readFileSync(path.join(__dirname, '../docs/reader', file), 'utf8');

function trial(number, method, ms, extra = {}) {
  return {format:'journal-field-trial-v1', id:'private-id-' + number, participant:'PRIVATE-PERSON-' + number,
    caseId:key.caseId, articleUrl:key.articleUrl, taskId:task.id, prompt:task.prompt,
    kind:'editor', method, kitVersion:'e'.repeat(64), status:'completed', recovered:false, split:true,
    phaseMs:{search:ms,locate:0,decide:0}, found:'found', documentUrl:task.reference.documentUrl,
    locator:'표의 위치 ' + number, verdict:task.verdict, reason:'15세 이상 인구, 62.6%에서 62.7%로 상승.', ...extra};
}

function page(t, previous) {
  const {window} = new JSDOM(reader('field-summary.html'), {runScripts:'outside-only', url:'https://example.org/field-summary.html'});
  t.after(() => window.close());
  let now = 500;
  Object.defineProperty(window.performance, 'now', {value:() => now});
  if (previous) for (const k of Object.keys(previous)) window.sessionStorage.setItem(k, previous.getItem(k));
  for (const script of window.document.querySelectorAll('script[src]')) window.eval(reader(script.getAttribute('src')));
  const el = id => window.document.getElementById(id);
  async function upload(id, ...data) {
    const input = el(id);
    Object.defineProperty(input, 'files', {configurable:true, value:data.map(x=>({text:async () => JSON.stringify(x)}))});
    await input.onchange({target:input});
  }
  function card(n) {
    const bucket = [...el('entries').querySelectorAll('article')];
    return bucket.find(c => c.textContent.includes('제출한 위치 · 표의 위치 ' + n)) ||
      bucket.find(c=>c.textContent.includes('중도 종료'));
  }
  function click(n, label) {
    const button = [...card(n).querySelectorAll('button')].find(b=>b.textContent===label);
    assert.ok(button && !button.disabled, label);
    button.click();
  }
  function grade(n, field, value = 'yes') {
    const control = [...card(n).querySelectorAll('label')].find(l=>l.textContent.startsWith(field + ' ')).querySelector('select');
    control.value = value;
    control.dispatchEvent(new window.Event('change', {bubbles:true}));
  }
  function person(target = 'comparisons') {
    el('toggle-results').click();
    const result = el(target).querySelector('.person-time').textContent;
    el('toggle-results').click();
    return result;
  }
  async function save() {
    let blob;
    window.URL.createObjectURL = b => { blob = b; return 'blob:test'; };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = () => {};
    el('save').click();
    return JSON.parse(await blob.text());
  }
  return {window, storage:window.sessionStorage, el, upload, card, click, grade, person, save, wait:ms=>{now+=ms;}};
}

test('두 편집 역할의 시간을 따로 측정한 뒤 원배정·기록상 방식 모두에서 60/40초와 성공당 65/90초를 구분한다', async t => {
  const p = page(t), a = trial(1,'manual',60000), b = trial(2,'journal',40000);
  await p.upload('key-file',key);
  await p.upload('roster-file',{format:'journal-field-assignment-v1', assignments:[a,b].map(({participant,method,caseId,articleUrl,taskId,prompt})=>
    ({participant,method,caseId,articleUrl,taskId,prompt}))});
  await p.upload('imports',a,b);
  assert.match(p.person(),/미측정 · 합산 대기/);
  for (const [n,time] of [[1,5000],[2,50000]]) {
    p.click(n,'측정 시작');
    p.wait(time/2);
    p.grade(n,'근거 위치');
    p.grade(n,'판단 이유');
    p.click(n,'일시 정지');
    p.wait(300000);
    p.click(n,'측정 재개');
    p.wait(time/2);
    p.click(n,'채점 시간 확정');
    assert.doesNotMatch(p.el('entries').innerHTML,/PRIVATE-PERSON|private-id|65\.0초|90\.0초|평소 검증 도구/);
  }
  for (const block of ['comparisons','allocation-comparisons']) {
    const report = p.person(block);
    assert.match(report,/참여자 60초 \+ 진행자 5초 · 성공 1건당 65.0초/);
    assert.match(report,/참여자 40초 \+ 진행자 50초 · 성공 1건당 90.0초/);
    assert.match(report,/25.0초 더 걸림/);
  }
  const saved = await p.save(), fresh = page(t);
  await fresh.upload('imports',saved,saved,a,b);
  assert.match(fresh.person(),/25.0초 더 걸림/);
  const divergent = structuredClone(saved);
  divergent.entries[0].gradingTime.ms += 1000;
  await fresh.upload('imports',divergent);
  assert.match(fresh.el('status').textContent,/진행자 시간 기록이 서로 다릅니다/);
  assert.match(fresh.person(),/25.0초 더 걸림/);
  const old = structuredClone(saved);
  old.entries.forEach(e=>delete e.gradingTime);
  const legacy = page(t);
  await legacy.upload('imports',old);
  assert.match(legacy.person(),/미측정 · 합산 대기/);
  legacy.click(1,'측정 시작'); legacy.wait(2000); legacy.click(1,'채점 시간 확정');
  assert.match(legacy.person(),/진행자 전체 시간 0\/1건/);
});

test('답안을 바꾸거나 탭을 닫으면 멈추고 비정상 복원은 확인된 구간만 남긴다', async t => {
  const p = page(t);
  await p.upload('key-file',key);
  await p.upload('imports',trial(1,'manual',60000),trial(2,'journal',40000));
  p.click(1,'측정 시작'); p.wait(3000); p.click(2,'측정 시작'); p.wait(7000);
  p.window.document.dispatchEvent(new p.window.Event('visibilitychange'));
  const crash = page(t,p.storage);
  crash.wait(500000);
  crash.click(2,'측정 재개'); crash.wait(2000); crash.click(2,'채점 시간 확정');
  const fromCrash = (await crash.save()).entries.find(e=>e.trial.id==='private-id-2').gradingTime;
  assert.equal(fromCrash.partial,true);
  assert.equal(fromCrash.ms,9000);
  p.window.dispatchEvent(new p.window.Event('pagehide'));
  const restored = page(t,p.storage);
  restored.wait(900000);
  restored.click(2,'측정 재개'); restored.wait(1000);
  restored.grade(2,'근거 위치'); restored.grade(2,'판단 이유'); restored.click(2,'채점 시간 확정');
  const result = (await restored.save()).entries;
  assert.equal(result.find(e=>e.trial.id==='private-id-1').gradingTime.ms,3000);
  assert.deepEqual(result.find(e=>e.trial.id==='private-id-2').gradingTime,
    {...fromCrash,partial:false,ms:8000});
  restored.grade(2,'판단 이유','no');
  assert.match(restored.person(),/진행자 전체 시간 0\/1건/);
});

test('오답과 중도 종료의 채점 시간도 합산하고, 하나의 시계가 불완전하면 그 방식의 합계를 보류한다', async t => {
  const p = page(t);
  await p.upload('key-file',key);
  await p.upload('imports',trial(1,'manual',60000),trial(2,'manual',10000),
    trial(3,'manual',20000,{status:'withdrawn'}),trial(4,'journal',50000,{recovered:true}));
  for (const [n,ms] of [[1,5000],[2,8000],[3,3000],[4,1000]]) {
    p.click(n,'측정 시작'); p.wait(ms);
    if (n!==3) {
      p.grade(n,'근거 위치',n===2?'no':'yes');
      if (n!==2) p.grade(n,'판단 이유');
    }
    if (n!==3) p.click(n,'채점 시간 확정');
    else p.click(n,'일시 정지');
  }
  assert.doesNotMatch(p.person(),/106.0초의 인력 시간/);
  p.click(3,'채점 시간 확정');
  const text=p.person();
  assert.match(text,/참여자 90초 \+ 진행자 16초 · 성공 1건당 106.0초/);
  assert.match(text,/참여자 전체 시간 0\/1건 · 진행자 전체 시간 1\/1건/);
  assert.doesNotMatch(text,/저널의 성공당 인력 시간/);
});

test('새 기준은 시간을 재확정하도록 하고, 빠진 구간이나 여러 답안에 복사된 시간 기록을 구별한다', async t => {
  const p = page(t);
  await p.upload('key-file',key);
  await p.upload('imports',trial(1,'manual',60000),trial(2,'journal',40000));
  for (const n of [1,2]) {
    p.click(n,'측정 시작'); p.wait(2000); p.grade(n,'근거 위치'); p.grade(n,'판단 이유');
    if (n===2) p.click(n,'빠진 시간 표시');
    p.click(n,'채점 시간 확정');
  }
  const original = await p.save();
  assert.match(p.person(),/진행자 전체 시간 0\/1건/);
  const changed = structuredClone(key);
  changed.tasks.find(row=>row.id===task.id).explanation += ' 연간 통계의 연령 분모를 확인.';
  await p.upload('key-file',changed);
  const refreshed = await p.save();
  assert.ok(refreshed.entries.every(e=>e.gradingTime.status==='paused' && e.gradingTime.ms===2000));
  const invalid = structuredClone(original);
  invalid.entries[1].gradingTime.id = invalid.entries[0].gradingTime.id;
  const fresh = page(t);
  await fresh.upload('imports',invalid);
  assert.match(fresh.el('status').textContent,/서로 다른 답안에서 같은 진행자 시간 기록/);
  assert.equal(fresh.el('entries').children.length,0);
});

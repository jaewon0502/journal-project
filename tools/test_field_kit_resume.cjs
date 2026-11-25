const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {JSDOM} = require('jsdom');
const core = require('../docs/reader/field-review-core.js');
const fixture = require('../experiments/cross-party-review/blind-tasks.json');
const A='a'.repeat(64), B='b'.repeat(64);
const read = file => fs.readFileSync(path.join(__dirname,'../docs/reader',file),'utf8');

function tab(t, method, version, stored) {
  const {window} = new JSDOM(read('field-review.html'), {url:'https://journal.test/field-review.html',runScripts:'outside-only'});
  t.after(() => window.close());
  const id = key => window.document.getElementById(key);
  const storageKey = 'journal-natural-trial-v1:' + JSON.stringify([fixture.caseId,method]);
  id('case-file').dataset.caseId = fixture.caseId;
  id('method').value = method;
  id('method').disabled = true;
  if (version) {
    const meta = window.document.createElement('meta');
    meta.name = 'journal-field-kit'; meta.content = version;
    window.document.head.append(meta);
  }
  if (stored) window.localStorage.setItem(storageKey,stored);
  let now = 0;
  Object.defineProperty(window.performance,'now',{value:() => now});
  window.confirm = () => true;
  for (const script of window.document.querySelectorAll('script[src]')) window.eval(read(script.getAttribute('src')));
  const saved = () => window.localStorage.getItem(storageKey);
  return {id,saved,now:value => { now = value; },result:() => JSON.parse(saved()).result};
}
async function start(t, method, version) {
  const p = tab(t,method,version);
  await p.id('case-file').onchange({target:{files:[{text:async () => JSON.stringify(fixture)}]}});
  p.id('participant').value = 'E-' + method;
  p.id('kind').value = 'editor';
  p.id('task').value = fixture.tasks[0].id;
  p.id('participant').oninput();
  p.id('start').click();
  return p;
}
function finish(p) {
  for (const [key,value] of Object.entries({found:'found',documentUrl:'https://council.example/report',
    locator:'의결액 표',verdict:'supported',reason:'예산표의 확정액을 대조했다.',journalUse:p.id('method').value === 'journal' ? 'yes':'no'})) p.id(key).value=value;
  p.id('submit').click();
  return p.result();
}
function comparison(manual, journal) {
  return core.compareTimes(core.group([manual,journal].map(trial => ({trial,locationGrade:'yes',verdictGrade:'yes'}))))[0].byVersion;
}

test('A에서 2초, B에서 재개 후 3초를 쓴 답안은 총 5초와 채점 결과를 보존하고 A의 절감률에서 빠진다', async t => {
  const m = await start(t,'manual',A), j = await start(t,'journal',A);
  m.now(10000); const manual = finish(m);
  j.now(2000); j.id('pause').click();
  const same = tab(t,'journal',A,j.saved());
  same.id('pause').click(); same.now(3000);
  const control = finish(same);
  assert.equal(control.kitVersion,A);
  assert.equal(Object.hasOwn(control,'startedKitVersion'),false);
  assert.equal(comparison(manual,control)[0].savedPct,50);
  for (const next of [B,null]) {
    const p = tab(t,'journal',next,j.saved());
    assert.match(p.id('status').textContent,/재개하면 배포본별 시간 절감률에서 제외/);
    assert.equal(JSON.parse(p.saved()).base.kitVersion,A);
    p.id('pause').click();
    assert.match(p.id('status').textContent,/배포본별 시간 절감률에서 제외/);
    p.now(3000); const mixed = finish(p);
    assert.deepEqual([mixed.kitVersion,mixed.startedKitVersion,mixed.recovered,mixed.phaseMs.search],[null,A,false,5000]);
    assert.match(p.id('end-summary').textContent,/같은 배포본/);
    const estimates = comparison(manual,mixed);
    assert.deepEqual(estimates.map(v => v.savedPct),[null,null]);
    const unknown = estimates.find(v => v.version === null).journal;
    assert.deepEqual([unknown.totalMs,unknown.timedVerified,unknown.resumedWithoutMatchingKit],[5000,1,1]);
    assert.throws(() => core.validate({...mixed,kitVersion:A}));
    assert.throws(() => core.validate({...mixed,startedKitVersion:'broken id'}));
  }
});

test('휴식한 파일을 다른 버전에서 열어 중도 종료하거나 완료 파일을 보기만 하면 원래 배포본을 유지한다', async t => {
  const j = await start(t,'journal',A);
  j.now(2000); j.id('pause').click();
  const p = tab(t,'journal',B,j.saved());
  p.id('withdraw').click();
  const stopped = p.result();
  assert.deepEqual([stopped.kitVersion,Object.hasOwn(stopped,'startedKitVersion'),stopped.phaseMs.search],[A,false,2000]);
  const restored = tab(t,'journal',B,p.saved());
  assert.deepEqual(restored.result(),stopped);
  assert.doesNotMatch(restored.id('end-summary').textContent,/재개에 같은 배포본/);
  const m = await start(t,'manual',A);
  m.now(3000); const done = finish(m);
  assert.deepEqual(tab(t,'manual',B,m.saved()).result(),done);
});

test('버전이 없는 종전 기록은 새 배포본으로 승격하지 않고 재개를 반복해도 시작 ID를 덮어쓰지 않는다', async t => {
  const j = await start(t,'journal',A);
  j.now(1000); j.id('pause').click();
  for (const original of [null,A]) {
    const stored = JSON.parse(j.saved());
    if (!original) delete stored.base.kitVersion;
    const p = tab(t,'journal',B,JSON.stringify(stored));
    p.id('pause').click(); p.now(2000); p.id('pause').click();
    const back = tab(t,'journal',A,p.saved());
    back.id('pause').click(); back.now(1000);
    const result = finish(back);
    assert.deepEqual([result.startedKitVersion,result.kitVersion,result.phaseMs.search],[original,null,4000]);
  }
});

test('진행자 화면은 버전 미확인 기록 중 다른 배포본에서 재개한 건수를 표시하고 충돌하는 시작 이력을 거절한다', async t => {
  const j = await start(t,'journal',A);
  j.now(2000); j.id('pause').click();
  const resumed = tab(t,'journal',B,j.saved());
  resumed.id('pause').click(); resumed.now(3000);
  const mixed = finish(resumed);
  const m = await start(t,'manual',A);
  m.now(10000); const manual = finish(m);
  const {window} = new JSDOM(read('field-summary.html'), {url:'https://journal.test/field-summary.html',runScripts:'outside-only'});
  t.after(() => window.close());
  for (const script of window.document.querySelectorAll('script[src]')) window.eval(read(script.getAttribute('src')));
  const id = key => window.document.getElementById(key);
  async function upload(...rows) {
    const input = id('imports');
    Object.defineProperty(input,'files',{configurable:true,value:rows.map(data => ({text:async () => JSON.stringify(data)}))});
    await input.onchange({target:input});
  }
  await upload(manual,mixed);
  id('toggle-results').click();
  assert.match(id('comparisons').textContent,/재개한 기록 1건/u);
  assert.doesNotMatch(id('comparisons').textContent,/50\.0%/u);
  assert.match(id('comparisons').textContent,/평균 5\.0초/u);
  await upload({...mixed,startedKitVersion:B});
  assert.match(id('status').textContent,/같은 과제 기록 ID에 내용이 다른 파일/u);
});

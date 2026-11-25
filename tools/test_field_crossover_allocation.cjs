const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {webcrypto} = require('node:crypto'), {JSDOM} = require('jsdom');
const reader = path.join(__dirname, '../docs/reader');
const catalog = ['cross-party-review','labour-field-review'].map((name, i) => ({
  material:require('../experiments/' + name + '/blind-tasks.json'), label:name, kitVersion:String(i).repeat(64),
  files:{manual:name+'-manual.zip',journal:name+'-journal.zip'}
}));

function form(t, entries = catalog) {
  const html = fs.readFileSync(path.join(reader, 'field-allocation.html'), 'utf8').replace('</body>',
    '<script type="application/json" id="allocation-catalog">' + JSON.stringify(entries) + '</script></body>');
  const {window:w} = new JSDOM(html, {url:'https://example.invalid/', runScripts:'outside-only'});
  t.after(() => w.close());
  const el = id => w.document.getElementById(id);
  Object.defineProperty(w,'crypto',{value:webcrypto});
  w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
  let download;
  w.URL.createObjectURL = blob => { download = blob; return 'blob:test'; };
  w.URL.revokeObjectURL = () => {};
  w.document.addEventListener('click', ev => {if (ev.target.closest('a[download]')) ev.preventDefault();});
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(fs.readFileSync(path.join(reader,script.getAttribute('src')),'utf8'));
  function choose(id, value) { el(id).value = value; el(id).dispatchEvent(new w.Event('change')); }
  function selectPlan(n) {
    choose('allocation-mode', 'crossover');
    for (const [i, side] of ['a','b'].entries()) choose('cross-task-'+side, entries[i].material.tasks[1].id);
    el('cross-codes').value = Array.from({length:n},(_,i)=>'모의-'+i).join('\n');
    el('cross-target-a').value = '75';
  }
  async function open(roster) {
    const file = {name:'재개.json',text:async()=>JSON.stringify(roster)};
    Object.defineProperty(el('roster-file'),'files',{value:[file],configurable:true});
    await el('roster-file').onchange();
  }
  return {w,el,choose,selectPlan,open,generate:()=>el('crossover-form').requestSubmit(),
    save:async()=>{el('download').click();return JSON.parse(await download.text());}};
}

test('짝수 명부에서 두 과제·배포본·순서를 배정하고 각 참여자의 올바른 코드와 ZIP을 복원한다', async t => {
  for (const n of [2,4,6,8]) {
    const p = form(t);
    assert.equal(p.el('allocation-form').hidden,false);
    assert.equal(p.el('crossover-form').hidden,true);
    p.selectPlan(n); p.generate();
    const saved = await p.save(), rows = saved.assignments;
    assert.equal(saved.design,'two-article-crossover-v1');
    assert.equal(saved.scope,'single-allocation');
    assert.equal(rows.length, 2*n);
    assert.equal(p.el('cross-order-heading').hidden,false);
    assert.match(p.el('block-count').textContent,n%4 ? /마지막 두 사람/ : /첫 방식/);
    assert.deepEqual(JSON.parse(JSON.stringify(p.w.JournalFieldReview.mergeAssignments([], [saved]))),rows);
    const person = new Set(), counts = [0,0], starts = [0,0];
    let manualStarts = 0;
    for (let i = 0; i < rows.length; i+=2) {
      const [a,b] = rows.slice(i,i+2);
      assert.equal(a.participant,b.participant); assert.notEqual(a.method,b.method);
      assert.notEqual(a.caseId,b.caseId); assert.ok(!person.has(a.participant)); person.add(a.participant);
      manualStarts += Number(a.method === 'manual');
      starts[Number(a.caseId === catalog[1].material.caseId)]++;
      for (const row of [a,b]) {
        const index = Number(row.caseId === catalog[1].material.caseId), entry = catalog[index];
        assert.equal(row.taskId,entry.material.tasks[1].id);
        assert.equal(row.assignedKitVersion,entry.kitVersion);
        assert.equal(row.targetSeconds,index ? undefined : 75);
        counts[index] += Number(row.method === 'manual');
      }
    }
    assert.equal(person.size,n); assert.deepEqual(counts,[n/2,n/2]);
    assert.equal(manualStarts,n/2); assert.equal(Math.abs(starts[0]-starts[1]), n%4);
    const q=form(t); await q.open(saved);
    assert.deepEqual(await q.save(), saved);
    for (const [i,row] of rows.entries()) {
      const cells=q.el('allocations').rows[i].cells, entry=catalog.find(e=>e.material.caseId===row.caseId);
      assert.equal(cells[6].textContent,i%2 ? '두 번째' : '첫 번째');
      assert.equal(cells[3].querySelector('a').getAttribute('href'),entry.files[row.method]);
      assert.ok(cells[4].querySelector('button').getAttribute('aria-label').includes(row.caseId));
      await cells[4].querySelector('button').onclick();
      const code=cells[4].querySelector('input').value;
      const matched=await q.w.JournalFieldInvite.match(code,entry.material,[row.method],entry.kitVersion);
      assert.equal(matched.participant,row.participant); assert.equal(matched.taskId,row.taskId);
      await assert.rejects(q.w.JournalFieldInvite.match(code,entry.material,[row.method],'f'.repeat(64)));
    }
  }
});

test('중복 배정, 미선택 과제, 목표 시간 입력 오류, 잘못된 인원 수를 막고 양식 전환을 보존한다', t => {
  const p=form(t);
  for (const ids of ['한명','A\nB\nC','A\nA','x'.repeat(65)+'\nB']) {
    p.selectPlan(4); p.el('cross-codes').value=ids; p.generate();
    assert.equal(p.el('allocations').rows.length,0);
    assert.match(p.el('status').textContent,/익명 코드|짝수 인원/);
  }
  p.selectPlan(2);
  p.choose('cross-case-b','0');
  p.choose('cross-task-b',catalog[0].material.tasks[0].id);
  p.generate(); assert.equal(p.el('allocations').rows.length,0);
  assert.match(p.el('status').textContent,/서로 다른 기사/);
  p.choose('cross-case-b','1');
  p.generate(); assert.equal(p.el('allocations').rows.length,0);
  p.choose('cross-task-b',catalog[1].material.tasks[0].id);
  p.el('cross-target-b').value='1.5'; p.generate();
  assert.equal(p.el('cross-target-b').getAttribute('aria-invalid'),'true');
  p.choose('cross-task-b',catalog[1].material.tasks[1].id);
  assert.equal(p.el('cross-target-b').value,'');
  p.choose('allocation-mode','single'); assert.equal(p.el('allocation-form').hidden,false);
  assert.equal(p.el('crossover-form').hidden,true);
  p.choose('allocation-mode','crossover'); p.generate();
  assert.equal(p.el('allocations').rows.length,4);
});

test('판본과 서로 다른 기사가 필요하며 변경된 순서를 가진 명부를 원래 교차 배정으로 열 수 없다', async t => {
  const missingKit = [{...catalog[0],kitVersion:null},catalog[1]];
  const sameArticle = [catalog[0],{...catalog[1],material:{...catalog[1].material,articleUrl:catalog[0].material.articleUrl+'#표'}}];
  for (const entries of [[],[catalog[0]],missingKit,sameArticle]) assert.equal(form(t,entries).el('allocation-mode-picker').hidden,true);
  const p=form(t); p.selectPlan(4); p.generate(); const saved=await p.save();
  for (const mutate of [
    rows=>rows.pop(),
    rows=>{[rows[1],rows[2]]=[rows[2],rows[1]];},
    rows=>{rows[0].assignedKitVersion='a'.repeat(64);}
  ]) {
    const corrupted=structuredClone(saved); mutate(corrupted.assignments);
    const q=form(t); await q.open(corrupted);
    assert.equal(q.el('allocation').hidden,true); assert.match(q.el('status').textContent,/교차 배정/);
  }
  const q=form(t); const ordinary={format:saved.format,assignments:saved.assignments};
  await q.open(ordinary); assert.deepEqual(await q.save(),ordinary);
  assert.equal(q.el('cross-order-heading').hidden,true);
});

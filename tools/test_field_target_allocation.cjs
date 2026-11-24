const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { JSDOM } = require('jsdom');
const pack = require('../experiments/labour-field-review/blind-tasks.json');
const reader = path.resolve(__dirname, '../docs/reader');

function open(t) {
  const read = name => fs.readFileSync(path.join(reader, name), 'utf8');
  const w = new JSDOM(read('field-allocation.html'), {
    url: 'https://journal.example/field-allocation.html', runScripts: 'outside-only'
  }).window;
  t.after(() => w.close());
  const el = id => w.document.getElementById(id);
  let draws = 0, download;
  Object.defineProperty(w, 'crypto', {value: {
    subtle: webcrypto.subtle,
    getRandomValues(array) { draws++; return webcrypto.getRandomValues(array); }
  }});
  w.TextEncoder = TextEncoder;
  w.TextDecoder = TextDecoder;
  w.URL.createObjectURL = blob => { download = blob; return 'blob:local'; };
  w.URL.revokeObjectURL = () => {};
  w.document.addEventListener('click', event => {
    if (event.target.closest('a[download]')) event.preventDefault();
  });
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(read(script.getAttribute('src')));
  async function load(id, value) {
    const file = {name: 'roster.json', text: async () => JSON.stringify(value)};
    Object.defineProperty(el(id), 'files', {value: [file], configurable: true});
    await el(id).onchange();
  }
  async function save() {
    el('download').click();
    return JSON.parse(await download.text());
  }
  // jsdom receives File objects directly; requestSubmit still exercises the form handler.
  el('allocation-form').noValidate = true;
  return {w, el, load, save, draws: () => draws};
}

test('목표 입력이 모두 유효해야 배정하며 과제별 목표는 진행자에게만 보인다', async t => {
  const p = open(t);
  await p.load('case-file', pack);
  const inputs = [...p.el('target-inputs').querySelectorAll('input')];
  assert.deepEqual(inputs.map(i => i.value), ['', '', '']);
  const codes = 'A\nB\nC\nD\nE\nF';
  p.el('participant-codes').value = codes;
  inputs[0].value = '120';
  for (const bad of ['0', '-1', '2.5', '1e2', 'abc', '9007199254741']) {
    inputs[2].value = bad;
    p.el('allocation-form').requestSubmit();
    assert.equal(p.el('allocations').rows.length, 0);
    assert.equal(p.draws(), 0);
    assert.equal(p.w.document.activeElement, inputs[2]);
    assert.equal(inputs[2].getAttribute('aria-invalid'), 'true');
    assert.deepEqual(inputs.map(i => i.value), ['120', '', bad]);
    assert.equal(p.el('participant-codes').value, codes);
  }
  inputs[2].value = '9007199254740';
  p.el('allocation-form').requestSubmit();
  assert.ok(p.draws() > 0);
  const roster = await p.save();
  assert.equal(roster.scope, 'single-allocation');
  assert.equal(roster.assignments.length, 6);
  const seconds = new Map([[pack.tasks[0].id, 120], [pack.tasks[2].id, 9007199254740]]);
  const restored = open(t);
  await restored.load('roster-file', roster);
  for (const [index, assignment] of roster.assignments.entries()) {
    const target = seconds.get(assignment.taskId);
    assert.equal(Object.hasOwn(assignment, 'targetSeconds'), target !== undefined);
    assert.equal(assignment.targetSeconds, target);
    const row = restored.el('allocations').rows[index];
    assert.equal(row.cells[5].textContent, target === undefined ? '미설정' : target + '초');
    const {targetSeconds, ...participant} = assignment;
    await row.querySelector('button').onclick();
    const code = row.querySelector('input').value;
    assert.equal(code, await restored.w.JournalFieldInvite.encode(participant));
    const matched = await restored.w.JournalFieldInvite.match(code, pack, [participant.method]);
    assert.deepEqual({...matched}, participant);
  }
  assert.equal(restored.el('allocation-form').hidden, true);
  assert.equal(restored.el('reopen').hidden, true);
  inputs[0].value = '1';
  p.el('allocation-form').requestSubmit();
  assert.deepEqual(await p.save(), roster);
  assert.deepEqual(await restored.save(), roster);
});

test('재열기에서 잘못되거나 서로 다른 기준은 배정표 전체를 거절하고 이전 명부는 그대로 복원한다', async t => {
  const p = open(t);
  const task = pack.tasks[0];
  const row = {participant: 'A', caseId: pack.caseId, articleUrl: pack.articleUrl,
    taskId: task.id, prompt: task.prompt, method: 'manual'};
  const roster = {format: p.w.JournalFieldReview.assignmentFormat, assignments: [row]};
  for (const extra of [{...row, participant: 'B', targetSeconds: 0}, {...row, targetSeconds: 60}]) {
    await p.load('roster-file', {...roster, assignments: [row, extra]});
    assert.equal(p.el('allocations').rows.length, 0);
    assert.equal(p.el('allocation').hidden, true);
    assert.match(p.el('status').textContent, /배정표 JSON을 확인/);
  }
  await p.load('roster-file', roster);
  assert.equal(p.el('allocations').rows[0].cells[5].textContent, '미설정');
  assert.deepEqual(await p.save(), roster);
});

test('원본 파일 안의 동일 과제는 방식과 참여자에 관계없이 목표 설정 또는 미설정이 일치해야 한다', async t => {
  const p = open(t);
  const core = p.w.JournalFieldReview;
  const task = pack.tasks[0];
  const row = {participant: 'A', caseId: pack.caseId, articleUrl: pack.articleUrl,
    taskId: task.id, prompt: task.prompt, method: 'manual'};
  const journal = {...row, participant: 'B', method: 'journal'};
  const single = assignments => ({format: core.assignmentFormat, scope: 'single-allocation', assignments});
  for (const pair of [
    [{...row, targetSeconds: 60}, {...journal, targetSeconds: 90}],
    [{...row, targetSeconds: 60}, journal],
    [row, {...journal, targetSeconds: 60}]
  ]) {
    assert.throws(() => core.mergeAssignments([], [single(pair)]), /같은 과제의 목표 시간/);
    await p.load('roster-file', single(pair));
    assert.equal(p.el('allocations').rows.length, 0);
    assert.match(p.el('status').textContent, /같은 과제의 목표 시간/);
  }
  const first = single([{...row, targetSeconds: 60}, {...journal, targetSeconds: 60}]);
  const second = single([{...row, participant: 'C', targetSeconds: 90},
    {...journal, participant: 'D', targetSeconds: 90}]);
  const assignments = first.assignments.concat(second.assignments);
  assert.deepEqual(JSON.parse(JSON.stringify(core.mergeAssignments([], [first, second]))), assignments);
  assert.throws(() => core.mergeAssignments([], [{...first, scope: 'future-format'}]), /배정표 종류/);
  const aggregate = {format: core.assignmentFormat, assignments: [...assignments, {...row, participant: 'E'}]};
  await p.load('roster-file', aggregate);
  assert.deepEqual(await p.save(), aggregate);
});

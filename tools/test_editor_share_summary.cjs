const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {JSDOM} = require('jsdom');
const study = require('../docs/reader/editor-study-core');
const cases = require('../docs/reader/editor-study-cases');

const root = path.join(__dirname, '..');
const reader = path.join(root, 'docs/reader');
const edition = 'b'.repeat(64);
const privateReason = 'PRIVATE-EDITOR-REASON';
function invitation(ordinal) {
  const id = 'E' + String(ordinal).padStart(16,'0');
  return {ordinal, id, code:'J2-' + ordinal + '-' + id + '-' + edition};
}
function completed(invite, {partialTime=false, actualEdition=edition} = {}) {
  let record = study.createRecord(invite.id, invite.ordinal, 'editor', true);
  for (const task of study.plan(invite.ordinal)) {
    const item = cases.get(task.caseId, task.variant);
    const timing = partialTime && task.position === 1
      ? {elapsedMs:null, observedMs:10000}
      : {elapsedMs:task.method === 'manual' ? 60000 : 30000};
    record = study.addTrial(record, {...timing, journalUsed:task.method === 'journal', kitVersion:actualEdition,
      verdict:item.expectedVerdict, sourceIds:task.method === 'journal' ? [] : item.expectedSourceIds, reason:privateReason});
  }
  return record;
}
function dashboard(t, records=[], invitations=[]) {
  const read = name => fs.readFileSync(path.join(reader,name), 'utf8');
  const {window:w} = new JSDOM(read('editor-study.html'), {url:'https://local.example/editor-study.html', runScripts:'outside-only'});
  t.after(() => w.close());
  w.localStorage.setItem('journal-editor-study-workspace-v1', JSON.stringify({records,invitations}));
  w.Blob = Blob;
  let contents, filename;
  w.URL.createObjectURL = blob => {contents = blob.text(); return 'blob:local-export';};
  w.HTMLAnchorElement.prototype.click = function() {filename = this.download;};
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(read(script.getAttribute('src')));
  const el = id => w.document.getElementById(id);
  return {el, async save() {
    contents = undefined; filename = undefined;
    el('export-summary').click();
    if (!contents) return null;
    assert.equal(filename, 'journal-editor-study-summary.json');
    return JSON.parse(await contents);
  }};
}

test('빈 실측의 분모는 0이고 효과는 미측정이며 가상 예시를 열면 요약을 저장할 수 없다', async t => {
  const p = dashboard(t);
  const summary = await p.save();
  assert.equal(summary.overall.editors.enrolled, 0);
  assert.equal(summary.overall.time.tasks, 0);
  assert.equal(summary.overall.time.reductionPct, null);
  assert.deepEqual(summary.overall.verdictAndEvidence.manual, {tasks:0,verified:null,verifiedPct:null});
  assert.deepEqual(Object.values(summary.overall.partyLabelAcceptanceGap), [null,null,null,null]);
  assert.deepEqual(summary.observedEditions, []);
  p.el('demo-view').click();
  assert.match(p.el('counts').textContent, /등록 8명/);
  assert.ok(p.el('manage-records').hidden && p.el('export-summary').disabled);
  assert.equal(await p.save(), null);
  p.el('real-view').click();
  assert.deepEqual(await p.save(), summary);
});

test('요약과 대시보드의 시간·집단 격차·완주 및 정확도 분모가 같고 개인 자료는 빠진다', async t => {
  const invitations = [1,2,3,4,5].map(invitation);
  const records = invitations.map(row => completed(row));
  records.push(completed(invitation(6))); // Not in the coordinator's roster.
  const p = dashboard(t,records,invitations);
  const summary = await p.save();
  assert.match(p.el('counts').textContent, /등록 5명.*분석 4명 · 16건.*분석 미포함 1명/);
  assert.equal(summary.unconfirmedEditors, 1);
  assert.deepEqual(summary.overall.editors, {enrolled:5,included:4,excluded:1,completeBlocks:1});
  const overall = summary.overall;
  assert.equal(overall.submittedTasks,20);
  assert.equal(overall.includedTasks,16);
  assert.deepEqual(overall.time, {editors:4,tasks:16,manualMeanSeconds:60,journalMeanSeconds:30,reductionPct:50,
    manualSecondsPerVerified:60,journalSecondsPerVerified:null});
  assert.deepEqual(Array.from(p.el('metrics').querySelectorAll('.value'), el => el.textContent),
    [overall.time.reductionPct + '%', overall.partyLabelAcceptanceGap.reductionPp + '%p']);
  assert.deepEqual(overall.partyLabelAcceptanceGap,{manualPp:0,journalPp:0,reductionPp:0,relativeReductionPct:null});
  const quality = overall.verdictAndEvidence;
  assert.deepEqual(quality, {manual:{tasks:8,verified:8,verifiedPct:100},journal:{tasks:8,verified:0,verifiedPct:0}});
  const row = Array.from(p.el('quality').querySelectorAll('tr')).find(r=>r.cells[0].textContent==='판정과 근거 모두 일치');
  assert.deepEqual(Array.from(row.cells).slice(1).map(c=>c.textContent),
    [quality.manual,quality.journal].map(v=>v.verifiedPct+'% ('+v.verified+'/'+v.tasks+')'));
  assert.deepEqual(summary.assignedEditionCoverage, {rosterBlocks:2,matchedBlocks:1});
  assert.equal(summary.assignedMatchedEditions.length,1);
  assert.equal(summary.observedEditions[0].kitVersion, edition);
  assert.deepEqual(summary.assignedMatchedEditions,summary.observedEditions);
  assert.equal(summary.assignedMatchedEditions[0].editors.enrolled,4);
  const json = JSON.stringify(summary);
  assert.doesNotMatch(json, /"(?:records|invitations|participantId|ordinal|code|trials|reason|blockNumbers|editorPairs|caseId|sourceIds|members)"/);
  for (const value of [...records.map(r=>r.participantId),...invitations.map(i=>i.code),privateReason])
    assert.equal(json.includes(value), false);
});

test('부족한 시간·다른 배정 판본·미완성 묶음을 수치 0으로 바꾸지 않는다', async t => {
  const roster = [1,2,3,4].map(invitation);
  const records = roster.map(i => completed(i, {partialTime:i.ordinal===1, actualEdition:'c'.repeat(64)}));
  const p = dashboard(t,records,roster);
  const summary = await p.save();
  assert.equal(summary.overall.includedTasks,16);
  assert.equal(summary.overall.time.tasks,0);
  assert.equal(summary.overall.time.reductionPct,null);
  assert.equal(summary.overall.verdictAndEvidence.manual.verifiedPct,100);
  assert.equal(summary.observedEditions[0].kitVersion, 'c'.repeat(64));
  assert.deepEqual(summary.assignedEditionCoverage, {rosterBlocks:1,matchedBlocks:0});
  assert.deepEqual(summary.assignedMatchedEditions,[]);
  const unfinished = await dashboard(t,records.slice(0,3),roster).save();
  assert.equal(unfinished.overall.editors.enrolled,3);
  assert.equal(unfinished.overall.time.reductionPct,null);
  assert.equal(unfinished.overall.partyLabelAcceptanceGap.reductionPp,null);
  assert.deepEqual(unfinished.observedEditions,[]);
});

test('배부되는 실제 참여자 ZIP에서 진행자용 요약 버튼과 저장 코드를 제거한다', () => {
  const program = [
    'from build_editor_study_pack import packet_bytes',
    'from io import BytesIO',
    'from zipfile import ZipFile',
    'with ZipFile(BytesIO(packet_bytes())) as z:',
    "    assert b'export-summary' not in z.read('editor-study.html')",
    "    assert b'journal-editor-study-summary' not in z.read('editor-study-ui.js')",
    "    assert b'function shareMetrics' not in z.read('editor-study-ui.js')"
  ].join('\n');
  execFileSync('python3', ['-B','-c',program], {cwd:__dirname});
});

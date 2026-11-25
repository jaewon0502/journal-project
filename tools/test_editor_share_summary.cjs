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
function completed(invite, {partialTime=false, actualEdition=edition, answer} = {}) {
  let record = study.createRecord(invite.id, invite.ordinal, 'editor', true);
  for (const task of study.plan(invite.ordinal)) {
    const item = cases.get(task.caseId, task.variant);
    const timing = partialTime && task.position === 1
      ? {elapsedMs:null, observedMs:10000}
      : {elapsedMs:task.method === 'manual' ? 60000 : 30000};
    const response = answer ? answer(task,item) : {verdict:item.expectedVerdict, sourceIds:task.method === 'journal' ? [] : item.expectedSourceIds};
    record = study.addTrial(record, {...timing, ...response, journalUsed:task.method === 'journal', kitVersion:actualEdition, reason:privateReason});
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
  assert.deepEqual(summary.overall.time.verifiedTrials, {
    manual:{verified:null,tasks:0},journal:{verified:null,tasks:0}});
  assert.equal(summary.overall.time.reductionPct, null);
  assert.equal(summary.overall.partyLabelDirectionReversals, null);
  assert.equal(summary.overall.partyLabelVerdictSourceAssociation, null);
  assert.deepEqual(summary.overall.verdictAndEvidence.manual, {tasks:0,verified:null,verifiedPct:null});
  const unmeasured = {accepted:null,eligible:0,pct:null};
  assert.deepEqual(summary.overall.unsupportedAcceptance, {manual:unmeasured,journal:unmeasured,changePp:null,increased:null});
  assert.deepEqual(summary.overall.time.unsupportedAcceptance, summary.overall.unsupportedAcceptance);
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
  const safe = {accepted:0,eligible:4,pct:0};
  assert.deepEqual(overall.unsupportedAcceptance, {manual:safe,journal:safe,changePp:0,increased:false});
  assert.deepEqual(overall.time, {editors:4,tasks:16,manualMeanSeconds:60,journalMeanSeconds:30,reductionPct:50,
    manualSecondsPerVerified:60,journalSecondsPerVerified:null,
    caseVerification:{comparedCases:4,fasterCases:4,fasterWithFewerVerified:4},
    verifiedTrials:{manual:{verified:8,tasks:8},journal:{verified:0,tasks:8}},unsupportedAcceptance:overall.unsupportedAcceptance});
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

test('동시 일치율이 같은 두 방식의 오승인과 시간이 온전히 기록된 표본의 경고를 구분한다', async t => {
  const roster = Array.from({length:8}, (_,i) => invitation(i + 1));
  const records = roster.map(invite => completed(invite, {partialTime:invite.ordinal === 5, answer(task,item) {
    // Each method misses one case twice per block. The error can be false acceptance or excess caution.
    const acceptsUnsupported = task.method === (invite.ordinal <= 4 ? 'journal' : 'manual');
    let verdict = item.expectedVerdict;
    if (acceptsUnsupported && task.caseId === 'repair') verdict = 'supported';
    if (!acceptsUnsupported && task.caseId === 'transit') verdict = 'insufficient';
    return {verdict, sourceIds:item.expectedSourceIds};
  }}));
  const p = dashboard(t,records,roster);
  const {overall, observedEditions, assignedMatchedEditions} = await p.save();
  assert.equal(overall.editors.included,8);
  assert.equal(overall.time.editors,4);
  assert.equal(overall.time.reductionPct,50);
  assert.deepEqual(overall.verdictAndEvidence.manual, {tasks:16,verified:12,verifiedPct:75});
  assert.deepEqual(overall.verdictAndEvidence.journal, overall.verdictAndEvidence.manual);
  const all = {accepted:2,eligible:8,pct:25};
  assert.deepEqual(overall.unsupportedAcceptance, {manual:all,journal:all,changePp:0,increased:false});
  const timed = {manual:{accepted:0,eligible:4,pct:0},journal:{accepted:2,eligible:4,pct:50},changePp:50,increased:true};
  assert.deepEqual(overall.time.unsupportedAcceptance,timed);
  assert.deepEqual(observedEditions[0].time.unsupportedAcceptance,timed);
  assert.deepEqual(assignedMatchedEditions[0].time.unsupportedAcceptance,timed);
  assert.equal(p.el('timed-quality-warning').hidden,false);
  assert.match(p.el('timed-quality-warning').textContent,/근거 없는 사실 채택률 50%p 상승/);
  const first = (await dashboard(t,records.slice(0,4),roster.slice(0,4)).save()).overall;
  assert.deepEqual(first.unsupportedAcceptance,timed);
  assert.deepEqual(first.verdictAndEvidence.manual, {tasks:8,verified:6,verifiedPct:75});
  assert.deepEqual(first.verdictAndEvidence.journal,first.verdictAndEvidence.manual);
});

test('성공 한 건당 시간에는 온전히 시간을 기록한 과제만 들어가고 전체 품질 분모는 따로 보관한다', async t => {
  const roster = Array.from({length:8}, (_,i) => invitation(i+1));
  const records = roster.map(invite => completed(invite, {
    partialTime:invite.ordinal === 5,
    answer(task, item) {
      const verified = task.method === 'manual' || invite.ordinal > 4;
      return {verdict:item.expectedVerdict, sourceIds:verified ? item.expectedSourceIds : []};
    }
  }));
  const summary = await dashboard(t,records,roster).save();
  for (const view of [summary.overall, summary.observedEditions[0], summary.assignedMatchedEditions[0]]) {
    assert.equal(view.time.tasks,16);
    assert.equal(view.includedTasks,32);
    assert.deepEqual(view.time.verifiedTrials,{manual:{verified:8,tasks:8},journal:{verified:0,tasks:8}});
    assert.equal(view.time.manualSecondsPerVerified,60);
    assert.equal(view.time.journalSecondsPerVerified,null);
    assert.deepEqual(view.verdictAndEvidence.journal,{tasks:16,verified:8,verifiedPct:50});
  }
});

test('판정·근거 조합 차이는 실측 전체와 판본별 공유 파일에 기사 건수로만 전달한다', async t => {
  const roster = Array.from({length:8}, (_, i) => invitation(i + 1));
  const demo = study.verdictSourceDemoRecords();
  const records = roster.map((invite, i) => completed(invite, {answer(task) {
    const {verdict, sourceIds} = demo[i].trials[task.position - 1];
    return {verdict, sourceIds};
  }}));
  const summary = await dashboard(t, records, roster).save();
  for (const view of [summary.overall, summary.observedEditions[0], summary.assignedMatchedEditions[0]]) {
    assert.deepEqual(view.partyLabelVerdictSourceAssociation, {comparedCases:4,
      manual:{differentCases:0,equalMarginalsWithGap:0}, journal:{differentCases:1,equalMarginalsWithGap:1}});
  }
  assert.doesNotMatch(JSON.stringify(summary), /"sourceId"|"differences"|"countA"|"countB"|"repair"|PRIVATE-EDITOR-REASON/);
});

test('전체와 해당 판본에서 정당 표기 채택의 방향이 뒤집힌 기사 수만 공유한다', async t => {
  const roster = [1,2,3,4].map(invitation);
  const records = roster.map(invite=>completed(invite, {answer(task,item) {
    const journal = task.method === 'journal';
    const accepted = task.caseId === 'repair' && task.variant === (journal ? 'B' : 'A')
      || task.caseId === 'permits' && task.variant === (journal ? 'A' : 'B');
    return {verdict:accepted ? 'supported' : item.expectedVerdict,sourceIds:item.expectedSourceIds};
  }}));
  const summary = await dashboard(t,records,roster).save();
  for (const view of [summary.overall,summary.observedEditions[0],summary.assignedMatchedEditions[0]]) {
    assert.deepEqual(view.partyLabelAcceptanceGap, {manualPp:50,journalPp:50,reductionPp:0,relativeReductionPct:0});
    assert.deepEqual(view.partyLabelDirectionReversals, {comparedCases:4,reversedCases:2,byExpectedVerdict:{
      supported:{comparedCases:2,reversedCases:0},contradicted:{comparedCases:1,reversedCases:1},insufficient:{comparedCases:1,reversedCases:1}}});
  }
  assert.doesNotMatch(JSON.stringify(summary), /"caseId"|"repair"|"permits"|"participantId"/);
});

test('부족한 시간·다른 배정 판본·미완성 묶음을 수치 0으로 바꾸지 않는다', async t => {
  const roster = [1,2,3,4].map(invitation);
  const records = roster.map(i => completed(i, {partialTime:i.ordinal===1, actualEdition:'c'.repeat(64)}));
  const p = dashboard(t,records,roster);
  const summary = await p.save();
  assert.equal(summary.overall.includedTasks,16);
  assert.equal(summary.overall.time.tasks,0);
  assert.equal(summary.overall.time.reductionPct,null);
  assert.equal(summary.overall.time.unsupportedAcceptance.increased,null);
  assert.equal(summary.overall.unsupportedAcceptance.increased,false);
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

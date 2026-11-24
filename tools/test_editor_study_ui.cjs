// The two study pages communicate through postMessage. Exercise the parent
// protocol and timer separately from the actual local Chromium end-to-end run.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const folder = path.join(__dirname, '../docs/reader');

function page(t, hash = '', url = 'https://study.example/editor-study.html', prior, participantKit = false) {
  const dom = new JSDOM(fs.readFileSync(path.join(folder, 'editor-study.html'), 'utf8'), {url: url + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  if (participantKit) {
    w.document.documentElement.setAttribute('data-participant-kit', '');
    w.document.getElementById('dashboard').remove();
  }
  let ticks = 0;
  if (prior) w.localStorage.setItem('journal-editor-study-workspace-v1',JSON.stringify(prior));
  Object.defineProperty(w.performance, 'now', {value:() => ticks});
  const el = id => w.document.getElementById(id);
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(fs.readFileSync(path.join(folder, script.getAttribute('src')), 'utf8'));
  const workspace = () => JSON.parse(w.localStorage.getItem('journal-editor-study-workspace-v1'));
  const enroll = ordinal => {
    el('invite-code').value = 'J1-' + ordinal + '-E0000000000000001';
    el('qualified').checked = true;
    el('enroll').requestSubmit();
  };
  const answer = () => {
    el('verdict').value = 'supported'; el('source').value = 'doc-2'; el('reason').value = '제공된 자료의 표결 수치를 확인했다.';
    el('answer').requestSubmit();
  };
  return {w, el, workspace, enroll, answer, advance:ms => {ticks += ms;}};
}

test('실측이 비었을 때 예시 수치가 실측으로 남지 않는다', t => {
  const p = page(t);
  assert.match(p.el('counts').textContent, /등록 0명/);
  p.el('demo-view').click();
  assert.match(p.el('metrics').textContent, /25%p/);
  assert.match(p.el('metrics').textContent, /120초/);
  assert.match(p.el('quality').textContent, /4\/8/);
  p.el('real-view').click();
  assert.match(p.el('metrics').textContent, /측정 대기/);
  assert.doesNotMatch(p.el('metrics').textContent, /25%/);
  assert.equal(p.workspace(), null);
});

test('명시적 휴식만 시간에서 빠지고 과제 사이에 근거와 답안이 노출되지 않는다', t => {
  const p = page(t, '#participate');
  p.enroll(1);
  assert.equal(p.el('task-pane').hidden, true);
  assert.equal(p.el('stimulus-article').textContent, '');
  p.el('begin-trial').click(); p.advance(12000);
  p.el('pause-trial').click(); p.advance(40000);
  assert.equal(p.el('task-pane').hidden, true);
  p.el('resume-trial').click(); p.advance(3000);
  p.answer();
  const trial = p.workspace().records[0].trials[0];
  assert.equal(trial.elapsedMs, 15000);
  assert.equal(trial.journalUsed, false);
  assert.equal(trial.reason, '제공된 자료의 표결 수치를 확인했다.');
  assert.equal(p.el('task-pane').hidden, true);
});

test('저널 조건은 배정된 자식 화면의 확인된 판단이 도착해야 제출할 수 있다', t => {
  const p = page(t, '#participate');
  p.enroll(3);
  p.el('begin-trial').click(); p.advance(1000);
  const frame = p.w.document.querySelector('iframe');
  const origin = p.w.location.origin;
  const send = (source, data) => p.w.dispatchEvent(new p.w.MessageEvent('message', {data, source, origin}));
  let packet;
  frame.contentWindow.postMessage = m => {packet = m;};
  send(frame.contentWindow, {type:'journal-study-ready'});
  assert.equal(typeof packet.nonce, 'string');
  assert.ok(packet.sources.every(s => s.excerpt));
  assert.ok(!Object.hasOwn(packet, 'expectedVerdict'));
  const report = {type:'journal-study-used',nonce:packet.nonce,status:'held',sourceIds:['doc-2'],reason:'다른 지역의 자료가 없다.'};
  send(p.w, report);
  send(frame.contentWindow, {...report, nonce:'stale'});
  p.answer();
  assert.equal(p.workspace().records[0].trials.length, 0);
  send(frame.contentWindow, report);
  assert.equal(p.el('verdict').value, 'insufficient');
  assert.equal(p.el('reason').value, report.reason);
  p.el('answer').requestSubmit();
  assert.equal(p.workspace().records[0].trials[0].journalUsed, true);
});

function captureDownloads(p) {
  const blobs = [];
  p.w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:study'; };
  p.w.URL.revokeObjectURL = () => {};
  p.w.document.addEventListener('click', event => { if (event.target.closest('a[download]')) event.preventDefault(); });
  return blobs;
}
async function importFiles(p, texts) {
  const input = p.el('import-files');
  const files = texts.map((text, i) => new p.w.File([text], 'study-' + i + '.json', {type: 'application/json'}));
  Object.defineProperty(input, 'files', {value: files, configurable: true});
  const done = new Promise(resolve => {
    const observer = new p.w.MutationObserver(() => { if (p.el('import-status').textContent) { observer.disconnect(); resolve(); } });
    observer.observe(p.el('import-status'), {childList: true, subtree: true, characterData: true});
  });
  input.dispatchEvent(new p.w.Event('change'));
  await done;
}
const issuedCodes = p => [...p.el('invites').querySelectorAll('tbody tr')].map(tr => tr.cells[1].textContent);

test('참여 등록 화면에서 집계로 갈 수 없고, 참여를 닫으면 빈 등록 화면으로 돌아간다', t => {
  const p = page(t, '#participate');
  assert.equal(p.el('enroll-box').querySelector('a[href="#dashboard"]'), null);
  p.w.confirm = () => true;
  p.enroll(1);
  p.el('withdraw').click();
  p.el('leave-session').click();
  assert.equal(p.el('dashboard').hidden, true);
  assert.equal(p.el('enroll-box').hidden, false);
  assert.equal(p.el('qualified').checked, false);
  assert.equal(p.el('invite-code').value, '');
});

test('초대 코드 명부가 모은 기록 파일과 함께 옮겨져 같은 번호를 다시 발급하지 않는다', async t => {
  const p = page(t);
  const blobs = captureDownloads(p);
  p.el('issue-codes').click();
  assert.equal(p.el('export-all').disabled, false);
  p.el('export-all').click();
  const exported = JSON.parse(await blobs.at(-1).text());
  assert.equal(exported.invitations.length, 4);

  const q = page(t, '', 'https://study-copy.example/editor-study.html');
  await importFiles(q, [JSON.stringify(exported)]);
  assert.doesNotMatch(q.el('import-status').textContent, /가져오지 못했습니다/);
  q.el('issue-codes').click();
  const ordinals = issuedCodes(q).map(code => Number(code.split('-')[1])).sort((a, b) => a - b);
  assert.deepEqual(ordinals, [1, 2, 3, 4, 5, 6, 7, 8]);

  const forged = {...exported, invitations: [{...exported.invitations[0], ordinal: 9, code: 'J1-9-' + exported.invitations[0].id}]};
  await importFiles(q, [JSON.stringify(forged)]);
  assert.match(q.el('import-status').textContent, /가져오지 못했습니다/);
});

test('발급한 코드의 번호와 식별자가 어긋나면 등록하지 않는다', t => {
  const p = page(t, '#participate');
  p.el('issue-codes').click();
  const id = issuedCodes(p).find(code => code.startsWith('J1-1-')).split('-')[2];
  p.el('invite-code').value = 'J1-7-' + id;
  p.el('qualified').checked = true;
  p.el('enroll').requestSubmit();
  assert.match(p.el('enroll-status').textContent, /다른 참여자에게 배정한 코드/);
  assert.equal(p.workspace().records.length, 0);
});

test('화면이 바뀌면 키보드 초점이 새 단계로 옮겨지고 진행 중 과제에서만 이탈을 확인한다', t => {
  const p = page(t, '#participate');
  const active = () => p.w.document.activeElement.id;
  const leave = () => { const e = new p.w.Event('beforeunload', {cancelable: true}); p.w.dispatchEvent(e); return e.defaultPrevented; };
  assert.equal(p.el('global-status').hidden, false);
  p.enroll(1);
  assert.equal(active(), 'trial-heading');
  assert.equal(leave(), false);
  p.el('begin-trial').click();
  assert.equal(active(), 'trial-heading');
  assert.equal(leave(), true);
  p.el('pause-trial').click();
  assert.equal(active(), 'resume-trial');
  assert.equal(leave(), false);
  p.el('resume-trial').click();
  assert.equal(active(), 'trial-heading');
  p.w.confirm = () => true;
  p.el('withdraw').click();
  assert.equal(active(), 'ended-heading');
  assert.doesNotMatch(fs.readFileSync(path.join(folder, 'editor-study.css'), 'utf8'), /\.status:empty\{display:none\}/);
});

test('양쪽 검토 조건에서 같은 단계 버튼으로 되돌아간 시간과 재제출 시도를 누적한다', t => {
  for (const ordinal of [1,3]) {
    const p=page(t,'#participate'); p.enroll(ordinal); p.el('begin-trial').click();
    const choose=name=>p.w.document.querySelector('[data-phase="'+name+'"]').click();
    p.advance(100); choose('locate'); p.advance(200); choose('select'); p.advance(50);
    p.el('pause-trial').click(); p.advance(700); p.el('resume-trial').click(); p.advance(10); choose('locate');
    p.advance(40); choose('decide'); p.advance(10);
    if (ordinal===3) {
      p.answer(); // Retry: the assigned Journal frame has not recorded a judgment yet.
      assert.equal(p.workspace().records[0].trials.length,0);
      const frame=p.w.document.querySelector('iframe');
      const send=data=>p.w.dispatchEvent(new p.w.MessageEvent('message',{data,source:frame.contentWindow,origin:p.w.location.origin}));
      let task; frame.contentWindow.postMessage=m=>{task=m;}; send({type:'journal-study-ready'});
      send({type:'journal-study-used',nonce:task.nonce,status:'fact',sourceIds:['doc-2'],reason:'주체와 기간을 확인했다.'});
    }
    p.advance(20); p.answer();
    const trial=p.workspace().records[0].trials[0], expected={select:160,locate:240,decide:30};
    assert.deepEqual(trial.phaseMs,expected);
    assert.equal(trial.elapsedMs,430);
  }
});

test('표시를 놓친 과제는 총시간만 남고 예시의 단계 평균은 실제 집계로 넘어오지 않는다', t => {
  const q=page(t);
  q.el('demo-view').click();
  assert.match(q.el('phase-counts').textContent,/8명 · 32건/);
  assert.equal(q.el('phase-table').querySelectorAll('tbody tr').length,3);
  q.el('real-view').click();
  assert.equal(q.el('phase-table').querySelectorAll('tbody tr').length,0);
  for(const omitted of [true,false]) {
    const p=page(t,'#participate'); p.enroll(1); p.el('begin-trial').click();
    if(omitted) {
      for(const name of ['locate','decide']) p.w.document.querySelector('[data-phase="'+name+'"]').click();
      p.el('phase-omit').click();
    }
    p.advance(32);p.answer();
    const trial=p.workspace().records[0].trials[0];
    assert.equal(trial.phaseMs,null);assert.equal(trial.elapsedMs,32);
  }
});

test('다시 열린 과제는 휴식 시점의 단계만 복원하고 중단 중인 단계 시간은 추정하지 않는다', t => {
  const p=page(t,'#participate'); p.enroll(1); p.el('begin-trial').click();
  const choose=(v,name)=>v.w.document.querySelector('[data-phase="'+name+'"]').click();
  p.advance(100); choose(p,'locate'); p.advance(80); p.el('pause-trial').click();
  const paused=p.workspace();
  const q=page(t,'#participate',undefined,paused); q.el('resume-trial').click();
  q.advance(10); choose(q,'decide'); q.advance(30); q.answer();
  assert.deepEqual(q.workspace().records[0].trials[0].phaseMs,{select:100,locate:90,decide:30});
  const interrupted=structuredClone(paused);
  interrupted.session.state='running';interrupted.session.segmentAt=Date.now()-100;
  const r=page(t,'#participate',undefined,interrupted);
  assert.equal(r.el('recovery').hidden,false);
  r.el('resume-unbroken').click(); r.advance(20); r.answer();
  assert.equal(r.workspace().records[0].trials[0].phaseMs,null);
  assert.ok(r.workspace().records[0].trials[0].elapsedMs>=300);
});

test('배포본은 코드 입력 후에만 본인 기록을 복원하고 연구자·다른 편집자의 상태를 섞지 않는다', t => {
  const key = n => 'journal-editor-study-participant-v1/J1-' + n + '-E0000000000000001';
  const pilot = page(t, '', undefined, undefined, true);
  pilot.el('qualified').checked = true; pilot.el('enroll').requestSubmit();
  assert.match(pilot.el('enroll-status').textContent, /초대 코드/);
  assert.equal(pilot.w.localStorage.length, 0);
  pilot.enroll(1);
  pilot.el('begin-trial').click(); pilot.advance(1000); pilot.answer();
  const stored = pilot.w.localStorage.getItem(key(1));
  assert.equal(JSON.parse(stored).records[0].trials.length, 1);
  assert.equal(pilot.workspace(), null);

  const reentry = page(t, '#dashboard', undefined, undefined, true);
  reentry.w.localStorage.setItem(key(1), stored);
  reentry.w.localStorage.setItem('journal-editor-study-workspace-v1', '진행자의 별도 저장소');
  assert.equal(reentry.el('dashboard'), null);
  assert.equal(reentry.el('enroll-box').hidden, false);
  assert.equal(reentry.el('trial-heading').textContent, '');
  reentry.enroll(2);
  assert.equal(reentry.el('trial-heading').textContent.includes('과제 1 / 4'), true);
  assert.equal(reentry.w.localStorage.getItem(key(1)), stored);
  assert.equal(reentry.w.localStorage.getItem('journal-editor-study-workspace-v1'), '진행자의 별도 저장소');

  const owner = page(t, '', undefined, undefined, true);
  owner.w.localStorage.setItem(key(1), stored);
  owner.enroll(1);
  assert.match(owner.el('trial-heading').textContent, /과제 2 \/ 4/);
});

function completedRecord(ordinal, id) {
  const core = require('../docs/reader/editor-study-core.js');
  const cases = require('../docs/reader/editor-study-cases.js');
  let record = core.createRecord(id, ordinal, 'editor', true);
  for (const trial of core.plan(ordinal)) {
    const c = cases.get(trial.caseId, trial.variant);
    const manual = trial.method === 'manual';
    record = core.addTrial(record, {elapsedMs:manual ? 60000 : 30000,
      verdict:manual ? (trial.variant === 'A' ? 'supported' : 'insufficient') : c.expectedVerdict,
      reason:'격리된 집계 검증', sourceIds:[c.expectedSourceIds[0]], journalUsed:!manual});
  }
  return record;
}

test('다른 묶음의 개인 기록 네 개는 지표에 들어가지 않고 발급 명부의 16건만 집계한다', async t => {
  const p = page(t);
  p.el('issue-codes').click();
  const roster = p.workspace().invitations;
  const records = roster.map(i => completedRecord(i.ordinal, i.id));
  const other = [5,6,7,8].map(n => completedRecord(n, 'E' + String(n).padStart(16, '0')));
  await importFiles(p, [...other, records[0]].map(r => JSON.stringify(r)));
  assert.match(p.el('import-status').textContent, /명부에 없는 개인 기록/);
  assert.match(p.el('counts').textContent, /분석 0명 · 0건/);
  assert.match(p.el('metrics').textContent, /측정 대기/);
  assert.equal(p.workspace().records.length, 0);
  const foreignInvites = other.map(r => ({ordinal:r.ordinal, id:r.participantId, code:'J1-' + r.ordinal + '-' + r.participantId}));
  await importFiles(p, [JSON.stringify({type:'journal-editor-study-collection-v1', records:other, invitations:foreignInvites})]);
  assert.match(p.el('import-status').textContent, /기존 명부에 일치하는 배정이 없습니다/);
  assert.equal(p.workspace().records.length, 0);
  const fresh = page(t);
  await importFiles(fresh, [JSON.stringify({type:'journal-editor-study-collection-v1', records:[], invitations:roster}),
    ...records.map(r => JSON.stringify(r))]);
  assert.match(fresh.el('counts').textContent, /분석 4명 · 16건/);
  assert.match(fresh.el('metrics').textContent, /시간 절감률50%/);
  assert.match(fresh.el('metrics').textContent, /격차 감소100%p/);
  await importFiles(fresh, [JSON.stringify(records[0])]);
  assert.equal(fresh.workspace().records.length, 4);
});

test('예전 명부 없는 백업은 재저장·재복원해도 보관 상태를 유지하고 직접 확인한 배정만 복구한다', async t => {
  const p = page(t);
  const records = [1,2,3,4].map(n => completedRecord(n, 'E' + String(n).padStart(16,'0')));
  await importFiles(p, [JSON.stringify({type:'journal-editor-study-collection-v1', records})]);
  assert.equal(p.workspace().records.length, 4);
  assert.match(p.el('counts').textContent, /등록 0명/);
  assert.match(p.el('data-notice').textContent, /명부 미확인 4명/);
  const next = page(t, '', undefined, p.workspace());
  assert.match(next.el('metrics').textContent, /측정 대기/);
  const downloads = captureDownloads(next);
  next.el('export-all').click();
  const backup = await downloads[0].text();
  const final = page(t);
  await importFiles(final, [backup]);
  assert.match(final.el('data-notice').textContent, /명부 미확인 4명/);
  final.el('roster-code').value = 'J1-1-EAAAAAAAAAAAAAAAA';
  final.el('recover-roster').requestSubmit();
  assert.match(final.el('import-status').textContent, /다릅니다/);
  assert.deepEqual(final.workspace().invitations, []);
  for (const [index,r] of records.entries()) {
    final.el('roster-code').value = 'J1-' + r.ordinal + '-' + r.participantId;
    final.el('recover-roster').requestSubmit();
    assert.match(final.el('counts').textContent, new RegExp('등록 ' + (index + 1) + '명'));
    if (index < 3) assert.match(final.el('metrics').textContent, /측정 대기/);
  }
  assert.match(final.el('counts').textContent, /분석 4명 · 16건/);
  assert.match(final.el('metrics').textContent, /시간 절감률50%/);
});

test('공용 기기의 직접 등록은 백업에서 확인되며 예전 진행 중 참여도 원래 배정으로 이어간다', async t => {
  const p = page(t, '#participate');
  p.el('qualified').checked = true;
  p.el('enroll').requestSubmit();
  const direct = p.workspace();
  assert.equal(direct.invitations.length, 1);
  assert.equal(direct.invitations[0].atDevice, true);
  assert.equal(direct.invitations[0].id, direct.records[0].participantId);
  const old = {...direct, invitations:[]};
  const resumed = page(t, '#participate', undefined, old);
  assert.match(resumed.el('trial-heading').textContent, /과제 1/);
  resumed.el('begin-trial').click();
  assert.deepEqual(resumed.workspace().invitations, direct.invitations);
  const downloads = captureDownloads(p);
  p.el('export-all').click();
  const moved = page(t);
  await importFiles(moved, [await downloads[0].text()]);
  assert.match(moved.el('counts').textContent, /등록 1명/);
  assert.match(moved.el('invites').textContent, /발급된 초대 코드가 없습니다/);
  await importFiles(moved, [JSON.stringify(direct.records[0])]);
  assert.match(moved.el('import-status').textContent, /현재 등록 1명/);
});

test('중단한 편집자의 개인 파일과 진행자 백업이 대기 중인 기록과 구분된다', async t => {
  const coordinator = page(t);
  coordinator.el('issue-codes').click();
  const code = issuedCodes(coordinator).find(value => value.startsWith('J1-1-'));
  const participant = page(t, '#participate', undefined, undefined, true);
  participant.el('invite-code').value = code;
  participant.el('qualified').checked = true;
  participant.el('enroll').requestSubmit();
  participant.el('begin-trial').click(); participant.advance(1500); participant.answer();
  participant.w.confirm = () => true;
  const participantFiles = captureDownloads(participant);
  participant.el('export-one').click();
  participant.el('withdraw').click(); participant.el('export-finished').click();
  const [active, stopped] = await Promise.all(participantFiles.map(file => file.text()));
  assert.equal(JSON.parse(stopped).withdrawn, true);
  await importFiles(coordinator, [stopped, active]);
  assert.match(coordinator.el('counts').textContent, /중단 확인 1명/);
  assert.match(coordinator.el('counts').textContent, /분석 0명 · 0건/);
  const backup = captureDownloads(coordinator);
  coordinator.el('export-all').click();
  const restored = page(t);
  await importFiles(restored, [await backup[0].text()]);
  assert.match(restored.el('counts').textContent, /중단 확인 1명/);
  const id = JSON.parse(stopped).participantId;
  const longer = {...completedRecord(1,id), trials:JSON.parse(stopped).trials.concat(completedRecord(1,id).trials.slice(1))};
  await importFiles(restored, [JSON.stringify(longer)]);
  assert.match(restored.el('import-status').textContent, /중단/);
  assert.equal(restored.workspace().records[0].trials.length, 1);
});

test('이전 버전의 기기 상태에서 확인된 중단만 개인 파일에 복원한다', async t => {
  const previous = page(t, '#participate');
  previous.enroll(1);
  previous.el('begin-trial').click(); previous.advance(1100); previous.answer();
  const legacy = previous.workspace();
  for (const state of ['ready', 'withdrawn']) {
    const saved = structuredClone(legacy);
    saved.session.state = state;
    const restored = page(t, '#participate', undefined, saved);
    const files = captureDownloads(restored);
    restored.el(state === 'ready' ? 'export-one' : 'export-finished').click();
    const record = JSON.parse(await files[0].text());
    assert.equal(record.withdrawn, state === 'withdrawn' ? true : undefined);
    assert.equal(record.trials.length, 1);
  }
});

test('실제 네 명의 집단 평균이 개선되어도 개인별 중앙값 증가와 인원은 같은 카드에 표시한다', async t => {
  const p = page(t);
  p.el('issue-codes').click();
  const journal = [10000, 110000, 120000, 130000];
  const records = p.workspace().invitations.map(invitation => {
    const record = completedRecord(invitation.ordinal,invitation.id);
    for (const trial of record.trials) trial.elapsedMs = trial.method === 'manual' ? 100000 : journal[invitation.ordinal-1];
    return record;
  });
  await importFiles(p, records.map(record => JSON.stringify(record)));
  const card = () => p.el('metrics').firstElementChild.textContent;
  assert.match(card(),/시간 절감률7.5%/);
  assert.match(card(),/중앙값 15초 증가/);
  assert.match(card(),/단축 1명 · 동일 0명 · 증가 3명/);
  p.el('demo-view').click();
  assert.match(card(),/단축 8명 · 동일 0명 · 증가 0명/);
  p.el('real-view').click();
  assert.match(card(),/단축 1명 · 동일 0명 · 증가 3명/);
});

test('집계 화면에서 정당 격차 감소폭의 묶음별 범위를 실제 등록 파일로 계산한다', async t => {
  const p = page(t);
  const card = () => p.el('metrics').lastElementChild.textContent;
  assert.match(card(), /완성 0묶음.*2묶음부터/);
  for (let i=0; i<3; i++) p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const record = completedRecord(inv.ordinal, inv.id);
    const block = Math.floor((inv.ordinal - 1) / 4);
    for (const trial of record.trials) {
      const side = (trial.method === 'manual' ? [1,1,-1] : [1,0,-1])[block];
      trial.verdict = (side === 1 && trial.variant === 'A') || (side === -1 && trial.variant === 'B') ? 'supported' : 'insufficient';
    }
    return record;
  }).sort((a,b) => a.ordinal - b.ordinal);
  await importFiles(p, records.slice(0,7).map(record => JSON.stringify(record)));
  assert.match(card(), /완성 1묶음.*2묶음부터/);
  await importFiles(p, records.slice(7).map(record => JSON.stringify(record)));
  assert.match(card(), /완성 3묶음.*-50%p ~ 50%p/);
  assert.match(card(), /신뢰구간/);
  p.el('demo-view').click();
  assert.match(card(), /완성 2묶음.*0%p ~ 50%p/);
  p.el('real-view').click();
  assert.match(card(), /완성 3묶음.*-50%p ~ 50%p/);
});

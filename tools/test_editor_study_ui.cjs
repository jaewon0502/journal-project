// The two study pages communicate through postMessage. Exercise the parent
// protocol and timer separately from the actual local Chromium end-to-end run.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const folder = path.join(__dirname, '../docs/reader');

function page(t, hash = '', url = 'https://study.example/editor-study.html', prior, participantKit = false, assignedKit) {
  const dom = new JSDOM(fs.readFileSync(path.join(folder, 'editor-study.html'), 'utf8'), {url: url + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  if (assignedKit !== undefined) {
    const meta = w.document.createElement('meta');
    meta.name = 'journal-editor-assigned-kit'; meta.content = assignedKit; w.document.head.append(meta);
  }
  if (participantKit) {
    w.document.documentElement.setAttribute('data-participant-kit', '');
    w.document.getElementById('dashboard').remove();
    if (typeof participantKit === 'string') {
      const meta = w.document.createElement('meta');
      meta.name = 'journal-editor-kit'; meta.content = participantKit; w.document.head.append(meta);
    }
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

test('두 표기가 같은 오답에 모이는 가상 사례는 전체 일치율을 그대로 유지하고 실측과 분리된다', t => {
  const p = page(t);
  p.el('demo-view').click();
  p.el('demo-example').value = 'agreement';
  p.el('demo-example').dispatchEvent(new p.w.Event('change'));
  assert.match(p.el('data-notice').textContent, /가상 수치 예시/);
  assert.match(p.el('counts').textContent, /4과제 완료 4명/);
  const qualityRow = [...p.el('quality').querySelectorAll('tbody tr')].find(tr => tr.cells[0].textContent === '기준 판정 일치');
  assert.deepEqual([...qualityRow.cells].slice(1).map(cell => cell.textContent), ['75% (6/8)', '75% (6/8)']);
  const cases = p.w.JournalEditorStudy.analyze(p.w.JournalEditorStudy.cueAgreementDemoRecords(), 'demo').bias;
  assert.deepEqual([cases.manualGapPp, cases.journalGapPp], [50, 0]);
  assert.deepEqual(Array.from(cases.cases.filter(c => c.qualityDrops.length), c => c.caseId), ['repair']);
  const alternatives = p.el('cue-case-repair').querySelector('.case-alternatives');
  assert.match(alternatives.textContent, /예산 요구서/);
  assert.match(alternatives.textContent, /원자료 방식 0\/2 · 저널 방식 1\/2/);
  p.el('real-view').click();
  assert.match(p.el('counts').textContent, /등록 0명/);
  assert.equal(p.el('quality').querySelector('tbody'), null);
});

test('오승인 합계가 같아도 반박된 주장 채택의 증가를 예시의 전체·시간 표본에서 확인한다', t => {
  const p = page(t);
  p.el('demo-view').click();
  const selector = p.el('demo-example');
  selector.value = 'adoptions';
  selector.dispatchEvent(new p.w.Event('change'));
  assert.match(p.el('data-notice').textContent, /가상 수치 예시/);
  assert.match(p.el('metrics').textContent, /시간 절감률50%/);
  assert.match(p.el('quality').textContent, /근거 없는 사실 채택50% \(2\/4\)50% \(2\/4\)/);
  assert.deepEqual([...p.el('adoption-quality').querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => cell.textContent)), [
    ['사실 채택 중 판정·대표 근거 모두 일치','66.7% (4/6)','66.7% (4/6)'],
    ['사실 채택 중 판정만 일치 (근거가 다르거나 미지정)','0% (0/6)','0% (0/6)'],
    ['원자료가 반박한 과제 중 사실 채택','0% (0/2)','100% (2/2)'],
    ['근거가 불충분한 과제 중 사실 채택','100% (2/2)','0% (0/2)']
  ]);
  for (const id of ['quality-warning','timed-quality-warning']) {
    assert.equal(p.el(id).hidden,false);
    assert.match(p.el(id).textContent,/원자료가 반박한 과제의 사실 채택률 100%p 상승 \(0\/2 → 2\/2\)/);
  }
  assert.equal(p.el('same-adoption-sample').hidden,false);
  assert.equal(p.el('export-summary').disabled,true);
  p.el('real-view').click();
  assert.equal(p.el('adoption-quality').querySelector('tbody'),null);
  assert.equal(p.el('same-adoption-sample').hidden,true);
});

test('오승인 예시 링크는 해당 표를 열고, 직접 전환하거나 진행 중인 참여자가 열면 현재 선택을 따른다', t => {
  const link = '#demo-adoptions';
  for (const choice of ['real','partial']) {
    const p = page(t,link);
    assert.equal(p.el('demo-example').value,'adoptions');
    assert.equal(p.w.document.activeElement,p.el('fact-adoptions-title'));
    assert.match(p.el('fact-adoptions-title').textContent,/가상 기록/);
    assert.match(p.el('adoption-quality').textContent,/원자료가 반박한 과제 중 사실 채택0% \(0\/2\)100% \(2\/2\)/);
    if (choice === 'real') {
      p.el('real-view').click();
      assert.ok(p.el('demo-options').hidden);
      assert.doesNotMatch(p.el('fact-adoptions-title').textContent,/가상 기록/);
    } else {
      p.el('demo-example').value = choice;
      p.el('demo-example').dispatchEvent(new p.w.Event('change'));
      assert.match(p.el('counts').textContent,/등록 12명/);
      assert.equal(p.el('demo-example').value,'partial');
    }
    assert.equal(p.w.location.hash,'');
  }
  const started = page(t,'#participate');
  started.enroll(1); started.el('begin-trial').click();
  const returning = page(t,link,undefined,started.workspace());
  assert.equal(returning.el('participant').hidden,false);
  assert.equal(returning.el('dashboard').hidden,true);
  assert.equal(returning.el('adoption-quality').querySelector('tbody'),null);
  const kit = page(t,link,undefined,undefined,true);
  assert.equal(kit.el('participant').hidden,false);
  assert.equal(kit.el('adoption-quality'),null);
});

test('진행자는 시간 누락 예시에서 4명과 12명의 결과를 대조하고 개인 실측으로 돌아갈 수 있다', t => {
  const p = page(t);
  const options = p.el('demo-options'), selector = p.el('demo-example'), coverage = p.el('timing-coverage');
  assert.ok(options.hidden);
  p.el('demo-view').click();
  assert.equal(options.hidden, false);
  assert.ok(coverage.hidden);
  selector.value = 'partial';
  selector.dispatchEvent(new p.w.Event('change'));
  assert.match(p.el('data-notice').textContent, /가상 수치 예시/);
  assert.match(p.el('metrics').textContent, /50%/);
  assert.match(p.el('timing-coverage-summary').textContent, /12명.*단축 4명.*증가 8명/);
  assert.match(p.el('timing-coverage-range').textContent, /33\.3%/);
  assert.equal(coverage.hidden, false);
  p.el('real-view').click();
  assert.ok(options.hidden && coverage.hidden);
  assert.match(p.el('counts').textContent, /등록 0명/);
  assert.equal(p.el('timing-coverage-summary').textContent, '');
  p.el('demo-view').click();
  selector.value = 'complete';
  selector.dispatchEvent(new p.w.Event('change'));
  assert.match(p.el('counts').textContent, /등록 8명/);
  assert.ok(coverage.hidden);
});

test('미제출 답의 격차 범위를 완료 묶음과 구분하고 명부 미확인 응답은 범위에서 제외한다', async t => {
  const p = page(t);
  const sample = p.el('missing-answer-sample'), range = p.el('missing-answer-range');
  p.el('demo-view').click();
  const selector = p.el('demo-example');
  selector.value = 'missing';
  selector.dispatchEvent(new p.w.Event('change'));
  assert.match(p.el('metrics').textContent, /격차 감소100%p/);
  assert.match(sample.textContent, /2묶음 · 제출 31\/32건 · 미제출 1건/);
  assert.match(range.textContent, /-50%p ~ -37.5%p.*격차가 커집니다/);
  p.el('real-view').click();
  assert.match(sample.textContent, /등록 기록이 필요/);
  assert.equal(range.textContent, '');
  p.el('issue-codes').click();
  const roster = p.workspace().invitations;
  const confirmed = roster.map(i => completedRecord(i.ordinal, i.id));
  confirmed[3].trials.pop();
  const foreign = [5,6,7,8].map(n => completedRecord(n, 'E' + String(n).padStart(16, '0')));
  await importFiles(p, [JSON.stringify({type:'journal-editor-study-collection-v1', records:foreign}),
    ...confirmed.slice(0,3).map(r => JSON.stringify(r))]);
  assert.match(sample.textContent, /등록 기록이 일부만 있는 1묶음 제외/);
  assert.equal(range.textContent, '');
  await importFiles(p, [JSON.stringify(confirmed[3])]);
  assert.match(p.el('data-notice').textContent, /명부 미확인 4명/);
  assert.match(sample.textContent, /1묶음 · 제출 15\/16건 · 미제출 1건/);
  assert.match(range.textContent, /가정할 때 격차 감소폭/);
  assert.match(p.el('metrics').textContent, /측정 대기/);
});

test('격차 범위에서 발급 후 기록 미수신, 일부 등록 묶음의 회신, 중단한 등록자의 미제출을 구분한다', async t => {
  const p = page(t), sample = p.el('missing-answer-sample'), range = p.el('missing-answer-range');
  p.el('issue-codes').click(); p.el('issue-codes').click();
  assert.match(sample.textContent,/발급 코드 8개 중 등록 기록 미수신 8개/);
  const invites = [...p.workspace().invitations].sort((a,b) => a.ordinal-b.ordinal);
  const results = invites.map(inv => completedRecord(inv.ordinal,inv.id));
  await importFiles(p,results.slice(0,4).map(JSON.stringify));
  assert.match(sample.textContent,/제출 16\/16건 · 미제출 0건/);
  assert.match(sample.textContent,/발급 코드 8개 중 등록 기록 미수신 4개/);
  assert.match(range.textContent,/이 1묶음의 배정 과제 16건이 모두 제출/);
  const stopped = {...results[4],trials:results[4].trials.slice(0,2),withdrawn:true,withdrawalTask:null};
  await importFiles(p,[stopped,results[5]].map(JSON.stringify));
  assert.match(sample.textContent,/1묶음 제외 \(제출 6건\)/);
  assert.match(sample.textContent,/발급 코드 8개 중 등록 기록 미수신 2개/);
  assert.match(p.el('counts').textContent,/중단 확인 1명/);
  await importFiles(p,results.slice(6).map(JSON.stringify));
  assert.match(sample.textContent,/제출 30\/32건 · 미제출 2건/);
  assert.doesNotMatch(sample.textContent,/기록 미수신/);
  p.el('demo-view').click(); assert.doesNotMatch(sample.textContent,/발급 코드/);
});

test('실측이 비었을 때 예시 수치가 실측으로 남지 않는다', t => {
  const p = page(t);
  assert.match(p.el('counts').textContent, /등록 0명/);
  p.el('demo-view').click();
  assert.match(p.el('metrics').textContent, /25%p/);
  assert.match(p.el('metrics').textContent, /120초/);
  assert.match(p.el('quality').textContent, /4\/8/);
  assert.ok(p.el('timed-quality-table').querySelector('tbody'));
  p.el('real-view').click();
  assert.match(p.el('metrics').textContent, /측정 대기/);
  assert.doesNotMatch(p.el('metrics').textContent, /25%/);
  assert.equal(p.el('timed-quality-table').querySelector('tbody'), null);
  assert.equal(p.el('timed-quality-warning').hidden, true);
  assert.equal(p.el('timed-quality-change').textContent, '');
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

test('판본이 있는 과제는 확인한 문서 전용 연결로만 보내고 다른 판본·구형 화면 재개 시 기록을 보존하며 멈춘다', async t => {
  const edition = 'ab'.repeat(32);
  for (const wrong of ['cd'.repeat(32), undefined]) {
    const p = page(t, '', undefined, undefined, edition);
    p.el('invite-code').value = 'J2-3-E0000000000000001-' + edition;
    p.el('qualified').checked = true; p.el('enroll').requestSubmit(); p.el('begin-trial').click();
    const frame = p.w.document.querySelector('iframe'), globalMessages = [], tasks = [];
    frame.contentWindow.postMessage = m => {globalMessages.push(m);};
    const send = (data, ports=[]) => {
      const event = new p.w.MessageEvent('message', {source:frame.contentWindow, origin:p.w.location.origin, data});
      Object.defineProperty(event, 'ports', {value:ports});
      p.w.dispatchEvent(event);
    };
    frame.dispatchEvent(new p.w.Event('load'));
    const challenge = globalMessages.at(-1).challenge;
    assert.equal(globalMessages.at(-1).type, 'journal-study-identify');
    send({type:'journal-study-ready', kitVersion:edition});
    const port = {postMessage:m=>tasks.push(m), close() {}};
    send({type:'journal-study-ready', challenge, kitVersion:edition}, [port]);
    assert.equal(tasks.length, 1); assert.equal(tasks[0].kitVersion, edition);
    const receipt = {type:'journal-study-used', nonce:tasks[0].nonce, status:'held', sourceIds:['doc-2'], reason:'A에서 확인한 근거'};
    send(receipt); port.onmessage({data:receipt}); assert.equal(p.el('reason').value,'');
    port.onmessage({data:{type:'journal-study-loaded',nonce:tasks[0].nonce}});
    port.onmessage({data:receipt}); assert.equal(p.el('reason').value,receipt.reason);
    p.advance(1000); p.el('pause-trial').click(); p.el('resume-trial').click();
    p.el('answer').requestSubmit(); assert.match(p.el('answer-status').textContent,/위 저널 화면/);
    frame.dispatchEvent(new p.w.Event('load'));
    send({type:'journal-study-ready', challenge, kitVersion:edition}, [port]);
    port.onmessage({data:{...receipt,reason:'이전 창에서 뒤늦게 온 메시지'}});
    assert.equal(p.el('reason').value,receipt.reason); assert.equal(tasks.length,1);
    send({type:'journal-study-ready', kitVersion:wrong});
    assert.equal(p.el('pause-pane').hidden,false); assert.match(p.el('session-status').textContent,/원래 참여자 ZIP을 별도 폴더/);
    assert.ok(globalMessages.every(m=>!('article' in m) && !('sources' in m)));
    p.advance(60000); const downloads = captureDownloads(p);
    p.el('export-resume').click(); const saved = JSON.parse(await downloads[0].text());
    assert.equal(saved.record.trials.length,0); assert.equal(saved.session.activeMs,1000);
    assert.equal(saved.session.used,true); assert.equal(saved.session.reason,receipt.reason);
    assert.equal(saved.session.state,'paused');
  }
});
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

test('여러 파일을 접수하다 실패하면 선택 순서와 복구 방법을 표시하고 기존 명부와 회신을 보존한다', async t => {
  const p = page(t);
  p.el('issue-codes').click();
  const before = p.workspace(), invite = before.invitations[0];
  const participant = completedRecord(invite.ordinal, invite.id);
  const backup = JSON.stringify({type:'journal-editor-study-collection-v1', records:[], invitations:before.invitations});
  const cases = [
    ['{"incomplete":"private-report-content",private-report-content}', /JSON을 읽을 수 없습니다/],
    [JSON.stringify({format:'journal-editor-study-resume',version:1}), /이어하기 파일/],
    [JSON.stringify({type:'journal-editor-study-summary-v1',kind:'editor'}), /공유용 실측 요약/],
    [JSON.stringify({kind:'demo'}), /실제 편집자용 참여 기록/],
    [JSON.stringify({type:'journal-editor-study-collection-v1',records:[{}]}), /진행자 백업의 참여 기록/],
  ];
  for (const [raw, expected] of cases) {
    await importFiles(p, [JSON.stringify(participant), raw, backup]);
    const message = p.el('import-status').textContent;
    assert.match(message, /선택한 2번째 파일/);
    assert.match(message, expected);
    assert.match(message, /내 참여 기록 내려받기/);
    assert.doesNotMatch(message, /study-1\.json|private-report-content/);
    assert.deepEqual(p.workspace(), before);
  }
  const conflicting = structuredClone(participant);
  conflicting.trials[0].reason = '같은 회차에 남은 다른 판단 사유';
  await importFiles(p, [JSON.stringify(participant), backup, JSON.stringify(conflicting)]);
  assert.match(p.el('import-status').textContent, /선택한 3번째 파일/);
  assert.doesNotMatch(p.el('import-status').textContent, /다른 판단 사유/);
  assert.deepEqual(p.workspace(), before);

  for (const files of [[JSON.stringify(participant), backup], [backup, JSON.stringify(participant)]]) {
    const fresh = page(t);
    await importFiles(fresh, files);
    assert.match(fresh.el('import-status').textContent, /현재 등록 1명/);
    assert.equal(fresh.workspace().invitations.length, 4);
    assert.equal(fresh.workspace().records[0].trials.length, 4);
  }
});

test('진행자는 같은 행의 배정 코드와 ZIP을 복사하고 복사가 제한되면 코드 전체를 선택한다', async t => {
  const current = 'cd'.repeat(32), previous = 'ab'.repeat(32);
  const p = page(t, '', undefined, undefined, false, current);
  const priorCode = 'J2-1-E0000000000000001-' + previous;
  p.el('roster-code').value = priorCode;
  p.el('recover-roster').requestSubmit();
  p.el('issue-codes').click();
  const rows = [...p.el('invites').querySelectorAll('tbody tr')];
  assert.equal(rows.length, 5);
  assert.equal(rows[0].querySelector('a'), null);
  assert.match(rows[0].cells[3].textContent, /abababababab.*발급한 진행자 폴더/);
  let copied;
  Object.defineProperty(p.w.navigator, 'clipboard', {value:{writeText:async code => {copied = code;}}});
  rows[1].querySelector('button').click();
  await t.waitFor(() => assert.match(p.el('import-status').textContent, /복사했습니다/));
  assert.equal(copied, rows[1].querySelector('code').textContent);
  assert.ok(copied.endsWith(current));
  assert.equal(rows[1].querySelector('a[download]').getAttribute('href'), 'participant-editor-study.zip');
  p.w.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  rows[3].querySelector('button').click();
  await t.waitFor(() => assert.match(p.el('import-status').textContent, /코드 전체를 선택/));
  assert.equal(p.w.getSelection().toString(), rows[3].querySelector('code').textContent);
});

test('J2는 지정한 참가자 ZIP에서만 등록하고, 재개와 응답 저장 중에도 처음 발급한 코드를 유지한다', async t => {
  const a = 'ab'.repeat(32), b = 'cd'.repeat(32);
  const coordinator = page(t, '', undefined, undefined, false, a);
  coordinator.el('issue-codes').click();
  const roster = coordinator.workspace().invitations;
  assert.equal(roster.length, 4);
  for (const row of roster) assert.equal(row.code, 'J2-' + row.ordinal + '-' + row.id + '-' + a);
  const row = roster.find(inv => inv.ordinal === 1);
  function enter(p) {
    p.el('qualified').checked = true; p.el('invite-code').value = ' ' + row.code.toUpperCase() + ' ';
    p.el('enroll').requestSubmit();
  }
  for (const [kit,stamp] of [[b,a], [true,a], [false,a], [false,undefined]]) {
    const wrong = page(t, '#participate', undefined, undefined, kit, stamp); enter(wrong);
    assert.match(wrong.el('enroll-status').textContent, /코드와 함께 보낸 ZIP/);
    assert.equal(wrong.el('stimulus-article').textContent, '');
    assert.equal(wrong.el('run').hidden, true); assert.equal(wrong.w.localStorage.length, 0);
  }
  const valid = page(t, '', undefined, undefined, a); enter(valid);
  const key = 'journal-editor-study-participant-v1/' + row.code;
  valid.el('begin-trial').click(); valid.advance(1000); valid.el('pause-trial').click();
  const blobs = captureDownloads(valid); valid.el('export-resume').click();
  assert.ok(valid.el('transfer-status').textContent.includes(row.code));
  const checkpoint = JSON.parse(await blobs.at(-1).text());
  const next = page(t, '', undefined, undefined, a); enter(next); await restoreParticipant(next, checkpoint);
  next.el('resume-trial').click(); next.advance(1000); next.answer();
  const saved = captureDownloads(next); next.el('export-one').click();
  const response = JSON.parse(await saved.at(-1).text());
  assert.equal(response.participantId, row.id); assert.equal(response.trials[0].kitVersion, a);
  assert.deepEqual(JSON.parse(next.w.localStorage.getItem(key)).records, [response]);
});

test('묶음의 기존 판본을 보존하고 같은 배정의 J1·J2 또는 서로 다른 J2 명부를 합치지 않는다', async t => {
  const a = 'ab'.repeat(32), b = 'cd'.repeat(32), id = 'E123456789ABCDEF0';
  const legacy = 'J1-1-' + id, current = 'J2-1-' + id + '-' + a, other = 'J2-1-' + id + '-' + b;
  for (const [prior, from] of [[legacy,5], [other,5], [current,2]]) {
    const p = page(t, '', undefined, undefined, false, a);
    p.el('roster-code').value = prior.toLowerCase(); p.el('recover-roster').requestSubmit();
    const existing = p.workspace().invitations;
    assert.deepEqual(existing,[{ordinal:1,id,code:prior}]);
    for (const conflict of [legacy, current, other].filter(c => c !== prior)) {
      p.el('roster-code').value = conflict; p.el('recover-roster').requestSubmit();
      assert.match(p.el('import-status').textContent, /초대 코드 판본이 다릅니다/);
      const backup = {type:'journal-editor-study-collection-v1',records:[],invitations:[{ordinal:1,id,code:conflict}]};
      await importFiles(p, [JSON.stringify(backup)]);
      assert.deepEqual(p.workspace().invitations,existing);
      assert.match(p.el('import-status').textContent, /초대 코드 판본이 다릅니다/);
    }
    p.el('issue-codes').click();
    const issued = p.workspace().invitations.slice(1);
    assert.equal(issued.length, from === 5 ? 4 : 3);
    assert.deepEqual(issued.map(inv => inv.ordinal).sort((x,y)=>x-y), Array.from({length:issued.length}, (_,i)=>from+i));
    assert.ok(issued.every(inv => inv.code === 'J2-' + inv.ordinal + '-' + inv.id + '-' + a));
  }
  const broken = page(t, '', undefined, undefined, false, 'broken');
  broken.el('issue-codes').click(); assert.match(broken.el('import-status').textContent, /배포본을 다시/);
  assert.equal(broken.workspace(),null);
});

test('참여 등록 화면에서 집계로 갈 수 없고, 참여를 닫으면 빈 등록 화면으로 돌아간다', t => {
  const p = page(t, '#participate');
  assert.equal(p.el('enroll-box').querySelector('a[href="#dashboard"]'), null);
  p.w.confirm = () => true;
  p.enroll(1);
  p.el('withdraw').click();
  assert.equal(p.workspace().records[0].withdrawalTask, null);
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

test('쉰 시간을 알 수 없어도 남은 답을 제출하고 닫힌 시간은 전체 비교와 측정 구간 양쪽에서 제외한다', t => {
  const p = page(t, '#participate'); p.enroll(1); p.el('begin-trial').click();
  p.advance(700); p.w.dispatchEvent(new p.w.Event('pagehide'));
  const saved = p.workspace();
  saved.session.segmentAt = Date.now() - 60000;
  const q = page(t, '#participate', undefined, saved);
  // First recovery is attested. An independent, later break leaves the total unknown.
  q.el('resume-unbroken').click(); q.advance(300); q.w.dispatchEvent(new q.w.Event('pagehide'));
  const again = q.workspace();
  again.session.segmentAt = Date.now() + 60000;
  const r = page(t, '#participate', undefined, again);
  r.el('resume-partial').click(); r.advance(200); r.w.dispatchEvent(new r.w.Event('pagehide'));
  const last = page(t, '#participate', undefined, r.workspace());
  assert.equal(last.el('resume-unbroken').hidden, true);
  last.el('resume-partial').click(); last.advance(100); last.answer();
  const record = last.workspace().records[0];
  assert.equal(record.trials[0].elapsedMs, null);
  assert.equal(record.trials[0].observedMs, 1300);
  assert.equal(record.trials[0].phaseMs, null);
  assert.equal(record.trials[0].verdict, 'supported');
  assert.equal(last.workspace().session.state, 'ready');
  last.el('begin-trial').click();
  assert.equal(last.workspace().session.partialTime, false);
});

test('브라우저가 이전 페이지를 메모리에서 복원해도 떠나 있던 시간을 자동 합산하지 않는다', t => {
  for (const paused of [false, true]) {
    const p = page(t, '#participate'); p.enroll(1); p.el('begin-trial').click();
    p.advance(600);
    if (paused) p.el('pause-trial').click();
    p.w.dispatchEvent(new p.w.PageTransitionEvent('pagehide', {persisted:true}));
    p.advance(60000);
    p.w.dispatchEvent(new p.w.PageTransitionEvent('pageshow', {persisted:true}));
    assert.equal(p.el('recovery').hidden, paused);
    assert.equal(p.el('pause-pane').hidden, !paused);
    p.el(paused ? 'resume-trial' : 'resume-partial').click();
    p.advance(300); p.answer();
    const trial = p.workspace().records[0].trials[0];
    assert.equal(trial.elapsedMs, paused ? 900 : null);
    assert.equal(trial.observedMs, paused ? undefined : 900);
  }
});

test('강제 종료로 떠나는 이벤트를 받지 못해도 마지막 답안 저장 시점까지 직접 잰 시간을 복구한다', t => {
  const p = page(t, '#participate'); p.enroll(1); p.el('begin-trial').click();
  p.advance(45000); p.el('reason').value = '본문과 표를 대조하는 중';
  p.el('reason').dispatchEvent(new p.w.Event('input', {bubbles:true}));
  const saved = p.workspace();
  assert.equal(saved.session.activeMs, 45000);
  const q = page(t, '#participate', undefined, saved);
  q.el('resume-partial').click();
  assert.equal(q.el('reason').value, '본문과 표를 대조하는 중');
  q.advance(300); q.answer();
  const trial = q.workspace().records[0].trials[0];
  assert.equal(trial.elapsedMs, null);
  assert.equal(trial.observedMs, 45300);
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

test('공유 요약은 사실 채택의 검증 결과를 전체와 시간 표본의 실제 분모로 내보낸다', async t => {
  const p = page(t);
  const files = captureDownloads(p);
  async function summary() {
    p.el('export-summary').click();
    return JSON.parse(await files.at(-1).text()).overall.factAdoptions;
  }
  const empty = await summary();
  assert.equal(empty.all.manual.total,0);
  assert.equal(empty.all.manual.verified,null);
  assert.deepEqual(empty.all.manual.contradicted,{accepted:null,eligible:0,pct:null});
  assert.deepEqual(empty.timed,empty.all);
  p.el('issue-codes').click(); p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const r = completedRecord(inv.ordinal,inv.id);
    for (const trial of r.trials) {
      const gold = p.w.JournalStudyCases.get(trial.caseId,trial.variant);
      trial.verdict = 'insufficient';
      trial.sourceIds = gold.expectedSourceIds.slice();
      if (inv.ordinal > 4 && trial.method === 'journal') {
        trial.verdict = 'supported';
        if (trial.caseId === 'transit') trial.sourceIds = [];
      }
    }
    if (inv.ordinal === 5) Object.assign(r.trials[0],{elapsedMs:null,observedMs:5000});
    return r;
  });
  await importFiles(p,records.map(r => JSON.stringify(r)));
  const detail = await summary();
  assert.deepEqual(detail.all.journal,{
    total:8, verified:2, otherSource:2, verifiedPct:25, otherSourcePct:25,
    contradicted:{accepted:2,eligible:4,pct:50}, insufficient:{accepted:2,eligible:4,pct:50}
  });
  assert.deepEqual(detail.timed.journal,{
    total:0, verified:0, otherSource:0, verifiedPct:null, otherSourcePct:null,
    contradicted:{accepted:0,eligible:2,pct:0}, insufficient:{accepted:0,eligible:2,pct:0}
  });
  assert.deepEqual(detail.timed.manual,detail.timed.journal);
  assert.match(p.el('adoption-quality').textContent,/판정만 일치.*— \(0\/0\)25% \(2\/8\)/);
  assert.match(p.el('timed-quality-table').textContent,/판정만 일치.*— \(0\/0\)— \(0\/0\)/);
  assert.equal(p.el('same-adoption-sample').hidden,true);
  assert.doesNotMatch(JSON.stringify(detail),/participantId|trials|reason|sourceIds|E[0-9A-F]{16}/);
});

test('같은 판본 표는 원래 네 명이 함께 사용한 자료로 시간·판정·정당 표기 격차를 계산한다', async t => {
  const p = page(t), kits = ['a'.repeat(64), 'b'.repeat(64)];
  for (let i = 0; i < 4; i++) p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const r = completedRecord(inv.ordinal, inv.id);
    const which = Math.ceil(r.ordinal / 4);
    for (const trial of r.trials) {
      if (which === 1 || which === 2 || which === 3) trial.kitVersion = kits[
        which === 1 || (which === 2 && r.ordinal % 2 === 0) ? 0 : 1];
      if (which === 3) {
        trial.verdict = 'insufficient'; trial.sourceIds = [];
        if (trial.method === 'manual') trial.elapsedMs = 10000;
      }
    }
    if (r.ordinal === 9) Object.assign(r.trials[0], {elapsedMs:null, observedMs:950});
    return r;
  });
  await importFiles(p, records.map(r => JSON.stringify(r)));
  assert.match(p.el('data-notice').textContent, /판본을 구분하지 않고 계산/);
  assert.match(p.el('edition-coverage').textContent, /같은 판본 확인 2묶음.*여러 판본 확인 1묶음.*판본 미확인 1묶음/);
  const sections = [...p.el('edition-tables').children];
  assert.equal(sections.length, 2);
  const a = sections.find(s => s.textContent.includes(kits[0]));
  const b = sections.find(s => s.textContent.includes(kits[1]));
  assert.match(a.textContent, /배정 묶음 1번 · 판정 4명 16건 · 시간 비교 4명 16건/);
  assert.match(a.textContent, /사례당 평균 검토 시간60초30초50% 감소/);
  assert.match(a.textContent, /검증 성공 1건당 총투입 시간160초 \(성공 3\/8건\)30초 \(성공 8\/8건\)81.3% 감소/);
  assert.match(a.textContent, /판정과 대표 근거 모두 일치.*100% \(8\/8\)/);
  assert.match(a.textContent, /정당 표기별 사실 채택률 격차100%p0%p100%p 감소/);
  assert.match(b.textContent, /배정 묶음 3번 · 판정 4명 16건 · 시간 비교 0명 0건/);
  assert.match(b.textContent, /전체 시간이 기록된 묶음 대기/);
  assert.match(b.textContent, /0% \(0\/8\)/);
  assert.match(b.textContent, /원자료 격차 0%p로 상대율 계산 불가/);
  assert.match(p.el('edition-block-table').textContent, /2번여러 판본 확인/);
  p.el('demo-view').click();
  assert.ok(p.el('edition-results').hidden);
  p.el('real-view').click();
  assert.equal(p.el('edition-results').hidden, false);
});

test('판본별 가상 예시에서 성공당 시간과 표기 격차를 바로 읽고 빈 실제 집계로 돌아온다', t => {
  const p = page(t);
  p.el('demo-view').click();
  p.el('demo-example').value = 'editions';
  p.el('demo-example').dispatchEvent(new p.w.Event('change'));
  assert.equal(p.el('edition-results').hidden, false);
  assert.match(p.el('edition-coverage').textContent, /같은 판본 확인 1묶음 · 여러 판본 확인 1묶음/);
  const content = p.el('edition-tables').textContent;
  assert.match(content, /가상 참여자 자료 A/);
  assert.match(content, /검증 성공 1건당 총투입 시간60초 \(성공 8\/8건\)120초 \(성공 2\/8건\)100% 증가/);
  assert.match(content, /정당 표기별 사실 채택률 격차0%p100%p100%p 증가/);
  p.el('real-view').click();
  assert.equal(p.el('edition-tables').querySelector('table'), null);
  assert.equal(p.el('edition-success-note').hidden, true);
  assert.match(p.el('counts').textContent, /등록 0명/);
});

test('같은 판본에서 평균이 빨라져도 검증 성공이 줄면 성공당 투입 시간은 증가로 표시한다', async t => {
  const p = page(t), kit = 'd'.repeat(64);
  p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const r = completedRecord(inv.ordinal, inv.id);
    for (const trial of r.trials) {
      trial.kitVersion = kit;
      if (trial.method === 'manual') {
        trial.verdict = p.w.JournalStudyCases.get(trial.caseId, trial.variant).expectedVerdict;
      } else if (r.ordinal !== 1) trial.sourceIds = [];
    }
    return r;
  });
  await importFiles(p, records.map(r => JSON.stringify(r)));
  const table = p.el('edition-tables').querySelector('tbody');
  assert.match(table.textContent, /사례당 평균 검토 시간60초30초50% 감소/);
  assert.match(table.textContent, /검증 성공 1건당 총투입 시간60초 \(성공 8\/8건\)120초 \(성공 2\/8건\)100% 증가/);
});

test('시간이 절반으로 줄어도 같은 편집자들의 성공률 하락을 전체 집계가 가리지 않는다', async t => {
  const p = page(t);
  p.el('issue-codes').click(); p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const r = completedRecord(inv.ordinal, inv.id);
    for (const trial of r.trials) {
      const gold = p.w.JournalStudyCases.get(trial.caseId, trial.variant);
      const succeeds = (trial.method === 'manual') === (inv.ordinal <= 4);
      trial.verdict = succeeds ? gold.expectedVerdict : 'supported';
      trial.sourceIds = succeeds ? [gold.expectedSourceIds[0]] : [];
      trial.elapsedMs = trial.method === 'manual' ? 120000 : 60000;
    }
    if (inv.ordinal === 5) {
      r.trials[0].elapsedMs = null;
      r.trials[0].observedMs = 5000;
    }
    return r;
  });
  await importFiles(p, records.map(r => JSON.stringify(r)));
  const rows = () => [...p.el('timed-quality-table').querySelectorAll('tbody tr')].map(row => [...row.cells].map(c => c.textContent));
  assert.match(p.el('metrics').textContent, /시간 절감률50%/);
  assert.equal(p.el('quality-warning').hidden, true);
  assert.match(p.el('quality').textContent, /판정과 근거 모두 일치50% \(8\/16\)50% \(8\/16\)/);
  assert.match(p.el('timed-quality-sample').textContent, /8명 중.*4명/);
  assert.deepEqual(rows().map(row => row.slice(1)), [
    ['960초','480초'], ['100% (8/8)','50% (4/8)'], ['100% (8/8)','0% (0/8)'],
    ['100% (8/8)','0% (0/8)'], ['0% (0/4)','100% (4/4)'], ['120초','산출 불가 (성공 0건)'],
    ['120초 (8건)','산출 불가 (0건)'], ['산출 불가 (0건)','60초 (8건)'],
    ['100% (4/4)','0% (0/8)'], ['0% (0/4)','50% (4/8)'],
    ['0% (0/2)','100% (2/2)'], ['0% (0/2)','100% (2/2)']
  ]);
  assert.equal(p.el('timed-quality-warning').hidden, false);
  assert.match(p.el('timed-quality-warning').textContent, /판정·근거 동시 일치율 100%p 하락.*근거 없는 사실 채택률 100%p 상승/);
  assert.match(p.el('timed-quality-change').textContent, /성공이 0건/);
  assert.match(p.el('timed-quality-editors').textContent, /빨라진 편집자 4명 중.*줄어든 사람은 4명/);
  p.el('demo-view').click();
  assert.doesNotMatch(p.el('timed-quality-change').textContent, /성공이 0건/);
  p.el('real-view').click();
  assert.deepEqual(rows().find(row => row[0] === '판정과 근거 모두 일치'), ['판정과 근거 모두 일치','100% (8/8)','0% (0/8)']);
});

for (const lower of ['기준 판정', '대표 근거']) {
  test('검증 성공률이 같아도 시간을 비교한 묶음에서 ' + lower + ' 일치율만 낮아지면 표시한다', async t => {
    const p = page(t);
    p.el('issue-codes').click(); p.el('issue-codes').click();
    const records = p.workspace().invitations.map(inv => {
      const r = completedRecord(inv.ordinal, inv.id);
      for (const trial of r.trials) {
        const gold = p.w.JournalStudyCases.get(trial.caseId, trial.variant);
        const matched = trial.variant === 'A';
        // Block 2 reverses the difference seen in the timed block. All A trials pass both checks.
        const targetCorrect = matched || (trial.method === 'manual') === (inv.ordinal <= 4);
        const verdictCorrect = lower === '기준 판정' ? targetCorrect : matched;
        const sourceCorrect = lower === '대표 근거' ? targetCorrect : matched;
        trial.verdict = verdictCorrect ? gold.expectedVerdict : 'opinion';
        trial.sourceIds = sourceCorrect ? [gold.expectedSourceIds[0]] : [];
      }
      if (inv.ordinal === 5) Object.assign(r.trials[0], {elapsedMs:null, observedMs:5000});
      return r;
    });
    await importFiles(p, records.map(r => JSON.stringify(r)));
    const warning = p.el('timed-quality-warning');
    assert.equal(p.el('quality-warning').hidden, true);
    assert.match(p.el('timed-quality-change').textContent, /50%\) 줄었습니다/);
    assert.match(p.el('timed-quality-table').textContent, /판정과 근거 모두 일치50% \(4\/8\)50% \(4\/8\)/);
    assert.ok(p.el('timed-quality-table').textContent.includes(lower + ' 일치100% (8/8)50% (4/8)'));
    assert.equal(warning.hidden, false);
    assert.equal(warning.textContent, '시간을 비교한 4명이 저널을 썼을 때 원자료 대비 ' + lower + ' 일치율 50%p 하락.');
  });
}

test('시간 단축과 성공당 시간 증가를 서로 다른 분모로 표시한다', async t => {
  const p = page(t);
  p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const r = completedRecord(inv.ordinal, inv.id);
    for (const trial of r.trials) {
      const gold = p.w.JournalStudyCases.get(trial.caseId, trial.variant);
      trial.verdict = gold.expectedVerdict;
      trial.sourceIds = trial.method === 'manual' || inv.ordinal === 1 ? [gold.expectedSourceIds[0]] : [];
      trial.elapsedMs = trial.method === 'manual' ? 120000 : 60000;
    }
    return r;
  });
  await importFiles(p, records.map(r => JSON.stringify(r)));
  assert.match(p.el('metrics').textContent, /시간 절감률50%/);
  assert.match(p.el('timed-quality-table').textContent, /검증 성공 1건당 총투입 시간120초240초/);
  assert.match(p.el('timed-quality-change').textContent, /120초\(100%\) 늘었습니다/);
  assert.match(p.el('timed-quality-editors').textContent, /줄어든 사람은 3명, 같은 사람은 1명/);
  assert.match(p.el('timed-quality-editors').textContent, /빨라진 4명 중.*0건 3명, 1건 0명, 2건 1명/);
});

test('진행자 표에서 성공당 총투입 시간이 같은 두 모집의 성공 과제와 실패 과제 시간을 구분한다', async t => {
  for (const [journalSuccessSeconds, journalFailedSeconds] of [[95,5], [5,95]]) {
    const p = page(t);
    p.el('issue-codes').click();
    const records = p.workspace().invitations.map(inv => {
      const r = completedRecord(inv.ordinal, inv.id);
      for (const trial of r.trials) {
        const gold = p.w.JournalStudyCases.get(trial.caseId, trial.variant);
        const verified = ['transit','filing'].includes(trial.caseId);
        const seconds = trial.method === 'manual' ? (verified ? 80 : 120) : (verified ? journalSuccessSeconds : journalFailedSeconds);
        trial.elapsedMs = seconds * 1000;
        trial.verdict = gold.expectedVerdict;
        trial.sourceIds = verified ? [gold.expectedSourceIds[0]] : [];
      }
      return r;
    });
    await importFiles(p, records.map(r => JSON.stringify(r)));
    const rows = [...p.el('timed-quality-table').querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => cell.textContent));
    assert.deepEqual(rows.slice(-3), [
      ['검증 성공 1건당 총투입 시간','200초','100초'],
      ['성공한 과제의 평균 시간','80초 (4건)', journalSuccessSeconds + '초 (4건)'],
      ['실패한 과제의 평균 시간','120초 (4건)', journalFailedSeconds + '초 (4건)']
    ]);
    assert.match(p.el('timed-quality-editors').textContent, /같은 사람은 4명/);
  }
});

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
  participant.el('begin-trial').click(); participant.advance(1300);
  participant.el('pause-trial').click(); participant.advance(30000);
  participant.el('resume-trial').click(); participant.advance(1000);
  participant.el('withdraw').click(); participant.el('export-finished').click();
  const [active, stopped] = await Promise.all(participantFiles.map(file => file.text()));
  assert.equal(JSON.parse(stopped).withdrawn, true);
  const expected = {...require('../docs/reader/editor-study-core.js').plan(1)[1], elapsedMs:2300, partial:false, kitVersion:null};
  assert.deepEqual(JSON.parse(stopped).withdrawalTask, expected);
  await importFiles(coordinator, [stopped, active]);
  assert.match(coordinator.el('counts').textContent, /중단 확인 1명/);
  assert.match(coordinator.el('counts').textContent, /분석 0명 · 0건/);
  const row = p => [...p.el('withdrawal-table').querySelector('tbody tr').cells].map(cell => cell.textContent);
  assert.deepEqual(row(coordinator), ['저널','1','2.3','0']);
  const backup = captureDownloads(coordinator);
  coordinator.el('export-all').click();
  const restored = page(t);
  await importFiles(restored, [await backup[0].text()]);
  assert.match(restored.el('counts').textContent, /중단 확인 1명/);
  assert.deepEqual(row(restored), row(coordinator));
  assert.deepEqual(restored.workspace().records[0].withdrawalTask, expected);
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
    assert.ok(!Object.hasOwn(record, 'withdrawalTask'));
    assert.equal(record.trials.length, 1);
  }
});

test('휴식 중 철회는 측정 총시간을, 복구 화면과 재개 뒤 철회는 확인 가능한 구간만 내보낸다', t => {
  const p = page(t,'#participate'); p.enroll(1); p.el('begin-trial').click();
  p.advance(600); p.el('pause-trial').click(); p.advance(10000);
  const paused = p.workspace();
  const finish = (q, button = 'withdraw') => {
    q.w.confirm = () => true; q.el(button).click();
    return q.workspace().records[0].withdrawalTask;
  };
  assert.equal(finish(p).elapsedMs,600);
  const q = page(t,'#participate',undefined,paused);
  q.el('resume-trial').click(); q.advance(500);
  q.w.dispatchEvent(new q.w.Event('pagehide'));
  const interrupted = q.workspace();
  interrupted.session.segmentAt = Date.now() - 60000;
  for (const resume of [false,true]) {
    const r = page(t,'#participate',undefined,interrupted);
    if (resume) { r.el('resume-unbroken').click(); r.advance(200); r.el('pause-trial').click(); }
    const task = finish(r, resume ? 'withdraw' : 'stop-interrupted');
    assert.equal(task.partial,true);
    assert.equal(task.elapsedMs,resume ? 1300 : 1100);
  }
  // A legacy resumed timer without phase data cannot distinguish measured and recovered time.
  delete paused.session.recoveredMs;
  paused.session.phaseMs = null;
  const legacy = page(t,'#participate',undefined,paused);
  legacy.el('resume-trial').click(); legacy.advance(120);
  const task = finish(legacy);
  assert.equal(task.partial,true);
  assert.equal(task.elapsedMs,120);
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

test('포함한 묶음에 따라 평균 시간이 늘거나 줄면 절감률 바로 아래에 표시한다', async t => {
  const p = page(t);
  p.el('issue-codes').click();
  p.el('issue-codes').click();
  const records = p.workspace().invitations.map(({ordinal, id}) => {
    const record = completedRecord(ordinal, id);
    for (const trial of record.trials)
      trial.elapsedMs = trial.method === 'manual' ? 60000 : ordinal <= 4 ? 10000 : 90000;
    return JSON.stringify(record);
  });
  await importFiles(p, records.slice(0, 4));
  const card = () => p.el('metrics').firstElementChild.textContent;
  assert.doesNotMatch(card(), /묶음 중 하나씩 제외/);
  await importFiles(p, records.slice(4));
  assert.match(card(), /시간 절감률16.7%/);
  assert.match(card(), /2묶음 중 하나씩 제외한 결과 50% 증가 ~ 83.3% 절감/);
  assert.match(card(), /시간이 줄었는지 늘었는지가 달라집니다/);
});

test('미완성 묶음의 개인 완료자는 가상 예시와 명부 확인 실측에서 따로 집계한다', async t => {
  const p = page(t,'#demo-unfinished-blocks');
  const panel = p.el('individual-time');
  assert.equal(p.el('demo-example').value,'unfinished-blocks');
  assert.equal(p.w.document.activeElement,p.el('individual-time-title'));
  assert.equal(panel.hidden,false);
  assert.match(p.el('individual-time-title').textContent,/가상 기록/);
  assert.match(panel.textContent,/등록 12명 중 개인 완료 10명, 미완료 2명/);
  assert.match(panel.textContent,/단축 4명 · 동일 0명 · 증가 6명 · 미확정 0명/);
  assert.match(panel.textContent,/10명 중 검토 시간이 줄어든 인원은 4명 \(40%\)/);
  assert.match(p.el('metrics').textContent,/시간 절감률50%/);
  assert.equal(p.el('export-summary').disabled,true);
  p.el('real-view').click();
  assert.equal(p.w.location.hash,'');
  assert.equal(panel.hidden,true);
  assert.equal(p.el('individual-time-directions').textContent,'');
  p.el('issue-codes').click();
  const files = p.workspace().invitations.slice(0,2).map(inv=>completedRecord(inv.ordinal,inv.id));
  Object.assign(files[1].trials.find(t=>t.method==='journal'),{elapsedMs:null,observedMs:10});
  const outside = completedRecord(8,'E0000000000000008');
  await importFiles(p,[...files.map(r=>JSON.stringify(r)),JSON.stringify({type:'journal-editor-study-collection-v1',records:[outside]})]);
  assert.equal(panel.hidden,false);
  assert.doesNotMatch(panel.textContent,/가상 기록/);
  assert.match(panel.textContent,/등록 2명 중 개인 완료 2명, 미완료 0명/);
  assert.match(panel.textContent,/상단 평균 시간 비교에는 0명/);
  assert.match(panel.textContent,/단축 1명 · 동일 0명 · 증가 0명 · 미확정 1명/);
  assert.match(panel.textContent,/1~2명 \(50~100%\)/);
  const downloads = captureDownloads(p);
  p.el('export-summary').click();
  const saved = JSON.parse(await downloads.at(-1).text());
  assert.equal(saved.unconfirmedEditors,1);
  assert.equal(saved.overall.time.reductionPct,null);
  assert.deepEqual(saved.overall.individualCompletionTiming,{
    registeredEditors:2, completedEditors:2, unfinishedEditors:0, outsideCompleteBlocks:2,
    directions:{total:2,faster:1,slower:0,unchanged:0,unknown:1,possibleFaster:2}
  });
  assert.ok(!JSON.stringify(saved).includes(files[0].participantId));
});

test('중단한 타이머가 있으면 완성한 묶음 전체의 시간 단축 가능 범위를 따로 표시한다', async t => {
  const p = page(t);
  for (let block = 0; block < 3; block++) p.el('issue-codes').click();
  const files = p.workspace().invitations.slice(0, 9).map(({ordinal, id}) => {
    const record = completedRecord(ordinal, id);
    for (const trial of record.trials) {
      const manual = trial.method === 'manual';
      trial.elapsedMs = manual === (ordinal <= 4) ? 60000 : 30000;
      if (ordinal === 8 && trial.variant === 'A') {
        trial.elapsedMs = null; trial.observedMs = 20000;
      }
    }
    return JSON.stringify(record);
  });
  await importFiles(p, files);
  const panel = p.el('timing-coverage');
  assert.equal(panel.hidden, false);
  assert.match(p.el('counts').textContent, /4과제 완료 9명/);
  assert.match(panel.textContent, /네 명 모두 과제를 마친 묶음의 8명/);
  assert.match(panel.textContent, /단축 4명 · 동일 0명 · 증가 3명 · 미확정 1명/);
  assert.match(panel.textContent, /4~5명 \(50~62.5%\)/);
  assert.doesNotMatch(panel.textContent, /E[0-9a-f]{16}/i);
  p.el('demo-view').click();
  assert.equal(panel.hidden, true);
  assert.equal(p.el('timing-coverage-range').textContent, '');
  p.el('real-view').click();
  assert.equal(panel.hidden, false);
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

test('같은 사실 채택률에서도 근거 불충분과 반박 응답을 구분해 집계 화면에 표시한다', async t => {
  const p = page(t);
  assert.match(p.el('distribution-gap').textContent, /완성된 4인 묶음/);
  p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const record = completedRecord(inv.ordinal, inv.id);
    for (const trial of record.trials) {
      trial.verdict = trial.caseId === 'permits' && trial.method === 'manual' && trial.variant === 'B' ? 'contradicted' : 'insufficient';
    }
    return record;
  });
  await importFiles(p, records.map(record => JSON.stringify(record)));
  assert.match(p.el('metrics').textContent, /사실 채택률 격차 변화 없음0%p/);
  assert.match(p.el('distribution-gap').textContent, /원자료 25%p → 저널 0%p · 25%p 감소/);
  const raw = [...p.el('cells').querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => cell.textContent));
  assert.deepEqual(raw.find(row => row[0] === '인허가 처리 기간' && row[1] === '근거와 충돌').slice(2), ['0/1','1/1','0/1','0/1']);
});

test('격차가 줄면서 검증 일치율이 하락한 사례는 집계 카드에서 해당 기사와 기준 근거로 바로 연다', async t => {
  const p = page(t);
  const area = p.el('case-quality'), list = p.el('case-quality-list');
  assert.equal(area.hidden, true);
  assert.equal(list.children.length, 0);
  p.el('demo-view').click();
  assert.equal(list.querySelectorAll(':scope > details').length, 4);
  assert.match(p.el('cue-case-repair').textContent, /근거로 지지됨 1\/2 · 근거와 충돌 1\/2/);
  p.el('real-view').click();
  assert.equal(area.hidden, true);
  assert.equal(list.textContent, '');
  assert.equal(p.el('metrics').querySelector('button[aria-controls^="cue-case-"]'), null);
  p.el('issue-codes').click();
  const returned = p.workspace().invitations.map(inv => {
    const record = completedRecord(inv.ordinal, inv.id);
    for (const trial of record.trials) {
      const item = p.w.JournalStudyCases.get(trial.caseId, trial.variant);
      const wrong = trial.caseId === 'repair' && (trial.method === 'journal' || trial.variant === 'B');
      trial.verdict = wrong ? 'supported' : item.expectedVerdict;
      trial.sourceIds = wrong ? [] : item.expectedSourceIds;
      trial.reason = '화면에 표시하지 않을 개인 메모';
    }
    return JSON.stringify(record);
  });
  await importFiles(p, returned);
  const link = p.el('metrics').querySelector('button[aria-controls="cue-case-repair"]');
  const detail = p.el('cue-case-repair');
  assert.ok(link);
  assert.equal(area.hidden, false);
  assert.equal(list.querySelectorAll(':scope > details').length, 4);
  assert.equal(detail.open, false);
  link.click();
  assert.equal(detail.open, true);
  assert.equal(p.w.document.activeElement, detail.querySelector('summary'));
  const article = p.w.JournalStudyCases.get('repair','A');
  const source = article.sources.find(s => article.expectedSourceIds.includes(s.id));
  for (const expected of [article.article, p.w.JournalStudyCases.get('repair','B').article, article.question,
    '기준 판정 · 근거와 충돌', source.title, source.version, source.locator, source.excerpt,
    '기준 판정 일치', '대표 근거 일치', '판정·근거 동시 일치', '50% (1/2) → 0% (0/2)']) {
    assert.ok(detail.textContent.includes(expected), expected);
  }
  assert.ok(!detail.textContent.includes('화면에 표시하지 않을 개인 메모'));
  assert.doesNotMatch(detail.textContent, /E[0-9a-f]{16}/i);
  assert.deepEqual([...detail.querySelector('.scroll').querySelectorAll('tbody tr')].map(tr=>[...tr.cells].map(td=>td.textContent)), [
    ['보수 성향 표기 · 원자료','100% (1/1)','100% (1/1)','100% (1/1)','근거와 충돌 1/1'],
    ['보수 성향 표기 · 저널','0% (0/1)','0% (0/1)','0% (0/1)','근거로 지지됨 1/1'],
    ['진보 성향 표기 · 원자료','0% (0/1)','0% (0/1)','0% (0/1)','근거로 지지됨 1/1'],
    ['진보 성향 표기 · 저널','0% (0/1)','0% (0/1)','0% (0/1)','근거로 지지됨 1/1']
  ]);
  p.el('demo-view').click();
  assert.equal(p.el('metrics').querySelector('[aria-controls="cue-case-repair"]'), null);
  assert.equal(p.el('cue-case-repair').open, false);
  p.el('real-view').click();
  assert.ok(p.el('metrics').querySelector('[aria-controls="cue-case-repair"]'));
  assert.equal(p.el('cue-case-repair').open, false);
});

test('판정 일치율이 같고 대표 근거 일치율만 내려간 기사에서 실제 선택한 다른 자료와 미지정을 대조한다', async t => {
  const p = page(t);
  p.el('issue-codes').click();
  const files = p.workspace().invitations.map(inv => {
    const record = completedRecord(inv.ordinal, inv.id);
    for (const trial of record.trials) {
      const gold = p.w.JournalStudyCases.get(trial.caseId, trial.variant);
      trial.verdict = gold.expectedVerdict;
      trial.sourceIds = gold.expectedSourceIds;
      if (trial.caseId !== 'repair') continue;
      if (trial.method === 'manual' && trial.variant === 'A') trial.verdict = 'supported';
      else if (trial.method === 'journal' && trial.variant === 'B') {
        trial.verdict = 'insufficient'; trial.sourceIds = [];
      } else trial.sourceIds = ['doc-1'];
    }
    return JSON.stringify(record);
  });
  await importFiles(p, files);
  p.el('metrics').querySelector('[aria-controls="cue-case-repair"]').click();
  const box = p.el('cue-case-repair'), alternatives = box.querySelector('.case-alternatives');
  const [chosen, unused, key] = p.w.JournalStudyCases.get('repair','A').sources;
  assert.match(box.querySelector('.notice').textContent, /대표 근거 일치 50% \(1\/2\) → 0% \(0\/2\)/);
  assert.doesNotMatch(box.querySelector('.notice').textContent, /기준 판정 일치|동시 일치/);
  assert.equal(alternatives.open, false);
  alternatives.querySelector('summary').click();
  assert.equal(alternatives.open, true);
  for (const value of [chosen.title, chosen.version, chosen.locator, chosen.excerpt]) assert.ok(alternatives.textContent.includes(value));
  assert.match(alternatives.textContent, /원자료 방식 1\/2 · 저널 방식 1\/2/);
  assert.match(alternatives.textContent, /지정한 자료 없음.*원자료 방식 0\/2 · 저널 방식 1\/2/);
  assert.deepEqual([...box.querySelector('.case-source-choices tbody tr:last-child').cells].map(cell => cell.textContent),
    ['지정한 자료 없음', '0/1', '0/1', '0/1', '1/1']);
  assert.ok(!alternatives.textContent.includes(unused.title) && !alternatives.textContent.includes(key.title));
  assert.equal(p.el('cue-case-transit').querySelector('.case-alternatives'), null);
});

test('같은 자료 선택 합계에서도 표기별로 서로 다른 문서를 고른 기사를 찾아 건수를 대조한다', async t => {
  for (const split of [false, true]) {
    const p = page(t);
    p.el('issue-codes').click();
    p.el('issue-codes').click();
    const files = p.workspace().invitations.map(inv => {
      const record = completedRecord(inv.ordinal, inv.id);
      for (const trial of record.trials) {
        const gold = p.w.JournalStudyCases.get(trial.caseId, trial.variant);
        trial.verdict = gold.expectedVerdict;
        if (trial.caseId !== 'repair') continue;
        const choseRequest = split && trial.method === 'journal' ? trial.variant === 'A' : inv.ordinal <= 4;
        trial.sourceIds = [choseRequest ? 'doc-1' : 'doc-2'];
      }
      return JSON.stringify(record);
    });
    await importFiles(p, files);
    const article = p.el('cue-case-repair'), summary = article.querySelector('summary');
    assert.ok(summary.textContent.includes('사실 채택률 격차 0%p → 0%p · 자료 선택 격차 0%p → ' + (split ? '100' : '0') + '%p'));
    summary.click();
    const detail = article.querySelector('.case-source-choices');
    detail.querySelector('summary').click();
    assert.ok(detail.open);
    assert.deepEqual([...detail.querySelectorAll('thead th')].map(cell => cell.textContent),
      ['선택한 자료', '원자료 · 보수', '원자료 · 진보', '저널 · 보수', '저널 · 진보']);
    assert.deepEqual([...detail.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(cell => cell.textContent)), [
      ['예산 요구서', '1/2', '1/2', split ? '2/2' : '1/2', split ? '0/2' : '1/2'],
      ['예산안 부속 설명서', '1/2', '1/2', split ? '0/2' : '1/2', split ? '2/2' : '1/2'],
      ['의결 예산 비교표 (기준 근거)', '0/2', '0/2', '0/2', '0/2'],
      ['지정한 자료 없음', '0/2', '0/2', '0/2', '0/2']
    ]);
    for (const source of article.querySelectorAll('.case-alternatives .source')) {
      assert.match(source.textContent, /원자료 방식 2\/4 · 저널 방식 2\/4/);
    }
  }
});

test('전체 품질이 같아도 기사 표기에 따라 엇갈린 근거 선택과 잘못된 사실 채택을 보여 준다', async t => {
  const p = page(t);
  const cases = require('../docs/reader/editor-study-cases.js');
  const table = () => [...p.el('quality-by-variant').querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => cell.textContent));
  assert.deepEqual(table(), []);
  p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const record = completedRecord(inv.ordinal, inv.id);
    for (const trial of record.trials) {
      const gold = cases.get(trial.caseId, trial.variant);
      const affected = trial.method === 'manual' ? trial.variant === 'B' : trial.variant === 'A';
      trial.verdict = affected ? 'supported' : gold.expectedVerdict;
      trial.sourceIds = affected ? [] : gold.expectedSourceIds;
    }
    return record;
  });
  await importFiles(p, records.map(record => JSON.stringify(record)));
  assert.deepEqual(table(), [
    ['보수 성향 표기 · 원자료', '100% (4/4)', '0% (0/4)', '0% (0/4)', '0% (0/2)'],
    ['보수 성향 표기 · 저널', '0% (0/4)', '50% (2/4)', '100% (4/4)', '100% (2/2)'],
    ['진보 성향 표기 · 원자료', '0% (0/4)', '50% (2/4)', '100% (4/4)', '100% (2/2)'],
    ['진보 성향 표기 · 저널', '100% (4/4)', '0% (0/4)', '0% (0/4)', '0% (0/2)']
  ]);
  assert.equal(p.el('quality-warning').hidden, false);
  assert.match(p.el('quality-warning').textContent, /보수 성향 표기에서 판정·근거 동시 일치율 100%p 하락/);
  assert.match(p.el('quality-warning').textContent, /보수 성향 표기에서 근거 없는 사실 채택률 100%p 상승/);
  p.el('demo-view').click();
  assert.ok(table().every(row => row[1].endsWith('/8)')));
  p.el('real-view').click();
  assert.equal(table()[3][1], '100% (4/4)');
});

test('대표 근거가 모두 빠졌어도 한쪽 표기에만 늘어난 판정 오류가 드러난다', async t => {
  const p = page(t);
  p.el('issue-codes').click();
  const records = p.workspace().invitations.map(inv => {
    const record = completedRecord(inv.ordinal, inv.id);
    for (const trial of record.trials) {
      const affected = trial.method === 'manual' ? trial.variant === 'A' : trial.variant === 'B';
      trial.verdict = affected ? 'opinion' : p.w.JournalStudyCases.get(trial.caseId, trial.variant).expectedVerdict;
      trial.sourceIds = [];
    }
    return record;
  });
  await importFiles(p, records.map(record => JSON.stringify(record)));
  assert.equal(p.el('quality-warning').hidden, false);
  assert.match(p.el('quality-warning').textContent, /진보 성향 표기에서 기준 판정 일치율 100%p 하락/);
});

async function restoreParticipant(p, data) {
  const input = p.el('resume-file');
  Object.defineProperty(input, 'files', {value:[{text:async () => JSON.stringify(data)}], configurable:true});
  await input.onchange({target:input});
}

const participantWorkspace = (p, ordinal = 1) => JSON.parse(
  p.w.localStorage.getItem('journal-editor-study-participant-v1/J1-' + ordinal + '-E0000000000000001'));

test('같은 판본의 중단 회차만 판본을 유지하고 다른 판본·구형 개인 파일의 진행 이력을 새 판본으로 바꾸지 않는다', async t => {
  const a = 'ab'.repeat(32), b = 'cd'.repeat(32);
  const first = page(t, '', undefined, undefined, a);
  first.enroll(1); first.el('begin-trial').click(); first.advance(1000); first.el('pause-trial').click();
  const files = captureDownloads(first);
  first.el('export-resume').click();
  const paused = JSON.parse(await files.at(-1).text());
  assert.equal(paused.session.kitVersion, a);
  const oldResponse = paused.record;
  for (const [kit, input, expected] of [[a, paused, a], [b, paused, null], [b, oldResponse, null]]) {
    const other = page(t, '', undefined, undefined, kit);
    other.enroll(1); await restoreParticipant(other, input);
    other.el(input === paused ? 'resume-trial' : 'begin-trial').click();
    other.advance(2000); other.answer();
    assert.equal(participantWorkspace(other).records[0].trials[0].kitVersion, expected);
    other.el('begin-trial').click(); other.w.confirm = () => true; other.el('withdraw').click();
    assert.equal(participantWorkspace(other).records[0].withdrawalTask.kitVersion, kit);
  }
  const latest = page(t, '', undefined, undefined, b);
  const key = first.w.localStorage.key(0);
  latest.w.localStorage.setItem(key, first.w.localStorage.getItem(key));
  latest.enroll(1); latest.el('resume-trial').click(); latest.advance(3000); latest.answer();
  assert.equal(participantWorkspace(latest).records[0].trials[0].kitVersion, null);
});

test('다른 기기의 같은 참여 코드는 휴식 전 초안과 단계 시간을 이어가며 기존 응답을 다시 풀지 않는다', async t => {
  const original = page(t, '', undefined, undefined, true);
  original.enroll(1);
  original.el('begin-trial').click(); original.advance(25000); original.answer();
  original.el('begin-trial').click();
  original.advance(20000); original.w.document.querySelector('[data-phase="locate"]').click();
  original.advance(25000); original.el('reason').value='모집단의 분모를 다시 확인 중';
  original.el('reason').dispatchEvent(new original.w.Event('input',{bubbles:true}));
  original.el('pause-trial').click();
  const files=captureDownloads(original);
  original.el('export-resume').click();
  const checkpoint=JSON.parse(await files.at(-1).text());
  original.el('export-one').click();
  const response=JSON.parse(await files.at(-1).text());
  assert.ok(!Object.hasOwn(response,'session'));
  assert.equal(response.trials.length,1);
  assert.match(original.el('transfer-status').textContent,/J1-1-E0000000000000001/);
  const recovered=page(t, '', undefined, undefined, true);
  recovered.enroll(1);
  await restoreParticipant(recovered,checkpoint);
  assert.match(recovered.el('trial-heading').textContent,/과제 2 \/ 4/);
  assert.equal(recovered.el('pause-pane').hidden,false);
  assert.equal(recovered.el('timer').textContent,'00:45');
  assert.equal(recovered.w.document.activeElement,recovered.el('resume-trial'));
  recovered.advance(900000);recovered.el('resume-trial').click();
  assert.equal(recovered.el('reason').value,'모집단의 분모를 다시 확인 중');
  assert.equal(recovered.w.document.querySelector('[data-phase="locate"]').getAttribute('aria-pressed'),'true');
  recovered.advance(1000);
  const frame=recovered.w.document.querySelector('iframe'), origin=recovered.w.location.origin;
  let packet;frame.contentWindow.postMessage=m=>{packet=m;};
  const send=data=>recovered.w.dispatchEvent(new recovered.w.MessageEvent('message',{data,source:frame.contentWindow,origin}));
  send({type:'journal-study-ready'});send({type:'journal-study-used',nonce:packet.nonce,status:'held',sourceIds:['doc-2'],reason:'자료의 모집단 범위를 확인했다.'});
  recovered.w.document.querySelector('[data-phase="decide"]').click();recovered.advance(500);
  recovered.el('answer').requestSubmit();
  const records=participantWorkspace(recovered).records[0].trials;
  assert.deepEqual(records[0],response.trials[0]);assert.equal(records[1].elapsedMs,46500);
  assert.deepEqual(records[1].phaseMs,{select:20000,locate:26000,decide:500});
  const before=participantWorkspace(recovered);
  await restoreParticipant(recovered,checkpoint);
  assert.match(recovered.el('transfer-status').textContent,/더 많은 응답/);
  assert.deepEqual(participantWorkspace(recovered),before);
});

test('실행 중 이어하기와 구형 참여 기록을 옮겨도 누락 구간을 온전한 과제 시간으로 계산하지 않는다', async t => {
  const p=page(t,'',undefined,undefined,true);p.enroll(1);p.el('begin-trial').click();p.advance(7000);
  const files=captureDownloads(p);p.el('export-resume').click();
  const running=JSON.parse(await files.at(-1).text());p.el('export-one').click();
  const legacy=JSON.parse(await files.at(-1).text());
  for(const [data,expected] of [[running,10000],[legacy,3000]]) {
    const other=page(t,'',undefined,undefined,true);other.enroll(1);
    await restoreParticipant(other,data);other.advance(3600000);
    if (expected===3000) assert.equal(other.el('partial-start').hidden,false);
    else assert.match(other.el('pause-note').textContent,/일부 시간/);
    other.el(expected===3000?'begin-trial':'resume-trial').click();other.advance(3000);other.answer();
    const trial=participantWorkspace(other).records[0].trials[0];
    assert.deepEqual([trial.elapsedMs,trial.observedMs,trial.phaseMs],[null,expected,null]);
    assert.equal(other.el('partial-start').hidden,true);
  }
  const wrong=page(t,'',undefined,undefined,true);wrong.enroll(2);
  const prior=participantWorkspace(wrong,2);
  await restoreParticipant(wrong,running);assert.match(wrong.el('transfer-status').textContent,/초대 코드/);
  await restoreParticipant(wrong,{type:'journal-editor-study-collection-v1',records:[legacy]});
  assert.match(wrong.el('transfer-status').textContent,/열지 못했습니다/);
  assert.deepEqual(participantWorkspace(wrong,2),prior);
});

test('파일을 읽는 도중 다른 과제를 시작하거나 다른 탭에서 기록하면 현재 작업을 덮어쓰지 않는다', async t => {
  for (const simultaneous of ['start','tab']) {
    const p=page(t,'',undefined,undefined,true);p.enroll(1);
    const record=participantWorkspace(p).records[0], input=p.el('resume-file');
    let resolve;
    Object.defineProperty(input,'files',{value:[{text:()=>new Promise(done=>{resolve=done;})}],configurable:true});
    const load=input.onchange({target:input});
    const key=p.w.localStorage.key(0);
    if(simultaneous==='start') p.el('begin-trial').click();
    else p.w.localStorage.setItem(key,'다른 탭이 저장한 기록');
    const prior=p.w.localStorage.getItem(key);
    resolve(JSON.stringify(record));await load;
    assert.equal(p.w.localStorage.getItem(key),prior);
    assert.match(p.el('transfer-status').textContent,/열지 못했습니다/);
  }
});

test('옛 참여 기록을 옮기고 새 측정을 시작하기 전에 중단하면 이전 과제의 시작 여부를 미확인으로 남긴다', async t => {
  const p=page(t,'',undefined,undefined,true);p.enroll(1);
  const response=participantWorkspace(p).records[0];
  await restoreParticipant(p,response);p.w.confirm=()=>true;p.el('withdraw').click();
  const record=participantWorkspace(p).records[0];
  assert.equal(record.withdrawn,true);
  assert.equal(Object.hasOwn(record,'withdrawalTask'),false);
  const counts=require('../docs/reader/editor-study-core.js').analyze([record]).withdrawalWork;
  assert.deepEqual([counts.unknown,counts.betweenTasks],[1,0]);
});

test('복구한 시간을 포함한 채 휴식 후 이관하면 새 기기에 직접 측정 여부를 확인할 수 없는 초가 표시된다', async t => {
  const key='journal-editor-study-participant-v1/J1-1-E0000000000000001';
  const origin=page(t,'',undefined,undefined,true);
  origin.w.Date.now=()=>2000000;
  origin.enroll(1);origin.el('begin-trial').click();origin.advance(1000);
  origin.w.dispatchEvent(new origin.w.Event('pagehide'));
  const reopened=page(t,'',undefined,undefined,true);
  reopened.w.Date.now=()=>2009750;
  reopened.w.localStorage.setItem(key,origin.w.localStorage.getItem(key));
  reopened.enroll(1);reopened.el('resume-unbroken').click();reopened.advance(2000);
  reopened.el('pause-trial').click();
  const notice=/직접 측정했는지 확인할 수 없는 이전 구간 9\.75초가 포함/;
  assert.match(reopened.el('pause-note').textContent,notice);
  const files=captureDownloads(reopened);reopened.el('export-resume').click();
  assert.match(reopened.el('transfer-status').textContent,notice);
  const migrated=page(t,'',undefined,undefined,true);migrated.enroll(1);
  await restoreParticipant(migrated,JSON.parse(await files.at(-1).text()));
  assert.match(migrated.el('pause-note').textContent,notice);
  assert.equal(migrated.el('pause-pane').hidden,false);
  migrated.el('resume-trial').click();migrated.advance(500);migrated.answer();
  assert.equal(participantWorkspace(migrated).records[0].trials[0].elapsedMs,13250);
  reopened.el('resume-trial').click();reopened.el('export-resume').click();
  const partial=page(t,'',undefined,undefined,true);partial.enroll(1);
  await restoreParticipant(partial,JSON.parse(await files.at(-1).text()));
  assert.match(partial.el('pause-note').textContent,/일부 시간만 확인/);
  assert.doesNotMatch(partial.el('pause-note').textContent,/이전 구간|9\.75/);
  assert.equal(participantWorkspace(partial).session.activeMs,3000);
});

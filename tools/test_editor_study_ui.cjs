// The two study pages communicate through postMessage. Exercise the parent
// protocol and timer separately from the actual local Chromium end-to-end run.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const folder = path.join(__dirname, '../docs/reader');

function page(t, hash = '', url = 'https://study.example/editor-study.html') {
  const dom = new JSDOM(fs.readFileSync(path.join(folder, 'editor-study.html'), 'utf8'), {url: url + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  let ticks = 0;
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

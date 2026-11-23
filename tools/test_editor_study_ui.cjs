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

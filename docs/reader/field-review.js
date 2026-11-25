(() => {
  'use strict';
  const c = window.JournalFieldReview,
    el = (id) => document.getElementById(id);
  const assignedCase = el('case-file').dataset.caseId;
  const fixedMethod = el('method').disabled;
  const kitVersion = c.kitVersion(document.querySelector('meta[name="journal-field-kit"]')?.content);
  const key = assignedCase
    ? 'journal-natural-trial-v1:' + JSON.stringify([assignedCase, el('method').value])
    : 'journal-natural-trial-v1';
  const labels = { search: '원자료 찾기', locate: '표·발언 위치 찾기', decide: '판정 기록' };
  const fields = ['found', 'documentUrl', 'locator', 'verdict', 'reason', 'journalUse'];
  let pack = null,
    session = null,
    generation = 0;
  let inviteActive = false, assignment = null, inviteRevision = 0;
  let storageVersion = null, storageLocked = false, lastCheckpointAt = null;
  let supersededTrial = false;
  let restoredBeforeResume = false;
  function message(s) {
    el('status').textContent = s;
  }
  function link(parent, label, href) {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    parent.replaceChildren(a);
  }
  function lockStorage(current) {
    storageLocked = true;
    // Two windows can both restore the same paused trial. Once one advances,
    // the other has missed its active segments and cannot export an exact time.
    let other;
    try { other = JSON.parse(current); } catch { /* unrelated or unreadable draft */ }
    if (!supersededTrial && session && !session.result && other?.base?.id === session.base.id) {
      supersededTrial = true;
      session.timer = c.tick(session.timer, performance.now(), session.timer.phase, false);
      render();
    }
    el('storage-status').textContent = supersededTrial
      ? '다른 탭에서 임시 기록이 바뀌었습니다. 같은 참여 기록을 이어서 측정한 탭에서 과제를 마치세요. 이 탭의 측정을 중지했습니다.'
      : '다른 탭에서 임시 기록이 바뀌었습니다. 이 탭은 임시 저장을 멈췄습니다. 같은 과제는 한 탭에서만 마치고 참여 기록 파일을 저장하세요.';
    el('storage-status').hidden = false;
  }
  function checkTimerOwner() {
    try {
      const current = localStorage.getItem(key);
      if (current !== storageVersion) lockStorage(current);
    } catch { /* in-memory timing is available if browser storage is disabled */ }
    return !supersededTrial;
  }
  function differentKitOnResume() {
    return restoredBeforeResume && (!kitVersion || c.kitVersion(session.base.kitVersion) !== kitVersion);
  }
  const mixedKitNote = '시작과 재개에 같은 배포본을 썼는지 확인할 수 없어 배포본별 시간 절감률에서 제외합니다.';
  function showResumeStatus() {
    const timing = session.recovered
      ? '활동 중 중단된 과제를 복원했습니다. 마지막 저장까지 확인한 시간만 남아 전체 소요 시간 비교에서 제외합니다. 측정을 재개할 수 있습니다.'
      : '휴식 중이던 과제를 복원했습니다. 휴식 전까지의 활동 시간은 저장됐습니다. 작업을 계속하려면 측정 재개를 누르세요.';
    message(timing + (Object.hasOwn(session.base, 'startedKitVersion') ? ' ' + mixedKitNote : differentKitOnResume()
      ? ' 현재 배포본이 시작할 때와 다르거나 버전을 확인할 수 없습니다. 여기서 재개하면 배포본별 시간 절감률에서 제외합니다.' : ''));
  }
  function persist() {
    if (storageLocked) return;
    try {
      const current = localStorage.getItem(key);
      if (current !== storageVersion) { lockStorage(current); return; }
      let snapshot = session;
      if (session && !session.result && session.timer.start !== null) {
        const t = session.timer, now = performance.now();
        // Only the persisted copy needs a checkpoint. Keep the live segment intact across saves.
        snapshot = {...session, timer:c.tick(t, now, t.phase, true)};
        lastCheckpointAt = now;
      }
      const json = snapshot ? JSON.stringify(snapshot) : null;
      if (json !== null) localStorage.setItem(key, json);
      else localStorage.removeItem(key);
      storageVersion = json;
      el('storage-status').hidden = true;
    } catch {
      el('storage-status').textContent = '이 브라우저에 임시 기록을 저장하지 못했습니다. 창을 열어 둔 채 완료하거나 중도 종료한 뒤 참여 기록 파일을 저장하세요.';
      el('storage-status').hidden = false;
    }
  }
  function saveAnswer() {
    for (const k of fields) session.answers[k] = el(k).value;
  }
  const evidence = window.JournalFieldEvidence?.create(location => {
    if (!session || session.result || session.base.method !== 'journal' || session.timer.start === null || !checkTimerOwner()) return false;
    const replacing = ['documentUrl','locator'].some(k => el(k).value.trim() && el(k).value !== location[k]);
    if (replacing && !confirm('작성 중인 원자료 주소와 확인 위치를 선택한 내용으로 바꿀까요?')) return false;
    el('documentUrl').value = location.documentUrl;
    el('locator').value = location.locator;
    saveAnswer();
    persist();
    message('주소와 위치를 옮겼습니다. 이 과제의 표·행 또는 발언 구간인지 확인하고 판정과 이유를 기록하세요.');
    return true;
  });
  function showClock() {
    if (!session || session.result) return;
    const t = session.timer;
    const ms = c.tick(t, performance.now(), t.phase, t.start !== null).ms;
    el('clock').textContent = Object.entries(labels)
      .map(([k, v]) => v + ' ' + (ms[k] / 1000).toFixed(0) + '초')
      .join(' · ');
  }
  function render() {
    evidence?.update(session && !session.result && session.base.method === 'journal' &&
      session.timer.start !== null && !supersededTrial ? session.base.id : null);
    el('setup').hidden = !!session;
    el('work').hidden = !session || !!session.result;
    el('ended').hidden = !session?.result;
    if (!session) {
      el('kit-note').hidden = !!kitVersion || el('kind').value !== 'editor';
      el('participant').disabled = el('task').disabled = inviteActive;
      el('method').disabled = fixedMethod || inviteActive;
      el('manual-entry').hidden = !inviteActive;
      el('apply-invite').disabled = !pack || !el('invite-code').value.trim() || !!assignment;
      el('start').disabled = !pack || (inviteActive && !assignment) || !el('task').value || !el('participant').value.trim();
      return;
    }
    if (session.result) {
      const r = session.result;
      const sec = Object.values(r.phaseMs).reduce((n, v) => n + v, 0) / 1000;
      el('end-summary').textContent =
        (r.status === 'completed' ? '완료' : '중도 종료') +
        ' · ' +
        (r.kind === 'editor' ? '현업 참여' : '연습') +
        ' · 기록된 활동 시간 ' +
        sec.toFixed(1) +
        '초' +
        (r.recovered ? ' · 활동 중 중단되어 전체 소요 시간 비교 제외' : '') +
        (!r.split ? ' · 단계별 시간 비교 제외' : '') +
        (Object.hasOwn(r, 'startedKitVersion') ? ' · ' + mixedKitNote : '');
      return;
    }
    el('question').textContent = session.base.prompt;
    link(el('article-link'), '검토할 기사 열기 ↗', session.base.articleUrl);
    if (session.base.method === 'journal') link(el('tool-link'), '저널 팩트체크 열기 ↗', 'factcheck.html?field=1');
    else el('tool-link').textContent = '평소 사용하는 검증 도구로 진행하세요.';
    const paused = session.timer.start === null;
    for (const id of ['question', 'article-link', 'tool-link']) el(id).hidden = paused;
    for (const b of el('phases').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.phase === session.timer.phase));
      b.disabled = paused;
    }
    el('pause').textContent = paused ? '측정 재개' : '휴식';
    el('pause').disabled = el('withdraw').disabled = supersededTrial;
    el('total-only').checked = session.totalOnly === true;
    el('total-only').disabled = paused;
    el('answer').disabled = paused;
    el('submit').disabled = paused;
    for (const k of fields) el(k).value = session.answers[k] || '';
    showClock();
  }
  function loadCase(raw) {
    const data = c.readCase(raw);
    if (assignedCase && data.caseId !== assignedCase)
      throw Error('이 배포본과 다른 기사입니다. 같은 폴더의 blind-tasks.json을 선택하세요.');
    pack = data;
    el('case-name').textContent = data.title;
    el('task').replaceChildren();
    if (assignedCase) el('task').add(new Option('받은 과제 번호를 선택하세요', ''));
    for (const t of data.tasks) el('task').add(new Option(t.id, t.id));
    message('');
    render();
  }
  function resetInvite(keepCode = false) {
    inviteRevision++;
    assignment = null;
    if (inviteActive) {
      el('participant').value = '';
      el('task').selectedIndex = el('method').selectedIndex = 0;
    }
    if (!keepCode) el('invite-code').value = '';
    inviteActive = keepCode && inviteActive;
    el('invite-status').textContent = inviteActive ? '새 과제 파일에서 배정 코드를 다시 확인하세요.' : '';
  }
  el('invite-code').oninput = () => {
    inviteRevision++;
    inviteActive = true;
    assignment = null;
    el('participant').value = '';
    el('task').value = '';
    el('invite-status').textContent = pack ? '' : '먼저 진행자가 보낸 배포본을 열거나 과제 파일을 선택하세요.';
    render();
  };
  el('manual-entry').onclick = () => {
    resetInvite();
    render();
    el('task').focus();
  };
  el('apply-invite').onclick = async () => {
    const code = el('invite-code').value.trim();
    if (!code || !pack || session) return;
    const revision = ++inviteRevision;
    inviteActive = true;
    assignment = null;
    render();
    el('apply-invite').disabled = true;
    el('invite-status').textContent = '배정 코드를 확인하는 중입니다.';
    try {
      const methods = [...el('method').options].map(option => option.value);
      const row = await window.JournalFieldInvite.match(code, pack, methods, kitVersion);
      if (inviteRevision !== revision) return;
      assignment = row;
      el('participant').value = row.participant;
      el('task').value = row.taskId;
      el('method').value = row.method;
      el('invite-status').textContent = '배정한 과제와 방식을 확인했습니다. 참여 구분을 고른 뒤 측정을 시작하세요.';
    } catch (err) {
      if (inviteRevision !== revision) return;
      el('invite-status').textContent = err.message;
    }
    render();
  };
  el('case-file').onchange = async (e) => {
    const gen = ++generation,
      file = e.target.files[0];
    resetInvite(true);
    pack = null;
    el('task').replaceChildren();
    el('case-name').textContent = '';
    render();
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (gen !== generation) return;
      loadCase(raw);
    } catch (err) {
      if (gen === generation) message(err.message);
    }
  };
  el('task').onchange = render;
  el('kind').onchange = render;
  el('participant').oninput = render;
  el('start').onclick = () => {
    if (session || !pack || (inviteActive && !assignment) || !el('participant').value.trim()) return;
    const t = pack.tasks.find((v) => v.id === el('task').value);
    if (!t) return;
    const selected = assignment || {
      participant:el('participant').value.trim(), method:el('method').value,
      caseId:pack.caseId, taskId:t.id, prompt:t.prompt, articleUrl:pack.articleUrl
    };
    const base = {
      format: c.format,
      id: crypto.randomUUID(),
      kind: el('kind').value,
      ...selected,
      kitVersion
    };
    restoredBeforeResume = false;
    session = {
      base,
      timer: c.timer(performance.now()),
      visited: ['search'],
      answers: {},
      recovered: false,
      result: null
    };
    persist();
    message('');
    render();
  };
  el('phases').onclick = (e) => {
    const phase = e.target.dataset.phase;
    if (!session || !c.phases.includes(phase) || session.timer.start === null) return;
    session.timer = c.tick(session.timer, performance.now(), phase, true);
    if (!session.visited.includes(phase)) session.visited.push(phase);
    persist();
    render();
  };
  el('pause').onclick = () => {
    if (!checkTimerOwner()) return;
    const t = session.timer;
    session.timer = c.tick(t, performance.now(), t.phase, t.start === null);
    if (t.start === null) {
      if (differentKitOnResume() && !Object.hasOwn(session.base, 'startedKitVersion')) {
        session.base.startedKitVersion = c.kitVersion(session.base.kitVersion);
        session.base.kitVersion = null;
      }
      restoredBeforeResume = false;
      const notes = [];
      if (session.recovered) notes.push('측정을 재개했습니다. 앞서 중단된 기록은 전체 소요 시간 비교에서 제외합니다.');
      if (Object.hasOwn(session.base, 'startedKitVersion')) notes.push(mixedKitNote);
      message(notes.join(' '));
    }
    persist();
    render();
  };
  el('total-only').onchange = () => {
    if (!session || session.result || session.timer.start === null) return;
    session.totalOnly = el('total-only').checked;
    persist();
  };
  el('answer').oninput = () => {
    saveAnswer();
    persist();
  };
  function finish(status, stoppedAt = performance.now()) {
    if (!session || session.result || !checkTimerOwner()) return;
    try {
      saveAnswer();
      const t = session.timer,
        stopped = c.tick(t, stoppedAt, t.phase, false);
      const result = {
        ...session.base,
        status,
        recovered: session.recovered,
        split: session.visited.length === 3 && !session.totalOnly,
        phaseMs: stopped.ms,
        ...session.answers
      };
      if (status === 'completed' && !['yes', 'no'].includes(result.journalUse)) {
        throw Error('과제를 수행할 때 저널을 실제로 사용했는지 선택하세요.');
      }
      c.validate(result);
      session.result = result;
      session.timer = stopped;
      persist();
      message('');
      render();
    } catch (err) {
      message(err.message);
    }
  }
  el('submit').onclick = () => finish('completed');
  el('withdraw').onclick = () => {
    if (!session || session.result || !checkTimerOwner()) return;
    const t = session.timer, stoppedAt = performance.now();
    persist();
    if (confirm('중도 종료 시 지금까지의 기록을 저장할 수 있습니다. 종료할까요?')) {
      finish('withdrawn', stoppedAt);
    } else if (t.start !== null) {
      const stopped = c.tick(t, stoppedAt, t.phase, false);
      session.timer = c.tick(stopped, performance.now(), t.phase, true);
      persist();
    }
  };
  el('download').onclick = () => {
    const r = session.result,
      a = document.createElement('a'),
      url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    a.href = url;
    a.download = 'field-' + r.id + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  el('next').onclick = () => {
    if (!confirm('현재 기록을 파일로 저장했는지 확인하세요. 새 과제로 이동할까요?')) return;
    session = null;
    resetInvite();
    for (const id of ['question','article-link','tool-link','end-summary','clock']) el(id).replaceChildren();
    for (const field of fields) el(field).value = '';
    el('participant').value = '';
    for (const id of ['task', 'method', 'kind']) el(id).selectedIndex = 0;
    persist();
    message('');
    render();
  };
  window.addEventListener('pagehide', () => {
    if (!session || session.result || session.timer.start === null) return;
    session.timer = c.tick(session.timer, performance.now(), session.timer.phase, false);
    session.recovered = true;
    persist();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && session && !session.result && session.timer.start === null) showResumeStatus();
    render();
  });
  window.addEventListener('storage', event => {
    if (event.storageArea !== localStorage) return;
    if (event.key === key || event.key === null) {
      // A background tab can receive the event after the owner has already
      // downloaded its result and removed the finished draft with “새 과제”.
      if (event.key === key && event.newValue !== storageVersion && localStorage.getItem(key) !== storageVersion)
        lockStorage(event.newValue);
      checkTimerOwner();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session && !session.result && session.timer.start !== null) persist();
  });
  const assignedTasks = el('assigned-tasks');
  if (assignedTasks) {
    try {
      loadCase(JSON.parse(assignedTasks.textContent));
      el('case-import').open = false;
    } catch {
      message('과제 목록을 열지 못했습니다. 같은 폴더의 blind-tasks.json을 직접 불러오세요.');
    }
  }
  try {
    storageVersion = localStorage.getItem(key);
    const raw = JSON.parse(storageVersion);
    if (
      raw &&
      raw.base?.format === c.format &&
      c.url(raw.base.articleUrl) &&
      c.validTimer(raw.timer) &&
      Array.isArray(raw.visited) &&
      raw.answers
    ) {
      if (raw.result) c.validate(raw.result);
      session = raw;
      if (!session.result) {
        restoredBeforeResume = true;
        session.recovered = raw.recovered !== false || raw.timer.start !== null;
        session.timer.start = null;
        showResumeStatus();
      }
    }
  } catch {
    message('이전 임시 기록을 열 수 없습니다. 새로 시작할 수 있습니다.');
  }
  render();
  setInterval(() => {
    showClock();
    if (session && !session.result && session.timer.start !== null &&
        performance.now() - (lastCheckpointAt ?? session.timer.start) >= 15000) persist();
  }, 1000);
})();

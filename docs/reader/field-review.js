(() => {
  'use strict';
  const c = window.JournalFieldReview,
    el = (id) => document.getElementById(id);
  const assignedCase = el('case-file').dataset.caseId;
  const key = assignedCase
    ? 'journal-natural-trial-v1:' + JSON.stringify([assignedCase, el('method').value])
    : 'journal-natural-trial-v1';
  const labels = { search: '원자료 찾기', locate: '표·발언 위치 찾기', decide: '판정 기록' };
  const fields = ['found', 'documentUrl', 'locator', 'verdict', 'reason', 'journalUse'];
  let pack = null,
    session = null,
    generation = 0;
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
  function persist() {
    try {
      if (session) localStorage.setItem(key, JSON.stringify(session));
      else localStorage.removeItem(key);
      el('storage-status').hidden = true;
    } catch {
      el('storage-status').textContent = '이 브라우저에 임시 기록을 저장하지 못했습니다. 창을 열어 둔 채 완료하거나 중도 종료한 뒤 참여 기록 파일을 저장하세요.';
      el('storage-status').hidden = false;
    }
  }
  function saveAnswer() {
    for (const k of fields) session.answers[k] = el(k).value;
  }
  function showClock() {
    if (!session || session.result) return;
    const t = session.timer;
    const ms = c.tick(t, performance.now(), t.phase, t.start !== null).ms;
    el('clock').textContent = Object.entries(labels)
      .map(([k, v]) => v + ' ' + (ms[k] / 1000).toFixed(0) + '초')
      .join(' · ');
  }
  function render() {
    el('setup').hidden = !!session;
    el('work').hidden = !session || !!session.result;
    el('ended').hidden = !session?.result;
    if (!session) {
      el('start').disabled = !pack || !el('participant').value.trim();
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
        (r.recovered ? ' · 새로고침으로 시간 비교 제외' : '') +
        (!r.split ? ' · 단계별 시간 비교 제외' : '');
      return;
    }
    el('question').textContent = session.base.prompt;
    link(el('article-link'), '검토할 기사 열기 ↗', session.base.articleUrl);
    if (session.base.method === 'journal') link(el('tool-link'), '저널 팩트체크 열기 ↗', 'factcheck.html');
    else el('tool-link').textContent = '평소 사용하는 검증 도구로 진행하세요.';
    const paused = session.timer.start === null;
    for (const id of ['question', 'article-link', 'tool-link']) el(id).hidden = paused;
    for (const b of el('phases').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.phase === session.timer.phase));
      b.disabled = paused;
    }
    el('pause').textContent = paused ? '측정 재개' : '휴식';
    el('total-only').checked = session.totalOnly === true;
    el('total-only').disabled = paused;
    el('answer').disabled = paused;
    el('submit').disabled = paused;
    for (const k of fields) el(k).value = session.answers[k] || '';
    showClock();
  }
  el('case-file').onchange = async (e) => {
    const gen = ++generation,
      file = e.target.files[0];
    pack = null;
    el('task').replaceChildren();
    el('case-name').textContent = '';
    render();
    if (!file) return;
    try {
      const data = c.readCase(JSON.parse(await file.text()));
      if (gen !== generation) return;
      if (assignedCase && data.caseId !== assignedCase)
        throw Error('이 배포본과 다른 기사입니다. 같은 폴더의 blind-tasks.json을 선택하세요.');
      pack = data;
      el('case-name').textContent = data.title;
      for (const t of data.tasks) el('task').add(new Option(t.id, t.id));
      message('');
      render();
    } catch (err) {
      if (gen === generation) message(err.message);
    }
  };
  el('participant').oninput = render;
  el('start').onclick = () => {
    if (session || !pack || !el('participant').value.trim()) return;
    const t = pack.tasks.find((v) => v.id === el('task').value);
    if (!t) return;
    const base = {
      format: c.format,
      id: crypto.randomUUID(),
      participant: el('participant').value.trim(),
      kind: el('kind').value,
      method: el('method').value,
      caseId: pack.caseId,
      taskId: t.id,
      prompt: t.prompt,
      articleUrl: pack.articleUrl
    };
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
    const t = session.timer;
    session.timer = c.tick(t, performance.now(), t.phase, t.start === null);
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
  function finish(status) {
    if (!session || session.result) return;
    try {
      saveAnswer();
      const t = session.timer,
        stopped = c.tick(t, performance.now(), t.phase, false);
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
    if (confirm('중도 종료 시 지금까지의 기록을 저장할 수 있습니다. 종료할까요?')) finish('withdrawn');
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
  window.addEventListener('pageshow', render);
  try {
    const raw = JSON.parse(localStorage.getItem(key));
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
        session.recovered = true;
        session.timer.start = null;
        message(
          '중단한 과제를 복원했습니다. 측정을 재개할 수 있습니다. 이 기록은 소요 시간 비교에서 제외합니다.'
        );
      }
    }
  } catch {
    message('이전 임시 기록을 열 수 없습니다. 새로 시작할 수 있습니다.');
  }
  render();
  setInterval(showClock, 1000);
})();

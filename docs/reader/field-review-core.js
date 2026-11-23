// Real-article field trials remain separate from the balanced, supplied-document experiment.
(function (root) {
  'use strict';
  const phases = ['search', 'locate', 'decide'];
  const format = 'journal-field-trial-v1';
  const text = (v) => typeof v === 'string' && !!v.trim();
  function url(value) {
    try {
      const u = new URL(value);
      return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
    } catch {
      return false;
    }
  }
  function readCase(v) {
    if (
      !v ||
      !text(v.caseId) ||
      !text(v.title) ||
      !url(v.articleUrl) ||
      !Array.isArray(v.tasks) ||
      !v.tasks.length ||
      v.tasks.some(
        (t) =>
          !t || !text(t.id) || !text(t.prompt) || Object.keys(t).some((k) => !['id', 'prompt'].includes(k))
      ) ||
      new Set(v.tasks.map((t) => t.id)).size !== v.tasks.length
    )
      throw Error('참여자용 과제 파일(blind-tasks.json)을 선택하세요.');
    return {
      caseId: v.caseId,
      title: v.title,
      articleUrl: v.articleUrl,
      tasks: v.tasks.map((t) => ({ id: t.id, prompt: t.prompt }))
    };
  }
  function validTimer(timer) {
    return (
      timer &&
      phases.includes(timer.phase) &&
      phases.every((p) => Number.isSafeInteger(timer.ms?.[p]) && timer.ms[p] >= 0) &&
      (timer.start === null || Number.isFinite(timer.start))
    );
  }
  function timer(now) {
    return { phase: 'search', start: now, ms: { search: 0, locate: 0, decide: 0 } };
  }
  function tick(state, now, next, running) {
    if (!validTimer(state) || !Number.isFinite(now) || !phases.includes(next))
      throw Error('측정 단계가 올바르지 않습니다.');
    const ms = { ...state.ms };
    if (state.start !== null) {
      if (now < state.start) throw Error('시간 측정이 중단됐습니다. 현재 기록을 확인하세요.');
      ms[state.phase] += Math.round(now - state.start);
    }
    return { phase: next, start: running ? now : null, ms };
  }
  function validate(v) {
    if (
      !v ||
      v.format !== format ||
      ![v.id, v.participant, v.caseId, v.taskId, v.prompt].every(text) ||
      !url(v.articleUrl) ||
      !['editor', 'practice'].includes(v.kind) ||
      !['manual', 'journal'].includes(v.method) ||
      !['completed', 'withdrawn'].includes(v.status) ||
      (v.journalUse !== undefined &&
        !['yes', 'no'].includes(v.journalUse) &&
        !(v.status === 'withdrawn' && v.journalUse === '')) ||
      !phases.every((p) => Number.isSafeInteger(v.phaseMs?.[p]) && v.phaseMs[p] >= 0) ||
      typeof v.recovered !== 'boolean' ||
      typeof v.split !== 'boolean'
    )
      throw Error('현장 측정 화면에서 저장한 기록을 선택하세요.');
    if (
      v.status === 'completed' &&
      (!['found', 'missing'].includes(v.found) ||
        !['supported', 'contradicted', 'insufficient'].includes(v.verdict) ||
        !text(v.reason) ||
        (v.found === 'found' && (!url(v.documentUrl) || !text(v.locator))))
    )
      throw Error('제출 기록의 근거 위치와 판정을 확인하세요.');
    return v;
  }
  function group(records) {
    const groups = new Map();
    for (const { trial: t, locationGrade, verdictGrade, expected } of records) {
      const key = JSON.stringify([t.caseId, t.taskId, t.prompt, t.articleUrl, t.method, t.kind]);
      if (!groups.has(key))
        groups.set(key, {
          caseId: t.caseId,
          taskId: t.taskId,
          prompt: t.prompt,
          articleUrl: t.articleUrl,
          method: t.method,
          kind: t.kind,
          submitted: 0,
          withdrawn: 0,
          timed: 0,
          totalTimed: 0,
          totalMs: 0,
          timedGraded: 0,
          timedVerified: 0,
          recovered: 0,
          asAssigned: 0,
          differentMethod: 0,
          unknownUse: 0,
          ms: { search: 0, locate: 0, decide: 0 },
          locationHits: 0,
          locationGraded: 0,
          verdictHits: 0,
          verdictGraded: 0,
          unsafe: 0,
          unsafeTotal: 0
        });
      const g = groups.get(key);
      if (t.status === 'withdrawn') {
        g.withdrawn++;
        continue;
      }
      g.submitted++;
      const loc = t.found === 'missing' ? 'no' : locationGrade;
      if (t.journalUse === undefined) g.unknownUse++;
      else if ((t.journalUse === 'yes') === (t.method === 'journal')) g.asAssigned++;
      else g.differentMethod++;
      if (t.recovered) g.recovered++;
      else {
        g.totalTimed++;
        g.totalMs += phases.reduce((sum, p) => sum + t.phaseMs[p], 0);
        if (['yes', 'no'].includes(loc) && ['yes', 'no'].includes(verdictGrade)) {
          g.timedGraded++;
          if (loc === 'yes' && verdictGrade === 'yes') g.timedVerified++;
        }
        if (t.split) {
          g.timed++;
          for (const p of phases) g.ms[p] += t.phaseMs[p];
        }
      }
      if (['contradicted', 'insufficient'].includes(expected)) {
        g.unsafeTotal++;
        if (t.verdict === 'supported') g.unsafe++;
      }
      if (['yes', 'no'].includes(loc)) {
        g.locationGraded++;
        if (loc === 'yes') g.locationHits++;
      }
      if (['yes', 'no'].includes(verdictGrade)) {
        g.verdictGraded++;
        if (verdictGrade === 'yes') g.verdictHits++;
      }
    }
    return [...groups.values()];
  }
  function compareTimes(groups) {
    const tasks = new Map();
    for (const g of groups) {
      const key = JSON.stringify([g.kind, g.caseId, g.articleUrl, g.taskId, g.prompt]);
      if (!tasks.has(key)) tasks.set(key, { caseId: g.caseId, articleUrl: g.articleUrl, taskId: g.taskId, prompt: g.prompt });
      tasks.get(key)[g.method] = g;
    }
    return [...tasks.values()].map((task) => {
      const { manual, journal } = task;
      const manualMs = manual?.totalTimed ? manual.totalMs / manual.totalTimed : null;
      const journalMs = journal?.totalTimed ? journal.totalMs / journal.totalTimed : null;
      const savedMs = manualMs !== null && journalMs !== null ? manualMs - journalMs : null;
      const savedPct = savedMs !== null && manualMs > 0 ? 100 * savedMs / manualMs : null;
      return { ...task, manualMs, journalMs, savedMs, savedPct };
    });
  }
  const api = { phases, format, readCase, timer, tick, validate, validTimer, group, compareTimes, url };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalFieldReview = api;
})(globalThis);

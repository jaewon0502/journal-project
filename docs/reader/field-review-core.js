// Real-article field trials remain separate from the balanced, supplied-document experiment.
(function (root) {
  'use strict';
  const phases = ['search', 'locate', 'decide'];
  const format = 'journal-field-trial-v1';
  const text = (v) => typeof v === 'string' && !!v.trim();
  function kitVersion(value) {
    return typeof value === 'string' && value.length === 64 && !/[^a-f0-9]/.test(value) ? value : null;
  }
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
  function newTimeTotals() {
    return {
      timed: 0, totalTimed: 0, totalMs: 0, timedWithdrawn: 0, withdrawnMs: 0,
      timedGraded: 0, timedVerified: 0, timedOutcomePending: 0
    };
  }
  function group(records) {
    const groups = new Map();
    const completedTimes = new Map();
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
          ...newTimeTotals(),
          timedKits: new Map(),
          recovered: 0,
          asAssigned: 0,
          differentMethod: 0,
          unknownUse: 0,
          ms: { search: 0, locate: 0, decide: 0 },
          locationHits: 0,
          locationGraded: 0,
          verdictHits: 0,
          verdictGraded: 0,
          verified: 0,
          verificationKnown: 0,
          unsafe: 0,
          unsafeTotal: 0,
          referencePending: 0
        });
      const g = groups.get(key);
      const elapsedMs = phases.reduce((sum, p) => sum + t.phaseMs[p], 0);
      const loc = t.found === 'missing' ? 'no' : locationGrade;
      const verified = loc === 'yes' && verdictGrade === 'yes';
      const verificationKnown = verified || loc === 'no' || verdictGrade === 'no';
      if (!t.recovered) {
        const version = kitVersion(t.kitVersion);
        if (!g.timedKits.has(version)) {
          const kit = newTimeTotals();
          g.timedKits.set(version, kit);
          completedTimes.set(kit, []);
        }
        const kit = g.timedKits.get(version);
        if (t.status === 'completed') completedTimes.get(kit).push(elapsedMs);
        for (const totals of [g, kit]) {
          if (t.status === 'withdrawn') {
            totals.timedWithdrawn++;
            totals.withdrawnMs += elapsedMs;
          } else {
            totals.totalTimed++;
            totals.totalMs += elapsedMs;
            if (t.split) totals.timed++;
            if (['yes', 'no'].includes(loc) && ['yes', 'no'].includes(verdictGrade)) totals.timedGraded++;
            if (verified) totals.timedVerified++;
            if (!verificationKnown) totals.timedOutcomePending++;
          }
        }
        if (t.status === 'completed' && t.split)
          for (const p of phases) g.ms[p] += t.phaseMs[p];
      }
      if (t.status === 'withdrawn') {
        g.withdrawn++;
        continue;
      }
      g.submitted++;
      if (verified) g.verified++;
      if (verificationKnown) g.verificationKnown++;
      if (t.journalUse === undefined) g.unknownUse++;
      else if ((t.journalUse === 'yes') === (t.method === 'journal')) g.asAssigned++;
      else g.differentMethod++;
      if (t.recovered) g.recovered++;
      if (['contradicted', 'insufficient'].includes(expected)) {
        g.unsafeTotal++;
        if (t.verdict === 'supported') g.unsafe++;
      } else if (expected !== 'supported') g.referencePending++;
      if (['yes', 'no'].includes(loc)) {
        g.locationGraded++;
        if (loc === 'yes') g.locationHits++;
      }
      if (['yes', 'no'].includes(verdictGrade)) {
        g.verdictGraded++;
        if (verdictGrade === 'yes') g.verdictHits++;
      }
    }
    for (const [kit, times] of completedTimes) {
      times.sort((a, b) => a - b);
      const middle = Math.floor(times.length / 2);
      kit.medianMs = times.length ? (times[middle] + times[Math.floor((times.length - 1) / 2)]) / 2 : null;
    }
    return [...groups.values()];
  }
  function compareTimes(groups) {
    function change(version, manualMs, journalMs) {
      const savedMs = version && manualMs !== null && journalMs !== null ? manualMs - journalMs : null;
      const savedPct = savedMs !== null && manualMs > 0 ? 100 * savedMs / manualMs : null;
      return { manualMs, journalMs, savedMs, savedPct };
    }
    function msPerVerified(g) {
      if (!g?.timedVerified || g.timedOutcomePending) return null;
      return (g.totalMs + g.withdrawnMs) / g.timedVerified;
    }
    const tasks = new Map();
    for (const g of groups) {
      const key = JSON.stringify([g.kind, g.caseId, g.articleUrl, g.taskId, g.prompt]);
      if (!tasks.has(key)) tasks.set(key, { caseId: g.caseId, articleUrl: g.articleUrl, taskId: g.taskId, prompt: g.prompt });
      tasks.get(key)[g.method] = g;
    }
    return [...tasks.values()].map((task) => {
      const versions = new Set([...(task.manual?.timedKits.keys() || []), ...(task.journal?.timedKits.keys() || [])]);
      const byVersion = Array.from(versions, version => {
        const manual = task.manual?.timedKits.get(version);
        const journal = task.journal?.timedKits.get(version);
        const manualMs = manual?.totalTimed ? manual.totalMs / manual.totalTimed : null;
        const journalMs = journal?.totalTimed ? journal.totalMs / journal.totalTimed : null;
        return { version, manual, journal, ...change(version, manualMs, journalMs),
          median: change(version, manual?.medianMs ?? null, journal?.medianMs ?? null),
          perVerified: change(version, msPerVerified(manual), msPerVerified(journal)) };
      });
      return { ...task, byVersion };
    });
  }
  const assignmentFormat = 'journal-field-assignment-v1';
  const assignmentFields = ['participant', 'caseId', 'articleUrl', 'taskId', 'prompt', 'method'];

  function articleIdentity(value) {
    const article = new URL(value);
    // Keep the SPA article route; drop an ordinary in-document anchor and tracking parameters.
    article.hash = article.hash.match(/^#!?\/[^#]*/u)?.[0] || '';
    for (const name of [...article.searchParams.keys()]) {
      if (/^(?:utm_.+|fbclid|gclid)$/iu.test(name)) article.searchParams.delete(name);
    }
    // Serialize every query identically, including untracked links (%20 and + encode a space).
    article.searchParams.sort();
    return article.href;
  }

  function mergeAssignments(existing, files) {
    const byCase = new Map(), byArticle = new Map();
    function insert(row) {
      if (!row || !assignmentFields.every(k => typeof row[k] === 'string' && text(row[k])) ||
          row.participant !== row.participant.trim() || row.participant.length > 64 ||
          !url(row.articleUrl) || !['manual','journal'].includes(row.method))
        throw Error('배정표의 참여 코드, 기사, 과제와 방식을 확인하세요.');
      const assignment = Object.fromEntries(assignmentFields.map(k => [k, row[k]]));
      const caseKey = JSON.stringify([row.participant, row.caseId]);
      const articleKey = JSON.stringify([row.participant, articleIdentity(row.articleUrl)]);
      const prior = byCase.get(caseKey) || byArticle.get(articleKey);
      if (prior && !assignmentFields.every(k => prior[k] === assignment[k]))
        throw Error('같은 참여 코드에 같은 사례나 기사의 서로 다른 배정이 있습니다. 원래 명부를 확인하세요.');
      byCase.set(caseKey, assignment);
      byArticle.set(articleKey, assignment);
    }
    existing.forEach(insert);
    for (const file of files) {
      if (file?.format !== assignmentFormat || !Array.isArray(file.assignments) || !file.assignments.length)
        throw Error('진행자가 별도로 보관한 현장 사전 배정표 JSON을 선택하세요.');
      file.assignments.forEach(insert);
    }
    return [...byCase.values()];
  }

  // The packet is an observed method. Only a separate assignment can supply the intended arm.
  function allocationReport(assignments, records, repeated) {
    const totals = () => ({assigned:0, completed:0, withdrawn:0, wrongTask:0, excluded:0, missing:0, crossover:0});
    const armKey = a => JSON.stringify([a.caseId, a.articleUrl, a.taskId, a.prompt, a.method]);
    const byParticipant = new Map(), arms = new Map(), matched = [];
    let outsideRoster = 0, unlinked = 0;
    for (const a of assignments) {
      if (!byParticipant.has(a.participant)) byParticipant.set(a.participant, []);
      byParticipant.get(a.participant).push({a, article:articleIdentity(a.articleUrl), related:[], ambiguous:false});
    }
    const otherArticles = [];
    for (const entry of records) {
      const t = entry.trial;
      if (t.kind !== 'editor') continue;
      const assigned = byParticipant.get(t.participant);
      if (!assigned) { outsideRoster++; continue; }
      const article = articleIdentity(t.articleUrl);
      const candidates = assigned.filter(slot => slot.a.caseId === t.caseId || slot.article === article);
      if (!candidates.length) { otherArticles.push(assigned); continue; }
      for (const slot of candidates) {
        slot.related.push(entry);
        if (candidates.length > 1) slot.ambiguous = true;
      }
    }
    // If the code has one assignment and only unrelated articles came back, the assigned
    // task was not done; when several slots are possible, don't guess which one was attempted.
    for (const assigned of otherArticles) {
      if (assigned.length === 1 && !assigned[0].related.length) assigned[0].otherArticle = true;
      unlinked++;
    }
    const all = totals();
    for (const slots of byParticipant.values()) for (const slot of slots) {
      const {a, related} = slot;
      const key = armKey(a);
      if (!arms.has(key)) arms.set(key, {caseId:a.caseId, articleUrl:a.articleUrl, taskId:a.taskId,
        prompt:a.prompt, method:a.method, ...totals(), selfSame:0, selfDifferent:0, selfUnknown:0});
      const arm = arms.get(key);
      arm.assigned++; all.assigned++;
      let status;
      if (!related.length) status = slot.otherArticle ? 'wrongTask' : 'missing';
      else if (slot.ambiguous || related.length > 1 || repeated.has(related[0].trial.id)) status = 'excluded';
      else {
        const entry = related[0], t = entry.trial;
        if (a.caseId !== t.caseId || a.articleUrl !== t.articleUrl || a.taskId !== t.taskId || a.prompt !== t.prompt) status = 'wrongTask';
        else {
          status = t.status;
          if (t.method !== a.method) { arm.crossover++; all.crossover++; }
          if (status === 'completed') {
            if (t.journalUse === undefined) arm.selfUnknown++;
            else if ((t.journalUse === 'yes') === (a.method === 'journal')) arm.selfSame++;
            else arm.selfDifferent++;
          }
          matched.push({...entry, trial:{...t, method:a.method}});
        }
      }
      arm[status]++; all[status]++;
    }
    const groups = group(matched);
    for (const g of groups) arms.get(armKey(g)).outcomes = g;
    const byTask = new Map();
    for (const arm of arms.values()) {
      const {caseId, articleUrl, taskId, prompt} = arm;
      const verified = arm.outcomes?.verified ?? 0;
      const known = arm.outcomes?.verificationKnown ?? 0;
      // An explicit withdrawal ends this assigned attempt. An unmatched return
      // cannot establish whether the editor produced a correct assigned answer.
      arm.yieldBounds = {verified, failed:known - verified, withdrawn:arm.withdrawn,
        unknown:arm.assigned - known - arm.withdrawn};
      const key = JSON.stringify([caseId, articleUrl, taskId, prompt]);
      if (!byTask.has(key)) byTask.set(key, {caseId, articleUrl, taskId, prompt, difference:null});
      byTask.get(key)[arm.method] = arm;
    }
    for (const comparison of byTask.values()) {
      const {manual, journal} = comparison;
      if (!manual || !journal) continue;
      const m = manual.yieldBounds, j = journal.yieldBounds;
      comparison.difference = {
        low:100 * (j.verified / journal.assigned - (m.verified + m.unknown) / manual.assigned),
        high:100 * ((j.verified + j.unknown) / journal.assigned - m.verified / manual.assigned)
      };
    }
    return {all, arms:[...arms.values()], groups, outsideRoster, unlinked, assignmentComparisons:[...byTask.values()]};
  }

  const api = { phases, format, readCase, timer, tick, validate, validTimer, group, compareTimes, url, kitVersion,
    assignmentFormat, articleIdentity, mergeAssignments, allocationReport };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalFieldReview = api;
})(globalThis);

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
      (timer.remainderMs === undefined || (Number.isFinite(timer.remainderMs) &&
        timer.remainderMs >= -0.5 && timer.remainderMs < 0.5)) &&
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
    let remainderMs = state.remainderMs ?? 0;
    if (state.start !== null) {
      if (now < state.start) throw Error('시간 측정이 중단됐습니다. 현재 기록을 확인하세요.');
      // Carry fractional milliseconds across phase changes and pauses. Rounding each
      // segment separately can turn an on-time submission into a missed deadline.
      const elapsed = (now - state.start) + remainderMs;
      const recorded = Math.round(elapsed);
      ms[state.phase] += recorded;
      remainderMs = elapsed - recorded;
    }
    return { phase: next, start: running ? now : null, ms, remainderMs };
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
      (Object.hasOwn(v, 'startedKitVersion') && (v.kitVersion !== null ||
        (v.startedKitVersion !== null && !kitVersion(v.startedKitVersion)))) ||
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
    if (Object.hasOwn(v, 'assignedKitVersion')) {
      const {assignedKitVersion, ...trial} = v;
      return trial;
    }
    return v;
  }
  function newTimeTotals() {
    return {
      timed: 0, totalTimed: 0, totalMs: 0, timedWithdrawn: 0, withdrawnMs: 0,
      timedGraded: 0, timedVerified: 0, timedOutcomePending: 0
    };
  }
  function hasReference(trial, basis) {
    return basis && basis.caseId === trial.caseId && basis.articleUrl === trial.articleUrl &&
      basis.id === trial.taskId && basis.prompt === trial.prompt &&
      text(basis.reference?.document) && text(basis.reference?.locator) &&
      ['supported', 'contradicted', 'insufficient'].includes(basis.verdict);
  }
  function checkedReasonGrade(trial, basis, submitted) {
    return ['yes', 'no'].includes(submitted) && trial.status === 'completed' && trial.found === 'found' &&
      hasReference(trial, basis) && basis.verdict === trial.verdict && text(basis.explanation) ? submitted : '';
  }
  function group(records) {
    const groups = new Map();
    const completedTimes = new Map();
    for (const { trial: t, locationGrade, verdictGrade, reasonGrade:submittedReasonGrade, expected, basis, gradingTime } of records) {
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
          verifiedWithReason: 0,
          reasonOutcomeKnown: 0,
          verifiedReasonFailed: 0,
          verifiedReasonPending: 0,
          unsafe: 0,
          unsafeTotal: 0,
          referencePending: 0
        });
      const g = groups.get(key);
      const elapsedMs = phases.reduce((sum, p) => sum + t.phaseMs[p], 0);
      const loc = t.found === 'missing' ? 'no' : locationGrade;
      const verified = loc === 'yes' && verdictGrade === 'yes';
      const verificationKnown = verified || loc === 'no' || verdictGrade === 'no';
      const reasonGrade = checkedReasonGrade(t, basis, submittedReasonGrade);
      const verifiedWithReason = verified && reasonGrade === 'yes';
      const reasonOutcomeKnown = (verificationKnown && !verified) || reasonGrade === 'no' || verifiedWithReason;
      const changedKit = Object.hasOwn(t, 'startedKitVersion');
      const version = changedKit ? null : kitVersion(t.kitVersion);
      if (!g.timedKits.has(version)) {
        const totals = {...newTimeTotals(), partialCompleted:0, partialCompletedMs:0, partialWithdrawn:0, partialWithdrawnMs:0,
          partialVerified:0, partialOutcomePending:0, reasonGraded:0, verifiedWithReason:0, reasonOutcomePending:0,
          gradingMeasured:0, gradingComplete:0, gradingMs:0, resumedWithoutMatchingKit:0};
        g.timedKits.set(version, totals);
        completedTimes.set(totals, []);
      }
      const kit = g.timedKits.get(version);
      if (changedKit) kit.resumedWithoutMatchingKit++;
      if (gradingTime) {
        kit.gradingMeasured++;
        kit.gradingMs += gradingTime.ms;
        if (gradingTime.status === 'complete' && !gradingTime.partial) kit.gradingComplete++;
      }
      if (t.status === 'completed') {
        if (verified && reasonGrade) kit.reasonGraded++;
        if (verifiedWithReason) kit.verifiedWithReason++;
        if (!reasonOutcomeKnown) kit.reasonOutcomePending++;
      }
      if (t.recovered) {
        if (t.status === 'withdrawn') {
          kit.partialWithdrawn++;
          kit.partialWithdrawnMs += elapsedMs;
        } else {
          kit.partialCompleted++;
          kit.partialCompletedMs += elapsedMs;
          if (verified) kit.partialVerified++;
          if (!verificationKnown) kit.partialOutcomePending++;
        }
      } else {
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
      if (verifiedWithReason) g.verifiedWithReason++;
      if (reasonOutcomeKnown) g.reasonOutcomeKnown++;
      if (verified && reasonGrade === 'no') g.verifiedReasonFailed++;
      if (verified && !['yes', 'no'].includes(reasonGrade)) g.verifiedReasonPending++;
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
    function completedMean(kit) {
      const count = kit ? kit.totalTimed + kit.partialCompleted : 0;
      if (!count) return null;
      return {count, minMs:(kit.totalMs + kit.partialCompletedMs) / count, exact:kit.partialCompleted === 0};
    }
    function returnedCost(kit, withReason) {
      if (!kit) return null;
      const verified = withReason ? kit.verifiedWithReason : kit.timedVerified + kit.partialVerified;
      const pending = withReason ? kit.reasonOutcomePending : kit.timedOutcomePending + kit.partialOutcomePending;
      const partial = kit.partialCompleted + kit.partialWithdrawn;
      const observedMs = kit.totalMs + kit.withdrawnMs + kit.partialCompletedMs + kit.partialWithdrawnMs;
      // Bounds are conditional on a positive integer number of successes. When
      // none is confirmed, a zero denominator remains possible as a separate outcome.
      const possible = verified + pending;
      return {completed:kit.totalTimed + kit.partialCompleted, withdrawn:kit.timedWithdrawn + kit.partialWithdrawn,
        observedMs, verified, pending, partial,
        minMs:possible ? observedMs / possible : null,
        maxMs:possible && !partial ? observedMs / Math.max(1, verified) : null};
    }
    function compareReturnedCost(version, manualKit, journalKit, withReason = false) {
      const manual = returnedCost(manualKit, withReason), journal = returnedCost(journalKit, withReason);
      let difference = null;
      if (version && manual?.verified && journal?.verified) {
        // Positive values mean that Journal required more time per success.
        difference = {
          low:manual.maxMs === null ? null : journal.minMs - manual.maxMs,
          high:journal.maxMs === null ? null : journal.maxMs - manual.minMs
        };
      }
      return {manual, journal, difference};
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
        return { version, manual, journal, completedMeans:{manual:completedMean(manual), journal:completedMean(journal)},
          ...change(version, manualMs, journalMs),
          median: change(version, manual?.medianMs ?? null, journal?.medianMs ?? null),
          perVerified: change(version, msPerVerified(manual), msPerVerified(journal)),
          returnedCost: compareReturnedCost(version, manual, journal),
          returnedCostWithReason: manual?.reasonGraded || journal?.reasonGraded
            ? compareReturnedCost(version, manual, journal, true) : null };
      });
      return { ...task, byVersion };
    });
  }
  const assignmentFormat = 'journal-field-assignment-v1';
  const assignmentFields = ['participant', 'caseId', 'articleUrl', 'taskId', 'prompt', 'method'];

  function validTargetSeconds(value) {
    return Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(value * 1000);
  }

  function assignmentTarget(row) {
    if (!Object.hasOwn(row, 'targetSeconds')) return undefined;
    if (!validTargetSeconds(row.targetSeconds)) throw Error('배정표의 목표 시간을 양의 정수(초)로 확인하세요.');
    return row.targetSeconds;
  }

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
    function insert(row, taskTargets) {
      if (!row || !assignmentFields.every(k => typeof row[k] === 'string' && text(row[k])) ||
          row.participant !== row.participant.trim() || row.participant.length > 64 ||
          !url(row.articleUrl) || !['manual','journal'].includes(row.method))
        throw Error('배정표의 참여 코드, 기사, 과제와 방식을 확인하세요.');
      const assignment = Object.fromEntries(assignmentFields.map(k => [k, row[k]]));
      const targetSeconds = assignmentTarget(row);
      if (targetSeconds !== undefined) assignment.targetSeconds = targetSeconds;
      if (Object.hasOwn(row, 'assignedKitVersion')) {
        if (!kitVersion(row.assignedKitVersion)) throw Error('배정표의 예정 배포본 ID를 확인하세요.');
        assignment.assignedKitVersion = row.assignedKitVersion;
      }
      const article = articleIdentity(row.articleUrl);
      if (taskTargets) {
        const task = JSON.stringify([row.caseId, article, row.taskId, row.prompt]);
        if (taskTargets.has(task) && taskTargets.get(task) !== targetSeconds)
          throw Error('한 번에 만든 배정표에는 같은 과제의 목표 시간이 모두 같아야 합니다. 원래 명부를 확인하세요.');
        taskTargets.set(task, targetSeconds);
      }
      const caseKey = JSON.stringify([row.participant, row.caseId]);
      const articleKey = JSON.stringify([row.participant, article]);
      const prior = byCase.get(caseKey) || byArticle.get(articleKey);
      if (prior && prior.assignedKitVersion !== assignment.assignedKitVersion)
        throw Error('같은 참여 코드와 기사의 예정 배포본이 서로 다르거나 한 명부에만 기록됐습니다. 원래 배정표를 확인하세요.');
      if (prior && (prior.targetSeconds !== targetSeconds || !assignmentFields.every(k => prior[k] === assignment[k])))
        throw Error('같은 참여 코드에 같은 사례나 기사의 서로 다른 배정이 있습니다. 원래 명부를 확인하세요.');
      byCase.set(caseKey, assignment);
      byArticle.set(articleKey, assignment);
    }
    for (const row of existing) insert(row);
    for (const file of files) {
      if (file?.format !== assignmentFormat || !Array.isArray(file.assignments) || !file.assignments.length)
        throw Error('진행자가 별도로 보관한 현장 사전 배정표 JSON을 선택하세요.');
      const singleAllocation = file.scope === 'single-allocation';
      if (Object.hasOwn(file, 'scope') && !singleAllocation)
        throw Error('지원하지 않는 배정표 종류입니다. 원래 명부를 확인하세요.');
      const taskTargets = singleAllocation ? new Map() : null;
      for (const row of file.assignments) insert(row, taskTargets);
    }
    return [...byCase.values()];
  }

  function deadlineOutcome(status, entry, targetSeconds) {
    if (status === 'withdrawn') return 'withdrawn';
    if (status !== 'completed') return 'unknown';
    const {trial, basis, locationGrade} = entry;
    if (trial.found === 'missing') return 'failedQuality';
    // The grading importer binds location grades to this exact reference and clears them
    // when the source changes. Manual verdict grades without a bound reference cannot verify an answer.
    const keyed = hasReference(trial, basis);
    if (keyed && (locationGrade === 'no' || trial.verdict !== basis.verdict)) return 'failedQuality';
    const elapsedMs = phases.reduce((sum, phase) => sum + trial.phaseMs[phase], 0);
    if (elapsedMs > targetSeconds * 1000) return 'overTime';
    if (trial.recovered) return 'unknown';
    return keyed && locationGrade === 'yes' ? 'verified' : 'unknown';
  }

  function deadlineWithReason(outcome, status, entry) {
    if (status !== 'completed' || outcome === 'failedQuality') return outcome;
    const grade = checkedReasonGrade(entry.trial, entry.basis, entry.reasonGrade);
    if (grade === 'no') return 'failedReason';
    if (outcome === 'verified' && grade !== 'yes') return 'unknown';
    return outcome;
  }

  function yieldDifference(manual, journal, manualYield = manual, journalYield = journal) {
    if (!manual?.assigned || !journal?.assigned) return null;
    return {
      low:100 * (journalYield.verified / journal.assigned - (manualYield.verified + manualYield.unknown) / manual.assigned),
      high:100 * ((journalYield.verified + journalYield.unknown) / journal.assigned - manualYield.verified / manual.assigned)
    };
  }

  function editionMatch(status, trial, planned) {
    if (status === 'missing') return 'noReturn';
    if (status !== 'completed' && status !== 'withdrawn') return 'unlinked';
    if (Object.hasOwn(trial, 'startedKitVersion')) return 'changedOnResume';
    const observed = kitVersion(trial.kitVersion);
    if (!observed) return 'noObservedVersion';
    return observed === planned ? 'matched' : 'differentVersion';
  }

  function editionArm() {
    return {assigned:0, verified:0, failedQuality:0, failedReason:0, overTime:0, withdrawn:0, unknown:0,
      editions:{matched:0, noReturn:0, unlinked:0, noObservedVersion:0, differentVersion:0, changedOnResume:0}};
  }

  function crossoverReturn(slot) {
    if (!slot.completed) return null;
    const {trial, basis, locationGrade, verdictGrade} = slot.completed;
    const {a} = slot;
    if (trial.recovered || trial.method !== a.method || trial.journalUse !== (a.method === 'journal' ? 'yes' : 'no') ||
        editionMatch('completed', trial, a.assignedKitVersion) !== 'matched' || !hasReference(trial, basis)) return null;
    const correct = trial.verdict === basis.verdict;
    const location = trial.found === 'missing' ? 'no' : locationGrade;
    if (!['yes', 'no'].includes(location) || verdictGrade !== (correct ? 'yes' : 'no')) return null;
    const ms = phases.reduce((sum, phase) => sum + BigInt(trial.phaseMs[phase]), 0n);
    const ref = basis.reference;
    const gradingKey = JSON.stringify([basis.verdict, ref.document, ref.locator, ref.documentUrl || null,
      [...new Set(ref.acceptedDocuments || [])].sort(), [...new Set(ref.acceptedLocators || [])].sort()]);
    return {ms, verified:correct && location === 'yes', expected:basis.verdict, adopted:trial.verdict === 'supported', gradingKey};
  }

  function editorCrossover(byParticipant, unexpectedReturns) {
    const result = {assignedEditors:byParticipant.size, pairedAssignments:0, completeEditors:0, comparedEditors:0,
      faster:0, sameTime:0, slower:0, fasterQuality:{fewer:0, same:0, more:0}, fasterUnsafe:{eligible:0, more:0},
      manualMeanMs:null, journalMeanMs:null, savedMs:null, savedPct:null};
    const cohorts = new Map();
    const taskKey = ({a}) => JSON.stringify([a.caseId, a.articleUrl, a.taskId, a.prompt, a.assignedKitVersion, a.targetSeconds ?? null]);
    for (const slots of byParticipant.values()) {
      if (slots.length !== 2) continue;
      const [one, two] = slots;
      if (one.a.method === two.a.method || one.a.caseId === two.a.caseId || one.article === two.article ||
          slots.some(s => !kitVersion(s.a.assignedKitVersion))) continue;
      result.pairedAssignments++;
      const [manual, journal] = one.a.method === 'manual' ? [one, two] : [two, one];
      const tasks = [taskKey(manual), taskKey(journal)], direction = Number(tasks[0] > tasks[1]);
      const key = JSON.stringify(tasks.sort());
      if (!cohorts.has(key)) cohorts.set(key, {planned:[0, 0], complete:[0, 0], pairs:[], standards:[new Set(), new Set()]});
      const cohort = cohorts.get(key);
      cohort.planned[direction]++;
      if (unexpectedReturns.has(slots)) continue;
      const m = crossoverReturn(manual), j = crossoverReturn(journal);
      if (!m || !j) continue;
      result.completeEditors++;
      cohort.complete[direction]++;
      cohort.standards[direction].add(m.gradingKey);
      cohort.standards[1 - direction].add(j.gradingKey);
      cohort.pairs.push({m, j});
    }
    let manualMs = 0n, journalMs = 0n;
    for (const {planned, complete, pairs, standards} of cohorts.values()) {
      // Different articles are compared within one editor. Keep the whole pair of tasks
      // only when both the roster and observed reviewers balance the opposite assignments.
      if (planned[0] !== planned[1] || complete[0] !== complete[1] || standards.some(keys => keys.size !== 1)) continue;
      for (const {m, j} of pairs) {
        result.comparedEditors++;
        manualMs += m.ms;
        journalMs += j.ms;
        if (j.ms === m.ms) result.sameTime++;
        else if (j.ms > m.ms) result.slower++;
        else {
          result.faster++;
          if (m.verified === j.verified) result.fasterQuality.same++;
          else if (m.verified) result.fasterQuality.fewer++;
          else result.fasterQuality.more++;
          if (m.expected === j.expected && m.expected !== 'supported') {
            result.fasterUnsafe.eligible++;
            if (!m.adopted && j.adopted) result.fasterUnsafe.more++;
          }
        }
      }
    }
    if (result.comparedEditors) {
      result.manualMeanMs = Number(manualMs) / result.comparedEditors;
      result.journalMeanMs = Number(journalMs) / result.comparedEditors;
      const difference = manualMs - journalMs;
      result.savedMs = Number(difference) / result.comparedEditors;
      result.savedPct = manualMs === 0n ? null : 100 * Number(difference) / Number(manualMs);
    }
    return result;
  }

  // The packet is an observed method. Only a separate assignment can supply the intended arm.
  function allocationReport(assignments, records, repeated) {
    const totals = () => ({assigned:0, completed:0, withdrawn:0, wrongTask:0, excluded:0, missing:0, crossover:0});
    const armKey = a => JSON.stringify([a.caseId, a.articleUrl, a.taskId, a.prompt, a.method]);
    const byParticipant = new Map(), arms = new Map(), matched = [];
    const deadlines = new Map(), editionDeadlines = new Map();
    const deadlineArm = () => ({assigned:0, verified:0, failedQuality:0, overTime:0, withdrawn:0, unknown:0});
    let outsideRoster = 0, unlinked = 0, deadlineAssigned = 0, unknownPlannedEdition = 0;
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
      if (status === 'completed') slot.completed = related[0];
      arm[status]++; all[status]++;
      const targetSeconds = assignmentTarget(a);
      if (targetSeconds !== undefined) {
        const {caseId, articleUrl, taskId, prompt} = a;
        const deadlineKey = JSON.stringify([caseId, articleUrl, taskId, prompt, targetSeconds]);
        if (!deadlines.has(deadlineKey)) {
          deadlines.set(deadlineKey, {caseId, articleUrl, taskId, prompt, targetSeconds, manual:deadlineArm(), journal:deadlineArm(),
            withReason:{manual:{...deadlineArm(), failedReason:0}, journal:{...deadlineArm(), failedReason:0}}});
        }
        const deadline = deadlines.get(deadlineKey);
        const counts = deadline[a.method], strict = deadline.withReason[a.method];
        const outcome = deadlineOutcome(status, related[0], targetSeconds);
        counts.assigned++;
        counts[outcome]++;
        strict.assigned++;
        const withReason = deadlineWithReason(outcome, status, related[0]);
        strict[withReason]++;
        deadlineAssigned++;
        const planned = kitVersion(a.assignedKitVersion);
        if (!planned) {
          unknownPlannedEdition++;
        } else {
          const editionKey = JSON.stringify([deadlineKey, planned]);
          if (!editionDeadlines.has(editionKey)) editionDeadlines.set(editionKey,
            {caseId, articleUrl, taskId, prompt, targetSeconds, assignedKitVersion:planned, manual:editionArm(), journal:editionArm()});
          const edition = editionDeadlines.get(editionKey)[a.method];
          const match = editionMatch(status, related[0]?.trial, planned);
          edition.assigned++;
          edition.editions[match]++;
          edition[match === 'matched' ? withReason : 'unknown']++;
        }
      }
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
      const strictVerified = arm.outcomes?.verifiedWithReason ?? 0;
      const strictKnown = arm.outcomes?.reasonOutcomeKnown ?? 0;
      // A location/verdict failure already rules out success under both criteria.
      const failedQuality = arm.yieldBounds.failed;
      arm.reasonYieldBounds = {verified:strictVerified, failedQuality,
        failedReason:strictKnown - strictVerified - failedQuality, withdrawn:arm.withdrawn,
        unknown:arm.assigned - strictKnown - arm.withdrawn};
      const key = JSON.stringify([caseId, articleUrl, taskId, prompt]);
      if (!byTask.has(key)) byTask.set(key, {caseId, articleUrl, taskId, prompt, difference:null});
      byTask.get(key)[arm.method] = arm;
    }
    for (const comparison of byTask.values()) {
      const {manual, journal} = comparison;
      comparison.difference = yieldDifference(manual, journal, manual?.yieldBounds, journal?.yieldBounds);
      comparison.reasonDifference = yieldDifference(manual, journal, manual?.reasonYieldBounds, journal?.reasonYieldBounds);
    }
    for (const comparison of deadlines.values()) {
      comparison.difference = yieldDifference(comparison.manual, comparison.journal);
      comparison.withReason.difference = yieldDifference(comparison.withReason.manual, comparison.withReason.journal);
    }
    for (const comparison of editionDeadlines.values())
      comparison.difference = yieldDifference(comparison.manual, comparison.journal);
    return {all, arms:[...arms.values()], groups, outsideRoster, unlinked,
      editorCrossover:editorCrossover(byParticipant, new Set(otherArticles)), assignmentComparisons:[...byTask.values()],
      deadlineAssigned, deadlineComparisons:[...deadlines.values()], unknownPlannedEdition,
      editionDeadlineComparisons:[...editionDeadlines.values()]};
  }

  const api = { phases, format, readCase, timer, tick, validate, validTimer, group, compareTimes, url, kitVersion,
    assignmentFormat, articleIdentity, validTargetSeconds, mergeAssignments, allocationReport };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalFieldReview = api;
})(globalThis);

// An offline link binds the first completed response to the second measurement.
(function (root) {
  'use strict';
  const field = typeof module === 'object' && module.exports ? require('./field-review-core.js') : root.JournalFieldReview;
  const methods = ['manual', 'journal'];

  function validReceipt(link) {
    return !!link && typeof link === 'object' && Object.keys(link).length === 2 &&
      Object.hasOwn(link, 'id') && typeof link.id === 'string' && !!link.id.trim() &&
      Object.hasOwn(link, 'sha256') && !!field.kitVersion(link.sha256);
  }

  function completedTrial(input) {
    const t = field.validate(input);
    if (t.kind !== 'editor' || t.synthetic === true || t.status !== 'completed' || t.recovered ||
        Object.hasOwn(t, 'startedKitVersion') || !field.kitVersion(t.kitVersion) ||
        t.journalUse !== (t.method === 'journal' ? 'yes' : 'no') ||
        [t.locator, t.documentUrl].some(value => value != null && typeof value !== 'string')) {
      throw Error('배정한 방식과 배포본에서 시간 기록이 온전히 남은 현업 완료 응답을 선택하세요.');
    }
    return t;
  }

  async function receipt(input) {
    const t = completedTrial(input);
    if (Object.hasOwn(t, 'previousCompletion')) throw Error('다른 완료 응답을 연결한 기록입니다. 첫 과제의 완료 파일을 선택하세요.');
    if (!root.crypto?.subtle) throw Error('이 브라우저에서 완료 응답의 지문을 확인할 수 없습니다.');
    // Use explicit fields and stage order. Coordinator grades can be added after import.
    const payload = ['journal-field-order-v1', t.format, t.id, t.participant, t.caseId, t.articleUrl, t.taskId, t.prompt,
      t.kind, t.method, t.kitVersion, t.status, t.recovered, t.split, ...field.phases.map(p => t.phaseMs[p]),
      t.found, t.documentUrl ?? '', t.locator ?? '', t.verdict, t.reason, t.journalUse];
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const hash = await root.crypto.subtle.digest('SHA-256', bytes);
    return {id:t.id, sha256:Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')};
  }

  async function observedFirst(pair, people, ids) {
    let manual, journal;
    try {
      manual = completedTrial(pair?.manual);
      journal = completedTrial(pair?.journal);
    } catch { return 'invalid'; }
    if (manual.method !== 'manual' || journal.method !== 'journal' || manual.participant !== journal.participant ||
        people.get(manual.participant) !== 1 || ids.get(manual.id) !== 1 || ids.get(journal.id) !== 1 ||
        manual.caseId === journal.caseId || field.articleIdentity(manual.articleUrl) === field.articleIdentity(journal.articleUrl)) return 'invalid';
    const m = Object.hasOwn(manual, 'previousCompletion'), j = Object.hasOwn(journal, 'previousCompletion');
    if (!m && !j) return 'unlinked';
    if (m && j) return 'invalid';
    const first = j ? manual : journal, link = j ? journal.previousCompletion : manual.previousCompletion;
    if (!validReceipt(link) || link.id !== first.id) return 'invalid';
    const expected = await receipt(first);
    return expected.sha256 === link.sha256 ? first.method : 'invalid';
  }

  function summarizeGroup(pairs) {
    const editors = pairs.length;
    const result = {editors, manualMeanMs:null, journalMeanMs:null, savedMs:null, savedPct:null,
      manualPassed:0, journalPassed:0, manualPending:0, journalPending:0};
    if (!editors) return result;
    const totals = {manual:0n, journal:0n};
    for (const pair of pairs) {
      for (const method of methods) {
        for (const phase of field.phases) totals[method] += BigInt(pair[method].phaseMs[phase]);
        const passed = pair[method + 'Passed'];
        if (passed === true) result[method + 'Passed']++;
        else if (passed !== false) result[method + 'Pending']++;
      }
    }
    const saved = totals.manual - totals.journal;
    result.manualMeanMs = Number(totals.manual) / editors;
    result.journalMeanMs = Number(totals.journal) / editors;
    result.savedMs = Number(saved) / editors;
    result.savedPct = totals.manual === 0n ? null : 100 * Number(saved) / Number(totals.manual);
    return result;
  }

  async function compare(pairs) {
    if (!Array.isArray(pairs)) throw Error('비교할 두 과제의 완료 기록을 확인하세요.');
    const result = {total:pairs.length, confirmed:0, manualFirst:0, journalFirst:0, unlinked:0, invalid:0,
      asPlanned:0, reversed:0, withoutPlan:0};
    const ids = new Map(), people = new Map();
    for (const pair of pairs) {
      const persons = new Set();
      for (const method of methods) {
        const t = pair?.[method];
        if (t) {
          ids.set(t.id, (ids.get(t.id) || 0) + 1);
          persons.add(t.participant);
        }
      }
      for (const person of persons) people.set(person, (people.get(person) || 0) + 1);
    }
    const cohorts = new Map();
    for (const pair of pairs) {
      const first = await observedFirst(pair, people, ids);
      if (first === 'invalid' || first === 'unlinked') {
        result[first]++;
        continue;
      }
      result.confirmed++;
      result[first + 'First']++;
      if (!methods.includes(pair.plannedFirst)) result.withoutPlan++;
      else if (pair.plannedFirst === first) result.asPlanned++;
      else result.reversed++;
      if (pair.cohort == null || ![0, 1].includes(pair.direction)) continue;
      if (!cohorts.has(pair.cohort)) cohorts.set(pair.cohort, {manual:[[], []], journal:[[], []]});
      cohorts.get(pair.cohort)[first][pair.direction].push(pair);
    }
    // Keep the same task mix in both order groups and the same weight for
    // each eligible cohort: all four method-order × article-assignment cells match.
    const balanced = {manual:[], journal:[]};
    let includedCohorts = 0;
    for (const cells of cohorts.values()) {
      const n = cells.manual[0].length;
      if (n === 0 || ![...cells.manual, ...cells.journal].every(cell => cell.length === n)) continue;
      includedCohorts++;
      for (const method of methods) {
        for (const direction of cells[method]) for (const pair of direction) balanced[method].push(pair);
      }
    }
    result.balanced = {cohorts:includedCohorts, editors:balanced.manual.length + balanced.journal.length,
      manualFirst:summarizeGroup(balanced.manual), journalFirst:summarizeGroup(balanced.journal)};
    return result;
  }

  const api = {receipt, validReceipt, compare};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalFieldOrder = api;
})(globalThis);

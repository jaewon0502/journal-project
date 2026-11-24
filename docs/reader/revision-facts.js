/* Public, passage-free factual observations from two editors of the same article version. */
(function (root) {
  'use strict';
  const flagsByOutcome = {
    supported: ['none'], limited: ['none'], contradicted: ['article'], quotedConflict: ['quote'],
    disputed: ['none', 'article', 'quote', 'both'], pending: ['none', 'article', 'quote'],
    excluded: ['none'], shared: ['none', 'article', 'quote']
  };

  function validRow(row) {
    return row !== null && typeof row === 'object' && !Array.isArray(row) && Reflect.ownKeys(row).length === 2 &&
      Object.hasOwn(row, 'outcome') && Object.hasOwn(row, 'flag') && typeof row.outcome === 'string' &&
      Object.hasOwn(flagsByOutcome, row.outcome) && flagsByOutcome[row.outcome].includes(row.flag);
  }

  function ratio(numerator, denominator) {
    return {numerator, denominator, pct: denominator ? 100 * numerator / denominator : null};
  }

  function summarize(rows) {
    if (!Array.isArray(rows)) throw new Error('구간별 공동 사실 판정 목록을 확인하세요.');
    const counts = Object.fromEntries(Object.keys(flagsByOutcome).map(outcome => [outcome, 0]));
    let articleFlagged = 0, quoteFlagged = 0, flagged = 0;
    for (const row of rows) {
      if (!validRow(row)) throw new Error('구간별 공동 사실 판정과 충돌 표시를 확인하세요.');
      counts[row.outcome]++;
      if (row.flag === 'article' || row.flag === 'both') articleFlagged++;
      if (row.flag === 'quote' || row.flag === 'both') quoteFlagged++;
      if (row.flag !== 'none') flagged++;
    }
    const {supported, contradicted, limited, quotedConflict, excluded} = counts;
    return {total: rows.length, ...counts, articleFlagged, quoteFlagged, flagged,
      support: ratio(supported, supported + contradicted),
      coverage: ratio(supported + contradicted + limited + quotedConflict, rows.length - excluded)};
  }

  function summarizeFactMatches(factMatches, afterRows) {
    let retained = 0, unmatched = 0, changed = 0;
    for (const [, revised] of factMatches) {
      if (revised === null) unmatched++;
      else if (afterRows[revised].outcome === 'supported') retained++;
      else changed++;
    }
    return {total: factMatches.length, retained, unmatched, changed};
  }

  function emptyAudit() {
    return {core: {total: 0, retained: 0, changed: 0, unmatched: 0},
      flags: {total: 0, previouslyFlagged: 0, previouslySupported: 0, previouslyUnflagged: 0, unmatched: 0, core: 0}};
  }

  function auditFacts(facts, context) {
    const {core, flags} = emptyAudit();
    const revisedRows = new Map(context.matches);
    const originalRows = new Map(context.matches.map(([before, after]) => [after, before]));
    for (const [index, row] of facts.before.entries()) {
      if (context.beforeCore[index] !== 2 || row.outcome !== 'supported') continue;
      core.total++;
      const revised = revisedRows.get(index);
      if (revised === undefined) core.unmatched++;
      else if (facts.after[revised].outcome === 'supported') core.retained++;
      else core.changed++;
    }
    for (const [index, row] of facts.after.entries()) {
      if (row.flag === 'none') continue;
      flags.total++;
      if (context.afterCore[index] === 2) flags.core++;
      const original = originalRows.get(index);
      if (original === undefined) flags.unmatched++;
      else if (facts.before[original].flag !== 'none') flags.previouslyFlagged++;
      else if (facts.before[original].outcome === 'supported') flags.previouslySupported++;
      else flags.previouslyUnflagged++;
    }
    return {core, flags};
  }

  function sumFactAudits(audits) {
    const result = emptyAudit();
    for (const audit of audits) {
      for (const group of Object.keys(result)) {
        for (const key of Object.keys(result[group])) result[group][key] += audit[group][key];
      }
    }
    return result;
  }

  const api = Object.freeze({validRow, summarize, summarizeFactMatches, auditFacts, sumFactAudits});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalRevisionFacts = api;
})(globalThis);

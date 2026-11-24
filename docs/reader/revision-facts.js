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

  const api = Object.freeze({validRow, summarize, summarizeFactMatches});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalRevisionFacts = api;
})(globalThis);

/* Compare snapshots rebuilt by the workspace reader from validated article and review data. */
(function (root) {
  'use strict';

  function ratio(numerator, denominator) {
    return {numerator, denominator, pct: denominator ? 100 * numerator / denominator : null};
  }

  function compareRatings(leftItems, rightItems) {
    const rightById = new Map(rightItems.map(item => [item.id, item]));
    const dimensions = leftItems.map(item => {
      const other = rightById.get(item.id);
      return {id: item.id, title: item.title, left: item.rating?.level ?? null,
        right: other?.rating?.level ?? null, leftRating: item.rating, rightRating: other?.rating ?? null};
    });
    const pairs = dimensions.filter(d => Number.isInteger(d.left) && Number.isInteger(d.right));
    const important = pairs.filter(d => d.left >= 2);
    const pendingImportant = dimensions.filter(d => Number.isInteger(d.left) && d.left >= 2 && !Number.isInteger(d.right));
    const minor = pairs.filter(d => d.left < 2);
    const bias = {
      total: dimensions.length, paired: pairs.length, unpaired: dimensions.length - pairs.length,
      improved: ratio(important.filter(d => d.right < 2).length, important.length),
      pendingImportant: pendingImportant.map(d => d.title),
      worsened: ratio(minor.filter(d => d.right >= 2).length, minor.length),
      agreement: ratio(pairs.filter(d => d.left === d.right).length, pairs.length),
      largeDifferences: pairs.filter(d => Math.abs(d.left - d.right) >= 2).length
    };
    return {dimensions, bias};
  }

  function reviewFacts(left, right) {
    const leftAccuracy = left.assessment.accuracy, rightAccuracy = right.assessment.accuracy;
    const leftCore = new Set(leftAccuracy.coreRowIds), rightCore = new Set(rightAccuracy.coreRowIds);
    const rightById = new Map(rightAccuracy.rows.map(row => [row.rowId, row]));
    const leftRows = new Map(left.rows.map(row => [row.id, row]));
    const rightRows = new Map(right.rows.map(row => [row.id, row]));
    const isDecided = category => category === 'supported' || category === 'contradicted';
    const rows = leftAccuracy.rows.map(a => {
      const b = rightById.get(a.rowId);
      if (!b) throw new Error('두 편집자가 같은 구간을 검토했는지 확인하고 작업 파일을 다시 여세요.');
      // Agreement concerns both the verdict and its scope: an isolated mixed-claim
      // fragment and the full sentence are not two judgments of the same assertion.
      const sameScope = a.label === b.label && a.scope === b.scope;
      const sameJudgment = isDecided(a.category) && isDecided(b.category)
        ? a.category === b.category && sameScope : null;
      const leftRow = leftRows.get(a.rowId), rightRow = rightRows.get(b.rowId);
      const openScopeDifference = a.category === 'unresolved' && b.category === 'unresolved' && !sameScope
        && !!leftRow.receipt && !!rightRow.receipt && !leftRow.draftPending && !rightRow.draftPending;
      return {rowId: a.rowId, text: leftRow.text, left: a.category, right: b.category, openScopeDifference,
        leftLabel: a.label, rightLabel: b.label, leftScope: a.scope, rightScope: b.scope, sameJudgment,
        coreLeft: leftCore.has(a.rowId), coreRight: rightCore.has(a.rowId)};
    });
    const pairs = rows.filter(r => r.sameJudgment !== null);
    return {
      total: rows.length, rows,
      agreement: ratio(pairs.filter(r => r.sameJudgment).length, pairs.length),
      unresolved: rows.filter(r => r.left === 'unresolved' || r.right === 'unresolved').length,
      excluded: rows.filter(r => r.left === 'excluded' || r.right === 'excluded').length,
      bothExcluded: rows.filter(r => r.left === 'excluded' && r.right === 'excluded').length,
      disagreements: rows.filter(r => r.sameJudgment === false || r.left !== r.right || r.openScopeDifference),
      coreDifferences: rows.filter(r => r.coreLeft !== r.coreRight)
    };
  }

  function rowFingerprint(row) {
    return JSON.stringify([row.text, row.context, row.positions.length]);
  }
  function uniqueRows(rows) {
    const index = new Map();
    for (const row of rows) {
      const key = rowFingerprint(row);
      index.set(key, index.has(key) ? null : row.id);
    }
    return index;
  }

  function revisionDetails(left, right) {
    const sameArticle = left.article === right.article;
    const leftById = new Map(left.assessment.accuracy.rows.map(r => [r.rowId, r.category]));
    const rightById = new Map(right.rows.map(r => [r.id, r]));
    const oldRows = sameArticle ? null : uniqueRows(left.rows);
    const newRows = sameArticle ? null : uniqueRows(right.rows);
    function matchingId(row, from, to) {
      if (sameArticle) return row.id;
      // An offset alone may now point at a rewritten claim. Each version must
      // have exactly one row with this wording, surrounding text and repeat count.
      const key = rowFingerprint(row);
      return from.get(key) === row.id ? to.get(key) : null;
    }
    const conflicts = {newlyObserved: [], unmatched: [], persisting: []};
    for (const decision of right.assessment.accuracy.rows) {
      if (decision.category !== 'contradicted') continue;
      const row = rightById.get(decision.rowId);
      const previous = leftById.get(matchingId(row, newRows, oldRows)) ?? null;
      const entry = {rowId: row.id, text: row.text, previous};
      if (previous === null) conflicts.unmatched.push(entry);
      else if (previous === 'contradicted') conflicts.persisting.push(entry);
      else conflicts.newlyObserved.push(entry);
    }
    const core = new Set(left.assessment.accuracy.coreRowIds);
    const untracedCore = left.rows.filter(row => core.has(row.id) && !matchingId(row, oldRows, newRows))
      .map(row => ({rowId: row.id, text: row.text}));
    return {conflicts, untracedCore};
  }

  function compare(left, right, mode) {
    if (!['revision', 'reviewers'].includes(mode)) throw new Error('수정 전후 또는 편집자 간 비교를 선택하세요.');
    if (left.demo !== right.demo) throw new Error('연습 기록끼리 또는 실제 기사 작업 파일끼리 선택하세요.');
    const sourceChanged = left.sourceKey !== right.sourceKey;
    if (mode === 'reviewers' && left.article !== right.article) {
      throw new Error('편집자 간 비교에는 기사 원문이 일치해야 합니다. 같은 판본의 작업 파일을 선택하세요.');
    }
    if (mode === 'reviewers' && sourceChanged) {
      throw new Error('편집자 간 비교에는 원자료 묶음이 일치해야 합니다. 같은 자료로 검토한 파일을 선택하세요.');
    }
    const accuracy = {left: left.assessment.accuracy, right: right.assessment.accuracy};
    const result = {mode, demo: left.demo, sourceChanged, accuracy,
      ...compareRatings(left.assessment.bias.items, right.assessment.bias.items)};
    if (mode === 'reviewers') result.facts = reviewFacts(left, right);
    else Object.assign(result, revisionDetails(left, right));
    return result;
  }

  const api = Object.freeze({compare});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalArticleCompare = api;
})(globalThis);

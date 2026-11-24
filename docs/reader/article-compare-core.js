/* Compare snapshots rebuilt by the workspace reader from validated article and review data. */
(function (root) {
  'use strict';
  const workspace = typeof module === 'object' && module.exports ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;

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
      revisedImportantWithoutPrior: dimensions.filter(d => Number.isInteger(d.right) && d.right >= 2 && !Number.isInteger(d.left))
        .map(d => ({title:d.title, prior:d.left})),
      worsened: ratio(minor.filter(d => d.right >= 2).length, minor.length),
      agreement: ratio(pairs.filter(d => d.left === d.right).length, pairs.length),
      largeDifferences: pairs.filter(d => Math.abs(d.left - d.right) >= 2).length
    };
    return {dimensions, bias};
  }

  function sourceRoles(receipt, keyById) {
    const refs = ids => new Map((ids ?? []).map(id => [keyById.get(id), id]));
    const speech = receipt.status === 'attribution';
    return {source:refs(speech ? [] : receipt.sourceIds), speech:refs(speech ? receipt.sourceIds : []),
      content:refs(receipt.contentSourceIds)};
  }

  function exclusiveIds(selected, other) {
    return [...selected].filter(([key]) => !other.has(key)).map(([, id]) => id);
  }

  function fullySupported(decision, row) {
    if (decision?.category !== 'supported') return false;
    const r = row.receipt;
    return r.status === 'fact' || (r.status === 'attribution' && r.contentStatus === 'supported');
  }

  function reviewFacts(left, right) {
    const leftAccuracy = left.assessment.accuracy, rightAccuracy = right.assessment.accuracy;
    const leftCore = new Set(leftAccuracy.coreRowIds), rightCore = new Set(rightAccuracy.coreRowIds);
    const rightById = new Map(rightAccuracy.rows.map(row => [row.rowId, row]));
    const leftRows = new Map(left.rows.map(row => [row.id, row]));
    const rightRows = new Map(right.rows.map(row => [row.id, row]));
    const sourceKeys = [left, right].map(s => new Map(s.sources.map(ref => [ref.id, workspace.sourceIdentity(ref)])));
    const isDecided = category => category === 'supported' || category === 'contradicted' || category === 'quotedConflict';
    let evidenceCompared = 0;
    const rows = leftAccuracy.rows.map(a => {
      const b = rightById.get(a.rowId);
      if (!b) throw new Error('두 편집자가 같은 구간을 검토했는지 확인하고 작업 파일을 다시 여세요.');
      // Agreement concerns both the verdict and its scope: an isolated mixed-claim
      // fragment and the full sentence are not two judgments of the same assertion.
      const sameScope = a.label === b.label && a.scope === b.scope;
      const sameJudgment = isDecided(a.category) && isDecided(b.category)
        ? a.category === b.category && sameScope : null;
      const leftRow = leftRows.get(a.rowId), rightRow = rightRows.get(b.rowId);
      const receipt = leftRow.receipt;
      // A matching supported judgment can cover only a factual span or the attribution of an opinion.
      const limitedAgreement = sameJudgment === true && a.category === 'supported' && !fullySupported(a, leftRow);
      // A copied exclusion cannot remove a passage from the independent review denominator.
      // Partial, held and unchecked decisions stay unresolved even if their receipts match.
      const sameReceipt = a.category !== 'unresolved' && b.category !== 'unresolved' &&
        !!receipt?.checksum && receipt.checksum === rightRow.receipt?.checksum;
      const openScopeDifference = a.category === 'unresolved' && b.category === 'unresolved' && !sameScope
        && !!leftRow.receipt && !!rightRow.receipt && !leftRow.draftPending && !rightRow.draftPending;
      const differentSources = [];
      if (leftRow.receipt && rightRow.receipt) {
        const chosen = sourceRoles(leftRow.receipt, sourceKeys[0]), other = sourceRoles(rightRow.receipt, sourceKeys[1]);
        if (Object.values(chosen).some(refs => refs.size) || Object.values(other).some(refs => refs.size)) evidenceCompared++;
        for (const [role, refs] of Object.entries(chosen)) {
          const left = exclusiveIds(refs, other[role]), right = exclusiveIds(other[role], refs);
          if (left.length || right.length) differentSources.push({role, left, right});
        }
      }
      return {rowId: a.rowId, text: leftRow.text, left: a.category, right: b.category, openScopeDifference,
        leftLabel: a.label, rightLabel: b.label, leftScope: a.scope, rightScope: b.scope, sameJudgment, sameReceipt, limitedAgreement,
        coreLeft: leftCore.has(a.rowId), coreRight: rightCore.has(a.rowId), differentSources};
    });
    const pairs = rows.filter(r => r.sameJudgment !== null);
    const distinct = pairs.filter(r => !r.sameReceipt);
    return {
      total: rows.length, rows,
      agreement: ratio(pairs.filter(r => r.sameJudgment).length, pairs.length),
      sharedReceipts: pairs.filter(r => r.sameReceipt),
      distinctAgreement: ratio(distinct.filter(r => r.sameJudgment).length, distinct.length),
      unresolved: rows.filter(r => r.left === 'unresolved' || r.right === 'unresolved').length,
      excluded: rows.filter(r => r.left === 'excluded' || r.right === 'excluded').length,
      bothExcluded: rows.filter(r => r.left === 'excluded' && r.right === 'excluded').length,
      disagreements: rows.filter(r => r.sameJudgment === false || r.left !== r.right || r.openScopeDifference),
      evidenceCompared, evidenceDifferences: rows.filter(r => r.differentSources.length),
      coreDifferences: rows.filter(r => r.coreLeft !== r.coreRight)
    };
  }

  function rowFingerprint(row) {
    return JSON.stringify([row.text, row.context, row.positions.length]);
  }
  // In "정부안과 같은 금액", 같은 has a comparison in the clause. In "같은 사업", its referent may be several sentences back.
  const referenceModifier = /(?<![\p{L}\p{N}])(?:이|그|해당|이런|그런|이러한|그러한|(?<![과와]\s)같은)\s+\p{L}/u;
  const referencePronoun = /(?<![\p{L}\p{N}])(?:그녀|그|이|이들|그들|이곳|그곳|이것|그것)(?:은|는|이|가|의|을|를|도|에서|에게)(?!\p{L})/u;
  // A standalone quotation can belong to a heading above it or a signature below it.
  const detachedQuotation = /^(?:“[\s\S]+”|"[\s\S]+"|‘[\s\S]+’|'[\s\S]+'|「[\s\S]+」|『[\s\S]+』|«[\s\S]+»)(?:\s*(?:이?라고|고)\s*(?:말했다|밝혔다|주장했다|답했다|덧붙였다))?[.!?…。！？]*$/u;
  // Require an explicit name field; an ordinary '발언자: 해당 의원' label can still refer back to the heading.
  const namedSpeaker = /^(?:발언자|화자)\s+실명\s*[:：]\s*[가-힣]{2,5}\s+(?:의원|시장|장관|위원장|대변인|대표|기자)$/u;
  function uniqueRows(rows, keyFor = rowFingerprint) {
    const index = new Map();
    for (const row of rows) {
      const key = keyFor(row);
      index.set(key, index.has(key) ? null : row.id);
    }
    return index;
  }

  // Row IDs encode offsets. Across different editions, link only a single location
  // whose wording and immediate context identify one row in each edition.
  function matchRevisionRows(before, after, withheldFromLegacy) {
    if (before.article === after.article) return new Map(before.rows.map(row => [row.id, row.id]));
    let commonPrefix = 0;
    while (before.article[commonPrefix] === after.article[commonPrefix]) commonPrefix++;
    let commonSuffix = 0;
    const shortest = Math.min(before.article.length, after.article.length);
    while (commonSuffix < shortest && before.article.at(-1 - commonSuffix) === after.article.at(-1 - commonSuffix)) commonSuffix++;
    const original = uniqueRows(before.rows), revised = uniqueRows(after.rows);
    const matches = new Map();
    for (const [index, row] of before.rows.entries()) {
      if (row.positions.length !== 1) continue;
      const key = rowFingerprint(row);
      const target = revised.get(key);
      if (original.get(key) !== row.id || target == null) continue;
      // A matching window cannot establish the referent after an earlier edit or a move.
      const priorTextChanged = row.positions[0].start > commonPrefix || row.id !== target;
      if (priorTextChanged && (referenceModifier.test(row.text) || referencePronoun.test(row.text))) continue;
      if (detachedQuotation.test(row.text)) {
        const previous = before.rows[index - 1];
        const anchored = previous?.positions.length === 1 && namedSpeaker.test(previous.text) &&
          previous.positions[0].start >= before.article.length - commonSuffix;
        if (!anchored) {
          // For reading existing coordinator archives only. The current comparison always withholds this pair.
          withheldFromLegacy?.set(row.id, target);
          continue;
        }
      }
      matches.set(row.id, target);
    }
    return matches;
  }

  function revisionDetails(left, right) {
    const sameArticle = left.article === right.article;
    const originalDecisions = new Map(left.assessment.accuracy.rows.map(r => [r.rowId, r]));
    const revisedDecisions = new Map(right.assessment.accuracy.rows.map(r => [r.rowId, r]));
    const rightById = new Map(right.rows.map(r => [r.id, r]));
    const matched = matchRevisionRows(left, right);
    const priorIds = new Map(Array.from(matched, ([before, after]) => [after, before]));
    const revisedWording = sameArticle ? null : uniqueRows(right.rows, row => row.text);
    const proposedCorrections = sameArticle ? null : uniqueRows(
      left.rows.filter(row => row.receipt?.correction), row => row.receipt.correction.trim()
    );
    const groups = () => ({newlyObserved: [], unmatched: [], persisting: [], scopeChanged: []});
    const conflicts = groups(), quotedConflicts = groups();
    for (const decision of right.assessment.accuracy.rows) {
      if (decision.category !== 'contradicted' && decision.category !== 'quotedConflict') continue;
      const row = rightById.get(decision.rowId);
      const priorDecision = originalDecisions.get(priorIds.get(row.id)) ?? null;
      const entry = {rowId: row.id, text: row.text, previous: priorDecision?.category ?? null, priorDecision, revised: decision};
      const inventory = decision.category === 'quotedConflict' ? quotedConflicts : conflicts;
      if (!priorDecision) inventory.unmatched.push(entry);
      else if (priorDecision.category === decision.category && priorDecision.scope === decision.scope) inventory.persisting.push(entry);
      else if (priorDecision.category === 'contradicted' || priorDecision.category === 'quotedConflict') inventory.scopeChanged.push(entry);
      else inventory.newlyObserved.push(entry);
    }
    const core = new Set(left.assessment.accuracy.coreRowIds);
    const untracedCore = [], originalConflicts = [], originalQuotedConflicts = [], originalSupported = [];
    for (const row of left.rows) {
      const original = originalDecisions.get(row.id);
      const category = original.category;
      const originalConflict = category === 'contradicted' || category === 'quotedConflict';
      const supported = fullySupported(original, row);
      if (!supported && !originalConflict && !core.has(row.id)) continue;
      const revisedId = matched.get(row.id);
      const revised = revisedDecisions.get(revisedId) ?? null;
      const entry = {rowId: row.id, text: row.text};
      if (supported) originalSupported.push({...entry, original, revised,
        revisedFullySupported: fullySupported(revised, rightById.get(revisedId))});
      if (!revised && core.has(row.id)) untracedCore.push(entry);
      if (originalConflict) {
        const conflict = {...entry, original, revised};
        const correction = row.receipt?.correction?.trim();
        if (!revised && correction && proposedCorrections?.get(correction) === row.id && row.positions.length === 1
            && !left.article.includes(correction) && !right.article.includes(row.text)) {
          const candidate = rightById.get(revisedWording.get(correction));
          // Consecutive repetitions share a row, but still have more than one location.
          if (candidate?.positions.length === 1) conflict.candidate = {...revisedDecisions.get(candidate.id), text: candidate.text};
        }
        if (category === 'quotedConflict') originalQuotedConflicts.push(conflict);
        else originalConflicts.push(conflict);
      }
    }
    return {conflicts, quotedConflicts, untracedCore, originalConflicts, originalQuotedConflicts, originalSupported};
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

  const api = Object.freeze({compare, matchRevisionRows});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalArticleCompare = api;
})(globalThis);

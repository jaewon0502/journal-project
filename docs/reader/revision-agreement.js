/* Compare two assignments after the coordinator has resolved each with its own blind key. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const workspace = useNode ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;
  const comparison = useNode ? require('./article-compare-core.js') : root.JournalArticleCompare;
  const rubric = useNode ? require('./article-rubric.js') : root.JournalArticleRubric;
  const compared = new WeakMap();

  function snapshot(work, demo) {
    const result = workspace.read(work);
    if (result.demo !== demo) throw new Error('배포 당시의 연습·실제 기사 구분과 회수한 기록이 다릅니다.');
    return result;
  }

  function missingState(view, work) {
    if (view.rows.some(row => row.receipt) || view.assessment.bias.items.some(item => item.rating)) return null;
    const draft = rubric.restoreDraft(view, view.sources, work.articleAssessmentDraft, work.articleAssessment);
    const biasDraft = Object.values(draft?.entries ?? {}).some(entry => entry.previous ||
      rubric.draftFields.some(field => entry[field].trim()));
    if (biasDraft || view.rows.some(row => row.draftPending)) return 'draft';
    if (view.stale || work.receipts.length) return 'invalid';
    const rowIds = new Set(view.rows.map(row => row.id));
    const orphan = work.rowDrafts.some(entry => !rowIds.has(entry.rowId) && workspace.draftChangesRecord(entry.data));
    return orphan ? 'invalid' : 'empty';
  }

  function compareRole(first, second, role, missingReturns) {
    const a = first.key.mapping[role], b = second.key.mapping[role];
    const label = role === 'before' ? '원본' : '수정본';
    if (a.articleSha256 !== b.articleSha256) throw new Error('두 편집자에게 배포한 ' + label + '의 기사 원문이 다릅니다.');
    if (a.sourcesSha256 !== b.sourcesSha256) throw new Error('두 편집자에게 배포한 ' + label + '의 원자료 묶음이 다릅니다.');
    const views = [first, second].map((review, editor) => {
      const work = review[role], view = snapshot(work, review.key.demo);
      const state = missingState(view, work);
      if (state) missingReturns.push({editor, role, state});
      return view;
    });
    const {dimensions, facts} = comparison.compare(views[0], views[1], 'reviewers');
    return {view: views[0], dimensions, facts};
  }

  function jointFact(row) {
    const article = row.left === 'contradicted' || row.right === 'contradicted';
    const quote = row.left === 'quotedConflict' || row.right === 'quotedConflict';
    let flag = 'none';
    if (article) flag = quote ? 'both' : 'article';
    else if (quote) flag = 'quote';
    let outcome;
    if (row.sameReceipt) outcome = 'shared';
    else if (row.left === 'unresolved' || row.right === 'unresolved') outcome = 'pending';
    else if (row.left === 'excluded' && row.right === 'excluded') outcome = 'excluded';
    else if (!row.sameJudgment) outcome = 'disputed';
    else outcome = row.limitedAgreement ? 'limited' : row.left;
    return {outcome, flag};
  }

  function change(before, after) {
    if (!Number.isInteger(before) || !Number.isInteger(after)) return 'unpaired';
    if (before >= 2) return after >= 2 ? 'high' : 'improved';
    return after >= 2 ? 'worsened' : 'low';
  }

  function transition(before, after) {
    return {before, after, change: change(before, after)};
  }

  function ratio(numerator, denominator) {
    return {numerator, denominator, pct: denominator ? 100 * numerator / denominator : null};
  }

  // An observation is one article and one dimension with both editors' score pairs.
  // The same rule counts a single article, a collection, or a particular dimension.
  function summarizeScores(dimensions) {
    let paired = 0, disagreed = 0, stableSeverityDifferences = 0;
    let missingScores = 0, naScores = 0, pendingImportant = 0;
    let unresolved = 0, notApplicable = 0;
    const revised = {rated:0, important:0, withoutBaseline:0};
    // Rows and columns count how many of the two editors marked an important
    // distortion in the original and revised versions of the same item.
    const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let oppositeSteps = 0, withinBandOppositeSteps = 0;
    for (const {first, second} of dimensions) {
      for (const level of [first.before, first.after, second.before, second.after]) {
        if (level === null) missingScores++;
        if (level === 'na') naScores++;
      }
      const a = change(first.before, first.after), b = change(second.before, second.after);
      if (Number.isInteger(first.after) && Number.isInteger(second.after)) {
        revised.rated++;
        if (first.after >= 2 && second.after >= 2) {
          revised.important++;
          if (a === 'unpaired' || b === 'unpaired') revised.withoutBaseline++;
        }
      }
      if (a === 'unpaired' || b === 'unpaired') {
        if (first.before >= 2 && second.before >= 2) {
          pendingImportant++;
          // A single recorded high rating already rules out common improvement.
          // An explicit NA remains NA when missing numeric ratings are filled.
          if (!(first.after >= 2 || second.after >= 2)) {
            if (first.after === 'na' || second.after === 'na') notApplicable++;
            else unresolved++;
          }
        }
        continue;
      }
      paired++;
      const before = Number(first.before >= 2) + Number(second.before >= 2);
      const after = Number(first.after >= 2) + Number(second.after >= 2);
      matrix[before][after]++;
      if ((first.after - first.before) * (second.after - second.before) < 0) {
        oppositeSteps++;
        if ([a, b].every(state => state === 'high' || state === 'low')) withinBandOppositeSteps++;
      }
      if (a !== b) {
        if ((a === 'high' && b === 'low') || (a === 'low' && b === 'high')) stableSeverityDifferences++;
        else disagreed++;
      }
    }
    const beforeImportant = matrix[2].reduce((sum, count) => sum + count, 0);
    const afterImportant = matrix.reduce((sum, row) => sum + row[2], 0);
    const baseline = beforeImportant + pendingImportant;
    const confirmed = matrix[2][0];
    const improvementRange = {baseline, confirmed, ruledOut:baseline - confirmed - unresolved - notApplicable,
      unresolved, notApplicable, lowerPct:ratio(confirmed, baseline).pct, upperPct:ratio(confirmed + unresolved, baseline).pct};
    const netSeverityChange = {paired, beforeImportant, afterImportant,
      deltaPoints:ratio(afterImportant - beforeImportant, paired).pct,
      relativeReductionPct:ratio(beforeImportant - afterImportant, beforeImportant).pct};
    return {total: dimensions.length, paired, unpaired: dimensions.length - paired, disagreed, stableSeverityDifferences,
      missingScores, naScores, pendingImportant, revised, severity: {matrix, oppositeSteps, withinBandOppositeSteps},
      improvementRange, netSeverityChange, improved: ratio(confirmed, beforeImportant),
      worsened: ratio(matrix[0][2], matrix[0].reduce((sum, n) => sum + n, 0))};
  }

  function keySignature(key) {
    return JSON.stringify([key?.format, key?.pairId, key?.demo, ...['before', 'after'].map(role => {
      const side = key?.mapping?.[role];
      return [side?.slot, side?.articleSha256, side?.sourcesSha256];
    })]);
  }

  function savedComparison(joint, key) {
    const saved = compared.get(joint);
    if (!saved || !saved.keys.includes(keySignature(key))) {
      throw new Error('두 편집자 결과를 대조한 뒤 같은 비교에 사용한 대응표로 기록을 저장하세요.');
    }
    return saved;
  }

  // Each export gets a fresh copy of the original comparison, independent of caller edits.
  function comparedScores(joint, key) { return JSON.parse(savedComparison(joint, key).scores); }
  function comparedFacts(joint, key) { return JSON.parse(savedComparison(joint, key).facts); }

  function recordFields(joint, key, version) {
    const saved = savedComparison(joint, key);
    if (!saved.completeReturns) throw new Error('각 편집자의 원본과 수정본 네 파일에 구절 판정이나 편향 평가를 하나 이상 기록한 뒤 요약을 저장하세요.');
    const fields = {dimensions: JSON.parse(saved.scores), facts: JSON.parse(saved.facts),
      factMatches: JSON.parse(saved.factMatches), factContext: JSON.parse(saved.factContext)};
    const historical = version === 5 || version === true ? saved.withheldV5 : version === 6 ? saved.withheldV6 : null;
    if (historical?.length) {
      const oldPairs = new Map(historical);
      fields.factContext.matches = fields.factContext.matches.concat(historical.map(pair => [...pair])).sort((a, b) => a[0] - b[0]);
      for (const pair of fields.factMatches) if (oldPairs.has(pair[0])) pair[1] = oldPairs.get(pair[0]);
    }
    return fields;
  }

  function compare(first, second) {
    if (first.key.pairId === second.key.pairId) throw new Error('같은 배포 묶음을 두 번 선택했습니다. 편집자별로 따로 배포한 두 묶음이 필요합니다.');
    if (first.key.demo !== second.key.demo) throw new Error('연습 기록끼리 또는 실제 기사 기록끼리 선택하세요.');
    if (first.sourceChanged || second.sourceChanged) throw new Error('배포 후 등록된 원자료가 달라진 작업이 있습니다. 배포 당시 자료로 평가한 파일을 선택하세요.');

    const missingReturns = [];
    const before = compareRole(first, second, 'before', missingReturns);
    const after = compareRole(first, second, 'after', missingReturns);
    const afterById = new Map(after.dimensions.map(d => [d.id, d]));
    const dimensions = before.dimensions.map(d => ({
      id: d.id, title: d.title, first: transition(d.left, afterById.get(d.id).left), second: transition(d.right, afterById.get(d.id).right)
    }));
    const facts = {before: before.facts.rows.map(jointFact), after: after.facts.rows.map(jointFact)};
    const legacyV5 = new Map(), legacyV6 = new Map();
    const matched = comparison.matchRevisionRows(before.view, after.view, legacyV5, legacyV6);
    const revisedIndexes = new Map(after.facts.rows.map((row, index) => [row.rowId, index]));
    const coreCount = row => Number(row.coreLeft) + Number(row.coreRight);
    const factContext = {beforeCore: before.facts.rows.map(coreCount), afterCore: after.facts.rows.map(coreCount), matches: []};
    const factMatches = [], withheldV5 = [], withheldV6 = [];
    for (const [index, row] of before.facts.rows.entries()) {
      const revised = revisedIndexes.get(matched.get(row.rowId)) ?? null;
      if (legacyV5.has(row.rowId)) withheldV5.push([index, revisedIndexes.get(legacyV5.get(row.rowId))]);
      if (legacyV6.has(row.rowId)) withheldV6.push([index, revisedIndexes.get(legacyV6.get(row.rowId))]);
      if (revised !== null) factContext.matches.push([index, revised]);
      if (facts.before[index].outcome === 'supported') factMatches.push([index, revised]);
    }
    const result = {demo: first.key.demo, ...summarizeScores(dimensions), dimensions, facts, factMatches, factContext, missingReturns};
    const scores = ({before, after}) => ({before, after});
    compared.set(result, {keys: [keySignature(first.key), keySignature(second.key)], completeReturns: !missingReturns.length, facts: JSON.stringify(facts),
      factMatches: JSON.stringify(factMatches), factContext: JSON.stringify(factContext), withheldV5, withheldV6,
      scores: JSON.stringify(dimensions.map(d => ({id: d.id, first: scores(d.first), second: scores(d.second)})))});
    return result;
  }

  const api = Object.freeze({compare, comparedScores, comparedFacts, recordFields, summarizeScores});
  if (useNode) module.exports = api;
  else root.JournalRevisionAgreement = api;
})(globalThis);

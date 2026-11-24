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
    const draft = rubric.restoreDraft(view, view.sources, work.articleAssessmentDraft);
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
    let high = 0, low = 0, improved = 0, worsened = 0;
    for (const {first, second} of dimensions) {
      for (const level of [first.before, first.after, second.before, second.after]) {
        if (level === null) missingScores++;
        if (level === 'na') naScores++;
      }
      const a = change(first.before, first.after), b = change(second.before, second.after);
      if (a === 'unpaired' || b === 'unpaired') {
        if (first.before >= 2 && second.before >= 2) pendingImportant++;
        continue;
      }
      paired++;
      if (first.before >= 2 && second.before >= 2) high++;
      if (first.before < 2 && second.before < 2) low++;
      if (a === 'improved' && b === 'improved') improved++;
      if (a === 'worsened' && b === 'worsened') worsened++;
      if (a !== b) {
        if ((a === 'high' && b === 'low') || (a === 'low' && b === 'high')) stableSeverityDifferences++;
        else disagreed++;
      }
    }
    return {total: dimensions.length, paired, unpaired: dimensions.length - paired, disagreed, stableSeverityDifferences,
      missingScores, naScores, pendingImportant, improved: ratio(improved, high), worsened: ratio(worsened, low)};
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

  function recordFields(joint, key) {
    const saved = savedComparison(joint, key);
    if (!saved.completeReturns) throw new Error('각 편집자의 원본과 수정본 네 파일에 구절 판정이나 편향 평가를 하나 이상 기록한 뒤 요약을 저장하세요.');
    return {dimensions: JSON.parse(saved.scores), facts: JSON.parse(saved.facts), factMatches: JSON.parse(saved.factMatches)};
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
    const matched = comparison.matchRevisionRows(before.view, after.view);
    const revisedIndexes = new Map(after.facts.rows.map((row, index) => [row.rowId, index]));
    const factMatches = [];
    for (const [index, fact] of facts.before.entries()) {
      if (fact.outcome !== 'supported') continue;
      const revisedId = matched.get(before.facts.rows[index].rowId);
      factMatches.push([index, revisedIndexes.get(revisedId) ?? null]);
    }
    const result = {demo: first.key.demo, ...summarizeScores(dimensions), dimensions, facts, factMatches, missingReturns};
    const scores = ({before, after}) => ({before, after});
    compared.set(result, {keys: [keySignature(first.key), keySignature(second.key)], completeReturns: !missingReturns.length, facts: JSON.stringify(facts),
      factMatches: JSON.stringify(factMatches),
      scores: JSON.stringify(dimensions.map(d => ({id: d.id, first: scores(d.first), second: scores(d.second)})))});
    return result;
  }

  const api = Object.freeze({compare, comparedScores, comparedFacts, recordFields, summarizeScores});
  if (useNode) module.exports = api;
  else root.JournalRevisionAgreement = api;
})(globalThis);

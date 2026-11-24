/* Compare two assignments after the coordinator has resolved each with its own blind key. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const workspace = useNode ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;
  const comparison = useNode ? require('./article-compare-core.js') : root.JournalArticleCompare;

  function snapshot(work, demo) {
    const result = workspace.read(work);
    if (result.demo !== demo) throw new Error('배포 당시의 연습·실제 기사 구분과 회수한 기록이 다릅니다.');
    return result;
  }

  function compareRole(first, second, role) {
    const a = first.key.mapping[role], b = second.key.mapping[role];
    const label = role === 'before' ? '원본' : '수정본';
    if (a.articleSha256 !== b.articleSha256) throw new Error('두 편집자에게 배포한 ' + label + '의 기사 원문이 다릅니다.');
    if (a.sourcesSha256 !== b.sourcesSha256) throw new Error('두 편집자에게 배포한 ' + label + '의 원자료 묶음이 다릅니다.');
    return comparison.compare(snapshot(first[role], first.key.demo), snapshot(second[role], second.key.demo), 'reviewers').dimensions;
  }

  function transition(before, after) {
    let change = 'unpaired';
    if (Number.isInteger(before) && Number.isInteger(after)) {
      if (before >= 2) change = after >= 2 ? 'high' : 'improved';
      else change = after >= 2 ? 'worsened' : 'low';
    }
    return {before, after, change};
  }

  function agreedRate(eligible, change) {
    const numerator = eligible.filter(d => d.first.change === change && d.second.change === change).length;
    const denominator = eligible.length;
    return {numerator, denominator, pct: denominator ? 100 * numerator / denominator : null};
  }

  function compare(first, second) {
    if (first.key.pairId === second.key.pairId) throw new Error('같은 배포 묶음을 두 번 선택했습니다. 편집자별로 따로 배포한 두 묶음이 필요합니다.');
    if (first.key.demo !== second.key.demo) throw new Error('연습 기록끼리 또는 실제 기사 기록끼리 선택하세요.');
    if (first.sourceChanged || second.sourceChanged) throw new Error('배포 후 등록된 원자료가 달라진 작업이 있습니다. 배포 당시 자료로 평가한 파일을 선택하세요.');

    const before = compareRole(first, second, 'before');
    const after = new Map(compareRole(first, second, 'after').map(d => [d.id, d]));
    const dimensions = before.map(d => ({
      id: d.id, title: d.title, first: transition(d.left, after.get(d.id).left), second: transition(d.right, after.get(d.id).right)
    }));
    const paired = dimensions.filter(d => d.first.change !== 'unpaired' && d.second.change !== 'unpaired');
    const different = paired.filter(d => d.first.change !== d.second.change);
    const stable = change => change === 'high' || change === 'low';
    const stableSeverityDifferences = different.filter(d => stable(d.first.change) && stable(d.second.change)).length;
    return {
      demo: first.key.demo, total: dimensions.length, paired: paired.length, unpaired: dimensions.length - paired.length,
      disagreed: different.length - stableSeverityDifferences, stableSeverityDifferences,
      improved: agreedRate(paired.filter(d => d.first.before >= 2 && d.second.before >= 2), 'improved'),
      worsened: agreedRate(paired.filter(d => d.first.before < 2 && d.second.before < 2), 'worsened'),
      dimensions
    };
  }

  const api = Object.freeze({compare});
  if (useNode) module.exports = api;
  else root.JournalRevisionAgreement = api;
})(globalThis);

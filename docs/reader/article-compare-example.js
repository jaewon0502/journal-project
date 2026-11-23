// A worked, fictional example. Build and replay the same receipts as uploaded work files.
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const engine = useNode ? require('./factcheck-engine.js') : root.JournalFactcheck;
  const rubric = useNode ? require('./article-rubric.js') : root.JournalArticleRubric;
  const workspace = useNode ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;
  const source = {id:'budget', title:'가상 의회 예산표', url:'https://example.invalid/budget',
    version:'확정본', locator:'1쪽 주택 보수 항목', excerpt:'동일 사업의 확정 예산은 지난해 10억 원, 올해 11억 원이다. 요구액은 12억 원이었다.'};
  const headers = ['주택 보수 확정 예산이 20% 늘었다.', '주택 보수 확정 예산이 10% 늘었다.'];
  const body = '지난해 확정 예산은 10억 원, 올해는 11억 원이다.';

  function snapshot(revised, secondReviewer) {
    const article = [headers[Number(revised)], body].join('\n');
    const sources = [source];
    const rows = engine.prepare(article, sources).rows;
    const receipts = rows.map((row, i) => engine.decide(row, {
      status: i === 0 && !revised ? (secondReviewer ? 'held' : 'contradicted') : 'fact',
      sourceIds:[source.id], acknowledged:true,
      reason: i === 0 && secondReviewer ? '독립적으로 두 연도의 예산 범위를 재확인할 때까지 보류한다.' : '같은 사업의 두 연도 확정액 10억 원과 11억 원을 대조했다.'
    }, sources));
    const report = engine.report(article, sources, receipts);
    const level = revised ? 0 : secondReviewer ? 3 : 2;
    const ratings = {framing: {level, rowId:rows[0].id, quote:rows[0].text, compareRowId:rows[1].id, compareQuote:rows[1].text,
      sourceId:source.id, sourceQuote:source.excerpt, reason:revised ? '제목의 10%가 본문의 두 확정액과 일치한다.' : '제목에서 요구액과 확정액을 혼동해 증가율을 두 배로 표시했다.',
      impact:revised ? '' : '같은 예산의 증가폭을 실제의 두 배로 읽게 한다.'},
      standards: {level:'na',reason:'비교할 두 당사자나 주장이 없다.'}};
    return workspace.read({format:workspace.schema, demo:true, article, articleDraft:article, sources, receipts,
      rowDrafts:[], sourceDraft:{id:null,fields:Object.fromEntries(workspace.sourceFields.map(k => [k,'']))},
      articleAssessment:rubric.save(report, sources, {coreRowIds:[rows[0].id], ratings})});
  }

  function example(mode) {
    if (mode !== 'revision' && mode !== 'reviewers') throw new Error('비교 방식을 선택하세요.');
    return [snapshot(false, false), snapshot(mode === 'revision', mode === 'reviewers')];
  }
  if (useNode) module.exports = example;
  else root.JournalCompareExample = example;
})(globalThis);

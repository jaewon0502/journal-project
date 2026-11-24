/* Reopen the fictional library-hours exercise represented in revision-series-example.js. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const engine = useNode ? require('./factcheck-engine.js') : root.JournalFactcheck;
  const rubric = useNode ? require('./article-rubric.js') : root.JournalArticleRubric;
  const workspace = useNode ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;
  const blind = useNode ? require('./blind-revision.js') : root.JournalBlindRevision;

  const quote = '가상 조사 담당자는 “주말 운영을 연장한 조사 도서관은 80곳이었다”고 말했다.';
  const body = '가상 조사표에 실린 100개 도서관 중 20곳이 주말 운영을 연장했다.';
  const sources = [
    {id:'table', title:'가상 도서관 주말 운영 조사표', url:'https://library.example.invalid/weekend', version:'연습 1판',
      locator:'표 1, 전체 시설과 연장 시설 행', excerpt:'조사한 도서관은 100개, 주말 운영을 연장한 도서관은 20개이다.'},
    {id:'transcript', title:'가상 도서관 간담회 발언록', url:'https://forum.example.invalid/transcript', version:'연습 1판',
      locator:'가상 조사 담당자의 첫 발언', excerpt:quote}
  ];
  const ratingReasons = {
    before:['일부 조사 시설의 운영 변경을 모든 시설의 일로 서술했다.',
      '제목은 모든 도서관이라고 하지만 본문과 표는 조사한 100곳 중 20곳이라고 한다.', '조사 대상과 연장 시설 수를 제목의 주장에 반영하지 않았다.'],
    after:['제목이 표에서 확인한 조사 시설과 운영 변경 범위를 제시했다.',
      '도입부와 본문은 모두 조사 시설 100곳 가운데 20곳이 운영을 연장했다고 밝혔다.', '조사한 시설 수와 주말 운영 변경 시설 수를 함께 제시했다.']
  };

  // Keep the timestamps and checksums of the recorded exercise. Opening it must not re-date a decision.
  const editors = [
    {pairId:'2195c9546c7bbd02a2077223a49e87bb', checksQuote:true,
      title:{before:'표 1에는 20곳으로 기재되어 모든 도서관이라는 제목과 충돌한다.', after:'표 1의 조사 대상 100곳과 연장 시설 20곳을 대조했다.'},
      body:'표 1에는 조사 시설 수가 100, 주말 운영 연장 시설 수가 20으로 기록돼 있다.', speech:'간담회 발언록에서 80곳이라는 발언을 확인했다.',
      levels:{before:[2,3,2], after:[0,1,0]},
      seals:{before:[
        [146,'cd5ee669e501d3918fd3f0ea614862bb755312d8113685cba8521aee78f38659'],
        [147,'03f4a92d7392907db71e72327da3646155caad388c523762b4540150be90d3f6'],
        [149,'60ad23740c8152baa1573eb31579f84ba73589d63cea0d9bc3843f53429b46c4']],
      after:[
        [152,'4fd6b4b6a039a0f9574b8346591d288213a5fa4b98db517383e88e7bd99967c7'],
        [152,'741f00acb127bf50584e8235c31a5fbb59fb2d856c90e1c7105a367463eb91ba'],
        [152,'2d4ccdcf908049376bf51bb15626410f3f468ab7b6585bb022bed2bd0aa16231']]}},
    {pairId:'8b90263a4dd47b11b778354bbecf593d', checksQuote:false,
      title:{before:'연장한 시설 수는 20곳인데 제목에서 모든 시설로 확대했다.', after:'원자료의 100곳과 20곳이 제목의 분모·분자와 일치한다.'},
      body:'표 1에 조사 대상 시설 수와 연장 시설 수가 함께 나온다.', speech:'첫 발언과 기사 인용의 문구를 대조했다.',
      levels:{before:[3,2,2], after:[1,0,1]},
      seals:{before:[
        [156,'5914d6e372dc584f64e0d608644707b648c27dad2cdd370dfa13b595d1c948c1'],
        [156,'8c6450ddf54bc0bf010c97d8b660ca4a4466e1b77615b52fae56daf9f0b4acd7'],
        [156,'28e4654654d88c72d5886b6fbb936155e5d9a2800feba394e246fababbfd0f4d']],
      after:[
        [157,'0d963f89477c5826a3249490854dbc946f6ed67a03d60fa7bc139b23c91a5cd3'],
        [158,'ff3592f8a544b6915f0ff9a810850f27a879a901dbc9bbb56c1da262fef3eb49'],
        [158,'100b1c1182526e748d685433990896b5eba95388ae4011578bf7ece5420be72a']]}}
  ];

  function manuscript(title) {
    const article = [title, body, quote].join('\n');
    return {format:workspace.schema, article, articleDraft:article, demo:true, sources, receipts:[], rowDrafts:[],
      sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(field => [field,'']))}};
  }

  function restoreWork(packet, role, editor) {
    const work = workspace.independentInput(packet);
    work.blindReview = {pairId:editor.pairId, slot:role === 'before' ? 'B' : 'A'};
    const [table, transcript] = work.sources;
    const {rows} = engine.prepare(work.article, work.sources);
    const decisions = [
      {status:role === 'before' ? 'contradicted' : 'fact', reason:editor.title[role], sourceIds:[table.id]},
      {status:'fact', reason:editor.body, sourceIds:[table.id]},
      {status:'attribution', reason:editor.speech, sourceIds:[transcript.id], ...(editor.checksQuote
        ? {contentStatus:'contradicted', contentSourceIds:[table.id], contentChecked:true,
          contentReason:'발언은 80곳을 말했으나 독립 조사표의 실제 연장 시설은 20곳이다.'}
        : {contentStatus:'unverified'})}
    ];
    work.receipts = rows.map((row, index) => {
      const [milliseconds, checksum] = editor.seals[role][index];
      return {...engine.decide(row, {...decisions[index], acknowledged:true}, work.sources),
        recordedAt:'2026-11-24T17:48:09.' + milliseconds + 'Z', checksum};
    });
    const report = engine.report(work.article, work.sources, work.receipts);
    if (report.rows.some(row => !row.receipt)) throw new Error('도서관 예시의 저장 판정과 원자료를 대조할 수 없습니다.');
    const [title, detail] = report.rows;
    const ratings = Object.fromEntries(['wording','framing','omission'].map((id, index) => [id, {
      level:editor.levels[role][index], rowId:title.id, quote:title.text, compareRowId:detail.id, compareQuote:detail.text,
      sourceId:table.id, sourceQuote:table.excerpt, reason:ratingReasons[role][index],
      impact:'대상과 기간이 분명한지에 따라 독자가 운영 변경 범위를 다르게 이해한다.'
    }]));
    work.articleAssessment = rubric.save(report, work.sources, {coreRowIds:[], ratings});
    return work;
  }

  async function files() {
    const {key, packets} = await blind.prepare(manuscript('모든 도서관이 주말 운영을 늘렸다.'),
      manuscript('조사 도서관 100곳 중 20곳이 주말 운영을 연장했다.'));
    return editors.flatMap((editor, index) => {
      const before = restoreWork(packets[key.mapping.before.slot], 'before', editor);
      const after = restoreWork(packets[key.mapping.after.slot], 'after', editor);
      // Both original synthetic assignments used B for the first edition and A for the revision.
      const mapping = {before:{...key.mapping.before, slot:'B'}, after:{...key.mapping.after, slot:'A'}};
      const parts = [['대응표', {...key, pairId:editor.pairId, mapping}], ['검토-B', before], ['검토-A', after]];
      return parts.map(([label, data]) => ({name:'도서관-연습-편집자' + (index + 1) + '-' + label + '.json',
        data, raw:JSON.stringify(data)}));
    });
  }

  const api = Object.freeze({files});
  if (useNode) module.exports = api;
  else root.JournalRevisionEvidenceExample = api;
})(globalThis);

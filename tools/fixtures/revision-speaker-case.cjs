const engine = require('../../docs/reader/factcheck-engine.js');
const workspace = require('../../docs/reader/workspace-snapshot.js');
const draft = require('../../docs/reader/revision-draft.js');
const rubric = require('../../docs/reader/article-rubric.js');
const blind = require('../../docs/reader/blind-revision.js');
const agreement = require('../../docs/reader/revision-agreement.js');


const quote = '“사업비는 10억 원이다”라고 거듭 강조했다.';

async function speakerCase() {
  const source = (id,title,excerpt) => ({id,title,excerpt,url:'https://' + id + '.example.invalid/doc',locator:'1쪽',version:'1판'});
  const sources = [
    source('minutes','공청회 회의록','김 의원과 박 기자는 각각 “사업비는 10억 원이다”라고 두 차례 말했다.'),
    source('budget','의결 예산표','해당 사업의 의결 사업비는 10억 원이다.'),
    source('survey','조사표','조사 대상은 전체 응답자다. 반대 응답률은 20%였다.')
  ];
  const original = ['모든 예산이 엉터리라는 김 의원의 서면 답변','질문 순서대로 답했다.',quote,'답변 끝.',
    '조사 대상: 응답자 일부','운영 현황을 조사했다.','반대 응답률은 20%였다.','조사는 종료됐다.'].join('\n');
  const manuscript = article => ({format:workspace.schema, article, articleDraft:article, demo:true, sources,
    receipts:[],rowDrafts:[],sourceDraft:{id:null,fields:Object.fromEntries(workspace.sourceFields.map(k => [k,'']))}});
  const {rows} = engine.prepare(original, sources);
  const repairs = [[0, '박 기자의 서면 답변', 'minutes'], [4, '조사 대상: 응답자 전체', 'survey']];
  const receipts = repairs.map(([index, correction, sourceId]) => engine.decide(rows[index], {status:'contradicted',
    sourceIds:[sourceId], reason:'표제의 범위를 원자료와 대조했다.', acknowledged:true, correction, correctionChecked:true}, sources));
  const report = engine.report(original, sources, receipts);
  const revised = draft.apply(report, draft.proposals(report));
  const items = [];
  for (const editor of [1,2]) {
    const {key, packets} = await blind.prepare(manuscript(original), manuscript(revised));
    items.push({name:'대응표-' + editor,data:key});
    for (const role of ['before','after']) {
      const packet = packets[key.mapping[role].slot];
      const {rows} = engine.prepare(packet.article, packet.sources);
      const [minutes,budget,survey] = packet.sources;
      packet.receipts = [
        engine.decide(rows[2], {status:'attribution', sourceIds:[minutes.id], reason:'편집자 ' + editor + '가 발언록을 대조했다.',
          acknowledged:true, contentStatus:'supported', contentChecked:true, contentSourceIds:[budget.id],
          contentReason:'공청회와 독립된 의결서에서 금액을 확인했다.'}, packet.sources),
        engine.decide(rows[6], {status:'fact',sourceIds:[survey.id],reason:'편집자 ' + editor + '가 응답률을 대조했다.',acknowledged:true},packet.sources)
      ];
      const report = engine.report(packet.article,packet.sources,packet.receipts);
      packet.articleAssessment = rubric.save(report,packet.sources,{coreRowIds:[rows[2].id], ratings:{wording:{
        level:role === 'before' ? 2 : 0, rowId:rows[0].id, quote:rows[0].text,sourceId:minutes.id,sourceQuote:minutes.excerpt,
        reason:'제목이 예산 전반에 대한 평가로 확대됐는지 비교했다.',impact:'독자가 사업 범위와 발언 취지를 다르게 이해한다.'}}});
      items.push({name:role + editor,data:packet});
    }
  }
  const reviews = await blind.resolveBundle(items);
  return {items, reviews, joint:agreement.compare(...reviews), key:reviews[0].key};
}

module.exports = {speakerCase, quote};

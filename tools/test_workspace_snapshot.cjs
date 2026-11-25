const {test} = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../docs/reader/factcheck-engine.js');
const rubric = require('../docs/reader/article-rubric.js');
const workspace = require('../docs/reader/workspace-snapshot.js');

function recorded() {
  const article = '시의회는 예산 10억 원을 확정했다.';
  const sources = [{id:'original',title:'예산표',url:'https://office.example/budget',version:'최종',
    locator:'1쪽',excerpt:'확정 예산 10억 원'}];
  const prepared = engine.prepare(article, sources);
  const row = prepared.rows[0];
  const receipts = [engine.decide(row, {status:'fact', acknowledged:true, sourceIds:['original'],
    reason:'확정액을 원표에서 대조했다.'}, sources)];
  const report = engine.report(article, sources, receipts);
  const articleAssessment = rubric.save(report,sources,{coreRowIds:[row.id],ratings:{
    wording:{level:0,rowId:row.id,quote:row.text,sourceId:'original',sourceQuote:sources[0].excerpt,reason:'확정액과 주체가 일치한다.'}
  }});
  return {format:workspace.schema,article,articleDraft:article,sources,receipts,demo:false,rowDrafts:[],
    articleAssessment,sourceDraft:{id:null,fields:Object.fromEntries(workspace.sourceFields.map(k=>[k,'']))}};
}

test('비교가 원문의 작업 중인 버전이나 이전 판정으로 점수를 올리지 않는다', () => {
  const data=recorded();
  let s=workspace.read(data);
  assert.equal(s.assessment.accuracy.supported,1);
  assert.equal(s.assessment.bias.assessed,1);
  const id=s.rows[0].id;
  data.articleAssessmentDraft={binding:data.articleAssessment.binding,activeId:'wording',entries:{wording:{level:'2',rowId:id}}};
  assert.equal(workspace.read(data).assessment.bias.assessed,0);
  data.rowDrafts=[{rowId:id,data:{status:'held',reason:'기간을 재검토한다.',sourceIds:[],factSpan:'',opinionSpan:''}}];
  s=workspace.read(data);
  assert.equal(s.assessment.accuracy.adjudicated,0);
  assert.equal(s.assessment.accuracy.coreUnresolved.length,1);
  assert.equal(s.stale,true);
  data.articleDraft= data.article+' 다음 초안.';
  assert.throws(()=>workspace.read(data),/기사 입력을 확정/);
});

test('독립 등록된 동일 자료와 판본이 바뀐 자료를 구분하고 예시 출처를 복원한다', () => {
  const a=recorded(), b=structuredClone(a);
  b.sources[0].id='elsewhere'; b.sources[0].title='내 표시명';
  b.sources.push({...b.sources[0], id:'다시 저장한 같은 대목'});
  assert.equal(workspace.read(a).sourceKey,workspace.read(b).sourceKey);
  b.sources[0].version='정정본';
  assert.notEqual(workspace.read(a).sourceKey,workspace.read(b).sourceKey);
  b.sources[0].originUrl='https://sample.invalid/';
  assert.equal(workspace.read(b).demo,true);
  assert.equal(workspace.read(b).assessment.accuracy.adjudicated,0);
  b.sourceDraft.fields.excerpt='새 판본의 근거 입력 중';
  assert.equal(workspace.read(b).sourceDraftPending,true);
});


test('같은 PDF의 수동 쪽 링크와 입력한 PDF 쪽번호는 편집자가 독립 등록해도 같은 위치다', () => {
  const a=recorded(), b=structuredClone(a);
  a.sources[0].url='https://office.example/data.pdf#page=34&zoom=150';
  b.sources[0].url='https://office.example/data.pdf';
  b.sources[0].pdfPage='34';
  assert.equal(workspace.read(a).sourceKey,workspace.read(b).sourceKey);
  b.sources[0].pdfPage='37';
  assert.notEqual(workspace.read(a).sourceKey,workspace.read(b).sourceKey);
});

test('독립 입력은 확정 원문·등록 자료만 기존 독립 배포 형식으로 복사한다', () => {
  const work = recorded();
  const rowId = work.receipts[0].rowId;
  const tag = {pairId:'0'.repeat(32),slot:'A'};
  work.blindReview = tag;
  work.coordinator = '내부 메모';
  work.currentId = rowId;
  work.sources[0].privateNote = '내부 메모';
  work.sourceDraft.suggestedLocator = '내부 메모';
  work.sourceDraft.fields.title = '내부 메모';
  work.rowDrafts.push({rowId,data:{status:'held',reason:'내부 메모',sourceIds:[],factSpan:'',opinionSpan:''}});
  work.articleAssessmentDraft = {binding:work.articleAssessment.binding,entries:{},activeId:'wording'};
  const clean = workspace.independentInput(work);
  assert.deepEqual(clean,{
    format:workspace.schema, article:work.article, articleDraft:work.article, demo:false,
    sources:[{id:'original',title:'예산표',url:'https://office.example/budget',version:'최종',
      locator:'1쪽',excerpt:'확정 예산 10억 원'}],
    receipts:[],rowDrafts:[],articleAssessment:null,articleAssessmentDraft:null,currentId:null,
    sourceDraft:{id:null,fields:Object.fromEntries(workspace.sourceFields.map(k=>[k,'']))}
  });
  assert.equal(workspace.read(clean).assessment.accuracy.adjudicated,0);
  assert.equal(workspace.read(clean).assessment.bias.assessed,0);
  clean.sources[0].excerpt = '새 인용';
  assert.equal(work.sources[0].excerpt,'확정 예산 10억 원');
  work.articleDraft += ' 미확정 원문';
  assert.throws(()=>workspace.independentInput(work),/기사 입력을 확정/);
});

test('블라인드 배정 표지는 공개 식별자와 A 또는 B만 허용한다', () => {
  const pairId = 'fedcba9876543210'.repeat(2);
  const tag = {pairId,slot:'B'};
  assert.deepEqual(workspace.blindTag(tag),tag);
  assert.notEqual(workspace.blindTag(tag),tag);
  for (const invalid of [null,undefined,[],{},'A',{pairId,slot:'a'},{pairId,slot:'before'},
    {pairId:pairId.toUpperCase(),slot:'A'},{pairId:pairId.slice(1),slot:'A'},
    {pairId:pairId+'\n',slot:'A'},{...tag,role:'before'}]) assert.equal(workspace.blindTag(invalid),null);
});

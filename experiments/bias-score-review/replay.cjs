// Reproduce two fictional editors' independent recordings and score disagreements.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reader = name => require('../../docs/reader/' + name + '.js');
const engine = reader('factcheck-engine'), blind = reader('blind-revision'), rubric = reader('article-rubric');
const workspace = reader('workspace-snapshot'), agreement = reader('revision-agreement'), series = reader('revision-series');
const retention = reader('retention-case'), audit = reader('revision-bias-audit');

const sources = [
  {id:'party', title:'다솔당 가상 입장문', url:'https://dasol.example.invalid/statement', version:'연습 1판', locator:'두 번째 문장',
    excerpt:'다솔당은 봄빛당이 심사를 고의로 막았다고 주장했다.'},
  {id:'council', title:'가상 시의회 회의록', url:'https://council.example.invalid/minutes', version:'연습 1판', locator:'연기 의결',
    excerpt:'두 정당의 간사는 심사를 다음 주로 연기하는 데 합의했다.'}
];
const articles = {
  before:['예산 심사 연기를 놓고 두 정당의 설명이 엇갈렸다.', '시의회는 봄빛당이 심사를 고의로 막았다고 확인했다.'],
  after:['예산 심사가 다음 주로 미뤄졌다.', '다솔당은 봄빛당이 심사를 고의로 막았다고 주장했다.',
    '회의록에는 두 정당이 심사를 연기하기로 합의했다고 적혔다.']
};
function manuscript(lines) {
  const article = lines.join('\n');
  return {format:workspace.schema, demo:true, article, articleDraft:article, sources, receipts:[], rowDrafts:[],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(key => [key,'']))}};
}
const judgments = [
  {before:{level:3, row:1, source:0, reason:'정당의 주장을 의회가 확인한 결론으로 옮겼다.',impact:'독자가 고의 방해를 의회의 공식 결론으로 받아들인다.'},
    after:{level:1, row:1, source:0, reason:'발언자를 밝혔지만 고의 방해 주장을 합의 사실보다 앞세웠다.',impact:'독자가 의혹에 먼저 주목할 수 있다.'}},
  {before:{level:2, row:1, source:0, reason:'발언 주체를 바꿔 의혹을 공식 확인처럼 보이게 했다.',impact:'의혹이 확인됐다고 오해할 수 있다.'},
    after:{level:0, row:2, source:1, reason:'회의록을 인용해 연기 합의가 있었다고 정확히 설명했다.'}}
];
async function generate() {
  const files = [];
  for (const [i, editor] of judgments.entries()) {
    const {key, packets} = await blind.prepare(manuscript(articles.before), manuscript(articles.after));
    const pairId = engine.digestValue(['score-review-practice',i]).slice(0,32);
    key.pairId = pairId;
    for (const role of ['before','after']) {
      const packet = packets[key.mapping[role].slot], slot = ((role === 'before') === (i === 0)) ? 'A' : 'B';
      key.mapping[role].slot = slot;
      packet.blindReview = {pairId,slot};
      const report = engine.report(packet.article,packet.sources);
      function rating({level,row,source,reason,impact}) {
        return {level, rowId:report.rows[row].id, quote:report.rows[row].text, sourceId:packet.sources[source].id,
          sourceQuote:packet.sources[source].excerpt, reason, impact:impact ?? ''};
      }
      const ratings = {wording:rating(editor[role])};
      if (role === 'before') ratings.omission = rating({level:2, row:1, source:1,
        reason:'심사 연기에 합의했다는 회의록의 내용이 빠졌다.', impact:'어느 한 당이 일방적으로 막은 것으로 읽힌다.'});
      else if (i === 0) ratings.omission = rating({level:0,row:2,source:1,reason:'연기 합의 내용을 기사에서 밝혔다.'});
      packet.articleAssessment = rubric.save(report, packet.sources, {coreRowIds:[],ratings});
      files.push({name:'편집자-' + (i+1) + '-' + slot + '.json',data:packet});
    }
    files.push({name:'진행자-' + (i+1) + '.json',data:key});
  }
  const pair = await blind.resolveBundle(files), joint = agreement.compare(...pair);
  assert.deepEqual(joint.missingReturns,[]);
  assert.equal(joint.improved.numerator,1);
  const citations = audit.article(joint,pair.map(review=>[review.before,review.after].map(workspace.read)));
  assert.deepEqual(citations.rows.find(x=>x.id === 'wording').sameEdition,['aligned','different']);
  const summary = series.makeRecord(joint,pair[0].key);
  const archive = await retention.create(summary,files,[]);
  return {summary,archive,joint};
}
async function main() {
  const {summary,archive} = await generate();
  for (const [name,data] of [['summary',summary],['coordinator-case',archive]]) {
    const file = path.join(__dirname,name+'.json'), content = JSON.stringify(data,null,2)+'\n';
    if (process.argv.includes('--check')) assert.equal(fs.readFileSync(file,'utf8'),content,name);
    else fs.writeFileSync(file,content);
  }
  console.log('가상 기사 한 편 · 원본 입장문 인용 위치 겹침, 수정본 입장문·회의록 인용 다름');
}
if (require.main === module) main().catch(error=>{ console.error(error); process.exitCode=1; });
module.exports = {generate};

// Fictional articles, sources and editor judgments for the offline reader.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const blind = require('../../docs/reader/blind-revision.js');
const agreement = require('../../docs/reader/revision-agreement.js');
const series = require('../../docs/reader/revision-series.js');
const retention = require('../../docs/reader/retention-case.js');
const audit = require('../../docs/reader/revision-bias-audit.js');
const rubric = require('../../docs/reader/article-rubric.js');
const workspace = require('../../docs/reader/workspace-snapshot.js');
const engine = require('../../docs/reader/factcheck-engine.js');
const renderPreview = require('./render-preview.cjs');

const aligned = {
  name:'aligned', title:'여울시장 상인의 매출 감소 응답',
  before:['가상 여울시장 상인 30명이 공사 기간의 영업 상황을 묻는 설문에 답했다.',
    '상인 12명은 매출이 줄었다며 엄살을 부렸다.'],
  after:['가상 여울시장 상인 30명이 공사 기간의 영업 상황을 묻는 설문에 답했다.',
    '상인 12명은 매출이 줄었다고 답했다.'],
  sources:[{id:'sales', title:'가상 여울시장 영업 상황 설문', url:'https://yeoul.example.invalid/sales',
    version:'연습 1판', locator:'문항 2, 매출 감소 응답', excerpt:'응답 상인 30명 중 12명이 공사 기간에 매출이 줄었다고 답했다.'}],
  editors:[
    {row:1, source:0, before:'응답표에는 매출 감소를 선택한 사람 수만 있다. 기사에서 이를 엄살이라고 단정했다.',
      impact:'독자가 상인들이 매출 감소를 과장했다고 받아들일 수 있다.',
      after:'엄살이라는 표현을 걷어 내고 12명이 어떤 답을 골랐는지 전했다.'},
    {row:1, source:0, before:'설문에는 상인들이 어려움을 부풀렸는지 묻는 문항이 없다. 엄살이라는 평가는 기자가 보탰다.',
      impact:'매출에 관한 자기 보고를 거짓 호소로 읽게 한다.',
      after:'매출이 줄었다는 판단을 응답자에게 돌렸고 그 진술에 대한 평가는 덧붙이지 않았다.'}
  ]
};
const different = {
  name:'different', title:'온들시장 공사와 휴업·이사 설문',
  before:['가상 온들시장 공사 기간에 상인과 인근 주민을 대상으로 두 설문을 실시했다.',
    '상인 응답자 20명 중 6명은 공사를 핑계로 가게를 닫았다.',
    '주민 응답자 40명 중 8명은 소음 때문에 이사를 고려한다며 엄살을 부렸다.'],
  after:['가상 온들시장 공사 기간에 상인과 인근 주민을 대상으로 두 설문을 실시했다.',
    '상인 응답자 20명 중 6명은 휴업 사유로 공사를 꼽았다.',
    '주민 응답자 40명 중 8명은 소음 때문에 이사를 고려한다고 답했다.'],
  sources:[
    {id:'closure', title:'가상 온들시장 상인 휴업 설문', url:'https://ondeul.example.invalid/shop-closures',
      version:'연습 1판', locator:'문항 3, 휴업 사유', excerpt:'상인 응답자 20명 중 6명이 휴업 사유로 시장 공사를 선택했다.'},
    {id:'moving', title:'가상 온들시장 인근 주민 주거 설문', url:'https://ondeul.example.invalid/resident-moves',
      version:'연습 1판', locator:'문항 4, 이사 의향', excerpt:'주민 응답자 40명 중 8명이 공사 소음 때문에 이사를 고려한다고 답했다.'}
  ],
  editors:[
    {row:1, source:0, before:'상인 설문은 휴업 사유를 물었다. 공사가 핑계였는지는 조사하지 않았다.',
      impact:'상인이 휴업 이유를 꾸며 냈다고 읽히게 한다.',
      after:'휴업 사유 문항에서 공사를 고른 상인 수를 그대로 옮겼다.'},
    {row:2, source:1, before:'주민 설문에 적힌 이사 의향을 기사에서 엄살이라고 평가했다.',
      impact:'주민이 이사까지 생각한다는 답을 과장으로 여기게 한다.',
      after:'주민들이 밝힌 이사 의향과 그 이유만 전했다.'}
  ]
};
const scenarios = [aligned, different];

function manuscript(lines, sources) {
  const article = lines.join('\n');
  return {format:workspace.schema, demo:true, article, articleDraft:article, sources, receipts:[], rowDrafts:[],
    sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(field => [field, '']))}};
}

async function editorFiles(scenario, editor, index) {
  const {key, packets} = await blind.prepare(manuscript(scenario.before, scenario.sources), manuscript(scenario.after, scenario.sources));
  // Normalize only the random identifiers and assignment order of these synthetic files.
  const pairId = engine.digestValue(['bias-citation-audit', scenario.name, index]).slice(0, 32);
  const prefix = scenario.name + '-editor-' + (index + 1);
  key.pairId = pairId;
  const files = [{name:prefix + '-key.json', data:key}];
  for (const role of ['before', 'after']) {
    const work = packets[key.mapping[role].slot];
    const slot = (role === 'before') === (index === 0) ? 'B' : 'A';
    key.mapping[role].slot = slot;
    work.blindReview = {pairId, slot};
    const report = engine.report(work.article, work.sources);
    const row = report.rows[editor.row], source = work.sources[editor.source];
    assert.equal(row.text, scenario[role][editor.row]);
    work.articleAssessment = rubric.save(report, work.sources, {coreRowIds:[], ratings:{wording:{
      level:role === 'before' ? 2 : 0, rowId:row.id, quote:row.text, sourceId:source.id,
      sourceQuote:source.excerpt, reason:editor[role], impact:role === 'before' ? editor.impact : ''
    }}});
    files.push({name:prefix + '-' + slot + '.json', data:work});
  }
  return files;
}

async function generate(scenario) {
  const inputs = (await Promise.all(scenario.editors.map((editor, index) => editorFiles(scenario, editor, index)))).flat();
  const pair = await blind.resolveBundle(inputs);
  const joint = agreement.compare(...pair);
  const summary = series.makeRecord(joint, pair[0].key);
  const archive = await retention.create(summary, inputs, []);
  assert.equal(summary.demo, true);
  assert.deepEqual(joint.missingReturns, []);
  assert.deepEqual(joint.improved, {numerator:1, denominator:1, pct:100});
  const verification = await audit.audit([summary], [archive]);
  assert.equal(verification[scenario.name], 1);
  assert.equal(verification.checkedArchives, 1);
  return {summary, archive, pair, verification, title:scenario.title};
}

async function main() {
  const results = await Promise.all(scenarios.map(generate));
  const summaries = results.map(item => item.summary), archives = results.map(item => item.archive);
  assert.deepEqual(summaries[0].dimensions, summaries[1].dimensions);
  const totals = await audit.audit(summaries, archives);
  for (const [field, count] of Object.entries({articles:2, improved:2, aligned:1, different:1,
    unresolved:0, unopened:0, checkedArchives:2, duplicateArchives:0})) assert.equal(totals[field], count, field);

  const checkOnly = process.argv.includes('--check');
  function output(name, contents) {
    const file = path.join(__dirname, name);
    if (checkOnly) assert.equal(fs.readFileSync(file, 'utf8'), contents, name);
    else fs.writeFileSync(file, contents);
  }
  output('preview.html', renderPreview(results, series.summarize(summaries).improved, totals));
  for (const [index, {summary, archive}] of results.entries()) {
    for (const [suffix, data] of [['summary', summary], ['case', archive]]) {
      output(scenarios[index].name + '-' + suffix + '.json', JSON.stringify(data, null, 2) + '\n');
    }
  }
  console.log(JSON.stringify(totals));
}

main().catch(error => { console.error(error); process.exitCode = 1; });

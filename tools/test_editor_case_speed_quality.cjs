const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const study = require('../docs/reader/editor-study-core');
const cases = require('../docs/reader/editor-study-cases');

test('같은 시간 표본에서 전체 성공 수가 그대로여도 빨라지며 검증 성공이 줄어든 기사를 찾는다', () => {
  const records = study.caseVerificationDemoRecords();
  for (const t of records.flatMap(r => r.trials).filter(t => t.method === 'journal' && t.caseId === 'filing')) {
    const source = cases.get(t.caseId,t.variant).sources.find(s => t.sourceIds.includes(s.id));
    assert.equal(source.title,'사전 검토 접수표');
  }
  const a = study.analyze(records, 'demo');
  assert.deepEqual([a.time.manualSeconds,a.time.journalSeconds], [60,46.25]);
  assert.deepEqual([a.timedQuality.manual.verified,a.timedQuality.journal.verified], [6,6]);
  assert.equal(a.bias.reductionPp, 0);
  assert.equal(a.timedQuality.faster.fewerVerified, 0);
  const sample = a.caseVerification;
  assert.deepEqual([sample.comparedCases,sample.fasterCases,sample.fasterWithFewerVerified], [4,1,1]);
  assert.deepEqual(sample.cases.map(row => row.caseId), cases.ids);
  const filing = sample.cases.find(row => row.caseId === 'filing');
  assert.deepEqual(filing, {caseId:'filing', manual:{tasks:2,verified:2,meanSeconds:60},
    journal:{tasks:2,verified:0,meanSeconds:5}, faster:true, fasterWithFewerVerified:true});
  assert.deepEqual(sample.cases.filter(row => row.fasterWithFewerVerified), [filing]);
  assert.equal(study.analyze(records.slice(1), 'demo').caseVerification, null);
  assert.equal(study.analyze(records).caseVerification, null);
});

test('일부 시간만 남은 묶음과 다른 판본을 배제하고 매우 긴 과제의 1ms 차이도 정확히 분류한다', () => {
  const records = study.caseVerificationDemoRecords();
  const large = Number.MAX_SAFE_INTEGER - 1;
  let reduced = false;
  const full = records.map(r => ({...r, trials:r.trials.map(t => {
    const earlier = !reduced && t.method === 'journal' && t.caseId === 'filing';
    if (earlier) reduced = true;
    return {...t,elapsedMs:large - Number(earlier),kitVersion:'a'.repeat(64)};
  })}));
  const partial = records.map(r => {
    let record = study.createRecord(r.participantId + '-next',r.ordinal + 4,'demo',false);
    for (const task of study.plan(record.ordinal)) {
      const gold = cases.get(task.caseId,task.variant);
      const time = record.ordinal === 5 && task.position === 1 ? {elapsedMs:null,observedMs:3000} : {elapsedMs:10000};
      record = study.addTrial(record, {...time, kitVersion:'b'.repeat(64), verdict:gold.expectedVerdict,
        sourceIds:gold.expectedSourceIds, journalUsed:task.method === 'journal', reason:'다른 판본에서 기록한 모의 답안입니다.'});
    }
    return record;
  });
  assert.equal(study.analyze(partial, 'demo').caseVerification, null);
  const editions = study.analyzeEditions([...full,...partial],'demo').editions;
  assert.equal(editions.length,2);
  assert.equal(editions.find(e => e.kitVersion === 'b'.repeat(64)).analysis.caseVerification,null);
  const result = study.analyze([...full,...partial],'demo').caseVerification;
  assert.deepEqual(result,editions.find(e => e.kitVersion === 'a'.repeat(64)).analysis.caseVerification);
  assert.deepEqual([result.fasterCases,result.fasterWithFewerVerified],[1,1]);
  const row = result.cases.find(item => item.caseId === 'filing');
  assert.equal(row.manual.tasks,2);
  assert.equal(row.manual.meanSeconds,row.journal.meanSeconds);
  const ties = study.analyze(full.map(r => ({...r,trials:r.trials.map(t => ({...t,elapsedMs:large}))})), 'demo').caseVerification;
  assert.deepEqual([ties.fasterCases,ties.fasterWithFewerVerified],[0,0]);
});

test('기사별 모의 결과를 바로 열어 두 방식의 성공 분모를 읽고 실측으로 돌아오면 모의 결과를 지운다', t => {
  const folder = path.join(__dirname,'../docs/reader');
  const read = name => readFileSync(path.join(folder,name),'utf8');
  const {window:w} = new JSDOM(read('editor-study.html'),
    {url:'https://journal.example/editor-study.html#demo-case-verification',runScripts:'outside-only'});
  t.after(() => w.close());
  for (const script of w.document.querySelectorAll('script[src]')) w.eval(read(script.getAttribute('src')));
  const el = id => w.document.getElementById(id);
  assert.equal(el('demo-example').value,'case-verification');
  const panel = el('case-verification');
  assert.match(panel.textContent,/기사 4개 중 평균 검토 시간이 줄어든 기사는 1개/);
  assert.match(panel.textContent,/줄어든 기사는 1개 \(사업비 자료 제출\)/);
  const filing = [...panel.querySelectorAll('tbody tr')].find(tr => tr.cells[0].textContent === '사업비 자료 제출');
  assert.deepEqual([...filing.cells].map(td => td.textContent), ['사업비 자료 제출','60초 · 성공 2/2건','5초 · 성공 0/2건']);
  el('real-view').click();
  assert.equal(panel.querySelector('table'),null);
  assert.match(panel.textContent,/전체 시간을 기록한 묶음이 필요/);
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const {JSDOM} = require('jsdom');
const order = require('../docs/reader/field-order.js');

function trial(person, method, article, ms) {
  return {format:'journal-field-trial-v1', id:person + '-' + method, kind:'editor', participant:person,
    caseId:'case-' + article, articleUrl:'https://private.example.invalid/' + article, taskId:'task-one',
    prompt:'내부 과제 ' + article, method, kitVersion:article.toLowerCase().repeat(64), status:'completed',
    recovered:false, split:true, phaseMs:{search:ms, locate:0, decide:0}, journalUse:method === 'manual' ? 'no' : 'yes',
    found:'found', documentUrl:'https://private.example.invalid/document', locator:'표 1', verdict:'supported', reason:'제출한 풀이'};
}

function pair(person, direction, manualMs = 10000, journalMs = 6000) {
  return {manual:trial(person, 'manual', direction ? 'B' : 'A', manualMs),
    journal:trial(person, 'journal', direction ? 'A' : 'B', journalMs),
    direction, cohort:'private-cohort', plannedFirst:null, manualPassed:true, journalPassed:true};
}

async function link(p, first) {
  p[first === 'manual' ? 'journal' : 'manual'].previousCompletion = await order.receipt(p[first]);
  return p;
}

test('완료 지문은 같은 제출물의 키 순서·진행자 채점에 무관하고 답안과 배정 판본·시간에 묶인다', async () => {
  const m = trial('private-person', 'manual', 'A', 1000);
  const expected = await order.receipt(m);
  assert.deepEqual(Object.keys(expected).sort(), ['id', 'sha256']);
  assert.equal(expected.id, m.id);
  // Lock the v1 wire format, independently checked against Python hashlib.
  assert.equal(expected.sha256, '81afd16b57d2ea23e19c6ba15897d11e97a843a66e05258e0e446b23a0901336');
  const reordered = Object.fromEntries(Object.entries(m).reverse());
  reordered.phaseMs = {decide:0, locate:0, search:1000};
  assert.deepEqual(await order.receipt({...reordered, reasonGrade:'no', assignedKitVersion:'f'.repeat(64)}), expected);
  for (const change of [{id:'other'}, {caseId:'other'}, {articleUrl:'https://example.invalid/other'}, {taskId:'other'},
    {prompt:'다른 과제'}, {participant:'other'}, {kitVersion:'c'.repeat(64)}, {split:false},
    {phaseMs:{search:999, locate:1, decide:0}}, {found:'missing'}, {documentUrl:'https://example.invalid/ref'},
    {locator:'표 2'}, {verdict:'contradicted'}, {reason:'다른 풀이'}, {method:'journal', journalUse:'yes'}]) {
    assert.notEqual((await order.receipt({...m, ...change})).sha256, expected.sha256);
  }
  for (const change of [{kind:'practice'}, {synthetic:true}, {recovered:true}, {status:'withdrawn'}, {kitVersion:null},
    {startedKitVersion:m.kitVersion, kitVersion:null}, {journalUse:'yes'}, {previousCompletion:expected}]) {
    await assert.rejects(order.receipt({...m, ...change}));
  }
  assert.equal(order.validReceipt(expected), true);
  for (const wrong of [null, {}, {id:'', sha256:expected.sha256}, {...expected, other:1}, {...expected, sha256:expected.sha256+'\n'}]) {
    assert.equal(order.validReceipt(wrong), false);
  }
});

test('원래 계획, 실제 선행 방식, 두 기사 배정이 맞물린 네 칸에서만 시간과 성공을 집계한다', async () => {
  const pairs = await Promise.all([
    link({...pair('p0', 0, 10000, 8000), plannedFirst:'manual'}, 'manual'),
    link({...pair('p1', 1, 30000, 4000), plannedFirst:'journal', manualPassed:false, journalPassed:null}, 'manual'),
    link({...pair('p2', 0, 0, 15000), plannedFirst:'journal', manualPassed:null, journalPassed:false}, 'journal'),
    link(pair('p3', 1, 0, 5000), 'journal')
  ]);
  const result = await order.compare(pairs);
  assert.deepEqual(result, {total:4, confirmed:4, manualFirst:2, journalFirst:2, unlinked:0, invalid:0,
    asPlanned:2, reversed:1, withoutPlan:1, balanced:{cohorts:1, editors:4,
      manualFirst:{editors:2, manualMeanMs:20000, journalMeanMs:6000, savedMs:14000, savedPct:70,
        manualPassed:1, journalPassed:1, manualPending:0, journalPending:1},
      journalFirst:{editors:2, manualMeanMs:0, journalMeanMs:10000, savedMs:-10000, savedPct:null,
        manualPassed:1, journalPassed:1, manualPending:1, journalPending:0}}});
  assert.deepEqual(await order.compare([...pairs].reverse()), result);
  const withoutFourth = await order.compare(pairs.slice(0, 3));
  assert.equal(withoutFourth.confirmed, 3);
  assert.equal(withoutFourth.balanced.editors, 0);
  assert.equal(withoutFourth.balanced.manualFirst.savedPct, null);
  const separate = pairs.map((p, i) => ({...p, cohort:i < 2 ? 'x' : 'y'}));
  assert.equal((await order.compare(separate)).balanced.cohorts, 0);
  assert.doesNotMatch(JSON.stringify(result), /private|case-A|task-one|표 1|제출한 풀이|p[0-3]|sha256/);
});

test('미연결·짝이 다른 지문·자기 참조·중복·순환 및 제출 이후 달라진 첫 답안을 구분한다', async () => {
  const item = await link(pair('private-person', 0), 'manual'), other = await link(pair('different-person', 1), 'journal');
  const old = pair('legacy-person', 1);
  const rejected = [
    {...item, journal:{...item.journal, previousCompletion:null}},
    {...item, journal:{...item.journal, previousCompletion:{...item.journal.previousCompletion, id:item.journal.id}}},
    {...item, journal:{...item.journal, previousCompletion:{...item.journal.previousCompletion, sha256:'f'.repeat(64)}}},
    {...item, manual:{...item.manual, previousCompletion:other.manual.previousCompletion}},
    {...item, manual:{...item.manual, reason:'새로 편집한 풀이'}},
    {...item, journal:{...item.journal, participant:'남의 코드'}},
    {...item, journal:{...item.journal, previousCompletion:other.manual.previousCompletion}},
    {...item, journal:{...item.journal, articleUrl:item.manual.articleUrl + '?utm_medium=other'}},
    {...item, journal:{...item.journal, caseId:item.manual.caseId}},
    {...item, journal:{...item.journal, method:'manual', journalUse:'no'}},
    {...item, journal:{...item.journal, recovered:true}},
  ];
  for (const p of rejected) {
    const result = await order.compare([p,old]);
    assert.deepEqual([result.confirmed,result.invalid,result.unlinked], [0,1,1]);
  }
  const mix = await order.compare([item,old,other]);
  assert.deepEqual([mix.confirmed,mix.unlinked,mix.invalid], [2,1,0]);
  const duplicates = await order.compare([item,other,structuredClone(item)]);
  assert.deepEqual([duplicates.confirmed,duplicates.invalid], [1,2]);
  const reusedId = {...other, journal:{...other.journal, id:item.manual.id}};
  assert.equal((await order.compare([item,reusedId])).invalid, 2);
  assert.equal((await order.compare([])).total, 0);
});

test('브라우저와 Node에서 같은 지문과 비교가 나오며 지문 계산 실패를 불일치로 세지 않는다', async t => {
  const {window} = new JSDOM('', {runScripts:'outside-only'});
  t.after(() => window.close());
  Object.defineProperty(window, 'crypto', {value:webcrypto, configurable:true});
  window.TextEncoder = TextEncoder;
  for (const name of ['field-review-core.js','field-order.js']) {
    window.eval(fs.readFileSync(path.join(__dirname, '../docs/reader', name), 'utf8'));
  }
  const p = await link(pair('browser-person', 0), 'journal');
  const read = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(read(await window.JournalFieldOrder.receipt(p.journal)), await order.receipt(p.journal));
  assert.deepEqual(read(await window.JournalFieldOrder.compare([p])), await order.compare([p]));
  Object.defineProperty(window, 'crypto', {value:{}, configurable:true});
  await assert.rejects(window.JournalFieldOrder.compare([p]), /지문/);
  assert.equal((await window.JournalFieldOrder.compare([pair('legacy',0)])).unlinked, 1);
});

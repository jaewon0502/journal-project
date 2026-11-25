'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tasks = [
  {
    caseId: 'synthetic-library', articleUrl: 'https://library.example.invalid/article-a', id: 'synthetic-a',
    prompt: '가상 과제 A. 가상 도서관의 연간 대출 건수가 100건에서 120건으로 20% 늘었다는 설명을 검토하세요.',
    verdict: 'supported', explanation: '증가분 20건을 전년의 100건으로 나누면 20%다.',
    reference: {document: '가상 도서관 대출표', documentUrl: 'https://library.example.invalid/table', locator: '가상 표 A 1행, 전년 100건·올해 120건'}
  },
  {
    caseId: 'synthetic-bike', articleUrl: 'https://bike.example.invalid/article-b', id: 'synthetic-b',
    prompt: '가상 과제 B. 가상 대여소의 한 달 대여 횟수가 80회에서 60회로 25% 줄었다는 설명을 검토하세요.',
    verdict: 'supported', explanation: '감소분 20회를 직전 달의 80회로 나누면 25%다.',
    reference: {document: '가상 자전거 대여표', documentUrl: 'https://bike.example.invalid/table', locator: '가상 표 B 1행, 직전 달 80회·이번 달 60회'}
  }
];
const wrongReasons = [
  '증가분 20건을 올해 120건으로 나누면 20%다.',
  '감소분 20회를 이번 달 60회로 나누면 25%다.'
];
const phaseSeconds = {
  manual: {search: 50, locate: 30, decide: 20},
  fast: {search: 8, locate: 7, decide: 5},
  slow: {search: 40, locate: 35, decide: 45}
};
// Each article and each method comes first twice across the four fictional editors.
const participants = [
  {code: 'SYNTHETIC-01', first: 0, manualTask: 0, speed: 'fast'},
  {code: 'SYNTHETIC-02', first: 1, manualTask: 0, speed: 'slow'},
  {code: 'SYNTHETIC-03', first: 0, manualTask: 1, speed: 'fast'},
  {code: 'SYNTHETIC-04', first: 1, manualTask: 1, speed: 'slow'}
];
const roster = {format: 'journal-field-assignment-v1', synthetic: true, design: 'two-article-crossover-v1',
  scope: 'single-allocation', assignments: []};
const grades = Object.fromEntries(['slow', 'fast'].map(speed => [speed, {
  format: 'journal-field-grades-v1', synthetic: true, entries: []
}]));

for (const person of participants) {
  for (const index of [person.first, 1 - person.first]) {
    const basis = tasks[index], manual = person.manualTask === index;
    const method = manual ? 'manual' : 'journal';
    const kitVersion = (index ? 'b' : 'a').repeat(64);
    const {caseId, articleUrl, prompt} = basis;
    const assignment = {participant: person.code, caseId, articleUrl, taskId: basis.id, prompt, method};
    roster.assignments.push({...assignment, assignedKitVersion: kitVersion});
    const seconds = phaseSeconds[manual ? 'manual' : person.speed];
    const phaseMs = Object.fromEntries(Object.entries(seconds).map(([phase, value]) => [phase, value * 1000]));
    for (const [passingSpeed, data] of Object.entries(grades)) {
      const pass = manual || person.speed === passingSpeed;
      // The real crossover analysis reads only 'editor' entries. These files belong in a separate demo window.
      const trial = {...assignment, format: 'journal-field-trial-v1', id: person.code + '-' + basis.id,
        kind: 'editor', status: 'completed', kitVersion, recovered: false, split: true,
        journalUse: manual ? 'no' : 'yes', phaseMs, found: 'found', documentUrl: basis.reference.documentUrl,
        locator: basis.reference.locator, verdict: basis.verdict, reason: pass ? basis.explanation : wrongReasons[index]};
      data.entries.push({trial, basis, expected: basis.verdict, locationGrade: 'yes', verdictGrade: 'yes',
        reasonGrade: pass ? 'yes' : 'no'});
    }
  }
}

function summarize(pairs) {
  const mean = method => pairs.reduce((sum, pair) => sum + pair[method].seconds, 0) / pairs.length;
  return {editors: pairs.length, manualMeanSeconds: mean('manual'), journalMeanSeconds: mean('journal'),
    journalMinusManualSeconds: mean('journal') - mean('manual')};
}
function measure(entries) {
  const people = new Map();
  for (const {trial, locationGrade, verdictGrade, reasonGrade} of entries) {
    if (!people.has(trial.participant)) people.set(trial.participant, {});
    const seconds = Object.values(trial.phaseMs).reduce((sum, ms) => sum + ms, 0) / 1000;
    const passed = [locationGrade, verdictGrade, reasonGrade].every(grade => grade === 'yes');
    people.get(trial.participant)[trial.method] = {seconds, passed};
  }
  const all = [...people.values()];
  return {all: summarize(all), bothPassed: summarize(all.filter(pair => pair.manual.passed && pair.journal.passed))};
}

const check = process.argv[2] === '--check';
if (process.argv.length > (check ? 3 : 2)) throw new Error('Usage: node build_fixture.cjs [--check]');
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected.json'), 'utf8'));
const files = {'synthetic-roster.json': roster};
for (const [speed, data] of Object.entries(grades)) {
  const name = 'synthetic-grades-' + speed + '-pass.json';
  assert.deepEqual(measure(data.entries), expected.scenarios[name], name);
  files[name] = data;
}
for (const [name, data] of Object.entries(files)) {
  const body = JSON.stringify(data, null, 2) + '\n';
  const target = path.join(__dirname, name);
  if (check) assert.equal(fs.readFileSync(target, 'utf8'), body, name + ' differs from the generated fixture');
  else fs.writeFileSync(target, body);
}
console.log(check ? 'Verified three synthetic input files and both expected comparisons.' : 'Wrote three synthetic input files.');

'use strict';

const assert = require('node:assert/strict');
const field = require('../../docs/reader/field-review-core.js');
const engine = require('../../docs/reader/factcheck-engine.js');
const workspace = require('../../docs/reader/workspace-snapshot.js');
const {compare} = require('../../docs/reader/article-compare-core.js');
const blind = require('./blind-tasks.json');
const original = require('./blind-workspace.json');
const key = require('./coordinator-key.json');

assert.deepEqual(field.readCase(blind), blind);
assert.deepEqual({...key, tasks: key.tasks.map(({id, prompt}) => ({id, prompt}))}, blind);
assert.equal(workspace.read(original).assessment.accuracy.adjudicated, 0);

// The same three published passages are judged in their original article context.
// Only the deictic year in the second passage changes in the local edit.
const [growth, period, rate] = original.article.split('\n');
assert.match(period, /^올해 /u);
const fixed = period.replace(/^올해 /u, '2024년 ');
const tasks = new Map(key.tasks.map(task => [task.id, task]));

function replay(revised) {
  const article = [growth, revised ? fixed : period, rate].join('\n');
  const {rows} = engine.prepare(article, original.sources);
  const decisionIds = ['labour-growth', 'labour-period', 'labour-rate'];
  const receipts = rows.map((row, index) => {
    const task = tasks.get(decisionIds[index]);
    const periodRow = task.id === 'labour-period';
    const corrected = revised && periodRow;
    const status = task.verdict === 'supported' || corrected ? 'fact' : 'contradicted';
    const reason = corrected
      ? 'AI 원자료 대조. 발행일과 구별해 집계 연도를 2024년으로 표시했다. 연간 취업자 증가 폭은 2022년 81.6만 명, 2023년 32.7만 명, 2024년 15.9만 명이다.'
      : 'AI 원자료 대조. ' + task.explanation;
    return engine.decide(row, {status, reason, acknowledged: true,
      sourceIds: periodRow ? ['survey', 'article-date'] : ['survey'],
      ...(status === 'contradicted' ? {correction: fixed, correctionChecked: true} : {})}, original.sources);
  });
  return workspace.read({...original, article, articleDraft: article, receipts, demo: true});
}

const before = replay(false);
const after = replay(true);
const pair = compare(before, after, 'revision');
assert.equal(pair.sourceChanged, false);
assert.equal(pair.bias.paired, 0);
assert.deepEqual(before.rows.map(row => row.receipt.status), ['fact', 'contradicted', 'fact']);
assert.deepEqual(after.rows.map(row => row.receipt.status), ['fact', 'fact', 'fact']);
for (const [label, snapshot] of [['발췌 원문', before], ['편집 제안', after]]) {
  const a = snapshot.assessment.accuracy;
  assert.equal(a.adjudicated, 3);
  assert.equal(a.coveragePct, 100);
  console.log(label, '근거 지지 ' + a.supported + '/' + a.adjudicated +
    ' (' + a.accuracyPct.toFixed(1) + '%), 충돌 ' + a.contradicted +
    '건, 판정 완료 ' + a.adjudicated + '/' + a.total + '.');
}

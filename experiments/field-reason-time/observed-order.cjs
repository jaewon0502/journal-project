// Four anonymous, synthetic pairs reusing the frozen fictional tasks and reasons.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const field = require('../../docs/reader/field-review-core.js');
const order = require('../../docs/reader/field-order.js');
const load = file => JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));

async function example() {
  const roster = load('synthetic-roster.json'), grades = load('synthetic-grades-slow-pass.json');
  assert.equal(roster.synthetic, true); assert.equal(grades.synthetic, true);
  const people = new Map();
  for (const {trial} of grades.entries) {
    if (!people.has(trial.participant)) people.set(trial.participant, {});
    people.get(trial.participant)[trial.method] = trial;
  }
  for (const [person, trials] of people) {
    const elapsed = trial => field.phases.reduce((sum, phase) => sum + trial.phaseMs[phase], 0);
    const fast = elapsed(trials.journal) < elapsed(trials.manual);
    const first = fast ? 'manual' : 'journal';
    const second = first === 'manual' ? 'journal' : 'manual';
    trials[second].previousCompletion = await order.receipt(trials[first]);
    const plan = person.endsWith('01') ? second : first;
    for (const row of roster.assignments.filter(r => r.participant === person)) row.plannedPeriod = row.method === plan ? 1 : 2;
  }
  return {roster, grades};
}

async function render() {
  const {roster, grades} = await example(), pairs = [];
  const records = grades.entries.map(entry => ({...entry, trial:field.validate(entry.trial)}));
  const {editorCrossover} = field.allocationReport(field.mergeAssignments([], [roster]), records, new Set(),
    undefined, pair => pairs.push(pair));
  const observed = await order.compare(pairs);
  assert.deepEqual([observed.confirmed, observed.reversed, observed.balanced.editors], [4,1,4]);
  assert.deepEqual([observed.balanced.manualFirst.savedPct, observed.balanced.journalFirst.savedPct], [80,-20]);
  const {window} = new JSDOM('', {runScripts:'outside-only'});
  try {
    window.eval(fs.readFileSync(path.join(__dirname, '../../docs/reader/field-time-report.js'), 'utf8'));
    const html = window.JournalFieldTimeReport.crossoverHtml(editorCrossover, '가상 네 편집자의 과제 순서와 검증 결과', observed);
    assert.doesNotMatch(html, /SYNTHETIC-|example\.invalid|sha256|previousCompletion/i);
    return html + '\n';
  } finally { window.close(); }
}

if (require.main === module) {
  render().then(html => {
    const file = path.join(__dirname, 'observed-order.html');
    if (process.argv[2] === '--check') assert.equal(fs.readFileSync(file,'utf8'), html);
    else fs.writeFileSync(file, html);
  }).catch(error => {console.error(error);process.exitCode=1});
}
module.exports = {example};

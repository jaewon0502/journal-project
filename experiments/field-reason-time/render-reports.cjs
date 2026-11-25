'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const core = require('../../docs/reader/field-review-core.js');

const check = process.argv[2] === '--check';
if (process.argv.length !== (check ? 3 : 2)) throw new Error('Usage: node render-reports.cjs [--check]');

function readSynthetic(name) {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  assert.equal(file.synthetic, true, name + ' must be marked synthetic');
  return file;
}
function checkIdentity(entry) {
  assert.match(entry.participant, /^SYNTHETIC-0[1-4]$/);
  assert.match(entry.caseId, /^synthetic-/);
  assert.match(entry.taskId, /^synthetic-/);
  assert.ok(new URL(entry.articleUrl).hostname.endsWith('.example.invalid'));
}
function checkTime(expected, time, editors) {
  assert.deepEqual({
    editors, manualMeanSeconds: time.manualMeanMs / 1000, journalMeanSeconds: time.journalMeanMs / 1000,
    journalMinusManualSeconds: -time.savedMs / 1000
  }, expected);
}

const assignments = core.mergeAssignments([], [readSynthetic('synthetic-roster.json')]);
assignments.forEach(checkIdentity);
const expected = readSynthetic('expected.json');
const renderer = fs.readFileSync(path.join(__dirname, '../../docs/reader/field-time-report.js'), 'utf8');
const examples = [
  ['slow-pass', '모의 비교 · 저널에서 더 오래 걸린 두 사람이 양쪽 모두 맞힌 경우'],
  ['fast-pass', '모의 비교 · 저널에서 빨라진 두 사람이 양쪽 모두 맞힌 경우']
];
for (const [id, title] of examples) {
  const file = 'synthetic-grades-' + id + '.json';
  const grades = readSynthetic(file);
  assert.equal(grades.format, 'journal-field-grades-v1');
  const entries = grades.entries.map(entry => {
    const trial = core.validate(entry.trial);
    checkIdentity(trial);
    assert.equal(trial.kind, 'editor');
    assert.ok(new URL(trial.documentUrl).hostname.endsWith('.example.invalid'));
    return {...entry, trial};
  });
  const {editorCrossover: result} = core.allocationReport(assignments, entries, new Set());
  const work = result.successfulWork;
  checkTime(expected.scenarios[file].all, result, result.comparedEditors);
  checkTime(expected.scenarios[file].bothPassed, work.time, work.comparedEditors);
  assert.equal(work.bothPassed, work.comparedEditors);
  assert.equal(work.phaseEditors, work.comparedEditors);

  // An opaque, in-memory document supplies the renderer's DOM; no grader page or browser profile is opened.
  const {window} = new JSDOM('', {runScripts: 'outside-only'});
  try {
    window.eval(renderer);
    const html = window.JournalFieldTimeReport.crossoverHtml(result, title) + '\n';
    const document = new window.DOMParser().parseFromString(html, 'text/html');
    assert.equal(document.title, title);
    assert.ok(document.body.textContent.includes('모의 기록'));
    assert.equal(document.querySelector('script, [src], [href], form, iframe'), null);
    assert.doesNotMatch(html, /SYNTHETIC-|example\.invalid|synthetic-library|synthetic-bike/i);
    const paragraphs = [...document.querySelectorAll('p')].map(line => line.textContent);
    for (const part of Object.values(expected.scenarios[file])) {
      const seconds = [part.manualMeanSeconds, part.journalMeanSeconds, Math.abs(part.journalMinusManualSeconds)];
      const direction = part.journalMinusManualSeconds > 0 ? '더 걸림' : '절감';
      assert.ok(paragraphs.some(line => seconds.every(n => line.includes(n.toFixed(1) + '초')) && line.includes(direction)));
    }
    const target = path.join(__dirname, id + '.html');
    if (check) assert.equal(fs.readFileSync(target, 'utf8'), html, id + '.html is out of date');
    else fs.writeFileSync(target, html);
  } finally {
    window.close();
  }
}
console.log(check ? 'Verified both static reports against synthetic inputs and expected results.' : 'Wrote slow-pass.html and fast-pass.html.');

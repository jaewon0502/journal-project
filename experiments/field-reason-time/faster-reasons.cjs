'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const field = require('../../docs/reader/field-review-core.js');

function read(name) {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  assert.equal(file.synthetic, true);
  return file;
}

// Keep the submitted reasons and grades together. Every borrowed response is
// from the same fictional task and the same frozen reference explanation.
function createCase(fastJournalPasses) {
  const grades = read('synthetic-grades-' + (fastJournalPasses ? 'fast' : 'slow') + '-pass.json');
  const journals = grades.entries.filter(e => e.trial.method === 'journal');
  for (const entry of grades.entries.filter(e => e.trial.method === 'manual')) {
    const paired = journals.find(e => e.trial.participant === entry.trial.participant);
    const donor = journals.find(e => e.trial.taskId === entry.trial.taskId && e.reasonGrade !== paired.reasonGrade);
    assert.deepEqual(donor.basis, entry.basis);
    entry.trial.reason = donor.trial.reason;
    entry.reasonGrade = donor.reasonGrade;
  }
  return grades;
}

function render() {
  const roster = field.mergeAssignments([], [read('synthetic-roster.json')]);
  const {window} = new JSDOM('', {runScripts:'outside-only'});
  try {
    window.eval(fs.readFileSync(path.join(__dirname, '../../docs/reader/field-time-report.js'), 'utf8'));
    const reports = [false, true].map(fastJournalPasses => {
      const entries = createCase(fastJournalPasses).entries.map(e => ({...e, trial:field.validate(e.trial)}));
      const pairs = [];
      const stats = field.allocationReport(roster, entries, new Set(), pair => pairs.push(pair)).editorCrossover;
      assert.deepEqual([stats.manualMeanMs, stats.journalMeanMs, stats.faster, stats.successfulWork.bothPassed],
        [100000,70000,2,0]);
      assert.equal(pairs.length, 2);
      assert.equal(stats.fasterReason[fastJournalPasses ? 'journalOnly' : 'manualOnly'], 2);
      const pair = pairs.find(p => entries.find(e => e.trial.id === p.manualId).trial.taskId === 'synthetic-a');
      const example = [pair.manualId, pair.journalId].map(id => entries.find(e => e.trial.id === id));
      const title = '같은 30% 시간 단축에서 달라진 판단 이유';
      const html = window.JournalFieldTimeReport.crossoverHtml(stats, title);
      const page = new window.DOMParser().parseFromString(html, 'text/html');
      const line = [...page.querySelectorAll('p')].find(p => p.textContent.startsWith('저널에서 빨라진 2명 중 평소 도구에서만 성공'));
      assert.ok(line);
      return {page, example, numericLine:line.textContent};
    });
    const doc = reports[0].page, main = doc.querySelector('main');
    main.replaceChildren(main.querySelector('h1'));
    function add(parent, tag, text) {
      const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el;
    }
    add(main, 'p', '가상 편집자 4명이 도서관 대출과 자전거 대여 통계를 검증한 모의 기록입니다. 두 사례 모두 평균 100초에서 70초로 줄었고, 빨라진 두 명은 평소 도구로 100초, 저널로 20초를 썼습니다. 두 사람 모두 양쪽 과제의 표와 판정을 맞혔습니다.');
    for (const [index, report] of reports.entries()) {
      const section = add(main, 'section', '');
      add(section, 'h2', index ? '둘째 사례 · 저널에서만 이유까지 맞혔을 때' : '첫째 사례 · 평소 도구에서만 이유까지 맞혔을 때');
      add(section, 'p', report.numericLine);
      add(section, 'h3', '빨라진 한 사람이 제출한 두 과제의 풀이');
      for (const entry of report.example) {
        const label = entry.trial.method === 'manual' ? '평소 도구' : '저널 병행';
        add(section, 'p', label + ' · ' + (entry.reasonGrade === 'yes' ? '이유 일치' : '이유 불일치'));
        add(section, 'blockquote', entry.trial.reason);
        if (entry.reasonGrade !== 'yes') add(section, 'p', '기준 설명 · ' + entry.basis.explanation);
      }
    }
    add(main, 'p', '한 사람은 서로 다른 기사를 검증했습니다. 이 모의 비교에서 도구가 정확도나 시간을 바꾼 정도를 추정할 수 없습니다.');
    const html = '<!doctype html>' + doc.documentElement.outerHTML + '\n';
    assert.doesNotMatch(html, /SYNTHETIC-|example\.invalid|<script/iu);
    return html;
  } finally { window.close(); }
}

if (require.main === module) {
  const check = process.argv[2] === '--check';
  if (process.argv.length !== (check ? 3 : 2)) throw Error('Usage: node faster-reasons.cjs [--check]');
  const target = path.join(__dirname, 'faster-reasons.html');
  const html = render();
  if (check) assert.equal(fs.readFileSync(target, 'utf8'), html);
  else fs.writeFileSync(target, html);
}
module.exports = {createCase};

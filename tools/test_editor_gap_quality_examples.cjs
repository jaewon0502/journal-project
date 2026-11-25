const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const core = require('../docs/reader/editor-study-core.js');
const cases = require('../docs/reader/editor-study-cases.js');

const reader = path.join(__dirname, '../docs/reader');
const edition = 'ab'.repeat(32);

function syntheticWorkspace(narrowedCase) {
  // Each method/label/case cell has two submissions, one from each complete block.
  const split = [2, 0], even = [1, 1];
  const journal = {
    transit:[2, 2], filing:[2, 2],
    repair:narrowedCase === 'repair' ? even : split,
    permits:narrowedCase === 'permits' ? even : split
  };
  const manual = {transit:split, filing:[2, 2], repair:[1, 0], permits:[2, 1]};
  const records = [], invitations = [];
  for (let ordinal = 1; ordinal <= 8; ordinal++) {
    const id = 'E' + String(ordinal).padStart(16, '0');
    invitations.push({ordinal, id, code:'J2-' + ordinal + '-' + id + '-' + edition});
    // The export requires the editor schema. Only this isolated test page receives these simulated records.
    let record = core.createRecord(id, ordinal, 'editor', true);
    for (const trial of core.plan(ordinal)) {
      const gold = cases.get(trial.caseId, trial.variant);
      const counts = (trial.method === 'manual' ? manual : journal)[trial.caseId];
      const endorse = Math.ceil(ordinal / 4) <= counts[trial.variant === 'A' ? 0 : 1];
      const otherVerdict = gold.expectedVerdict === 'supported' ? 'insufficient' : gold.expectedVerdict;
      record = core.addTrial(record, {
        verdict:endorse ? 'supported' : otherVerdict,
        sourceIds:gold.expectedSourceIds, elapsedMs:60000, reason:'공개 집계를 비교하는 합성 기록',
        journalUsed:trial.method === 'journal', kitVersion:edition
      });
    }
    records.push(record);
  }
  return {session:null, invitations, records};
}

async function exportedSummary(t, narrowedCase) {
  const dom = new JSDOM(fs.readFileSync(path.join(reader, 'editor-study.html'), 'utf8'), {
    url:'https://study.invalid/editor-study.html', runScripts:'outside-only'
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.localStorage.setItem('journal-editor-study-workspace-v1', JSON.stringify(syntheticWorkspace(narrowedCase)));
  let blob;
  w.URL.createObjectURL = file => { blob = file; return 'blob:export'; };
  w.URL.revokeObjectURL = () => {};
  w.document.addEventListener('click', e => { if (e.target.closest('a[download]')) e.preventDefault(); });
  for (const script of w.document.querySelectorAll('script[src]')) {
    w.eval(fs.readFileSync(path.join(reader, script.getAttribute('src')), 'utf8'));
  }
  w.document.getElementById('export-summary').click();
  return JSON.parse(await blob.text());
}

function scopes(summary) {
  return [summary.overall, ...summary.observedEditions, ...summary.assignedMatchedEditions];
}

test('기사별 격차와 오승인이 겹치는 경우만 다를 때 기존 공유 지표는 전체와 두 판본 집계에서 모두 같다', async t => {
  const repair = await exportedSummary(t, 'repair'), permits = await exportedSummary(t, 'permits');
  for (const summary of [repair, permits]) {
    assert.equal(summary.overall.includedTasks, 32);
    assert.deepEqual(summary.assignedEditionCoverage, {rosterBlocks:2, matchedBlocks:2});
    assert.deepEqual(summary.observedEditions.map(e => e.kitVersion), [edition]);
    assert.deepEqual(summary.assignedMatchedEditions.map(e => e.kitVersion), [edition]);
    for (const scope of scopes(summary)) {
      const {manualPp, journalPp} = scope.partyLabelAcceptanceGap;
      assert.deepEqual([manualPp, journalPp], [50, 25]);
      const {manual, journal} = scope.unsupportedAcceptance;
      assert.deepEqual([manual.accepted, manual.eligible, journal.accepted, journal.eligible], [4, 8, 4, 8]);
      assert.deepEqual([scope.verdictAndEvidence.manual.verified, scope.verdictAndEvidence.journal.verified], [10, 12]);
      delete scope.partyLabelGapAndQuality;
    }
  }
  assert.deepEqual(repair, permits);
});

test('같은 평균 격차 감소가 한 경우에는 반박된 예산 주장 오승인 증가와 겹치고 다른 경우에는 겹치지 않는다', async t => {
  for (const [caseId, increased] of [['repair', 1], ['permits', 0]]) {
    const summary = await exportedSummary(t, caseId);
    for (const scope of scopes(summary)) {
      assert.deepEqual(scope.partyLabelGapAndQuality, {
        cases:4, narrowed:2, narrowedUnsafeEligible:1, narrowedWithMoreUnsafe:increased,
        narrowedWithFewerVerified:increased, narrowedWithMoreUnsafeBothLabels:0
      });
    }
  }
});

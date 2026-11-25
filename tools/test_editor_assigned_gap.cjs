const test = require('node:test');
const assert = require('node:assert/strict');
const study = require('../docs/reader/editor-study-core.js');

test('예정 판본에서 확인한 답만 고정한 격차 범위는 누락 세 답의 모든 조합과 일치한다', () => {
  const a = 'a'.repeat(64), b = 'b'.repeat(64), roster = [], records = [];
  for (let ordinal = 1; ordinal <= 16; ordinal++) {
    const id = 'E' + String(ordinal).padStart(16, '0'), block = Math.ceil(ordinal / 4);
    const kit = block === 1 || block === 3 ? a : b;
    roster.push({ordinal, id, code:block === 4 ? 'J1-' + ordinal + '-' + id : 'J2-' + ordinal + '-' + id + '-' + kit});
    let record = study.createRecord(id, ordinal, 'editor', true);
    for (const t of study.plan(ordinal)) {
      record = study.addTrial(record, {elapsedMs:1000, kitVersion:kit, journalUsed:t.method === 'journal',
        verdict:t.variant === 'A' && t.method === 'manual' ? 'supported' : 'contradicted',
        sourceIds:[], reason:'배정 판본의 격차 범위 검증'});
    }
    records.push(record);
  }
  const sample = structuredClone(records);
  sample[0].trials[0].kitVersion = b;
  delete sample[10].trials[1].kitVersion;
  sample[11].trials.pop();
  const result = study.analyzeAssignedEditions(sample, roster);
  const planned = result.plannedBounds.find(r => r.kitVersion === a);
  assert.deepEqual(planned.blockNumbers, [1, 3]);
  assert.equal(planned.assigned, 32);
  assert.equal(planned.matched, 29);
  assert.deepEqual(result.plannedBounds.find(r => r.kitVersion === b).blockNumbers, [2]);
  const possible = [];
  for (let mask = 0; mask < 8; mask++) {
    const fixed = structuredClone(records);
    for (const [i, [person, trial]] of [[0,0], [10,1], [11,3]].entries()) {
      fixed[person].trials[trial].verdict = mask & (1 << i) ? 'supported' : 'opinion';
    }
    const originalBlocks = fixed.filter(r => r.ordinal <= 4 || (r.ordinal >= 9 && r.ordinal <= 12));
    possible.push(study.analyze(originalBlocks).bias.reductionPp);
  }
  assert.deepEqual([planned.minReductionPp, planned.maxReductionPp], [Math.min(...possible), Math.max(...possible)]);
  assert.ok(planned.minReductionPp < planned.maxReductionPp);
  const noReturns = study.analyzeAssignedEditions([], roster.slice(0, 4)).plannedBounds[0];
  assert.deepEqual([noReturns.matched, noReturns.assigned, noReturns.minReductionPp, noReturns.maxReductionPp], [0, 16, -100, 100]);
  assert.deepEqual(study.analyzeAssignedEditions(sample, roster.slice(0, 3)).plannedBounds, []);
});

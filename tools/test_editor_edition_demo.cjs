const {test} = require('node:test');
const assert = require('node:assert/strict');
const study = require('../docs/reader/editor-study-core.js');

test('판본 예시는 가상 참여자 8명이고 처음 네 명은 검토 시간 절반·검증 성공당 시간 두 배다', () => {
  const records = study.editionDemoRecords();
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  assert.deepEqual(records.map(r=>r.ordinal),[1,2,3,4,5,6,7,8]);
  assert.equal(new Set(records.map(r=>r.participantId)).size,8);
  records.forEach((record,i)=>{
    assert.equal(record.kind,'demo');
    assert.equal(record.editorAttested,false);
    assert.equal(record.trials.length,4);
    assert.ok(record.trials.every(t=>t.kitVersion === (i<6 ? a : b)));
  });
  assert.equal(study.analyze(records).trialCount,0);
  assert.deepEqual(study.analyzeEditions(records).editions,[]);
  const byEdition = study.analyzeEditions(records,'demo');
  assert.deepEqual(byEdition.blocks,[{block:1,state:'verified',kitVersion:a},{block:2,state:'mixed',kitVersion:null}]);
  assert.equal(byEdition.editions.length,1);
  const [{blockNumbers,analysis}] = byEdition.editions;
  assert.deepEqual(blockNumbers,[1]);
  assert.deepEqual([analysis.included,analysis.trialCount,analysis.time.manualSeconds,analysis.time.journalSeconds],[4,16,60,30]);
  const {manual,journal} = analysis.quality;
  assert.deepEqual([manual.qualityCorrect,manual.total,journal.qualityCorrect,journal.total],[8,8,2,8]);
  const costs = analysis.timedQuality;
  assert.equal(costs.manual.secondsPerVerified,60);
  assert.equal(costs.journal.secondsPerVerified,120);
  assert.deepEqual([analysis.bias.manualGapPp,analysis.bias.journalGapPp,analysis.bias.reductionPp,analysis.bias.reductionPct],[0,100,-100,null]);
  const pooled = study.analyze(records,'demo');
  assert.deepEqual([pooled.trialCount,pooled.quality.journal.qualityCorrect,pooled.quality.journal.total,pooled.timedQuality.journal.secondsPerVerified],[32,10,16,48]);
});

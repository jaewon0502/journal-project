'use strict';
// One fictional Korean paragraph per edition; the two return files per editor are exercises.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os'), path = require('node:path');
const reader = name => require('../../docs/reader/' + name + '.js');
const workspace = reader('workspace-snapshot'), engine = reader('factcheck-engine');
const rubric = reader('article-rubric'), blind = reader('blind-revision');
const agreement = reader('revision-agreement'), series = reader('revision-series'), retention = reader('retention-case');
const {build, exportFiles} = require('./third-reader.cjs');

const before = '새봄당이 예산 심사를 고의로 막았다고 시의회에서 확인했다.';
const after = '다솔당은 새봄당이 예산 심사를 막았다고 주장했고 두 정당은 심사를 연기하기로 합의했다.';
const source = {id:'s', title:'가상 회의록과 정당 발언', url:'https://example.invalid/council',
  version:'연습 1판', locator:'발언·의결', excerpt:'다솔당이 새봄당의 방해를 주장했다. 두 정당은 심사를 연기하기로 합의했다.'};
const manuscript = article => ({format:workspace.schema, demo:true, article, articleDraft:article, sources:[source],
  receipts:[], rowDrafts:[], sourceDraft:{id:null, fields:Object.fromEntries(workspace.sourceFields.map(k => [k,'']))}});
const text = {
  wording: ['정당이 제기한 주장을 의회의 확인으로 표현했다.', '누가 주장했는지 밝히고 합의 내용도 적었다.'],
  omission: ['두 정당이 연기에 합의한 일이 기록에서 빠졌다.', '두 정당이 합의한 내용을 포함했다.'],
};
async function makeDemo() {
  const files = [];
  for (let editor = 0; editor < 2; editor++) {
    const {key, packets} = await blind.prepare(manuscript(before), manuscript(after));
    for (const [index, role] of ['before','after'].entries()) {
      const slot = key.mapping[role].slot, packet = packets[slot], report = engine.report(packet.article, packet.sources);
      const rating = (id, level) => ({level, rowId:report.rows[0].id, quote:report.rows[0].text,
        sourceId:packet.sources[0].id, sourceQuote:packet.sources[0].excerpt,
        reason:text[id][index], impact:level ? '독자가 의혹과 확인된 사실을 다르게 받아들일 수 있다.' : ''});
      packet.articleAssessment = rubric.save(report, packet.sources, {coreRowIds:[], ratings:{
        wording:rating('wording', role === 'before' ? [1,2][editor] : [0,1][editor]),
        omission:rating('omission', role === 'before' ? 2 : 0),
      }});
      files.push({name:'practice-' + editor + '-' + slot + '.json', data:packet});
    }
    files.push({name:'practice-key-' + editor + '.json',data:key});
  }
  const pair = await blind.resolveBundle(files);
  return retention.create(series.makeRecord(agreement.compare(...pair), pair[0].key), files, []);
}

async function run() {
  const [arg, ...extra] = process.argv.slice(2);
  if (!arg || extra.length) throw Error('Usage: node third-reader-demo.cjs --check | <private-output-parent>');
  const archive = await makeDemo();
  if (arg !== '--check') { console.log(await exportFiles(archive, arg)); return; }
  const result = await build(archive);
  assert.deepEqual(result.coordinator.counts, {sameBand:3,splitBand:1,missing:4,notApplicable:0});
  assert.equal(result.coordinator.twoReaderImprovement.numerator,1);
  assert.equal(result.coordinator.twoReaderImprovement.denominator,1);
  const slots = Object.keys(result.packets);
  assert.equal(slots.length,1);
  const packet = result.packets[slots[0]];
  assert.equal(packet.demo,true); assert.equal(packet.article,before);
  assert.doesNotMatch(result.instructions, /수정본|원안|원본|편집자 [12]|[0-3]점/);
  assert.deepEqual(workspace.read(packet).sources.map(s => s.excerpt), [source.excerpt]);
  assert.equal(packet.articleAssessment,null); assert.equal(packet.articleAssessmentDraft,null);
  assert.deepEqual(packet.receipts,[]); assert.deepEqual(packet.rowDrafts,[]);
  assert.doesNotMatch(JSON.stringify(packet), /practice-key|독자가 의혹|기록에서 빠졌다/);
  const damaged = structuredClone(archive); damaged.items[0].data.articleDraft += '변경';
  await assert.rejects(build(damaged));
  const existing = JSON.parse(await fs.readFile(path.join(__dirname, '../bias-score-review/coordinator-case.json'), 'utf8'));
  const none = await build(existing);
  assert.deepEqual(none.packets,{}); assert.equal(none.instructions,null);
  assert.equal(none.coordinator.twoReaderImprovement.numerator,1);
  const parent = await fs.mkdtemp(path.join(os.tmpdir(),'journal-third-test-'));
  try {
    const project = path.resolve(__dirname,'../..'), link = path.join(parent,'project-link');
    await fs.symlink(project, link, 'dir');
    for (const bad of [project, __dirname, project + '/experiments/../docs', link, path.join(link,'experiments')]) {
      await assert.rejects(exportFiles(archive,bad), /저장소 밖/);
    }
    const folder = await exportFiles(archive,parent);
    const names = await fs.readdir(path.join(folder,'제3자용'));
    assert.equal(names.length,2); assert(names.includes('체크리스트.txt'));
    const noTasks = await exportFiles(existing,parent);
    assert.deepEqual(await fs.readdir(noTasks),['진행자만.json']);
  } finally { await fs.rm(parent,{force:true,recursive:true}); }
  console.log('Synthetic exercise verified: one blinded extra check, official two-reader improvement 1/1, and no files for band consensus.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});

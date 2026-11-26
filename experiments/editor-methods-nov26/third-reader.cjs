'use strict';
// Generate a focused third reading without changing the original two-reader result.
const fs = require('node:fs/promises');
const path = require('node:path');
const reader = moduleName => require('../../docs/reader/' + moduleName + '.js');
const blind = reader('blind-revision'), agreement = reader('revision-agreement');
const series = reader('revision-series'), retention = reader('retention-case');
const rubric = reader('article-rubric');

function classify(first, second) {
  if (first === null || second === null) return 'missing';
  if (first === 'na' || second === 'na') return 'notApplicable';
  return (first >= 2) === (second >= 2) ? 'sameBand' : 'splitBand';
}

async function build(archive) {
  const {items} = retention.read(archive);
  const pair = await blind.resolveBundle(items), joint = agreement.compare(...pair);
  const record = series.makeRecord(joint, pair[0].key);
  retention.verifyAll(archive, record);
  const counts = {sameBand:0, splitBand:0, missing:0, notApplicable:0};
  const tasks = [];
  for (const dimension of record.dimensions) {
    for (const role of ['before','after']) {
      const category = classify(dimension.first[role], dimension.second[role]);
      counts[category]++;
      if (category === 'splitBand') tasks.push({role, dimension:dimension.id});
    }
  }
  const coordinator = {demo:record.demo, twoReaderReview:series.reviewId(record),
    twoReaderImprovement:joint.improved, twoReaderWorsening:joint.worsened, counts};
  if (!tasks.length) return {coordinator, packets:{}, instructions:null};
  const {key, packets} = await blind.prepare(pair[0].before, pair[0].after);
  const needed = {};
  const lines = [record.demo ? '연습용 독립 재검' : '독립 재검',
    '독립 기사 검토 도구의 factcheck.html에서 아래 파일을 여세요. 지정된 항목에 본인의 단계와 기사·원자료 근거를 입력하고 작업 파일을 저장하세요.'];
  for (const slot of ['A','B']) {
    const names = tasks.filter(task => key.mapping[task.role].slot === slot)
      .map(task => rubric.dimensions.find(d => d.id === task.dimension).title);
    if (!names.length) continue;
    needed[slot] = packets[slot];
    lines.push(slot + '.json — ' + names.join(', '));
  }
  return {coordinator:{...coordinator, key}, packets:needed, instructions:lines.join('\n') + '\n'};
}

async function exportFiles(archive, parent) {
  const project = await fs.realpath(path.join(__dirname, '../..'));
  const destination = await fs.realpath(parent);
  const relative = path.relative(project, destination);
  if (relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
    throw Error('공개 저장소 밖의 비공개 폴더를 선택하세요.');
  }
  const {coordinator, packets, instructions} = await build(archive);
  const out = await fs.mkdtemp(path.join(destination, 'journal-third-'));
  try {
    await fs.writeFile(path.join(out, '진행자만.json'), JSON.stringify(coordinator, null, 2) + '\n', {mode:0o600});
    if (instructions) {
      const dest = path.join(out, '제3자용');
      await fs.mkdir(dest, {mode:0o700});
      for (const [slot, data] of Object.entries(packets)) {
        await fs.writeFile(path.join(dest, slot + '.json'), JSON.stringify(data, null, 2) + '\n', {mode:0o600});
      }
      await fs.writeFile(path.join(dest, '체크리스트.txt'), instructions, {mode:0o600});
    }
    return out;
  } catch (error) {
    await fs.rm(out, {recursive:true, force:true});
    throw error;
  }
}

if (require.main === module) {
  const [source, outputParent, ...extra] = process.argv.slice(2);
  if (!source || !outputParent || extra.length) {
    console.error('Usage: node third-reader.cjs <coordinator-case.json> <existing-private-directory>');
    process.exitCode = 1;
  } else {
    fs.readFile(source, 'utf8').then(text => exportFiles(JSON.parse(text), outputParent))
      .then(out => console.log(out)).catch(error => {console.error(error.message); process.exitCode = 1;});
  }
}
module.exports = {classify, build, exportFiles};

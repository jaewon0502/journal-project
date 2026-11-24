const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const core = require('../docs/reader/field-review-core.js');
const key = require('../experiments/cross-party-review/coordinator-key.json');
const task = key.tasks[0];
const roster = assignments => ({format:core.assignmentFormat, assignments});

function assignment(participant, method, targetSeconds) {
  return {participant, method, taskId:task.id, prompt:task.prompt, articleUrl:key.articleUrl,
    caseId:key.caseId, ...(targetSeconds === undefined ? {} : {targetSeconds})};
}
function submission(row, search, extra = {}) {
  const {participant, method, taskId, prompt, articleUrl, caseId} = row;
  return {format:core.format, participant, method, taskId, prompt, articleUrl, caseId, id:participant,
    kind:'editor', status:'completed', recovered:false, split:false, phaseMs:{search, locate:0, decide:0},
    found:'found', locator:'제출한 표 ' + participant, documentUrl:'https://example.org/report',
    verdict:task.verdict, reason:'원표의 해당 행을 확인했다.', ...extra};
}
function summary(t, previous) {
  const reader = file => fs.readFileSync(path.join(__dirname, '../docs/reader', file), 'utf8');
  const {window} = new JSDOM(reader('field-summary.html'), {
    runScripts:'outside-only', url:'https://example.org/field-summary.html'
  });
  t.after(() => window.close());
  if (previous) {
    for (const name of Object.keys(previous)) window.sessionStorage.setItem(name, previous.getItem(name));
  }
  window.eval(reader('field-review-core.js'));
  window.eval(reader('field-summary.js'));
  const el = id => window.document.getElementById(id);
  return {
    el, storage:window.sessionStorage,
    async upload(id, ...values) {
      const input = el(id);
      const files = values.map((v, i) => new window.File([JSON.stringify(v)], 'file-' + i + '.json'));
      Object.defineProperty(input, 'files', {value:files, configurable:true});
      await input.onchange({target:input});
    },
    toggle() { el('toggle-results').click(); },
    grade(participant) {
      const line = [...el('entries').querySelectorAll('p')].find(p => p.textContent === '제출한 위치 · 제출한 표 ' + participant);
      const select = line.closest('article').querySelector('select');
      assert.equal(select.disabled, false);
      select.value = 'yes';
      select.dispatchEvent(new window.Event('change', {bubbles:true}));
    },
    async download(id) {
      let blob;
      window.URL.createObjectURL = value => { blob = value; return 'blob:test'; };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = () => {};
      el(id).click();
      return JSON.parse(await blob.text());
    }
  };
}

test('목표별 원배정 분모와 시간 내 성공 범위를 보여 주고 재채점·연습 중에는 가린다', async t => {
  const p = summary(t);
  const rows = [
    assignment('M-ON', 'manual', 10), assignment('M-PENDING', 'manual', 10), assignment('M-ABSENT', 'manual', 10),
    assignment('J-LATE', 'journal', 10), assignment('J-STOP', 'journal', 10),
    assignment('J-ERROR', 'journal', 10), assignment('J-RESTORED', 'journal', 10),
    assignment('J-OTHER', 'journal', 20), assignment('M-LEGACY', 'manual')
  ];
  await p.upload('roster-file', roster(rows));
  await p.upload('key-file', key);
  await p.upload('imports',
    submission(rows[0], 10000, {method:'journal'}), submission(rows[1], 0),
    submission(rows[3], 10001), submission(rows[4], 2000, {status:'withdrawn'}),
    submission(rows[5], 8000, {found:'missing'}), submission(rows[6], 7000, {recovered:true}),
    submission(rows[7], 15000), submission(rows[8], 1000),
    submission(assignment('PRACTICE', 'journal'), 1000, {kind:'practice'}));
  for (const index of [0, 6, 7, 8]) p.grade(rows[index].participant);
  const area = p.el('allocation-deadlines');
  assert.equal(area.textContent, '');
  p.toggle();
  assert.match(p.el('deadline-coverage').textContent, /전체 배정 9건.*미리 정한 배정 8건.*미지정 1건/);
  const cards = [...area.querySelectorAll('article')];
  assert.equal(cards.length, 2);
  const at = seconds => cards.find(c => c.querySelector('h4').textContent.endsWith('목표 ' + seconds + '초')).textContent;
  assert.match(at(10), /평소 검증 도구 · 시간 내 검증 성공률 33\.3% ~ 100\.0% \(배정 3건\)/);
  assert.match(at(10), /시간 내 성공 0건 · 위치 또는 판정 불일치 1건 · 시간 초과 1건 · 중도 종료 1건 · 결과 미확인 1건/);
  assert.match(at(10), /0\.0% ~ 25\.0% \(배정 4건\)/);
  assert.match(at(10), /-100\.0%p ~ -8\.3%p.*저널을 배정받은 집단에서 더 낮습니다/);
  assert.match(at(20), /평소 검증 도구 · 이 목표로 배정한 과제 0건/);
  assert.match(at(20), /100\.0% \(배정 1건\)/);
  for (const row of rows) assert.ok(!area.textContent.includes(row.participant));
  p.toggle();
  assert.equal(area.textContent, '');
  assert.equal(p.el('deadline-coverage').textContent, '');
  p.el('kind').value = 'practice';
  p.el('kind').onchange();
  p.toggle();
  assert.equal(p.el('allocation-results').hidden, true);
  assert.equal(area.textContent, '');
});

test('명부의 목표 시간을 새로고침과 별도 내보내기에서 보존하고, 목표 없는 옛 명부에서는 비율을 보류한다', async t => {
  const rows = [assignment('CODE-A', 'manual', 60), assignment('CODE-B', 'journal', 60)];
  const p = summary(t);
  await p.upload('roster-file', roster(rows));
  await p.upload('key-file', key);
  await p.upload('imports', submission(rows[0], 5000));
  p.toggle();
  assert.match(p.el('allocation-deadlines').textContent, /-100\.0%p ~ \+100\.0%p.*어느 쪽/);
  const savedRoster = await p.download('save-roster');
  const savedGrades = await p.download('save');
  assert.deepEqual(savedRoster, roster(rows));
  assert.doesNotMatch(JSON.stringify(savedGrades), /targetSeconds|assignments/);
  const restored = summary(t, p.storage);
  const reopened = summary(t);
  await reopened.upload('imports', savedGrades);
  await reopened.upload('roster-file', savedRoster);
  for (const page of [restored, reopened]) {
    assert.equal(page.el('allocation-deadlines').textContent, '');
    page.grade('CODE-A');
    page.toggle();
    assert.match(page.el('allocation-deadlines').textContent, /목표 60초.*-100\.0%p ~ 0\.0%p.*같을 수도/);
  }
  const old = summary(t);
  await old.upload('roster-file', roster([assignment('CODE-A', 'manual')]));
  await old.upload('imports', savedGrades);
  old.toggle();
  assert.match(old.el('deadline-coverage').textContent, /미리 정한 배정 0건.*미지정 1건/);
  assert.doesNotMatch(old.el('allocation-deadlines').textContent, /%/);
  assert.match(old.el('allocation-deadlines').textContent, /목표 시간이 없어/);
});

for (const manualCount of [45, 46]) {
  const journalCount = 91 - manualCount;
  test('배정 집단의 성공률 차이 방향을 보존한다 (평소 도구 1/' + manualCount + ', 저널 1/' + journalCount + ')', async t => {
    const p = summary(t);
    const rows = [], trials = [];
    for (const [method, count] of [['manual', manualCount], ['journal', journalCount]]) {
      for (let i = 0; i < count; i++) {
        const row = assignment(method + i, method, 60);
        rows.push(row);
        trials.push(submission(row, 1000, {status:i === 0 ? 'completed' : 'withdrawn'}));
      }
    }
    await p.upload('roster-file', roster(rows));
    await p.upload('key-file', key);
    await p.upload('imports', ...trials);
    p.grade('manual0');
    p.grade('journal0');
    p.toggle();
    const expected = manualCount > journalCount ? '+0.048%p' : '-0.048%p';
    for (const id of ['allocation-yield', 'allocation-deadlines'])
      assert.ok(p.el(id).querySelector('strong').textContent.endsWith(expected));
  });
}

test('미확인 배정의 성공률 범위가 0%와 100%에 가까워도 두 끝을 구별한다', async t => {
  const rows = Array.from({length:2100}, (_, i) => assignment('edge' + i, 'journal', 60));
  const p = summary(t);
  await p.upload('roster-file', roster(rows));
  await p.upload('key-file', key);
  await p.upload('imports', submission(rows[0], 1000), submission(rows[1], 1000, {found:'missing'}));
  p.grade(rows[0].participant);
  p.toggle();
  for (const id of ['allocation-yield', 'allocation-deadlines'])
    assert.match(p.el(id).textContent, /0\.048% ~ 99\.952% \(배정 2100건\)/);
});

test('복원 후 확인된 시간만으로도 목표를 넘기면 실패이고, 완료 평균의 하한과 중도 종료 합계는 따로 보인다', async t => {
  const p = summary(t);
  const rows = ['M','J','중단','원본중단'].map((name, i) => assignment(name, [0,3].includes(i) ? 'manual' : 'journal', 120));
  const version = {kitVersion:'9'.repeat(64)};
  await p.upload('roster-file', roster(rows));
  await p.upload('key-file', key);
  await p.upload('imports', submission(rows[0], 120000, version), submission(rows[1], 180000, {...version, recovered:true}),
    submission(rows[2], 6500, {...version, status:'withdrawn', recovered:true}), submission(rows[3], 7000, {...version, status:'withdrawn'}));
  p.grade('M');
  p.grade('J');
  p.toggle();
  const panel = p.el('allocation-comparisons').querySelector('.partial-times');
  assert.match(panel.textContent, /제출한 1건 전체의 평균 120.0초.*중도 종료 1건의 활동 시간 합계 7초/);
  assert.match(panel.textContent, /제출한 1건 전체의 평균 최소 180초.*중도 종료 1건의 활동 시간 합계 최소 6.5초/);
  assert.match(panel.textContent, /저널 방식이 평균 60초 이상 더 걸렸습니다/);
  assert.match(p.el('allocation-deadlines').textContent, /시간 초과 1건 · 중도 종료 1건 · 결과 미확인 0건/);
  assert.match(p.el('allocation-comparisons').textContent, /검증 성공 1건당 투입 시간.*저널 · 비교할 시간 기록 0건/s);
  p.toggle();
  assert.equal(p.el('allocation-comparisons').textContent, '');
});

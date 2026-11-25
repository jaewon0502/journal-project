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
  window.eval(reader('field-time-report.js'));
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
    grade(participant, label = '근거 위치', value = 'yes') {
      const line = [...el('entries').querySelectorAll('p')].find(p => p.textContent === '제출한 위치 · 제출한 표 ' + participant);
      const control = [...line.closest('article').querySelectorAll('label')].find(n => n.textContent.startsWith(label + ' '));
      const select = control.querySelector('select');
      assert.equal(select.disabled, false);
      select.value = value;
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

test('같은 배정과 120초를 기준으로 위치·판정과 판단 이유의 성공률 방향을 각각 표시한다', async t => {
  const p = summary(t);
  const rows = ['M-100','M-121','J-60A','J-60B'].map((id,i) => assignment(id, i < 2 ? 'manual' : 'journal', 120));
  await p.upload('key-file', key);
  await p.upload('roster-file', roster(rows));
  await p.upload('imports', ...rows.map((row,i) => submission(row, [100000,121000,60000,60000][i])));
  for (const row of rows) p.grade(row.participant);
  for (const row of rows.slice(0,2)) p.grade(row.participant, '판단 이유');
  p.grade('J-60A', '판단 이유', 'no');
  const area = p.el('allocation-deadlines');
  assert.equal(area.textContent, '');
  p.toggle();
  const difference = selector => area.querySelector(selector + ' strong').textContent;
  assert.match(difference('.deadline-basic'), /\+50\.0%p$/);
  assert.match(difference('.deadline-with-reason'), /-50\.0%p ~ 0\.0%p$/);
  p.toggle();
  p.grade('J-60B', '판단 이유', 'no');
  p.toggle();
  assert.match(difference('.deadline-basic'), /\+50\.0%p$/);
  assert.match(difference('.deadline-with-reason'), /-50\.0%p$/);
  const result = area.querySelector('.deadline-with-reason');
  assert.match(result.textContent, /저널 · 시간 내 검증 성공률 0\.0% \(배정 2건\).*판단 이유 불일치 2건/);
  const stored = await p.download('save');
  const reopened = summary(t);
  await reopened.upload('roster-file', roster(rows));
  await reopened.upload('imports', stored);
  reopened.toggle();
  assert.equal(reopened.el('allocation-deadlines').textContent, area.textContent);
  p.toggle();
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

test('진행자 화면에서 온전한 기록의 절감과 회수 전체의 최소 비용 증가를 구분하고 재채점하면 범위를 갱신한다', async t => {
  const p = summary(t);
  const rows = ['M-OK','M-WRONG','M-STOP','J-OK','J-WRONG','J-STOP']
    .map((name, i) => assignment(name, i < 3 ? 'manual' : 'journal', 120));
  const version = {kitVersion:'c'.repeat(64)};
  await p.upload('roster-file', roster(rows));
  await p.upload('key-file', key);
  await p.upload('imports', submission(rows[0],30000,version), submission(rows[1],10000,{...version,found:'missing'}),
    submission(rows[2],20000,{...version,status:'withdrawn'}), submission(rows[3],10000,version),
    submission(rows[4],100000,{...version,found:'missing',recovered:true}),
    submission(rows[5],150000,{...version,status:'withdrawn',recovered:true}));
  p.grade('M-OK');
  p.toggle();
  for (const id of ['allocation-comparisons','comparisons']) {
    const panel = p.el(id).querySelector('.returned-cost').textContent;
    assert.match(panel, /성공이 1건 이상이면 성공 1건당 260초 이상.*모두 실패하면/);
    assert.match(panel, /더 짧은지 확정할 수 없습니다/);
  }
  p.toggle();
  assert.equal(p.el('comparisons').textContent, '');
  p.grade('J-OK');
  p.toggle();
  for (const id of ['allocation-comparisons','comparisons']) {
    const view = p.el(id);
    assert.match(view.textContent, /시간이 온전히 남은 기록에서 검증 성공 1건당 50.0초 절감/);
    assert.match(view.querySelector('.returned-cost').textContent, /회수한 기록 전체에서 저널은 검증 성공 1건당 200초 이상 더 걸렸습니다/);
  }
  const zero = summary(t);
  await zero.upload('imports', submission(rows[1],10000,{...version,found:'missing'}));
  zero.toggle();
  assert.match(zero.el('comparisons').querySelector('.returned-cost').textContent,
    /총 활동 시간 10초.*검증 성공이 0건이어서 성공 1건당 시간을 계산할 수 없습니다/);
});

test('성공당 시간이 1밀리초보다 작을 때 0초로 반올림하지 않는다', async t => {
  const p = summary(t);
  const rows = ['fast1','fast2','fast3'].map(name => assignment(name, 'journal', 1));
  await p.upload('key-file', key);
  await p.upload('imports', ...rows.map((row, i) => submission(row, i === 0 ? 1 : 0, {kitVersion:'d'.repeat(64)})));
  for (const row of rows) p.grade(row.participant);
  p.toggle();
  assert.match(p.el('comparisons').querySelector('.returned-cost').textContent, /성공 1건당 1밀리초 미만/);
});

test('판단 이유를 실제 대조한 뒤 세 항목이 모두 맞은 답안 1건당 비용과 대기를 표시한다', async t => {
  const p = summary(t);
  const rows = ['M1','M2','J1','J2'].map((id,i) => assignment(id, i < 2 ? 'manual' : 'journal', 120));
  await p.upload('roster-file', roster(rows));
  await p.upload('key-file', key);
  await p.upload('imports', ...rows.map((r,i) => submission(r, i < 2 ? 60000 : 40000, {kitVersion:'e'.repeat(64)})));
  for (const row of rows) p.grade(row.participant);
  p.toggle();
  assert.equal(p.el('comparisons').querySelector('.returned-reason-cost'), null);
  p.toggle();
  for (const id of ['M1','M2','J1']) p.grade(id, '판단 이유');
  p.toggle();
  let panel = p.el('comparisons').querySelector('.returned-reason-cost');
  assert.match(panel.textContent, /확인된 성공 1건, 성공 여부 확인 대기 1건.*성공 1건당 40초 ~ 80초/);
  assert.match(panel.textContent, /확정할 수 없습니다/);
  p.toggle();
  p.grade('J2', '판단 이유', 'no');
  p.toggle();
  for (const area of ['comparisons', 'allocation-comparisons']) {
    assert.match(p.el(area).querySelector('.returned-cost').textContent, /성공 1건당 20초 빨랐습니다/);
    panel = p.el(area).querySelector('.returned-reason-cost');
    assert.match(panel.textContent, /세 항목이 모두 맞은 1건당 20초 더 걸렸습니다/);
  }
  p.toggle();
  p.grade('J1', '판단 이유', 'no');
  p.toggle();
  assert.match(p.el('comparisons').querySelector('.returned-reason-cost').textContent,
    /확인된 성공 0건, 성공 여부 확인 대기 0건.*검증 성공이 0건/);
});

test('진행자만 예정 판본의 목표 내 검증 차이를 확인하고 기존 전체 배정·명부·채점 파일을 구별한다', async t => {
  const a='a'.repeat(64), b='b'.repeat(64);
  const m={...assignment('M','manual',120),assignedKitVersion:a};
  const j={...assignment('J','journal',120),assignedKitVersion:a};
  const legacy=assignment('L','journal',120);
  const p=summary(t);
  await p.upload('key-file',key);
  await p.upload('roster-file',roster([m,j,legacy]));
  // M and J are the only participants with an edition assigned in advance.
  await p.upload('imports',submission(m,60000,{kitVersion:a,found:'missing'}),
    submission(j,45000,{kitVersion:b}),submission(legacy,25000,{kitVersion:b}));
  p.grade('J'); p.grade('J','판단 이유'); p.grade('L'); p.grade('L','판단 이유');
  assert.equal(p.el('edition-deadlines').textContent,'');
  assert.doesNotMatch(p.el('entries').textContent,/[ab]{64}|시간 내 검증 성공률|예정 배포본 ID/);
  assert.equal(p.el('results').hidden,true);
  p.toggle();
  const area=p.el('edition-deadlines');
  assert.match(area.textContent,/목표가 있는 배정 3건 중 예정 판본 확인 2건 · 명부에 예정 판본이 없는 배정 1건/);
  assert.match(area.textContent,/예정 배포본 ID · a{64}/);
  assert.match(area.textContent,/같은 판본에서 다른 방식으로 참여했어도 원래 배정한 방식에 집계/);
  assert.match(area.textContent,/시간 내 검증 성공률 0.0% ~ 100.0% \(배정 1건\)/);
  assert.match(area.textContent,/예정 판본 일치 0건 · 다른 판본 1건/);
  assert.match(area.querySelector('strong').textContent,/0\.0%p ~ \+100\.0%p/);
  assert.match(p.el('allocation-deadlines').querySelector('.deadline-with-reason strong').textContent,/\+100\.0%p$/);
  const saved=await p.download('save-roster');
  assert.deepEqual(saved,roster([m,j,legacy]));
  const grades=await p.download('save');
  assert.doesNotMatch(JSON.stringify(grades),/assignedKitVersion|targetSeconds/);
  assert.equal(grades.entries.find(e=>e.trial.participant==='J').trial.kitVersion,b);
  const visible=area.textContent;
  p.toggle();
  assert.equal(area.textContent,'');
  const q=summary(t);
  await q.upload('roster-file',saved); await q.upload('imports',grades); q.toggle();
  assert.equal(q.el('edition-deadlines').textContent,visible);
  const old=summary(t);
  await old.upload('roster-file',roster([legacy])); old.toggle();
  assert.match(old.el('edition-deadlines').textContent,/예정 판본을 기록한 배정이 없어/);
  assert.equal(old.el('edition-deadlines').querySelector('article'),null);
});

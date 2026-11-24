const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const c = require('../docs/reader/field-review-core.js');
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../experiments/cross-party-review/blind-tasks.json'))
);
function trial(changes = {}) {
  return {
    format: c.format,
    id: 'one',
    participant: 'E01',
    caseId: fixture.caseId,
    taskId: fixture.tasks[0].id,
    prompt: fixture.tasks[0].prompt,
    articleUrl: fixture.articleUrl,
    kind: 'practice',
    method: 'manual',
    status: 'completed',
    phaseMs: { search: 400, locate: 600, decide: 200 },
    recovered: false,
    split: true,
    found: 'found',
    documentUrl: 'https://source.example/table',
    locator: '표 1, 2025년 행',
    verdict: 'supported',
    reason: '의결된 판본을 확인했다.',
    ...changes
  };
}
test('실제 과제 파일의 두 문장을 열고 과제에 정답이 들어간 파일을 거절한다', () => {
  assert.equal(c.readCase(fixture).tasks.length, 2);
  const bad = structuredClone(fixture);
  bad.tasks[0].reference = { page: 99 };
  assert.throws(() => c.readCase(bad));
  bad.articleUrl = 'javascript:alert(1)';
  assert.throws(() => c.readCase(bad));
});
test('원자료를 다시 찾는 시간과 명시한 휴식을 구분한다', () => {
  let t = c.timer(3);
  t = c.tick(t, 13, 'locate', true);
  t = c.tick(t, 29, 'search', true);
  t = c.tick(t, 36, 'search', false);
  t = c.tick(t, 70, 'search', true);
  t = c.tick(t, 72, 'decide', true);
  t = c.tick(t, 82, 'decide', false);
  assert.deepEqual(t.ms, { search: 19, locate: 16, decide: 10 });
  assert.throws(() => c.tick(c.timer(7), 6, 'search', true));
});
test('복원·미분할·미완료 과제와 미채점·근거 미발견, 연습을 다른 분모로 계산한다', () => {
  const samples = [
    { trial: trial(), locationGrade: 'yes', verdictGrade: 'yes' },
    { trial: trial({ id: 'b', found: 'missing', split: false }), locationGrade: '', verdictGrade: 'no' },
    { trial: trial({ id: 'c', recovered: true }), locationGrade: '', verdictGrade: '' },
    { trial: trial({ id: 'd', status: 'withdrawn' }), locationGrade: '', verdictGrade: '' },
    { trial: trial({ id: 'e', kind: 'editor' }), locationGrade: '', verdictGrade: '' }
  ];
  samples.forEach((s) => c.validate(s.trial));
  const [g, h] = c.group(samples);
  assert.deepEqual(
    [g.timed, g.totalTimed, g.totalMs, g.submitted, g.recovered, g.withdrawn],
    [1, 2, 2400, 3, 1, 1]
  );
  assert.deepEqual([g.locationHits, g.locationGraded, g.verdictHits, g.verdictGraded], [1, 2, 1, 2]);
  assert.equal(h.locationGraded, 0);
  assert.equal(h.kind, 'editor');
  assert.throws(() => c.validate(trial({ phaseMs: { search: -9, locate: 3, decide: 4 } })));
  assert.throws(() => c.validate(trial({ locator: '' })));
});
const { JSDOM } = require('jsdom');
const gradingKey = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../experiments/cross-party-review/coordinator-key.json'))
);
const reader = (name) => fs.readFileSync(path.resolve(__dirname, '../docs/reader', name), 'utf8');
function page(t, name, initialize) {
  const { window } = new JSDOM(reader(name + '.html'), {
    runScripts: 'outside-only',
    url: 'https://local.test/' + name + '.html'
  });
  t.after(() => window.close());
  initialize?.(window);
  window.confirm = () => true;
  window.eval(reader('field-review-core.js'));
  window.eval(reader(name + '.js'));
  const el = (id) => window.document.getElementById(id);
  async function upload(id, ...files) {
    const input = el(id);
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: files.map((v) => ({ text: async () => JSON.stringify(v) }))
    });
    await input.onchange({ target: input });
  }
  async function download(id) {
    let blob;
    window.URL.createObjectURL = (value) => {
      blob = value;
      return 'blob:mock';
    };
    window.URL.revokeObjectURL = () => {};
    window.HTMLAnchorElement.prototype.click = () => {};
    el(id).click();
    return JSON.parse(await blob.text());
  }
  function select(selector, value) {
    const input = window.document.querySelector(selector);
    input.value = value;
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  function gradeLocation(locator, value) {
    const card = [...el('entries').children].find(answer =>
      [...answer.querySelectorAll('p')].some(line => line.textContent === '제출한 위치 · ' + locator));
    assert.ok(card, '제출한 원자료 위치로 채점할 답안을 찾습니다.');
    const control = card.querySelector('select');
    assert.equal(control.disabled, false);
    control.value = value;
    control.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  function report(id, selector) {
    assert.equal(el('results').hidden, true);
    el('toggle-results').click();
    assert.equal(el('results').hidden, false);
    const content = selector ? el(id).querySelector(selector).textContent : el(id).textContent;
    el('toggle-results').click();
    assert.equal(el('results').hidden, true);
    return content;
  }
  return { window, el, upload, download, select, gradeLocation, report };
}
test('배정을 가린 채 파일 순서를 섞고 채점을 보존하며 진행자가 요청할 때만 시간과 방식을 공개한다', async t => {
  const p = page(t, 'field-summary', w => {
    const ranks = [0.8, 0.2, 0.6];
    w.Math.random = () => ranks.shift() ?? 0.5;
  });
  const a = trial({id:'record-a', participant:'MEMBER-AA', kind:'editor', method:'manual',
    journalUse:'yes', locator:'원표의 첫째 행', phaseMs:{search:60000, locate:0, decide:0}});
  const b = trial({id:'record-b', participant:'MEMBER-BB', kind:'editor', method:'journal',
    journalUse:'no', locator:'원표의 둘째 행', phaseMs:{search:30000, locate:0, decide:0}});
  const training = trial({id:'record-c', participant:'MEMBER-CC', locator:'원표의 셋째 행'});
  function checkMasked(view) {
    assert.equal(view.el('results').hidden, true);
    assert.equal(view.el('toggle-results').getAttribute('aria-expanded'), 'false');
    assert.equal(view.el('groups').childElementCount, 0);
    assert.equal(view.el('comparisons').childElementCount, 0);
    assert.doesNotMatch(view.el('entries').innerHTML, /MEMBER-|record-[abc]|평소 검증 도구|60\.0초|30\.0초/);
  }
  function locations(view) {
    return [...view.el('entries').querySelectorAll('article p')]
      .map(line => line.textContent).filter(line => line.startsWith('제출한 위치 · '));
  }

  await p.upload('key-file', gradingKey);
  const fileInput = p.el('imports');
  assert.equal(fileInput.hidden, true);
  let pickerOpened = false;
  fileInput.click = () => { pickerOpened = true; };
  p.el('choose-imports').click();
  assert.equal(pickerOpened, true);
  Object.defineProperty(fileInput, 'files', {configurable:true, value:[a,b].map(record =>
    new p.window.File([JSON.stringify(record)], record.participant + '-' + record.method + '.json'))});
  await fileInput.onchange({target:fileInput});
  checkMasked(p);
  assert.doesNotMatch(p.el('status').textContent, /MEMBER-|manual\.json|journal\.json/);
  assert.deepEqual(locations(p), [b.locator, a.locator].map(value => '제출한 위치 · ' + value));
  p.gradeLocation(b.locator, 'no');
  p.gradeLocation(a.locator, 'yes');
  checkMasked(p);
  assert.equal(p.el('entries').querySelector('select').value, 'no');

  p.el('toggle-results').click();
  assert.equal(p.el('results').hidden, false);
  assert.equal(p.el('toggle-results').getAttribute('aria-expanded'), 'true');
  assert.match(p.el('comparisons').textContent, /30\.0초 절감 \(50\.0%\)/);
  assert.match(p.el('entries').textContent, /MEMBER-AA.*평소 검증 도구/);
  assert.match(p.el('entries').textContent, /MEMBER-BB.*평소 검증 도구와 저널/);
  assert.equal(p.el('entries').querySelector('select:enabled'), null);
  const store = p.window.sessionStorage;
  const restored = page(t, 'field-summary', w => {
    for (const key of Object.keys(store)) w.sessionStorage.setItem(key, store.getItem(key));
  });
  checkMasked(restored);
  assert.deepEqual(locations(restored), [b.locator, a.locator].map(value => '제출한 위치 · ' + value));
  const saved = await restored.download('save');
  assert.deepEqual(saved.entries.map(e => [e.trial.id, e.trial.method, e.locationGrade]),
    [['record-a','manual','yes'],['record-b','journal','no']]);

  await p.upload('imports', training);
  checkMasked(p);
  p.el('toggle-results').click();
  p.select('#kind', 'practice');
  checkMasked(p);
  assert.deepEqual(locations(p), ['제출한 위치 · ' + training.locator]);
  p.el('toggle-results').click();
  const revised = structuredClone(gradingKey);
  revised.tasks[0].reference.acceptedLocators = ['새로 확인한 행'];
  await p.upload('key-file', revised);
  checkMasked(p);
  assert.match(p.el('entries').textContent, /새로 확인한 행/);
});

test('새 파일을 읽는 동안 배정을 다시 가리고 잘못된 JSON 본문과 파일명을 오류에 노출하지 않는다', async t => {
  const p = page(t, 'field-summary');
  await p.upload('imports', trial({kind:'editor', participant:'OLD-MEMBER'}));
  for (const [id, button] of [['imports','choose-imports'], ['key-file','choose-key']]) {
    p.el('toggle-results').click();
    assert.match(p.el('entries').textContent, /OLD-MEMBER/);
    const input = p.el(id);
    assert.equal(input.hidden, true);
    let resume;
    Object.defineProperty(input, 'files', {configurable:true, value:[{
      name:'LEAK-MEMBER-journal.json',
      text:() => new Promise(resolve => { resume = resolve; })
    }]});
    const pending = input.onchange({target:input});
    assert.equal(p.el('results').hidden, true);
    assert.equal(p.el(button).disabled, true);
    assert.equal(p.el('toggle-results').disabled, true);
    assert.doesNotMatch(p.el('entries').textContent, /OLD-MEMBER/);
    resume('LEAK-MEMBER-journal');
    await pending;
    assert.equal(p.el('toggle-results').disabled, false);
    assert.equal(p.el('results').hidden, true);
    assert.match(p.el('status').textContent, /JSON/);
    assert.doesNotMatch(p.el('status').textContent, /LEAK-MEMBER|journal/);
  }
});

test('진행자가 새로고침해도 구분·채점기준·수동 채점을 복원하고 각 구분의 저장 여부를 구별한다', async t => {
  const p = page(t, 'field-summary');
  await p.upload('key-file', gradingKey);
  await p.upload('imports', trial({id:'real',kind:'editor',participant:'P1'}), trial({id:'practice',participant:'P2'}));
  p.select('#entries select', 'yes');
  p.select('#kind', 'practice');
  p.select('#entries select', 'no');
  const first = await p.download('save');
  assert.deepEqual(first.entries.map(row => row.trial.id), ['practice']);
  assert.match(p.el('draft-status').textContent, /파일 저장 전 · 현업 참여$/);
  const store = p.window.sessionStorage;
  const restored = page(t, 'field-summary', w => {
    for (const key of Object.keys(store)) w.sessionStorage.setItem(key, store.getItem(key));
  });
  assert.equal(restored.el('kind').value, 'practice');
  assert.equal(restored.el('entries').querySelector('select').value, 'no');
  assert.match(restored.el('key-name').textContent, /기준 2개/);
  assert.match(restored.el('draft-status').textContent, /파일 저장 전 · 현업 참여$/);
  restored.select('#kind', 'editor');
  assert.equal(restored.el('entries').querySelector('select').value, 'yes');
  assert.equal(restored.window.dispatchEvent(new restored.window.Event('beforeunload', {cancelable:true})), false);
  assert.equal((await restored.download('save')).entries[0].locationGrade, 'yes');
  assert.equal(restored.window.dispatchEvent(new restored.window.Event('beforeunload', {cancelable:true})), true);
  await restored.upload('imports', trial({id:'new', participant:'new', kind:'editor',
    taskId:fixture.tasks[1].id, prompt:fixture.tasks[1].prompt}));
  const imported = [...restored.el('entries').children].find(card =>
    card.querySelector('h3').textContent.includes(fixture.tasks[1].id));
  assert.match(imported.textContent, /기준 판정/);
});

test('임시 저장이 막혀도 채점은 유지하고 파일 저장과 페이지 이탈 경고를 제공한다', async t => {
  const p = page(t, 'field-summary', w => {
    Object.defineProperty(w, 'sessionStorage', {get() { throw Error('blocked'); }});
  });
  await p.upload('imports', trial({kind:'editor'}));
  p.select('#entries select', 'yes');
  assert.match(p.el('draft-status').textContent, /임시 저장할 수 없습니다/);
  assert.equal(p.window.dispatchEvent(new p.window.Event('beforeunload', {cancelable:true})), false);
  assert.equal((await p.download('save')).entries[0].locationGrade, 'yes');
});
test('수동·저널 배정을 유지하고 실제 도구 사용 응답과 다음 참여자를 분리한다', async (t) => {
  for (const arm of ['manual', 'journal']) {
    const p = page(t, 'field-review');
    const { el } = p;
    await p.upload('case-file', fixture);
    // Each downloadable participant workbook locks assignment to one option.
    for (const opt of [...el('method').options]) if (opt.value !== arm) opt.remove();
    el('method').disabled = true;
    el('participant').value = '첫번째';
    el('participant').oninput();
    el('kind').value = 'editor';
    el('task').selectedIndex = 1;
    el('start').click();
    assert.equal(
      p.window.document.querySelectorAll('a[href="factcheck.html"]').length,
      arm === 'journal' ? 1 : 0
    );
    el('pause').click();
    assert.ok(el('question').hidden && el('article-link').hidden && el('answer').disabled);
    el('pause').click();
    el('found').value = 'missing';
    el('verdict').value = 'insufficient';
    el('reason').value = '원표를 확인하지 못함';
    el('submit').click();
    assert.match(el('status').textContent, /실제로 사용/);
    assert.equal(el('ended').hidden, true);
    el('journalUse').value = arm === 'manual' ? 'yes' : 'no';
    el('submit').click();
    const output = await p.download('download');
    assert.equal(output.method, arm);
    assert.equal(output.kitVersion, null);
    assert.equal(output.journalUse, el('journalUse').value);
    el('next').click();
    assert.deepEqual(
      [
        el('participant').value,
        el('kind').value,
        el('task').selectedIndex,
        el('method').value,
        el('start').disabled
      ],
      ['', 'practice', 0, arm, true]
    );
  }
});
test('배부본은 번호 선택과 시작을 기다리고 수동으로 다시 불러와도 같은 문장을 연다', async (t) => {
  for (const arm of ['manual', 'journal']) {
    const p = page(t, 'field-review', ({ document }) => {
      document.getElementById('case-file').dataset.caseId = fixture.caseId;
      const method = document.getElementById('method');
      for (const option of [...method.options]) if (option.value !== arm) option.remove();
      method.disabled = true;
      const script = document.createElement('script');
      script.type = 'application/json';
      script.id = 'assigned-tasks';
      script.textContent = JSON.stringify(fixture);
      document.head.append(script);
    });
    const { el } = p;
    assert.equal(el('case-import').open, false);
    el('participant').value = 'E01';
    el('participant').oninput();
    for (const reloadFile of [false, true]) {
      if (reloadFile) {
        await p.upload('case-file', { ...fixture, caseId: 'other-case' });
        assert.match(el('status').textContent, /다른 기사/);
        assert.equal(el('task').options.length, 0);
        await p.upload('case-file', fixture);
      }
      assert.equal(el('case-name').textContent, fixture.title);
      assert.deepEqual([...el('task').options].map(o => o.value), ['', ...fixture.tasks.map(t => t.id)]);
      assert.equal(el('task').value, '');
      assert.equal(el('start').disabled, true);
      p.select('#task', fixture.tasks[1].id);
      assert.equal(el('start').disabled, false);
      assert.equal(el('work').hidden, true);
      assert.equal(el('question').textContent, '');
      assert.equal(el('article-link').children.length, 0);
      assert.equal(el('clock').textContent, '');
      assert.equal(p.window.localStorage.length, 0);
    }
    el('start').click();
    assert.equal(el('question').textContent, fixture.tasks[1].prompt);
    assert.equal(el('article-link').firstElementChild.href, fixture.articleUrl);
    assert.equal(el('tool-link').children.length, arm === 'journal' ? 1 : 0);
    el('withdraw').click();
    el('next').click();
    assert.equal(el('task').value, '');
    assert.equal(el('start').disabled, true);
  }
});
test('참여 기록은 시간을 시작할 때의 배포본을 보관하고 이전 기록을 새 버전으로 표시하지 않는다', async t => {
  const first = '1'.repeat(64), next = '2'.repeat(64);
  function kit(version, saved) {
    return page(t, 'field-review', w => {
      const meta = w.document.createElement('meta');
      meta.name = 'journal-field-kit';
      meta.content = version;
      w.document.head.append(meta);
      w.document.getElementById('case-file').dataset.caseId = fixture.caseId;
      w.document.getElementById('method').disabled = true;
      if (saved) w.localStorage.setItem(saved.key, JSON.stringify(saved.session));
    });
  }
  const p = kit(first);
  await p.upload('case-file', fixture);
  p.el('participant').value = 'E01';
  p.select('#task', fixture.tasks[0].id);
  p.el('start').click();
  const key = p.window.localStorage.key(0);
  const session = JSON.parse(p.window.localStorage.getItem(key));
  assert.equal(session.base.kitVersion, first);
  p.el('withdraw').click();
  assert.equal((await p.download('download')).kitVersion, first);
  for (const legacy of [false, true]) {
    if (legacy) delete session.base.kitVersion;
    const restored = kit(next, {key, session});
    restored.el('withdraw').click();
    const result = await restored.download('download');
    assert.equal(result.recovered, true);
    assert.equal(result.kitVersion, legacy ? undefined : first);
  }
});

test('배정과 실제 사용이 다른 완료 건수와 과거 미확인 파일을 배정별로 센다', () => {
  const rows = [
    { journalUse: 'yes' },
    { journalUse: 'no' },
    {},
    { method: 'journal', journalUse: 'yes' },
    { method: 'journal', journalUse: 'no' },
    { method: 'journal', journalUse: '', status: 'withdrawn' }
  ];
  const groups = c.group(rows.map((changes) => ({ trial: c.validate(trial(changes)) })));
  assert.deepEqual(
    groups.map((g) => [g.method, g.asAssigned, g.differentMethod, g.unknownUse, g.withdrawn]),
    [
      ['manual', 1, 1, 1, 0],
      ['journal', 1, 1, 0, 1]
    ]
  );
  assert.throws(() => c.validate(trial({ journalUse: '' })));
});
test('기사 주소가 다른 과제와 원문 위치 기준이 달라진 집계본에 예전 점수를 적용하지 않는다', async (t) => {
  const raw = trial({ kind: 'editor', journalUse: 'no' });
  const p = page(t, 'field-summary');
  await p.upload('key-file', gradingKey);
  await p.upload('imports', { ...raw, articleUrl: 'https://other.example/reprint' });
  assert.match(p.report('groups'), /판정 일치율 산출 대기/);
  assert.match(p.el('entries').textContent, /수동으로 채점/);
  const q = page(t, 'field-summary');
  await q.upload('imports', raw);
  await q.upload('key-file', gradingKey);
  assert.match(q.report('groups'), /판정 일치율 100.0% \(1\/1\)/);
  q.select('#entries select', 'yes');
  const scored = await q.download('save');
  assert.equal(scored.entries[0].basis.articleUrl, raw.articleUrl);
  assert.equal(scored.entries[0].basis.reference.locator, gradingKey.tasks[0].reference.locator);
  const r = page(t, 'field-summary');
  await r.upload('imports', scored, raw);
  assert.match(r.report('groups'), /재확인 성공률 100.0% \(1\/1\)/);
  assert.match(r.report('groups'), /판정 일치율 100.0% \(1\/1\)/);
  const differentArticle = { ...gradingKey, articleUrl: 'https://other.example/reprint' };
  const wrong = page(t, 'field-summary');
  await wrong.upload('imports', scored);
  await wrong.upload('key-file', differentArticle);
  await wrong.upload('imports', scored);
  assert.match(wrong.report('groups'), /재확인 성공률 산출 대기/);
  assert.match(wrong.report('groups'), /판정 일치율 산출 대기/);
  assert.equal((await wrong.download('save')).entries[0].basis, null);
  const revised = structuredClone(gradingKey);
  revised.tasks[0].reference.acceptedLocators = ['교체한 기준 위치'];
  revised.tasks[0].verdict = 'contradicted';
  await r.upload('key-file', revised);
  assert.match(r.report('groups'), /재확인 성공률 산출 대기/);
  assert.match(r.report('groups'), /판정 일치율 0.0% \(0\/1\)/);
  const pending = await r.download('save');
  await r.upload('imports', pending, scored);
  assert.match(r.el('status').textContent, /파일을 불러왔습니다/);
  assert.match(r.report('groups'), /재확인 성공률 산출 대기/);
  r.select('#entries select', 'no');
  const final = await r.download('save');
  assert.equal(final.entries[0].locationGrade, 'no');
  assert.deepEqual(final.entries[0].basis.reference.acceptedLocators, ['교체한 기준 위치']);
  const mixed = page(t, 'field-summary');
  const otherPerson = structuredClone(final);
  otherPerson.entries[0].trial.id = 'separate';
  otherPerson.entries[0].trial.participant = 'separate';
  await mixed.upload('imports', scored, otherPerson);
  assert.match(mixed.el('status').textContent, /다른 기준이 섞였습니다/);
  assert.equal(mixed.el('save').disabled, true);
  await mixed.upload('key-file', revised);
  await mixed.upload('imports', scored, otherPerson);
  assert.match(mixed.el('status').textContent, /파일을 불러왔습니다/);
  assert.match(mixed.report('groups'), /판정 일치율 0.0% \(0\/2\)/);
  const s = page(t, 'field-summary');
  await s.upload('key-file', revised);
  await s.upload('imports', scored);
  assert.match(s.report('groups'), /재확인 성공률 산출 대기/);
  assert.match(s.report('groups'), /판정 일치율 0.0% \(0\/1\)/);
});
test('이전 자동 채점의 기준이 없으면 재채점하고 수동 채점 두 항목은 독립적으로 저장한다', async (t) => {
  const p = page(t, 'field-summary');
  const raw = trial({ kind: 'editor' });
  await p.upload('imports', {
    format: 'journal-field-grades-v1',
    entries: [{ trial: raw, locationGrade: 'yes', verdictGrade: 'yes', expected: 'supported' }]
  });
  assert.match(p.report('groups'), /재확인 성공률 산출 대기/);
  assert.match(p.report('groups'), /판정 일치율 산출 대기/);
  const controls = p.el('entries').querySelectorAll('select');
  controls[0].value = 'yes';
  controls[0].onchange();
  controls[1].value = 'no';
  controls[1].onchange();
  let saved = await p.download('save');
  assert.deepEqual(
    [saved.entries[0].locationGrade, saved.entries[0].verdictGrade, saved.entries[0].basis],
    ['yes', 'no', null]
  );
  await p.upload('imports', raw);
  saved = await p.download('save');
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.entries[0].locationGrade, 'yes');
  const mismatched = structuredClone(raw);
  mismatched.journalUse = 'yes';
  await p.upload('imports', mismatched);
  assert.match(p.el('status').textContent, /내용이 다른/);
  await p.upload('key-file', gradingKey);
  assert.match(p.report('groups'), /재확인 성공률 산출 대기/);
  assert.match(p.report('groups'), /판정 일치율 100.0%/);
});

test('진행자가 대체 공식 게시물과 발행 시점 설명을 열어 고용 과제의 근거를 재확인한다', async t => {
  const key = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../experiments/labour-field-review/coordinator-key.json')));
  const task = key.tasks.find(item => item.id === 'labour-period');
  const boardUrl = task.reference.acceptedDocuments.find(value => value.includes('/board.es?'));
  const p = page(t, 'field-summary');
  await p.upload('imports', trial({ kind: 'editor', caseId: key.caseId, articleUrl: key.articleUrl,
    taskId: task.id, prompt: task.prompt, documentUrl: boardUrl, verdict: task.verdict }));
  await p.upload('key-file', key);
  const details = p.el('entries').querySelector('details');
  assert.equal(details.querySelector('summary').textContent, '채점 근거와 추가 허용 자료');
  assert.ok(details.textContent.includes(task.explanation));
  const links = [...details.querySelectorAll('a')];
  assert.deepEqual(links.map(a => a.href), [boardUrl]);
  assert.match(links[0].rel, /noopener/);
});

test('상충하는 채점본은 전부 반영을 보류하고 두 답안의 근거와 해당 채점 항목만 보여준다', async t => {
  const p = page(t, 'field-summary');
  const a = trial({id:'record-private-one', participant:'member-secret', kind:'editor', method:'journal',
    locator:'부록 3 <img src=x onerror=alert(1)>', phaseMs:{search:63218000, locate:0, decide:0}});
  const b = trial({id:'record-private-two', participant:'member-hidden', kind:'editor', found:'missing',
    reason:'검토한 구간에 원표가 없었다.'});
  const extra = trial({id:'record-extra', participant:'other-secret', kind:'editor', locator:'일괄 가져오기에서 제외할 답안'});
  const scores = entries => ({format:'journal-field-grades-v1', entries});
  const prior = scores([{trial:a, locationGrade:'yes', verdictGrade:'no'}]);
  await p.upload('imports', prior);
  const saved = await p.download('save');
  const incoming = scores([{trial:extra, locationGrade:'yes', verdictGrade:'yes'},
    {trial:b, locationGrade:'', verdictGrade:'no'}, {trial:a, locationGrade:'no', verdictGrade:'yes'}]);
  const other = scores([{trial:b, locationGrade:'', verdictGrade:'yes'}, {trial:a, locationGrade:'no', verdictGrade:'yes'}]);
  p.el('toggle-results').click();
  await p.upload('imports', incoming, other);
  assert.equal(p.el('results').hidden, true);
  const status = p.el('status');
  assert.match(status.textContent, /채점 결과가 다릅니다/);
  const conflicts = [...status.querySelectorAll('li')];
  assert.equal(conflicts.length,2);
  const found = conflicts.find(row => row.textContent.includes(a.locator));
  assert.ok(found);
  assert.ok(found.textContent.includes(a.prompt));
  assert.match(found.textContent, /채점 차이 · 근거 위치, 판정/);
  const missing = conflicts.find(row => row.textContent.includes(b.reason));
  assert.match(missing.textContent, /채점 차이 · 판정/);
  assert.equal(status.querySelector('img'),null);
  assert.doesNotMatch(status.textContent, /record-private|member-|other-secret|63218|평소 검증 도구|저널|일괄 가져오기에서 제외할 답안/);
  assert.deepEqual(await p.download('save'),saved);
  await p.upload('imports', prior);
  assert.equal(status.querySelectorAll('li').length,0);
});

test('같은 기사·문장의 시간 절감률과 같은 시간 표본의 판정·위치 일치를 함께 표시한다', async (t) => {
  const p = page(t, 'field-summary');
  const a = trial({ kind: 'editor', phaseMs: { search: 9000, locate: 9000, decide: 2000 } });
  const b = { ...a, id: 'b', participant: 'B', method: 'journal',
    phaseMs: { search: 5000, locate: 3000, decide: 2000 }, found: 'missing', verdict: 'insufficient' };
  await p.upload('key-file', gradingKey);
  await p.upload('imports', a, { ...b, id: 'v2', participant: 'V', articleUrl: 'https://example.com/revised' },
    { ...b, id: 'practice', participant: 'P', kind: 'practice' }, { ...b, id: 'restored', participant: 'R', recovered: true });
  assert.doesNotMatch(p.report('comparisons'), /50\.0%/);
  await p.upload('imports', b);
  p.gradeLocation(a.locator, 'yes');
  const first = p.report('comparisons', 'article');
  assert.match(first, /10\.0초 절감 \(50\.0%\)/);
  assert.match(first, /평균 20\.0초 \(1건\) · 근거 위치와 판정 모두 일치 100\.0% \(1\/1\)/);
  assert.match(first, /평균 10\.0초 \(1건\) · 근거 위치와 판정 모두 일치 0\.0% \(0\/1\)/);
  // Repeated exposure invalidates both attempts by that participant.
  await p.upload('imports', { ...b, id: 'again' });
  assert.doesNotMatch(p.report('comparisons'), /50\.0%/);
});

test('시간이 늘거나 기준 시간이 0초인 과제의 차이와 비율을 보존한다', () => {
  function result(ms, js) {
    const samples = [['manual', ms], ['journal', js]].map(([method, search]) =>
      ({ trial: trial({ method, phaseMs: { search, locate: 0, decide: 0 } }) }));
    return c.compareTimes(c.group(samples))[0];
  }
  assert.equal(result(400, 500).savedPct, -25);
  assert.equal(result(400, 400).savedPct, 0);
  assert.equal(result(0, 500).savedMs, -500);
  assert.equal(result(0, 500).savedPct, null);
});

test('검증 성공 한 건의 투입 시간에 실패와 중도 종료를 포함하고 판정 전에는 수치를 보류한다', async t => {
  const p = page(t, 'field-summary');
  const make = (id, method, seconds, extra = {}) => trial({
    id, participant: id, kind: 'editor', method, locator: '위치 ' + id,
    phaseMs: { search: seconds * 1000, locate: 0, decide: 0 }, ...extra
  });
  const manual = make('manual', 'manual', 60);
  const journal = make('journal', 'journal', 10);
  const missed = make('missed', 'journal', 10, { found: 'missing' });
  const stopped = make('stopped', 'journal', 70, { status: 'withdrawn' });
  await p.upload('key-file', gradingKey);
  await p.upload('imports', manual, journal, missed, stopped,
    make('restored', 'journal', 500, { recovered: true }),
    make('restored-stop', 'journal', 500, { status: 'withdrawn', recovered: true }));
  const comparison = () => p.report('comparisons');
  assert.match(comparison(), /50\.0초 절감 \(83\.3%\)/);
  assert.match(comparison(), /총 90\.0초 \(완료 2건, 중도 종료 1건\) · 검증 성공 0건 · 성공 여부 확인 대기 1건/);
  p.gradeLocation(manual.locator, 'yes');
  assert.doesNotMatch(comparison(), /검증 성공 1건당 30\.0초/);
  p.gradeLocation(journal.locator, 'yes');
  assert.match(comparison(), /검증 성공 1건당 30\.0초 더 걸림 \(50\.0%\)/);
  assert.match(comparison(), /평소 검증 도구와 저널 · 90\.0초\/건/);
  const restored = page(t, 'field-summary');
  await restored.upload('imports', await p.download('save'));
  assert.equal(restored.report('comparisons'), comparison());
  p.gradeLocation(journal.locator, 'no');
  assert.match(comparison(), /총 90\.0초 \(완료 2건, 중도 종료 1건\) · 검증 성공 0건 · 성공 여부 확인 대기 0건/);
  assert.doesNotMatch(comparison(), /검증 성공 1건당 30\.0초/);
});

test('한 항목의 실패가 확정되면 나머지 채점이 끝나지 않아도 실패한 시간은 유지한다', () => {
  const entries = [
    { trial: trial(), locationGrade: 'yes', verdictGrade: 'yes' },
    { trial: trial({ found: 'missing' }), locationGrade: '', verdictGrade: '' },
    { trial: trial(), locationGrade: '', verdictGrade: 'no' },
    { trial: trial({ status: 'withdrawn' }) }
  ];
  const [task] = c.compareTimes(c.group(entries));
  assert.equal(task.manual.verified, 1);
  assert.equal(task.manual.verificationKnown, 3);
  assert.equal(task.manual.timedOutcomePending, 0);
  assert.equal(task.perVerified.manualMs, 4800);
  assert.equal(task.perVerified.savedMs, null);
  const pending = [...entries, { trial: trial(), locationGrade: '', verdictGrade: 'yes' }];
  assert.equal(c.compareTimes(c.group(pending))[0].perVerified.manualMs, null);
  const [withRecovered] = c.group([...pending, {
    trial: trial({recovered:true}), locationGrade:'yes', verdictGrade:'yes'
  }]);
  assert.deepEqual([withRecovered.verified, withRecovered.verificationKnown, withRecovered.submitted,
    withRecovered.timedVerified, withRecovered.timedOutcomePending], [2,4,5,1,1]);
});

test('연습에서 본 같은 기사 기록을 현업 분모에서 제외하고 구분별 내보내기를 거쳐도 보존한다', async t => {
  const baseline = trial({id:'manual', participant:'A', kind:'editor', phaseMs:{search:60000, locate:0, decide:0}});
  const journal = {...baseline, id:'journal', participant:'B', method:'journal', phaseMs:{search:30000, locate:0, decide:0}};
  const practice = {...journal, id:'training', kind:'practice', caseId:'other-case-for-same-article',
    articleUrl:journal.articleUrl + '#section', status:'withdrawn', reason:'연습에서만 보이는 응답'};
  const p = page(t, 'field-summary');
  await p.upload('key-file', gradingKey);
  await p.upload('imports', baseline, journal, journal);
  assert.match(p.report('comparisons'), /30\.0초 절감 \(50\.0%\)/);
  assert.match(p.el('count').textContent, /제외 0건/);
  await p.upload('imports', practice);
  assert.match(p.el('count').textContent, /불러온 2건.*제외 1건/);
  assert.match(p.report('comparisons'), /두 방식 모두 시간 기록이 필요/);
  assert.doesNotMatch(p.report('groups'), /저널/);
  const repeat = [...p.el('entries').children].find(answer => /연습·중도 종료/.test(answer.textContent));
  assert.ok(repeat);
  assert.equal(repeat.querySelector('select'), null);
  assert.match(p.el('count').textContent, /채점 대기 1건/);
  const saved = await p.download('save');
  assert.deepEqual(saved.entries.map(e => [e.trial.id,e.repeatExposure]), [['manual',undefined],['journal',true]]);
  assert.ok(!JSON.stringify(saved).includes('연습에서만 보이는 응답'));
  for (const files of [[journal,saved],[saved,journal]]) {
    const reopened = page(t, 'field-summary');
    await reopened.upload('imports', ...files);
    assert.match(reopened.el('count').textContent, /불러온 2건.*제외 1건/);
    assert.match(reopened.report('comparisons'), /두 방식 모두 시간 기록이 필요/);
  }
  const justRaw = page(t, 'field-summary');
  await justRaw.upload('imports', {...practice, caseId:'other', articleUrl:'https://different.example/story'}, journal, baseline);
  assert.match(justRaw.report('comparisons'), /50\.0%/);
});

test('해시 경로의 서로 다른 기사는 남기고 같은 경로의 본문 위치는 반복 노출로 센다', async t => {
  for (const route of ['#/', '#!/']) {
    const p = page(t, 'field-summary');
    const article = 'https://paper.example/news' + route + 'articles/';
    const seoul = trial({id:'seoul', kind:'editor', caseId:'case-seoul', articleUrl:article+'seoul/11'});
    const busan = trial({id:'busan', kind:'editor', caseId:'case-busan', articleUrl:article+'busan/35'});
    await p.upload('imports', seoul, busan);
    assert.match(p.el('count').textContent, /불러온 2건.*제외 0건/);
    await p.upload('imports', {...seoul, id:'practice', kind:'practice', caseId:'practice-seoul',
      articleUrl:seoul.articleUrl+'#fig1'});
    assert.match(p.el('count').textContent, /불러온 2건.*제외 1건/);
    const saved = await p.download('save');
    assert.deepEqual(saved.entries.map(e => [e.trial.id, !!e.repeatExposure]), [['seoul', true], ['busan', false]]);
    p.select('#kind', 'practice');
    assert.match(p.el('count').textContent, /불러온 1건.*제외 1건/);
  }
});

test('다른 참가자의 저장 기준을 같은 과제에 적용해 수동 점수와 오승인 분모를 일치시킨다', async t => {
  const [task] = gradingKey.tasks.filter(t => t.verdict === 'contradicted');
  const first = trial({id:'a',participant:'A',kind:'editor',taskId:task.id,prompt:task.prompt,verdict:'supported'});
  const second = {...first, id:'b', participant:'B'};
  const graded = page(t, 'field-summary');
  await graded.upload('key-file', gradingKey);
  await graded.upload('imports', first);
  graded.select('#entries select', 'yes');
  const keyed = await graded.download('save');
  const manual = {format:'journal-field-grades-v1',entries:[{trial:second,locationGrade:'yes',verdictGrade:'yes'}]};
  for (const files of [[keyed,manual],[manual,keyed]]) {
    const p = page(t, 'field-summary');
    for (const file of files) await p.upload('imports', file);
    assert.match(p.report('groups'), /판정 일치율 0\.0% \(0\/2\)/);
    assert.match(p.report('groups'), /근거 없는 사실 채택률 100\.0% \(2\/2\)/);
    assert.match(p.report('groups'), /재확인 성공률 100\.0% \(1\/1\) · 채점 대기 1건/);
    const saved = await p.download('save');
    assert.ok(saved.entries.every(e => e.basis.verdict === task.verdict));
    const restored = page(t, 'field-summary');
    await restored.upload('imports', saved);
    assert.equal(restored.report('groups'),p.report('groups'));
  }
});

test('현장에서 세 단계를 모두 눌러도 전환을 놓쳤다고 표시하면 전체 시간만 집계한다', async (t) => {
  for (const totalOnly of [true, false]) {
    const p = page(t, 'field-review');
    await p.upload('case-file', fixture);
    p.el('participant').value = '검토자';
    p.el('participant').oninput();
    p.el('start').click();
    for (const phase of ['locate','decide'])
      p.el('phases').querySelector('[data-phase="' + phase + '"]').click();
    p.el('total-only').click();
    if (!totalOnly) p.el('total-only').click();
    p.el('pause').click();
    assert.equal(p.el('total-only').disabled, true);
    p.el('pause').click();
    assert.equal(p.el('total-only').checked, totalOnly);
    p.el('found').value = 'missing';
    p.el('verdict').value = 'insufficient';
    p.el('reason').value = '검토할 자료를 확보하지 못했다.';
    p.el('journalUse').value = 'no';
    p.el('submit').click();
    const record = await p.download('download');
    const [summary] = c.group([{trial:record}]);
    assert.equal(record.split, !totalOnly);
    assert.equal(summary.totalTimed, 1);
    assert.equal(summary.timed, totalOnly ? 0 : 1);
  }
});

test('임시 저장 실패 안내가 과제 진행 상태에 지워지지 않고 파일로 회수할 수 있다', async (t) => {
  const p = page(t, 'field-review');
  p.window.Storage.prototype.setItem = () => { throw new Error('storage unavailable'); };
  await p.upload('case-file', fixture);
  p.el('participant').value = '테스트';
  p.el('participant').oninput();
  p.el('start').click();
  assert.equal(p.el('storage-status').hidden, false);
  p.el('withdraw').click();
  assert.equal(p.el('storage-status').hidden, false);
  const record = await p.download('download');
  assert.equal(record.status, 'withdrawn');
});

test('사전 배정표가 서로 다른 기사와 명부를 합치고 같은 기사에 대한 상충 배정을 거부한다', () => {
  const a = assignment('E01');
  const b = assignment('E01', {caseId:'other', articleUrl:'https://example.com/other'});
  const roster = rows => ({format:c.assignmentFormat, assignments:rows});
  assert.deepEqual(c.mergeAssignments([a], [roster([a,b,a])]), [a,b]);
  assert.deepEqual(c.mergeAssignments([], [roster([{...a, ignored:'not exported'}])]), [a]);
  for (const bad of [
    {...a, method:'unknown'}, {...a, participant:' '},
    {...a, articleUrl:'file:///private'}, {...a, prompt:''},
    {...a, method:'journal'}, {...a, taskId:'changed'},
    {...a, caseId:'other', articleUrl:a.articleUrl + '#page'},
    {...a, caseId:'other', articleUrl:a.articleUrl + '?utm_source=list'}
  ]) assert.throws(() => c.mergeAssignments([a], [roster([bad])]), /배정/);
  for (const bad of [{}, roster([])]) assert.throws(() => c.mergeAssignments([a], [bad]));
});

function assignment(participant, changes = {}) {
  const {caseId, articleUrl, taskId, prompt} = trial();
  return {participant, caseId, articleUrl, taskId, prompt, method:'manual', ...changes};
}

test('기사 쿼리 공백 부호와 추적 변수 차이를 배정 중복과 반복 노출 양쪽에 똑같이 적용한다', async t => {
  const base = 'https://paper.example/story';
  const articleUrl = base + '?article=employment%20report&year=2025#/view/1';
  const tracked = base + '?year=2025&article=employment+report&utm_source=x#/view/1#table';
  const a = assignment('A', {articleUrl});
  const b = {...a, caseId:'tracked', articleUrl:tracked};
  const pack = assignments => ({format:c.assignmentFormat, assignments});
  assert.equal(c.articleIdentity(base + '?article=employment%20report'),
    c.articleIdentity(base + '?article=employment%20report&utm_source=x'));
  assert.equal(c.articleIdentity(articleUrl), c.articleIdentity(tracked));
  assert.throws(() => c.mergeAssignments([], [pack([a,b])]), /서로 다른 배정/);
  for (const different of [articleUrl.replace('employment','income'), articleUrl.replace('%20','%2B'),
    articleUrl.replace('view/1','view/2')]) {
    const other = {...b, articleUrl:different};
    assert.deepEqual(c.mergeAssignments([], [pack([a,other])]), [a,other]);
  }
  const p = page(t, 'field-summary');
  await p.upload('roster-file', pack([a]));
  await p.upload('imports', trial({...a, id:'untagged', kind:'editor'}), trial({...b, id:'tagged', kind:'editor'}));
  assert.match(p.el('count').textContent, /불러온 2건.*제외 2건/);
  assert.match(p.report('allocation-counts'), /배정 1건 · 완료 0건.*반복·배정 충돌 1건/);
});

test('중단 복원·다른 방식으로 완료한 응답의 품질은 원래 배정에 남고 미회수 응답은 채점 분모에 들지 않는다', async t => {
  const p = page(t,'field-summary');
  const task = gradingKey.tasks.find(t => t.verdict === 'contradicted');
  const a = assignment('A', {taskId:task.id, prompt:task.prompt});
  const b = {...a, participant:'B', method:'journal'};
  const absent = {...a, participant:'C'};
  await p.upload('roster-file', {format:c.assignmentFormat, assignments:[a,b,absent]});
  const crossed = trial({...a, id:'crossed', kind:'editor', method:'journal', recovered:true, verdict:task.verdict});
  await p.upload('imports', crossed);
  const arm = index => p.report('allocation-arms', 'article:nth-child(' + index + ')');
  const beforeKey = arm(1);
  assert.match(beforeKey, /판정 일치율 산출 대기 \(0\/0\) · 채점 대기 1건/);
  assert.match(beforeKey, /근거 없는 사실 채택률 산출 대기 \(0\/0\).*기준 판정 미확인 1건/);
  await p.upload('key-file', gradingKey);
  p.gradeLocation(crossed.locator, 'no');
  const original = arm(1);
  assert.match(original, /배정 2건 · 완료 1건.*연결된 현업 기록 없음 1건/);
  assert.match(original, /원자료 위치 재확인 성공률 0\.0% \(0\/1\) · 채점 대기 0건/);
  assert.match(original, /판정 일치율 100\.0% \(1\/1\) · 채점 대기 0건/);
  assert.match(original, /근거 없는 사실 채택률 0\.0% \(0\/1\).*기준 판정 미확인 0건/);
  const empty = arm(2);
  assert.match(empty, /판정 일치율 산출 대기 \(0\/0\) · 채점 대기 0건/);
  assert.doesNotMatch(empty, /%/);
  assert.match(p.report('allocation-comparisons'), /평소 검증 도구 · 비교 가능한 완료 기록 0건/);
  await p.upload('imports', trial({...b, id:'unsupported', kind:'editor', method:'manual', verdict:'supported'}));
  assert.match(arm(2), /판정 일치율 0\.0% \(0\/1\).*근거 없는 사실 채택률 100\.0% \(1\/1\)/);
  assert.equal(arm(1), original);
});

test('근거와 판정을 서로 다른 답안에서 맞히면 두 항목 동시 일치율은 0/2다', async t => {
  const p = page(t, 'field-summary');
  const a = assignment('A'), b = assignment('B');
  await p.upload('roster-file', {format:c.assignmentFormat, assignments:[a,b]});
  await p.upload('key-file', gradingKey);
  const first = trial({...a, id:'location', kind:'editor', method:'journal', locator:'첫 번째 행',
    verdict:'insufficient', recovered:true});
  const second = trial({...b, id:'verdict', kind:'editor', method:'journal', locator:'두 번째 행',
    verdict:gradingKey.tasks[0].verdict});
  await p.upload('imports', first, second);
  p.gradeLocation(first.locator, 'yes');
  p.gradeLocation(second.locator, 'no');
  for (const area of ['allocation-arms', 'groups']) {
    const result = p.report(area);
    assert.match(result, /원자료 위치 재확인 성공률 50\.0% \(1\/2\)/);
    assert.match(result, /판정 일치율 50\.0% \(1\/2\)/);
    assert.match(result, /근거 위치와 판정 모두 일치 0\.0% \(0\/2\) · 성공 여부 확인 대기 0건/);
  }
  assert.match(p.report('allocation-comparisons'), /평소 검증 도구 · 평균 1\.2초 \(1건\)/);
  p.gradeLocation(second.locator, '');
  assert.match(p.report('allocation-arms'), /근거 위치와 판정 모두 일치 0\.0% \(0\/1\) · 성공 여부 확인 대기 1건/);
  p.gradeLocation(first.locator, '');
  assert.match(p.report('groups'), /근거 위치와 판정 모두 일치 0\.0% \(0\/1\) · 성공 여부 확인 대기 1건/);
  p.gradeLocation(second.locator, 'yes');
  assert.match(p.report('allocation-arms'), /근거 위치와 판정 모두 일치 50\.0% \(1\/2\) · 성공 여부 확인 대기 0건/);
});

test('사전 배정과 과제가 일치한 현업 기록을 원래 방식으로 비교하고 모든 배정을 분모에 남긴다', async t => {
  const roster = rows => ({format:c.assignmentFormat, assignments:rows});
  const as = ['A','B','C','D','E','F','G','H'].map((id,i) => assignment(id, {method:i%2 ? 'journal' : 'manual'}));
  const p = page(t, 'field-summary');
  await p.upload('roster-file', roster(as.slice(0,4)), roster(as.slice(4)));
  assert.equal(p.el('allocation-arms').textContent, '');
  assert.equal(p.el('entries').textContent, '');
  assert.match(p.report('allocation-counts'), /배정 8건.*연결된 현업 기록 없음 8건/);
  const run = (participant, changes={}) => trial({id:participant, participant, kind:'editor', ...changes});
  const left = run('A', {method:'journal', journalUse:'yes', phaseMs:{search:60000,locate:0,decide:0}});
  const right = run('B', {method:'manual', journalUse:'yes', phaseMs:{search:30000,locate:0,decide:0}});
  const submissions = [
    left, right, right,
    run('C', {taskId:'wrong-task'}),
    run('D', {method:'journal', status:'withdrawn', journalUse:''}),
    run('F', {id:'f1'}), run('F', {id:'f2'}),
    run('G', {kind:'practice'}), run('H', {caseId:'unknown', articleUrl:'https://example.com/unrelated'}),
    run('outside', {method:'manual', phaseMs:{search:600000,locate:0,decide:0}})
  ];
  await p.upload('imports', ...submissions);
  await p.upload('roster-file', roster(as));
  assert.doesNotMatch(p.el('roster-status').textContent, /A|journal|manual/);
  assert.equal(p.el('allocation-arms').textContent, '');
  assert.match(p.report('allocation-counts'), /배정 8건 · 완료 2건 · 중도 종료 1건 · 기사·과제 불일치 2건 · 반복·배정 충돌 1건 · 연결된 현업 기록 없음 2건/);
  assert.match(p.report('allocation-counts'), /명부 밖 코드의 현업 기록 1건/);
  assert.match(p.report('allocation-comparisons'), /30\.0초 절감 \(50\.0%\)/);
  p.el('toggle-results').click();
  const arms = [...p.el('allocation-arms').children].map(card => card.textContent);
  assert.match(arms[0], /배정 4건.*기록상 방식이 원래 배정과 다른 경우 1건.*실제 사용이 원래 배정과 일치 0건 · 불일치 1건/);
  assert.match(arms[1], /배정 4건.*기록상 방식이 원래 배정과 다른 경우 1건.*실제 사용이 원래 배정과 일치 1건/);
  assert.deepEqual(await p.download('save-roster'), roster(as));
  const grades = await p.download('save');
  assert.equal(grades.entries.find(v => v.trial.id === 'A').trial.method, 'journal');
  assert.doesNotMatch(JSON.stringify(grades), /assignments|field-assignment|"participant":"E"/);
  await p.upload('roster-file', roster([assignment('I')]), roster([{...as[0], method:'journal'}]));
  assert.match(p.el('roster-status').textContent, /서로 다른 배정/);
  assert.equal(p.el('allocation-results').hidden,true);
  assert.match(p.report('allocation-counts'), /배정 8건/);
  const store = p.window.sessionStorage;
  const restored = page(t,'field-summary',w=>{
    for (const key of Object.keys(store)) w.sessionStorage.setItem(key,store.getItem(key));
  });
  assert.equal(restored.el('allocation-comparisons').textContent,'');
  assert.match(restored.report('allocation-comparisons'), /30\.0초 절감/);
  restored.select('#kind','practice');
  restored.el('toggle-results').click();
  assert.equal(restored.el('allocation-results').hidden,true);
  assert.equal(restored.el('allocation-counts').textContent, '');
  const fresh = page(t, 'field-summary');
  await fresh.upload('imports', grades);
  fresh.el('toggle-results').click();
  assert.equal(fresh.el('allocation-results').hidden,true);
  assert.match(fresh.el('groups').textContent, /기록상 방식과 본인 응답 일치/);
  assert.doesNotMatch(fresh.el('groups').textContent, /배정대로 사용/);
});

test('한 편집자가 서로 다른 기사를 배정받으면 과제와 기사가 동시에 맞는 응답만 해당 배정에 연결한다', () => {
  const a = assignment('A'), b = assignment('A', {caseId:'B',articleUrl:'https://example.com/B'});
  const slots = c.mergeAssignments([],[{format:c.assignmentFormat,assignments:[a,b]}]);
  const row = (id, extra) => ({trial: trial({kind:'editor', id, ...extra})});
  const qualified = row('exact', b);
  const stray = row('stray', {...a, caseId:'stray', articleUrl:'https://example.com/stray'});
  const report = rows=>c.allocationReport(slots,rows,new Set());
  const two = report([qualified,stray]);
  assert.deepEqual([two.all.completed,two.all.missing,two.unlinked],[1,1,1]);
  const conflict = report([row('crossed identifiers',{...a, articleUrl:b.articleUrl})]);
  assert.deepEqual([conflict.all.excluded,conflict.all.completed,conflict.groups.length],[2,0,0]);
  assert.equal(c.allocationReport(slots,[qualified],new Set(['exact'])).all.excluded,1);
});

test('배포본 수는 시간 지표별로 원래 배정에 연결된 표본과 기록상 방식 표본에 맞춘다', async t => {
  const p = page(t, 'field-summary');
  const first = 'a'.repeat(64), second = 'b'.repeat(64), outside = 'c'.repeat(64), excluded = 'd'.repeat(64);
  const record = (id, changes) => trial({id, participant:id, kind:'editor', ...changes});
  const left = record('A', {method:'journal', kitVersion:first});
  await p.upload('roster-file', {format:c.assignmentFormat, assignments:[
    assignment('A'), assignment('B', {method:'journal'}), assignment('C'), assignment('D'),
    assignment('R'), assignment('wrong'), assignment('repeat')
  ]});
  await p.upload('imports', left, record('B', {kitVersion:first}),
    record('C', {method:'journal', kitVersion:second, status:'withdrawn'}),
    record('outside', {kitVersion:outside}), record('R', {kitVersion:excluded, recovered:true}),
    record('practice', {kitVersion:excluded, kind:'practice'}),
    record('wrong', {taskId:'other', kitVersion:excluded}),
    record('repeat', {kitVersion:excluded}), record('repeat2', {kitVersion:excluded, participant:'repeat'}));
  assert.doesNotMatch(p.el('entries').textContent, new RegExp(first));
  let assigned = p.report('allocation-comparisons');
  assert.match(assigned, /완료 시간 평균 · 기록에 적힌 배포본 1종 · 버전 미확인 0건/);
  assert.match(assigned, /완료·중도 종료 시간 · 기록에 적힌 배포본 2종 · 버전 미확인 0건. 여러 버전/);
  assert.ok(assigned.includes('평소 검증 도구 · ' + second + ' · 완료 0건 (단계별 측정 0건) · 중도 종료 1건'));
  assert.ok(!assigned.includes(excluded) && !assigned.includes(outside));
  const recorded = p.report('comparisons', 'article');
  assert.ok(recorded.includes('평소 검증 도구와 저널 · ' + second + ' · 완료 0건'));
  assert.ok(recorded.includes(outside) && !recorded.includes(excluded));
  await p.upload('imports', record('D', {}), record('malformed', {kitVersion:[first]}));
  assigned = p.report('allocation-comparisons');
  assert.match(assigned, /완료 시간 평균 · 기록에 적힌 배포본 1종 · 버전 미확인 1건/);
  assert.match(p.report('comparisons', 'article'), /완료 시간 평균 · 기록에 적힌 배포본 2종 · 버전 미확인 2건/);
  const exported = await p.download('save');
  assert.equal(exported.entries.find(r => r.trial.id === 'A').trial.kitVersion, first);
  await p.upload('imports', {...left, kitVersion:second});
  assert.match(p.el('status').textContent, /내용이 다른 파일/);
  assert.equal(p.report('allocation-comparisons'), assigned);
  p.select('#kind', 'practice');
  const practice = p.report('comparisons');
  assert.ok(practice.includes(excluded) && !practice.includes(first));
});

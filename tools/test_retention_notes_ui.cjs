const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const core = require('../docs/reader/retention-case.js');
const script = fs.readFileSync(require.resolve('../docs/reader/retention-notes-ui.js'), 'utf8');
const next = () => new Promise(resolve => setImmediate(resolve));

function screen(t, notes = [], onDownload, noOriginal = false, additionalPassages = []) {
  const dom = new JSDOM('<main><section id="panel"><p id="original">공동 편향 개선 1/1</p><details class="fact-retention"><summary>원본 사실 대조</summary></details></section></main>', {runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  w.JournalRetentionCase = core;
  w.eval(script);
  const side = digit => ({articleSha256:digit.repeat(64), sourcesSha256:'a'.repeat(64)});
  const record = {format:'journal-revision-series-record', version:5, demo:true, before:side('1'), after:side('2'),
    dimensions:['wording', 'framing', 'omission', 'standards'].map(id => ({id, first:{before:2, after:0}, second:{before:2, after:0}})),
    facts:{before:['supported','supported','supported'], after:['supported','supported','pending']}, factMatches:[[0,null],[1,2],[2,1]],
    factContext:{beforeCore:[0,0,0], afterCore:Array(3 + additionalPassages.length).fill(0), matches:[[1,2],[2,1]]}};
  for (const role of ['before','after']) record.facts[role] = record.facts[role].map(outcome => ({outcome, flag:'none'}));
  record.facts.after.push(...additionalPassages.map(() => ({outcome:'supported', flag:'none'})));
  if (noOriginal) {
    record.facts.before.forEach(row => { row.outcome = 'pending'; });
    record.factMatches = [];
  }
  const original = ['지원 대상은 300가구다.', '지원은 다음 달부터다.', '사업비는 100억 원이다.'];
  const revised = ['300가구에 지원한다. <img src=x>', '사업비는 100억 원이다.', '지원은 다음 달부터다.', ...additionalPassages];
  const editors = ['가', '나'].map(editor => ({snapshots:[original, revised].map(texts => ({
    rows:texts.map((text, index) => ({id:'unit-' + index, text, receipt:{reason:editor + '의 명부 확인'}})),
    assessment:{accuracy:{rows:texts.map((_, i) => ({rowId:'unit-' + i, label:'대조한 구절'}))}}
  }))}));
  const panel = doc.querySelector('#panel'), outer = panel.querySelector('details');
  for (const [before, after] of record.factMatches) {
    if (after !== null && record.facts.after[after].outcome === 'supported') continue;
    const row = doc.createElement('details'), label = doc.createElement('summary');
    row.dataset.retentionBefore = before;
    label.textContent = original[before];
    row.append(label);
    outer.append(row);
  }
  const downloads = [];
  w.JournalRetentionNotesUI.mount({container:panel, record, editors, notes, onSave: onDownload || (data => downloads.push(JSON.parse(JSON.stringify(data)))),
    decisionEvidence(snapshot, decision) {
      const p = doc.createElement('p');
      p.textContent = snapshot.rows.find(row => row.id === decision.rowId).receipt.reason;
      return p;
    }});
  const get = (key, root = panel) => root.querySelector('[data-retention-' + key + ']');
  const row = i => panel.querySelector('[data-retention-before="' + i + '"]');
  function edit(i, key, value) {
    const control = get(key, row(i));
    control.value = value;
    control.dispatchEvent(new w.Event(key === 'state' ? 'change' : 'input', {bubbles:true}));
  }
  const save = async () => { get('save').click(); await next(); };
  return {doc, panel, row, get, edit, save, downloads, record};
}

test('재서술된 구절을 고른 진행자가 두 사람의 근거를 대조하고 유지 확인을 저장·복원한다', async t => {
  const p = screen(t);
  const unchanged = JSON.stringify(p.record);
  assert.match(p.get('summary').textContent, /자동 대응으로 확인 1개.*진행자가 유지 확인 0개.*검토 남음 2개/);
  assert.ok(p.get('state', p.row(0)).labels.length);
  p.edit(0, 'state', 'retained');
  p.edit(0, 'target', '1');
  const preview = p.get('preview', p.row(0));
  assert.match(preview.textContent, /두 편집자의 판정 구절 전체 지지.*300가구에 지원한다.*가의 명부 확인나의 명부 확인/);
  assert.equal(p.panel.querySelector('img'), null);
  const reason = '명부의 대상 300가구와 대상 범위가 그대로다.';
  p.edit(0, 'reason', reason);
  p.edit(1, 'state', 'open');
  p.edit(1, 'reason', '최종 공고일을 다시 대조한다.');
  await p.save();
  assert.deepEqual(p.downloads[0], [{before:0, after:0, status:'retained', reason},
    {before:1, after:null, status:'open', reason:'최종 공고일을 다시 대조한다.'}]);
  assert.match(p.get('summary').textContent, /현재까지 유지 확인 2\/3개 \(66.7%\).*자동 대응으로 확인 1개.*진행자가 유지 확인 1개.*검토 남음 1개/);
  assert.equal(p.doc.querySelector('#original').textContent, '공동 편향 개선 1/1');
  assert.equal(JSON.stringify(p.record), unchanged);
  const reopened = screen(t, p.downloads[0]);
  assert.equal(reopened.get('state', reopened.row(0)).value, 'retained');
  assert.equal(reopened.get('target', reopened.row(0)).value, '1');
  assert.equal(reopened.get('reason', reopened.row(0)).value, reason);
  assert.equal(reopened.row(0).dataset.retentionPending, 'false');
  assert.equal(reopened.row(1).dataset.retentionPending, 'true');
  assert.match(reopened.panel.textContent, /미적용 초안.*작업 파일 4개.*대응표 2개/);
});

test('원본에 공동 지지 구절이 없으면 사후 유지 확인 비율은 산출 대기다', t => {
  const p = screen(t, [], undefined, true);
  assert.match(p.get('summary').textContent, /현재까지 유지 확인 0\/0개 \(산출 대기\)/);
  assert.doesNotMatch(p.get('summary').textContent, /0%|NaN/);
});

test('수량·여러 검색어로 재서술 후보를 찾고, 직접 고른 구절 번호와 두 편집자의 근거만 사용한다', async t => {
  const p = screen(t, [], undefined, false, ['지원 대상은 1,300 가구다.', '다른 지역은 3000가구에 지원한다.', '평균 300.5가구에 지원한다.']);
  const row = p.row(0), preview = p.get('preview', row), target = p.get('target', row);
  const picks = () => [...preview.querySelectorAll('button[data-retention-pick]')];
  p.edit(0, 'state', 'retained');
  p.edit(0, 'reason', '수정본에서도 동일한 지역의 300가구다.');
  for (const query of ['300 가구', '지원 ３００가구', '300']) {
    p.edit(0, 'target', query);
    assert.match(preview.textContent, /검색한 구절 1개/);
    assert.deepEqual(picks().map(button => button.dataset.retentionPick), ['0']);
    assert.equal(preview.querySelector('img'), null);
    await p.save();
    assert.equal(p.downloads.length, 0);
    assert.match(p.get('feedback').textContent, /검색 결과에서 대조할 구절을 선택/);
  }
  p.edit(0, 'target', '1,300가구');
  assert.deepEqual(picks().map(button => button.dataset.retentionPick), ['3']);
  p.edit(0, 'target', '300가구');
  picks()[0].click();
  assert.equal(target.value, '1');
  assert.match(preview.textContent, /가의 명부 확인나의 명부 확인/);
  assert.equal(p.doc.activeElement, preview);
  await p.save();
  assert.equal(p.downloads[0][0].after, 0);
  p.edit(0, 'target', '새 구절');
  assert.match(preview.textContent, /찾지 못했습니다/);
  assert.doesNotMatch(preview.textContent, /명부 확인/);
  await p.save();
  assert.equal(p.downloads.length, 1);
  p.edit(0, 'state', 'notFound');
  assert.equal(target.value, '');
  assert.equal(preview.textContent, '');
  p.edit(0, 'reason', '원문을 다시 읽은 결과 대상 지역이 일치하지 않았다.');
  await p.save();
  assert.equal(p.downloads[1][0].after, null);
  p.edit(0, 'state', 'open');
  p.edit(0, 'target', '지원');
  p.get('clear', row).click();
  await p.save();
  assert.deepEqual(p.downloads[2], []);
});

test('많은 결과에는 전체 건수·첫 다섯 구절을 표시하고 한글 조합이 끝난 검색어로 좁힌다', t => {
  const texts = Array.from({length:7}, (_, i) => i === 6 ? '수정된 일정이다. '.repeat(15) + '화요일 회의에서 설명했다.' : '월요일 회의에서 현황을 설명했다.');
  const p = screen(t, [], undefined, false, texts);
  const row = p.row(0), preview = p.get('preview', row), target = p.get('target', row);
  p.edit(0, 'target', '회의');
  assert.match(preview.textContent, /검색한 구절 7개.*처음 5개/);
  assert.equal(preview.querySelectorAll('button').length, 5);
  const w = target.ownerDocument.defaultView;
  assert.equal(target.inputMode, 'text');
  target.value = '화요일 회';
  target.dispatchEvent(new w.InputEvent('input', {isComposing:true}));
  assert.equal(preview.textContent, '');
  target.value = '회의 화요일';
  target.dispatchEvent(new w.CompositionEvent('compositionend'));
  assert.match(preview.textContent, /검색한 구절 1개.*10번.*화요일 회의/);
  p.edit(0, 'target', '３');
  assert.equal(preview.querySelector('button'), null);
  assert.match(preview.textContent, /수정본 3번.*미결/);
});

test('다른 구절에 남은 미완성 판단은 저장 전 열어 주며 불완전한 입력과 기존 기록을 함께 보존한다', async t => {
  const saved = {before:0, after:0, status:'retained', reason:'300가구가 원문과 같다.'};
  const p = screen(t, [saved]);
  p.edit(1, 'state', 'changed');
  p.edit(1, 'target', '3');
  await p.save();
  assert.deepEqual(p.downloads, []);
  assert.match(p.get('feedback').textContent, /원본 2번.*이유/);
  assert.equal(p.doc.activeElement, p.get('reason', p.row(1)));
  assert.equal(p.doc.activeElement.getAttribute('aria-describedby'), p.get('feedback').id);
  assert.equal(p.row(1).open && p.row(1).parentElement.open, true);
  assert.equal(p.get('target', p.row(1)).value, '3');
  p.edit(1, 'reason', '공고일과 시행일의 차이가 생겼다.');
  assert.equal(p.get('reason', p.row(1)).hasAttribute('aria-invalid'), false);
  await p.save();
  assert.equal(p.downloads[0][1].status, 'changed');
  assert.deepEqual(p.downloads[0][0], saved);
  p.edit(1, 'state', 'notFound');
  assert.equal(p.get('target', p.row(1)).value, '');
  assert.equal(p.get('target', p.row(1)).disabled, true);
  p.edit(1, 'reason', '수정본 전문에서 당초의 시행일을 찾지 못했다.');
  await p.save();
  assert.equal(p.downloads[1][1].after, null);
  assert.match(p.get('summary').textContent, /내용 변경 0개.*대응 구절을 찾지 못함 1개/);
  p.get('clear', p.row(1)).click();
  await p.save();
  assert.deepEqual(p.downloads[2], [saved]);
  assert.match(p.get('summary').textContent, /검토 남음 1개/);
});

test('미결 구절·존재하지 않는 번호·판단 없는 메모에서 유지 확인을 자동 추정하지 않는다', async t => {
  const p = screen(t);
  p.edit(0, 'reason', '내용은 같다.');
  await p.save();
  assert.equal(p.doc.activeElement, p.get('state', p.row(0)));
  p.edit(0, 'state', 'retained');
  for (const number of ['0', '4', '1.5', '1e0', '3']) {
    p.edit(0, 'target', number);
    await p.save();
    assert.deepEqual(p.downloads, []);
    assert.equal(p.doc.activeElement, p.get('target', p.row(0)));
  }
  assert.match(p.get('feedback').textContent, /두 편집자.*구절 전체/);
  p.edit(0, 'target', '1');
  p.edit(0, 'reason', '···');
  await p.save();
  assert.equal(p.doc.activeElement, p.get('reason', p.row(0)));
  assert.match(p.get('feedback').textContent, /원본 1번.*이유/);
  p.edit(0, 'target', '3');
  p.edit(0, 'reason', '내용은 같다.');
  p.edit(0, 'state', 'open');
  await p.save();
  assert.deepEqual(p.downloads[0], [{before:0, after:2, status:'open', reason:'내용은 같다.'}]);
  assert.match(p.get('summary').textContent, /진행자가 유지 확인 0개.*검토 남음 2개/);
});

test('다운로드가 실패해도 작성한 메모와 이전 집계를 보존하고 덧쓴 내용을 다시 저장한다', async t => {
  let attempts = 0, downloaded;
  const p = screen(t, [], entries => {
    if (++attempts === 1) throw new Error('다운로드 준비 실패');
    downloaded = entries;
  });
  p.edit(0, 'state', 'notFound');
  p.edit(0, 'reason', '수정본에서 300가구를 찾지 못했다.');
  await p.save();
  assert.match(p.get('feedback').textContent, /다운로드 준비 실패/);
  assert.match(p.get('summary').textContent, /찾지 못함 0개.*검토 남음 2개/);
  assert.match(p.get('reason', p.row(0)).value, /300가구/);
  assert.equal(p.get('save').disabled, false);
  p.edit(0, 'reason', '본문과 주석을 대조하고 300가구를 찾지 못했다.');
  await p.save();
  assert.equal(downloaded[0].reason, p.get('reason', p.row(0)).value);
  assert.match(p.get('summary').textContent, /찾지 못함 1개.*검토 남음 1개/);
});

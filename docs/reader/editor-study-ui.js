(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const core = window.JournalEditorStudy, cases = window.JournalStudyCases;
  const stageLabels = {select:'자료 선택', locate:'근거 위치 확인', decide:'판정 기록'};
  // coordinator-only:begin
  const verdictLabels = {supported:'근거로 지지됨', contradicted:'근거와 충돌', insufficient:'근거 불충분', opinion:'의견·가치판단'};
  const variantLabels = {A:'보수 성향 표기', B:'진보 성향 표기'};
  // coordinator-only:end
  const stageButtons = [...document.querySelectorAll('[data-phase]')];
  const participantOnly = document.documentElement.hasAttribute('data-participant-kit');
  let storeKey = participantOnly ? null : 'journal-editor-study-workspace-v1';
  // coordinator-only:begin
  const collectionType = 'journal-editor-study-collection-v1';
  // coordinator-only:end
  const invitePattern = /^J1-([1-9]\d{0,8})-(E[A-F0-9]{16})$/;
  let records = [], invitations = [], session = null, viewKind = 'editor';
  let frame = null, frameNonce = null, liveStart = null, storageVersion = null, storageLocked = false;
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function message(id, text, error = false) {
    const n = el(id);
    n.textContent = text;
    n.classList.toggle('error', error);
  }
  if (!core || !cases) {
    message('global-status', '실험 구성 파일을 불러오지 못했습니다. 연구용 폴더 안에서 이 화면을 여세요.', true);
    return;
  }
  const localKit = participantOnly ? core.kitVersion(document.querySelector('meta[name="journal-editor-kit"]')?.content) : null;
  const clock = () => performance.now();
  const idBytes = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  function sampleIndex(length) {
    const limit = Math.floor(256 / length) * length;
    let value;
    do { value = crypto.getRandomValues(new Uint8Array(1))[0]; } while (value >= limit);
    return value % length;
  }
  function currentRecord() { return records.find(r => r.participantId === session?.id); }
  function assignment() { const r = currentRecord(); return core.plan(r.ordinal)[r.trials.length]; }
  function stimulus() { const a = assignment(); return cases.get(a.caseId, a.variant); }
  function dropFrame() {
    frame = null;
    frameNonce = null;
    el('frame-host').replaceChildren();
  }
  function persist() {
    if (storageLocked || !storeKey) return;
    try {
      const prior = localStorage.getItem(storeKey);
      if (prior !== storageVersion) {
        storageLocked = true;
        message('global-status', '다른 탭에서 기록이 바뀌었습니다. 이 탭의 진행 상황은 ‘내 이어하기 파일 저장’으로 보관하세요.', true);
        return;
      }
      if (session?.state === 'running' && liveStart !== null) bankTime();
      const json = JSON.stringify({records, invitations, session});
      localStorage.setItem(storeKey, json);
      storageVersion = json;
    } catch (_) {
      message('global-status', session
        ? '브라우저 저장이 제한되어 있습니다. 진행 중에는 ‘내 이어하기 파일 저장’을, 완료·중단 후에는 ‘내 참여 기록 내려받기’를 누르세요.'
        : '브라우저 저장이 제한되어 있습니다. 창을 닫기 전에 모은 기록을 파일로 내려받으세요.', true);
    }
  }
  function restoreWorkspace() {
    try {
      storageVersion = localStorage.getItem(storeKey);
      if (storageVersion) {
        const saved = JSON.parse(storageVersion);
        if (!Array.isArray(saved.records) || saved.records.some(r => r?.kind !== 'editor')) throw new Error();
        const restored = core.mergeRecords([], saved.records);
        let roster = mergeInvitations([], saved.invitations ?? []);
        const current = restored.find(r => r.participantId === saved.session?.id);
        if (saved.session && !current) throw new Error();
        if (current) {
          // Older workspaces could retain the confirmed withdrawal only in the current local session.
          if (saved.session.state === 'withdrawn' && current.trials.length < 4) current.withdrawn = true;
          if (current.withdrawn) saved.session.state = 'withdrawn';
          if (current.trials.length === 4) saved.session.state = 'done';
        }
        if (!participantOnly && current && !onRoster(roster, current.ordinal, current.participantId)) {
          // Older shared-device workspaces kept their locally enrolled session but no roster entry.
          roster = mergeInvitations(roster, [registration(current.ordinal, current.participantId, true)]);
        }
        checkRosterConflicts(restored, roster);
        records = restored; invitations = roster; session = saved.session;
        if (session && ['running','paused','interrupted'].includes(session.state) &&
            !Object.hasOwn(session, 'recoveredMs') && !session.phaseMs) {
          // Older timers without phase data could include an unknown wall-clock recovery interval.
          session.recoveredMs = session.activeMs;
        }
        if (session?.state === 'running') session.state = 'interrupted';
      }
    } catch (_) {
      if (storageVersion) storageLocked = true;
      message('global-status', '기기에 보관된 상태를 읽지 못했습니다. 내려받은 JSON을 가져오거나 다른 브라우저에서 시작하세요.', true);
    }
  }
  if (!participantOnly) restoreWorkspace();
  window.addEventListener('storage', event => {
    if (event.key === storeKey && event.newValue !== storageVersion) {
      storageLocked = true;
      message('global-status', '다른 탭에서 저장한 기록이 있습니다. 이 탭에서 작성한 내용은 파일로 보관하고 한 탭에서만 계속하세요.', true);
    }
  });
  function download(data, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
    const a = node('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function exportSelf() {
    const r = currentRecord();
    if (r) download(r, 'journal-editor-' + r.participantId + '.json');
  }
  function recoveryNote(timer) {
    if (timer.partialTime || !(timer.recoveredMs > 0)) return '';
    const seconds = (timer.recoveredMs / 1000).toLocaleString('ko-KR', {maximumFractionDigits:3});
    return ' 전체 시간에는 타이머로 직접 측정했는지 확인할 수 없는 이전 구간 ' + seconds + '초가 포함됩니다.';
  }
  function exportResume() {
    try {
      const r = currentRecord();
      if (!r || r.withdrawn || r.trials.length === 4) return;
      if (session.state === 'running') bankTime();
      const data = window.JournalEditorResume.create(r, session);
      download(data, 'journal-resume-' + r.participantId + '.json');
      persist();
      message('transfer-status', '새 기기에서 초대 코드 J1-' + r.ordinal + '-' + r.participantId +
        '로 등록한 뒤 파일을 여세요.' + (session.state === 'running' ? ' 이번 과제는 측정한 시간만 이어집니다.' : recoveryNote(data.session)));
    } catch (err) { message('transfer-status', err.message, true); }
  }
  function canOpenResume() {
    return participantOnly && session?.state === 'ready';
  }
  async function openResume(event) {
    const [file] = event.target.files;
    event.target.value = '';
    if (!file || !canOpenResume()) return;
    const current = currentRecord();
    try {
      const data = JSON.parse(await file.text());
      if (!canOpenResume() || currentRecord() !== current) throw new Error('과제 상태가 바뀌었습니다. 현재 기록을 확인하세요.');
      const {record, session:next} = window.JournalEditorResume.read(data, current);
      if (record.trials.length < current.trials.length) throw new Error('이 기기에 더 많은 응답이 있습니다. 최근 파일을 선택하세요.');
      if (session.partialTime && record.trials.length === current.trials.length && !next.partialTime) {
        throw new Error('이 기기에서 이미 일부 측정으로 기록한 과제입니다. 현재 기록에서 계속하세요.');
      }
      const nextRecords = core.mergeRecords(records, [record]);
      // Recheck the version after the asynchronous file read before replacing anything shown here.
      if (!storageLocked) {
        try { storageLocked = localStorage.getItem(storeKey) !== storageVersion; }
        catch (_) { /* Browser storage may be disabled. Files can still be used in this tab. */ }
      }
      if (storageLocked) throw new Error('다른 탭의 기록이 있거나 기기 기록을 읽을 수 없습니다. 기존 기록을 확인하세요.');
      records = nextRecords; session = next;
      liveStart = null; dropFrame(); persist(); renderParticipant();
      const ended = next.state === 'done' || next.state === 'withdrawn';
      message('transfer-status', '제출한 응답 ' + record.trials.length + '건을 열었습니다.' +
        (next.partialTime ? ' 현재 과제는 시간 일부만 확인할 수 있어 전체 시간 비교에서 제외합니다.' : ''));
      el(ended ? 'ended-heading' : next.state === 'paused' ? 'resume-trial' : 'trial-heading').focus();
    } catch (err) { message('transfer-status', '열지 못했습니다. ' + err.message, true); }
  }
  function fmt(n) { return Number(n.toFixed(1)).toLocaleString('ko-KR'); }
  // coordinator-only:begin
  const percent = (a, b) => b ? fmt(100 * a / b) + '%' : '—';
  const ratio = (a, b) => b ? percent(a, b) + ' (' + a + '/' + b + ')' : '— (0/0)';
  function table(target, heads, rows, empty) {
    const wrap = typeof target === 'string' ? el(target) : target;
    wrap.replaceChildren();
    if (!rows.length) { wrap.append(node('p', empty, 'subtle')); return; }
    const tbl = node('table'), head = tbl.createTHead().insertRow(), body = tbl.createTBody();
    for (const s of heads) { const c = node('th', s); c.scope = 'col'; head.append(c); }
    for (const row of rows) {
      const tr = body.insertRow();
      row.forEach((s, i) => {
        const c = node(i ? 'td' : 'th', s);
        if (i === 0) c.scope = 'row';
        tr.append(c);
      });
    }
    wrap.append(tbl);
  }
  // coordinator-only:end
  function metric(title, value, pair, unit, caption) {
    const box = node('section', undefined, 'metric');
    box.append(node('h2', title), node('p', value ?? '측정 대기', 'value'));
    const max = pair ? Math.max(...pair, 1) : 1;
    ['원자료', '저널'].forEach((label, i) => {
      const row = node('div', undefined, 'compare'), track = node('span', undefined, 'track'), bar = node('span', undefined, 'bar' + (i ? ' tool' : ''));
      bar.style.width = (pair ? 100 * pair[i] / max : 0) + '%'; track.append(bar);
      row.append(node('span', label), track, node('span', pair ? fmt(pair[i]) + unit : '—')); box.append(row);
    });
    box.append(node('small', caption)); return box;
  }
  // coordinator-only:begin
  function showInvitations() {
    el('export-all').disabled = !records.length && !invitations.length;
    table('invites', ['발급 묶음', '전달할 초대 코드', '이 기기 수집 상태'], invitations.filter(inv => !inv.atDevice).map(inv => [
      String(Math.ceil(inv.ordinal / 4)), inv.code,
      records.some(r => r.participantId === inv.id) ? '기록 있음' : '기록 대기'
    ]), '발급된 초대 코드가 없습니다.');
  }
  function caseSource(source, title) {
    const part = node('section', undefined, 'source');
    part.append(node('strong', title), node('small', source.version + ' · ' + source.locator), node('p', source.excerpt, 'excerpt'));
    return part;
  }
  function showSourceChoices(box, article, choices) {
    const detail = node('details', undefined, 'case-source-choices');
    detail.append(node('summary', '정당 표기별 자료 선택 건수'),
      node('p', '자료 선택 격차에는 자료를 지정하지 않은 응답도 포함합니다. 보수·진보 표기에서 각 선택의 비율이 같으면 0%p, 겹치는 선택이 없으면 100%p입니다. 표기마다 다른 사람이 답하므로 응답 수를 함께 보세요.'));
    const {A, B} = choices.byVariant;
    const cells = [A.manual, B.manual, A.journal, B.journal];
    const rows = article.sources.map(source => [
      source.title + (article.expectedSourceIds.includes(source.id) ? ' (기준 근거)' : ''),
      ...cells.map(cell => cell.byId[source.id] + '/' + cell.total)
    ]);
    rows.push(['지정한 자료 없음', ...cells.map(cell => cell.none + '/' + cell.total)]);
    const wrap = node('div', undefined, 'scroll');
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', article.title + ' 표기·방식별 자료 선택 건수');
    table(wrap, ['선택한 자료', '원자료 · 보수', '원자료 · 진보', '저널 · 보수', '저널 · 진보'], rows);
    detail.append(wrap);
    box.append(detail);
  }
  function showAlternativeSources(box, article, choices) {
    const {manual, journal} = choices;
    const selected = article.sources.filter(s => !article.expectedSourceIds.includes(s.id) &&
      (manual.byId[s.id] > 0 || journal.byId[s.id] > 0));
    if (!selected.length && !manual.none && !journal.none) return;
    const counts = (m, j) => '원자료 방식 ' + m + '/' + manual.total + ' · 저널 방식 ' + j + '/' + journal.total;
    const alternatives = node('details', undefined, 'case-alternatives');
    alternatives.append(node('summary', '대표 근거와 다른 선택 보기'),
      node('p', '두 정당 표기를 합친 결과입니다. 각 방식의 전체 응답 중 해당 자료를 고른 건수를 표시합니다.', 'subtle'));
    for (const source of selected) {
      const part = caseSource(source, source.title);
      part.append(node('small', counts(manual.byId[source.id], journal.byId[source.id])));
      alternatives.append(part);
    }
    if (manual.none || journal.none) alternatives.append(node('p', '지정한 자료 없음 · ' + counts(manual.none, journal.none)));
    box.append(alternatives);
  }
  function showCaseQuality(bias, biasCard) {
    const list = el('case-quality-list');
    list.replaceChildren();
    el('case-quality').hidden = !bias;
    if (!bias) return;
    const criteria = {correct:'기준 판정 일치', citationCorrect:'대표 근거 일치', qualityCorrect:'판정·근거 동시 일치'};
    const warnings = node('div', undefined, 'case-cautions');
    for (const row of bias.cases) {
      const a = cases.get(row.caseId, 'A'), b = cases.get(row.caseId, 'B');
      const box = node('details', undefined, 'case-evidence');
      box.id = 'cue-case-' + row.caseId;
      const gaps = row.sourceChoices.gapPp;
      const summary = node('summary', a.title + ' (원자료 → 저널) · 사실 채택률 격차 ' +
        fmt(Math.abs(row.manual.signedGapPp)) + '%p → ' + fmt(Math.abs(row.journal.signedGapPp)) + '%p · 자료 선택 격차 ' +
        fmt(gaps.manual) + '%p → ' + fmt(gaps.journal) + '%p');
      box.append(summary);
      if (viewKind === 'demo') box.append(node('p', '가상 응답으로 계산한 예시입니다.', 'subtle'));
      if (row.qualityDrops.length) {
        const changes = row.qualityDrops.map(key => criteria[key] + ' ' +
          ratio(row.quality.manual[key], row.quality.manual.total) + ' → ' + ratio(row.quality.journal[key], row.quality.journal.total));
        const changeNote = node('div', undefined, 'notice sample');
        const changeList = node('ul', undefined, 'case-changes');
        changeList.append(...changes.map(text => node('li', text)));
        changeNote.append(node('strong', '두 표기를 합쳐 보았을 때 낮아진 지표'), changeList);
        box.append(changeNote);
        const open = node('button', a.title + ' · 기준과 근거 확인');
        open.type = 'button';
        open.setAttribute('aria-controls', box.id);
        open.addEventListener('click', () => { box.open = true; summary.focus(); });
        warnings.append(open);
      }
      const wrap = node('div', undefined, 'scroll');
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', a.title + ' 표기·방식별 일치율');
      const rows = [];
      for (const [variant, label] of Object.entries(variantLabels)) {
        for (const [method, methodLabel] of [['manual','원자료'], ['journal','저널']]) {
          const cell = row.quality.byVariant[variant][method];
          const responses = row[method][variant];
          const choices = Object.entries(verdictLabels).filter(([key]) => responses.counts[key] > 0)
            .map(([key, verdict]) => verdict + ' ' + responses.counts[key] + '/' + responses.total);
          rows.push([label + ' · ' + methodLabel, ...Object.keys(criteria).map(key => ratio(cell[key], cell.total)), choices.join(' · ')]);
        }
      }
      table(wrap, ['기사 표기 · 방식', ...Object.values(criteria), '제출한 판정'], rows);
      box.append(wrap);
      showSourceChoices(box, a, row.sourceChoices);
      box.append(node('h3', '검토한 기사와 근거'), node('p', a.question),
        node('blockquote', a.article), node('blockquote', b.article), node('strong', '기준 판정 · ' + verdictLabels[a.expectedVerdict]));
      for (const source of a.sources.filter(s => a.expectedSourceIds.includes(s.id))) {
        box.append(caseSource(source, '대표 근거 · ' + source.title));
      }
      showAlternativeSources(box, a, row.sourceChoices);
      list.append(box);
    }
    if (warnings.childElementCount) {
      warnings.prepend(node('p', '아래 기사에서는 표기별 사실 채택률 격차가 줄고, 검증 지표 중 하나 이상에서 일치율도 낮아졌습니다.'));
      biasCard.append(warnings);
    }
  }
  function showTimingCoverage(a) {
    const c = a.timing.partialTrials ? a.timingCoverage : null;
    el('timing-coverage').hidden = !c;
    el('timing-coverage-summary').textContent = c ? '네 명 모두 과제를 마친 묶음의 ' + c.total + '명 중 단축 ' + c.faster +
      '명 · 동일 ' + c.unchanged + '명 · 증가 ' + c.slower + '명 · 미확정 ' + c.unknown + '명' : '';
    let range = '';
    if (c) {
      const low = fmt(100 * c.faster / c.total), high = fmt(100 * c.possibleFaster / c.total);
      range = c.faster === c.possibleFaster ? c.faster + '명 (' + low + '%)' :
        c.faster + '~' + c.possibleFaster + '명 (' + low + '~' + high + '%)';
    }
    el('timing-coverage-range').textContent = c ? '이 ' + c.total + '명 중 검토 시간이 줄어든 인원은 ' + range + '입니다.' : '';
  }
  function showTimedQuality(a) {
    const q = a.timedQuality;
    el('timed-quality-sample').textContent = '판정 비교에 포함된 ' + a.included + '명 중 시간까지 기록된 4인 묶음의 ' +
      a.timing.included + '명을 비교합니다. 판정과 대표 근거가 모두 맞으면 성공입니다. 성공 1건당 총투입 시간은 실패에 쓴 시간까지 더해 성공 건수로 나눈 값입니다.';
    const warnings = [], rows = [];
    let change = '', editors = '';
    if (q) {
      const arms = [q.manual, q.journal];
      const outcomeMean = (seconds, count) => count ? seconds.toLocaleString('ko-KR', {maximumFractionDigits:3}) + '초 (' + count + '건)' : '산출 불가 (0건)';
      rows.push(['검토 시간 합계', ...arms.map(v => fmt(v.elapsedMs / 1000) + '초')],
        ['기준 판정 일치', ...arms.map(v => ratio(v.correct, v.total))],
        ['대표 근거 일치', ...arms.map(v => ratio(v.citationCorrect, v.total))],
        ['판정과 근거 모두 일치', ...arms.map(v => ratio(v.verified, v.total))],
        ['근거 없는 사실 채택¹', ...arms.map(v => ratio(v.unsafe, v.unsafeTotal))],
        ['검증 성공 1건당 총투입 시간', ...arms.map(v => v.verified ? fmt(v.secondsPerVerified) + '초' : '산출 불가 (성공 0건)')],
        ['성공한 과제의 평균 시간', ...arms.map(v => outcomeMean(v.meanVerifiedSeconds, v.verified))],
        ['실패한 과제의 평균 시간', ...arms.map(v => outcomeMean(v.meanFailedSeconds, v.total - v.verified))]);
      for (const [key, label] of [['correct', '기준 판정 일치율'], ['citationCorrect', '대표 근거 일치율'], ['verified', '판정·근거 동시 일치율']]) {
        const drop = 100 * (q.manual[key] / q.manual.total - q.journal[key] / q.journal.total);
        if (drop > 0) warnings.push(label + ' ' + fmt(drop) + '%p 하락');
      }
      if (q.journal.unsafeTotal && q.manual.unsafeTotal) {
        const rise = 100 * (q.journal.unsafe / q.journal.unsafeTotal - q.manual.unsafe / q.manual.unsafeTotal);
        if (rise > 0) warnings.push('근거 없는 사실 채택률 ' + fmt(rise) + '%p 상승');
      }
      const d = q.perVerified;
      if (d.savedSeconds === null) change = '한쪽 이상에서 검증 성공이 0건이어서 성공 1건당 총투입 시간 차이를 계산할 수 없습니다.';
      else if (d.savedSeconds === 0) change = '두 방식의 검증 성공 1건당 총투입 시간이 같습니다.';
      else change = '저널을 썼을 때 검증 성공 1건당 총투입 시간이 ' + fmt(Math.abs(d.savedSeconds)) + '초(' +
        fmt(Math.abs(d.reductionPct)) + '%) ' + (d.savedSeconds > 0 ? '줄었습니다.' : '늘었습니다.');
      const f = q.faster;
      editors = f.total ? '더 빨라진 편집자 ' + f.total + '명 중 검증 성공 건수가 줄어든 사람은 ' + f.fewerVerified +
        '명, 같은 사람은 ' + f.sameVerified + '명, 늘어난 사람은 ' + f.moreVerified + '명입니다.' : '두 과제의 평균 검토 시간이 줄어든 편집자는 없습니다.';
      if (f.total) {
        const [none, one, both] = q.fasterJournalSuccessCounts;
        editors += ' 빨라진 ' + f.total + '명 중 저널 과제에서 판정과 대표 근거를 모두 맞힌 횟수는 0건 ' +
          none + '명, 1건 ' + one + '명, 2건 ' + both + '명입니다.';
      }
    }
    const warning = el('timed-quality-warning');
    warning.hidden = !warnings.length;
    warning.textContent = warnings.length ? '시간을 비교한 ' + a.timing.included + '명이 저널을 썼을 때 원자료 대비 ' + warnings.join(', ') + '.' : '';
    table('timed-quality-table', ['지표', '원자료', '저널'], rows, '네 명 모두 시간을 기록한 묶음이 생기면 결과가 표시됩니다.');
    el('timed-quality-change').hidden = !q;
    el('timed-quality-change').textContent = change;
    el('timed-quality-editors').hidden = !q;
    el('timed-quality-editors').textContent = editors;
    if (q) el('timed-quality-table').append(node('p', '¹ 기준 판정이 반박·근거 불충분·의견인 과제 중 ‘근거로 지지됨’을 고른 비율입니다.', 'subtle'));
  }
  function showEditions(records, kind) {
    const {blocks, editions} = core.analyzeEditions(records, kind);
    const states = {verified:'같은 판본 확인', mixed:'여러 판본 확인', unknown:'판본 미확인', incomplete:'미완료'};
    const count = state => blocks.filter(block => block.state === state).length;
    el('edition-coverage').textContent = blocks.length
      ? Object.entries(states).map(([key, label]) => label + ' ' + count(key) + '묶음').join(' · ')
      : '명부에서 확인한 참여 기록을 기다리고 있습니다.';
    const container = el('edition-tables');
    container.replaceChildren();
    el('edition-success-note').hidden = !editions.length;
    if (!editions.length) container.append(node('p', '처음 배정된 네 명이 같은 판본으로 네 과제씩 마치면 이곳에서 해당 판본의 결과를 볼 수 있습니다.', 'subtle'));
    for (const {kitVersion, blockNumbers, analysis} of editions) {
      const {time, bias, quality, timing, timedQuality} = analysis;
      const section = node('section'), grid = node('div', undefined, 'scroll');
      const duration = x => fmt(x) + '초', points = x => fmt(x) + '%p';
      const change = (x, unit) => x === 0 ? '변화 없음' : fmt(Math.abs(x)) + unit + (x > 0 ? ' 감소' : ' 증가');
      const gapChange = change(bias.reductionPp, '%p') + (bias.reductionPct === null
        ? ' (원자료 격차 0%p로 상대율 계산 불가)' : ' (원자료 대비 ' + fmt(Math.abs(bias.reductionPct)) + '%)');
      section.append(node('h3', kind === 'demo' ? '가상 참여자 자료 A' : '참여자 자료 ' + kitVersion.slice(0, 12)),
        node('p', '배정 묶음 ' + blockNumbers.join(', ') + '번 · 판정 ' + analysis.included + '명 ' + analysis.trialCount +
          '건 · 시간 비교 ' + timing.included + '명 ' + timing.trialCount + '건'), grid);
      const arms = [quality.manual, quality.journal];
      const joint = arm => arm.qualityCorrect / arm.total;
      const jointDiff = 100 * (joint(quality.journal) - joint(quality.manual));
      const jointChange = jointDiff === 0 ? '변화 없음' : fmt(Math.abs(jointDiff)) + '%p ' + (jointDiff > 0 ? '상승' : '하락');
      const perSuccess = method => {
        if (!timedQuality) return '—';
        const arm = timedQuality[method];
        return (arm.verified ? duration(arm.secondsPerVerified) : '산출 불가') + ' (성공 ' + arm.verified + '/' + arm.total + '건)';
      };
      const successChange = timedQuality?.perVerified.reductionPct;
      table(grid, ['지표', '원자료', '저널', '저널 사용 시 차이'], [
        ['사례당 평균 검토 시간', time ? duration(time.manualSeconds) : '—', time ? duration(time.journalSeconds) : '—',
          time ? change(time.reductionPct, '%') : '전체 시간이 기록된 묶음 대기'],
        ['검증 성공 1건당 총투입 시간', perSuccess('manual'), perSuccess('journal'),
          successChange != null ? change(successChange, '%') : timedQuality ? '성공 건수 부족' : '전체 시간이 기록된 묶음 대기'],
        ['판정과 대표 근거 모두 일치', ...arms.map(arm => ratio(arm.qualityCorrect, arm.total)), jointChange],
        ['정당 표기별 사실 채택률 격차', points(bias.manualGapPp), points(bias.journalGapPp), gapChange]
      ]);
      if (kind !== 'demo') {
        const details = node('details');
        details.append(node('summary', '자료 식별값 전체 보기'), node('p', kitVersion));
        section.append(details);
      }
      container.append(section);
    }
    el('edition-blocks').hidden = !blocks.length;
    table('edition-block-table', ['배정 묶음', '제출한 과제의 판본'], blocks.map(b => [
      b.block + '번', states[b.state] + (b.kitVersion ? ' · ' + (kind === 'demo' ? '가상 자료 A' : b.kitVersion.slice(0, 12)) : '')
    ]), '');
  }
  function showDashboard() {
    const demo = viewKind === 'demo';
    const confirmed = records.filter(r => onRoster(invitations, r.ordinal, r.participantId));
    let sample = confirmed;
    if (demo) {
      const examples = {complete:core.demoRecords, partial:core.partialTimeDemoRecords,
        agreement:core.cueAgreementDemoRecords, missing:core.missingCueDemoRecords, editions:core.editionDemoRecords};
      sample = examples[el('demo-example').value]();
    }
    const a = core.analyze(sample, viewKind);
    el('edition-results').hidden = demo && el('demo-example').value !== 'editions';
    if (!el('edition-results').hidden) showEditions(sample, viewKind);
    el('demo-options').hidden = !demo;
    el('real-view').setAttribute('aria-pressed', String(!demo));
    el('demo-view').setAttribute('aria-pressed', String(demo));
    el('data-notice').textContent = demo ? '가상 수치 예시 · 계산 방법을 보여 주기 위해 만든 응답과 시간입니다. 실제 편집자 집계에는 들어가지 않습니다.'
      : a.completeBlocks ? '기사 편집·검증 업무를 수행한다고 본인이 응답한 참여자의 기록입니다. 시간과 판정의 관측값은 완성된 배정 묶음에서 계산했습니다.'
      : '실제 참여 기록 · 완성된 4인 묶음이 생기면 시간과 판정 차이를 표시합니다.';
    if (a.completeBlocks > 0 && a.completeBlocks <= 2) el('data-notice').textContent += ' 사례·방식·정당 표기별 응답은 각 ' + a.completeBlocks + '명으로, 한 사람의 응답에도 격차가 크게 바뀝니다.';
    if (!demo && a.completeBlocks) el('data-notice').textContent += ' 상단의 두 지표는 자료 판본을 구분하지 않고 계산했습니다. 특정 배포본의 수치는 바로 아래에서 확인하세요.';
    if (demo && el('demo-example').value === 'editions') el('data-notice').textContent += ' 상단은 8명을 합친 값입니다. 판본별 표에는 같은 자료를 쓴 첫 4명이 포함됩니다.';
    if (!demo && confirmed.length < records.length) el('data-notice').textContent +=
      ' 명부 미확인 ' + (records.length - confirmed.length) + '명은 보관 중입니다. 아래에서 원래 명부나 개별 배정 코드를 확인하세요.';
    el('data-notice').classList.toggle('sample', demo);
    el('counts').replaceChildren(...['등록 ' + a.enrolled + '명', '4과제 완료 ' + a.completed + '명',
      '분석 ' + a.included + '명 · ' + a.trialCount + '건', '분석 미포함 ' + a.excluded + '명',
      '중단 확인 ' + a.withdrawn + '명', '완성 ' + a.completeBlocks + '묶음'].map(s => node('span', s)));
    const work = a.withdrawalWork;
    el('withdrawal-work').hidden = !a.withdrawn;
    el('withdrawal-counts').textContent = '과제 시작 전 또는 과제 사이 중단 ' + work.betweenTasks +
      '명 · 중단 당시 과제 시작 여부를 알 수 없는 예전 기록 ' + work.unknown + '명';
    const workRows = Object.entries(work.byMethod).filter(([, v]) => v.tasks).map(([method, v]) => [
      method === 'manual' ? '원자료' : '저널', String(v.tasks), (v.elapsedMs / 1000).toLocaleString('ko-KR'), String(v.partial)
    ]);
    table('withdrawal-table', ['검토 방식','중단 과제 수','확인된 시간 합계(초)','시간이 일부만 남은 과제 수'], workRows,
      '시작한 뒤 중단했다고 확인된 과제가 없습니다.');
    const t = a.time, b = a.bias;
    const timeTitle = t && t.reductionPct < 0 ? '검토 시간 증가율' : '검토 시간 절감률';
    const biasTitle = !b ? '정당 표기별 사실 채택률 격차' : '정당 표기별 사실 채택률 격차 ' +
      (b.reductionPp > 0 ? '감소' : b.reductionPp < 0 ? '증가' : '변화 없음');
    const timeCard = metric(timeTitle, t && fmt(Math.abs(t.reductionPct)) + '%', t && [t.manualSeconds, t.journalSeconds], '초',
      t ? '사례당 평균 ' + fmt(Math.abs(t.savedSeconds)) + '초 ' + (t.savedSeconds >= 0 ? '단축' : '증가') : '사례 1건의 평균 검토 시간');
    if (a.timing.partialTrials) timeCard.append(node('small', '시간 비교 ' + a.timing.included + '명 · ' +
      a.timing.trialCount + '건. 전체 시간이 불명확한 ' + a.timing.partialTrials + '건에서 확인한 시간은 합계 ' +
      fmt(a.timing.observedMs / 1000) + '초입니다. 해당 과제가 있는 묶음은 평균 시간 계산에서 제외했습니다.'));
    if (t) {
      const median = t.medianSavedSeconds;
      const change = median === 0 ? '차이 없음' : fmt(Math.abs(median)) + '초 ' + (median > 0 ? '단축' : '증가');
      timeCard.append(node('small', '편집자별 시간 차이의 중앙값 ' + change),
        node('small', '단축 ' + t.fasterEditors + '명 · 동일 ' + t.unchangedEditors + '명 · 증가 ' + t.slowerEditors + '명'));
    }
    const biasCard = metric(biasTitle, b && fmt(Math.abs(b.reductionPp)) + '%p', b && [b.manualGapPp, b.journalGapPp], '%p',
      !b ? '성향 표지만 다른 두 조건의 사실 채택률 차이' : b.reductionPct == null ? '원자료 차이 0%p · 상대 감소율 산출 불가'
        : '원자료 차이 대비 ' + fmt(Math.abs(b.reductionPct)) + '% ' + (b.reductionPct >= 0 ? '감소' : '증가'));
    const range = b?.leaveOneBlockOut;
    if (range) {
      biasCard.append(node('small', '완성 ' + range.blocks + '묶음 중 하나씩 제외한 격차 감소폭 ' +
        fmt(range.minReductionPp) + '%p ~ ' + fmt(range.maxReductionPp) + '%p. 음수는 격차 증가입니다.'),
        node('small', '참여자 구성에 따른 변동 범위입니다. 통계적 신뢰구간이나 인과 효과를 추정하려면 별도 분석이 필요합니다.'));
    } else {
      biasCard.append(node('small', '완성 ' + a.completeBlocks + '묶음 · 하나씩 제외한 범위는 2묶음부터 계산합니다.'));
    }
    showCaseQuality(b, biasCard);
    el('metrics').replaceChildren(timeCard, biasCard);
    const bounds = a.missingAnswerBounds;
    el('missing-answer-sample').textContent = bounds
      ? '네 명의 등록 기록을 모두 확인한 ' + bounds.registeredBlocks + '묶음 · 제출 ' + bounds.submitted + '/' + bounds.assigned +
        '건 · 미제출 ' + bounds.missing + '건 (참여 중단 뒤 남은 과제 포함)'
      : '계산하려면 같은 배정 묶음 네 명의 등록 기록이 필요합니다.';
    const excludedBlocks = a.blocks.length - (bounds?.registeredBlocks || 0);
    if (excludedBlocks) el('missing-answer-sample').textContent += ' · 등록 기록이 일부만 있는 ' + excludedBlocks +
      '묶음 제외 (제출 ' + (a.recordedTrials - (bounds?.submitted || 0)) + '건)';
    if (!demo) {
      const issued = invitations.filter(inv => !inv.atDevice);
      const returned = new Set(confirmed.filter(record => record.kind === 'editor').map(record => record.ordinal));
      const pending = issued.filter(inv => !returned.has(inv.ordinal)).length;
      if (pending) el('missing-answer-sample').textContent += ' · 발급 코드 ' + issued.length + '개 중 등록 기록 미수신 ' +
        pending + '개 (참여 여부 미확인)';
    }
    const amount = el('missing-answer-range');
    amount.textContent = '';
    if (bounds) {
      if (bounds.missing) {
        amount.textContent = '모든 배정 과제에 답했다고 가정할 때 격차 감소폭은 ' + fmt(bounds.minReductionPp) + '%p ~ ' +
          fmt(bounds.maxReductionPp) + '%p입니다. ' +
          (bounds.maxReductionPp < 0 ? '어느 답을 가정해도 격차가 커집니다.' : bounds.minReductionPp > 0 ?
            '어느 답을 가정해도 격차가 줄어듭니다.' : '양수는 격차 감소, 음수는 증가, 0은 변화 없음을 뜻합니다.');
      } else {
        amount.textContent = '이 ' + bounds.registeredBlocks + '묶음의 배정 과제 ' + bounds.assigned +
          '건이 모두 제출됐습니다. 관측된 격차 감소폭 ' + fmt(bounds.minReductionPp) + '%p.';
      }
    }
    showTimingCoverage(a);
    showTimedQuality(a);
    const phases = a.phases;
    el('phase-counts').textContent = '전체 시간 분석 대상 ' + a.timing.trialCount + '건 중 세 단계를 기록한 과제 ' + phases.availableTrials +
      '건. 단계별 비교에는 전원이 세 단계를 기록한 ' + phases.completeBlocks + '묶음 · ' + phases.included + '명 · ' + phases.trialCount + '건을 사용합니다.';
    const stageRows = [], pairRows = [];
    if (phases.byStage) {
      for (const name of core.stages) {
        const stage = phases.byStage[name];
        stageRows.push([stageLabels[name], fmt(stage.manualSeconds), fmt(stage.journalSeconds), fmt(stage.savedSeconds)]);
        for (const person of stage.editorPairs) {
          pairRows.push([person.participantId, stageLabels[name], fmt(person.manualSeconds), fmt(person.journalSeconds), fmt(person.savedSeconds)]);
        }
      }
    }
    table('phase-table',['단계', '원자료 평균(초)', '저널 평균(초)', '절감(초)'], stageRows, '세 단계가 모두 기록된 4인 묶음을 기다리고 있습니다.');
    el('phase-pairs').hidden = !phases.included;
    table('phase-pair-table',['참여 코드','단계','원자료 평균(초)','저널 평균(초)','절감(초)'],pairRows,'');
    const q = a.quality;
    const warnings = [];
    const qualityByVariant = [];
    if (q) {
      const pointChange = (group, key, denom) => 100 * (group.journal[key] / group.journal[denom] - group.manual[key] / group.manual[denom]);
      const accuracy = pointChange(q, 'correct', 'total'), joint = pointChange(q, 'qualityCorrect', 'total'), unsafe = pointChange(q, 'unsafe', 'unsafeTotal');
      if (accuracy < 0) warnings.push('기준 판정 일치율 ' + fmt(-accuracy) + '%p 하락');
      if (joint < 0) warnings.push('판정·근거 동시 일치율 ' + fmt(-joint) + '%p 하락');
      if (unsafe > 0) warnings.push('근거 없는 사실 채택률 ' + fmt(unsafe) + '%p 상승');
      for (const [variant, group] of Object.entries(q.byVariant)) {
        const label = variantLabels[variant];
        const labelJoint = pointChange(group, 'qualityCorrect', 'total'), labelUnsafe = pointChange(group, 'unsafe', 'unsafeTotal');
        const labelAccuracy = pointChange(group, 'correct', 'total');
        if (joint >= 0 && labelJoint < 0) warnings.push(label + '에서 판정·근거 동시 일치율 ' + fmt(-labelJoint) + '%p 하락');
        else if (accuracy >= 0 && labelAccuracy < 0) warnings.push(label + '에서 기준 판정 일치율 ' + fmt(-labelAccuracy) + '%p 하락');
        if (unsafe <= 0 && labelUnsafe > 0) warnings.push(label + '에서 근거 없는 사실 채택률 ' + fmt(labelUnsafe) + '%p 상승');
        for (const method of ['manual', 'journal']) {
          const v = group[method];
          qualityByVariant.push([label + ' · ' + (method === 'manual' ? '원자료' : '저널'),
            ratio(v.qualityCorrect, v.total), ratio(v.total - v.correct, v.total),
            ratio(v.total - v.citationCorrect, v.total), ratio(v.unsafe, v.unsafeTotal)]);
        }
      }
    }
    el('quality-warning').hidden = !warnings.length;
    el('quality-warning').textContent = '원자료 방식과 비교한 저널의 판정 품질 · ' + warnings.join(', ') + '. 시간과 판정 품질을 함께 해석하세요.';
    const qualityRows = q ? [
      ['기준 판정 일치', ...[q.manual, q.journal].map(v => ratio(v.correct, v.total))],
      ['근거 없는 사실 채택', ...[q.manual, q.journal].map(v => ratio(v.unsafe, v.unsafeTotal))],
      ['대표 근거 일치', ...[q.manual, q.journal].map(v => ratio(v.citationCorrect, v.total))],
      ['판정과 근거 모두 일치', ...[q.manual, q.journal].map(v => ratio(v.qualityCorrect, v.total))]
    ] : [];
    table('quality', ['지표', '원자료', '저널'], qualityRows, '집계할 기준 판정이 없습니다.');
    table('quality-by-variant', ['기사 표기 · 방식', '판정과 근거 모두 일치', '기준과 다른 판정', '대표 근거 불일치', '근거 없는 사실 채택'],
      qualityByVariant, '완성된 4인 묶음에서 기사 표기별 판정과 근거 선택을 집계합니다.');
    const dist = b?.distribution;
    el('distribution-gap').textContent = dist ? '네 판정의 평균 분포 차이 · 원자료 ' + fmt(dist.manualGapPp) + '%p → 저널 ' +
      fmt(dist.journalGapPp) + '%p · ' + (dist.reductionPp === 0 ? '변화 없음' : fmt(Math.abs(dist.reductionPp)) +
      '%p ' + (dist.reductionPp > 0 ? '감소' : '증가')) : '완성된 4인 묶음에서 네 판정의 분포를 비교합니다.';
    const decisionRows = (b?.cases || []).flatMap(c => Object.entries(verdictLabels).map(([key, label]) =>
      [cases.get(c.caseId, 'A').title, label, ...[c.manual.A, c.manual.B, c.journal.A, c.journal.B].map(cell => cell.counts[key] + '/' + cell.total)]));
    table('cells', ['사례', '판정', '원자료 · 보수', '원자료 · 진보', '저널 · 보수', '저널 · 진보'], decisionRows,
      '완성된 묶음에서 각 표기별 분모를 집계합니다.');
    table('blocks', ['묶음', '등록', '완료', '미등록 번호', '미완료 번호', '그중 중단 확인 번호'], a.blocks.map(v => [
      String(v.block), String(v.enrolled), String(v.completed), v.missingOrdinals.join(', ') || '—', v.unfinishedOrdinals.join(', ') || '—', v.withdrawnOrdinals.join(', ') || '—'
    ]), '등록된 배정 묶음이 없습니다.');
    el('manage-records').hidden = demo;
    showInvitations();
  }

  // coordinator-only:end
  // Allocation and registrations are saved before task material is disclosed.
  function inviteConflict(list, ordinal, id) {
    return list.some(inv => (inv.ordinal === ordinal) !== (inv.id === id));
  }
  function onRoster(list, ordinal, id) {
    return list.some(inv => inv.ordinal === ordinal && inv.id === id);
  }
  function registration(ordinal, id, atDevice = false) {
    return {ordinal, id, code:'J1-' + ordinal + '-' + id, ...(atDevice ? {atDevice:true} : {})};
  }
  function checkRosterConflicts(list, roster) {
    if (list.some(r => inviteConflict(roster, r.ordinal, r.participantId)))
      throw new Error('이 기기에서 발급한 초대 코드와 배정 정보가 다릅니다.');
  }
  function vacantSlots() {
    const used = new Set([...records, ...invitations].map(r => r.ordinal));
    let start = 1;
    while ([0,1,2,3].every(d => used.has(start + d))) start += 4;
    return [0,1,2,3].map(d => start + d).filter(n => !used.has(n));
  }
  function mergeInvitations(existing, incoming) {
    if (!Array.isArray(incoming)) throw new Error('초대 코드 명부 형식을 확인하세요.');
    const merged = [...existing];
    for (const raw of incoming) {
      const ordinal = raw?.ordinal, id = raw?.id;
      if (typeof ordinal !== 'number' || !/^[1-9]\d{0,8}$/.test(String(ordinal)) || typeof id !== 'string' || !/^E[A-F0-9]{16}$/.test(id) || raw.code !== 'J1-' + ordinal + '-' + id) {
        throw new Error('초대 코드 명부 형식을 확인하세요.');
      }
      if (merged.some(inv => inv.ordinal === ordinal && inv.id === id)) continue;
      if (inviteConflict(merged, ordinal, id)) throw new Error('이 기기에서 발급한 초대 코드와 배정 정보가 다릅니다.');
      merged.push(registration(ordinal, id, raw.atDevice === true));
    }
    return merged;
  }
  // coordinator-only:begin
  function importRosters(groups) {
    const pending = groups.map(group => mergeInvitations([], group)).filter(group => group.length);
    let roster = invitations;
    if (!roster.length && pending.length) roster = pending.shift();
    while (pending.length) {
      const index = pending.findIndex(group => group.some(inv => onRoster(roster, inv.ordinal, inv.id)));
      if (index < 0) throw new Error('가져온 명부와 기존 명부에 일치하는 배정이 없습니다. 같은 연구의 원래 백업을 확인하세요. 다른 연구의 백업은 별도 브라우저 프로필에서 열 수 있습니다.');
      roster = mergeInvitations(roster, pending.splice(index, 1)[0]);
    }
    return roster;
  }
  function issueCodes() {
    const available = vacantSlots();
    while (available.length) {
      const ordinal = available.splice(sampleIndex(available.length), 1)[0];
      const id = 'E' + idBytes();
      invitations.push({ordinal, id, code: 'J1-' + ordinal + '-' + id});
    }
    persist(); showDashboard(); message('import-status', '배정한 초대 코드를 표시 순서대로 전달하세요.');
  }
  // coordinator-only:end
  function enroll(event) {
    event.preventDefault();
    try {
      if (!el('qualified').checked) throw new Error('편집 업무와 참여 조건을 확인하세요.');
      const code = el('invite-code').value.trim().toUpperCase();
      const m = invitePattern.exec(code);
      if ((participantOnly || code) && !m) throw new Error('연구자가 전달한 초대 코드를 다시 확인하세요.');
      if (participantOnly) {
        // A freshly opened participant kit does not select anyone's saved record
        // until its holder supplies their own invitation, including on a shared device.
        storeKey = 'journal-editor-study-participant-v1/' + code;
        storageVersion = null; storageLocked = false; records = []; invitations = []; session = null;
        restoreWorkspace();
        if (storageLocked || (records.length && (records.length !== 1 || !currentRecord() ||
            currentRecord().ordinal !== Number(m[1]) || currentRecord().participantId !== m[2]))) {
          session = null;
          throw new Error('이 코드의 저장 기록과 배정이 일치하지 않습니다. 진행자에게 확인하세요.');
        }
        if (session) { message('enroll-status', ''); renderParticipant(); return; }
      }
      const slots = vacantSlots();
      const ordinal = m ? Number(m[1]) : slots[sampleIndex(slots.length)];
      const id = m ? m[2] : 'E' + idBytes();
      if (records.some(r => r.ordinal === ordinal || r.participantId === id) ||
        inviteConflict(invitations, ordinal, id)) throw new Error('이미 사용하거나 다른 참여자에게 배정한 코드입니다. 연구자에게 확인하세요.');
      if (!participantOnly && m && !onRoster(invitations, ordinal, id) && invitations.some(inv => !inv.atDevice))
        throw new Error('이 진행자의 명부에 없는 초대 코드입니다. 배정받은 코드를 확인하세요.');
      const r = core.createRecord(id, ordinal, 'editor', true);
      records = core.mergeRecords(records, [r]);
      if (!participantOnly && !onRoster(invitations, ordinal, id)) invitations.push(registration(ordinal, id, true));
      session = {id, state:'ready', activeMs:0, segmentAt:null, used:false, verdict:'', source:'', reason:''};
      persist(); message('enroll-status', ''); renderParticipant(); el('trial-heading').focus();
    } catch (err) { message('enroll-status', err.message, true); }
  }
  function clearTaskState(next) {
    delete session.kitVersion;
    Object.assign(session, {state:next, activeMs:0, segmentAt:null, recoveredMs:null, partialTime:false, stage:null, phaseMs:null, phaseOmitted:false, used:false, verdict:'', source:'', reason:''});
    liveStart = null; dropFrame();
  }
  function elapsed() {
    return session.activeMs + (session.state === 'running' && liveStart !== null ? clock() - liveStart : 0);
  }
  function updateStages() {
    const enabled = !!session.phaseMs;
    for (const button of stageButtons) {
      button.disabled = !enabled;
      button.setAttribute('aria-pressed', String(enabled && button.dataset.phase === session.stage));
    }
    el('phase-omit').checked = !!session.phaseOmitted;
    el('phase-omit').disabled = !session.phaseMs;
    el('phase-note').textContent = enabled && !session.phaseOmitted
      ? '자료 선택은 문서를 고르는 시간, 근거 위치 확인은 그 안의 표·문구를 찾고 읽는 시간입니다. 결론과 이유를 정리할 때 판정 기록을 누르세요. 세 단계를 모두 표시해야 단계별 비교에 포함됩니다.'
      : session.partialTime ? '시계는 확인한 구간만 표시합니다. 답과 근거는 제출할 수 있습니다.' : '이 과제는 전체 검토 시간만 분석합니다.';
  }
  function bankTime() {
    const now = clock();
    const total = session.activeMs + (now - liveStart);
    // Round cumulative boundaries, so switching phases frequently cannot change total time.
    if (session.phaseMs) session.phaseMs[session.stage] += Math.round(total) - Math.round(session.activeMs);
    session.activeMs = total;
    liveStart = now; session.segmentAt = Date.now();
  }
  function switchStage(name) {
    if (session?.state !== 'running' || !session.phaseMs || name === session.stage) return;
    bankTime();
    session.stage = name;
    session.phaseMs[name] ??= 0;
    persist(); updateStages();
  }
  function phaseResult(total) {
    if (session.phaseOmitted || !session.phaseMs || !core.stages.every(key => Object.hasOwn(session.phaseMs, key))) return null;
    const ms = {...session.phaseMs};
    ms[session.stage] += total - Math.round(session.activeMs);
    return ms;
  }
  function updateTime() {
    if (!session || ['done','withdrawn'].includes(session.state)) return;
    const sec = Math.floor(elapsed() / 1000);
    el('timer').textContent = String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
  function start(observedOnly = false) {
    if (!session || !['ready','paused','interrupted'].includes(session.state)) return;
    if (session.state === 'ready') {
      session.stage = session.partialTime ? null : 'select';
      session.phaseMs = session.partialTime ? null : {select:0}; session.phaseOmitted = false;
      session.recoveredMs = null;
    }
    if (session.state === 'interrupted') {
      if (observedOnly || session.partialTime) {
        // Discard earlier wall-clock reconstructions as well. Retain only measured intervals.
        session.activeMs -= session.recoveredMs ?? 0;
        session.recoveredMs = 0;
        session.partialTime = true;
      } else {
        const delta = Date.now() - session.segmentAt;
        if (!Number.isSafeInteger(session.segmentAt) || delta < 0) {
          message('session-status', '시계가 바뀌어 전체 시간을 복원할 수 없습니다. 시간 제외 후 계속하거나 참여를 중단하세요.', true); return;
        }
        session.activeMs += delta;
        session.recoveredMs = (session.recoveredMs ?? 0) + delta;
      }
      // No phase boundaries can be verified while the task page was closed.
      session.phaseMs = null; session.stage = null;
      message('session-status', '');
    }
    // A submission-only import cannot prove that the next task had not already started.
    if (session.state === 'ready') session.kitVersion = session.partialTime ? null : localKit;
    else if (!localKit || session.kitVersion !== localKit) session.kitVersion = null;
    liveStart = clock(); session.segmentAt = Date.now(); session.state = 'running';
    persist(); renderParticipant(); el('trial-heading').focus();
  }
  function pause() {
    if (session?.state !== 'running') return;
    bankTime(); session.segmentAt = null; liveStart = null; session.state = 'paused';
    persist(); renderParticipant(); el('resume-trial').focus();
  }
  function withdraw() {
    if (!session || !['ready','running','paused','interrupted'].includes(session.state)) return;
    const task = session.state === 'ready' ? null : {...assignment(),
      kitVersion:core.kitVersion(session.kitVersion),
      elapsedMs:Math.round(elapsed() - (session.recoveredMs ?? 0)),
      partial:!!session.partialTime || session.state === 'interrupted' || session.recoveredMs != null};
    if (!confirm('제출한 과제와 현재 과제에서 측정한 시간을 보관합니다. 이번 참여를 중단할까요?')) return;
    const result = {...currentRecord(), withdrawn:true};
    // An old submission-only file cannot show whether this unsubmitted task had already begun.
    if (session.state !== 'ready' || !session.partialTime) result.withdrawalTask = task;
    records = core.mergeRecords(records, [result]);
    clearTaskState('withdrawn'); persist(); renderParticipant(); el('ended-heading').focus();
  }
  function mountJournal() {
    if (frame) return;
    frameNonce = idBytes(); frame = node('iframe', undefined, 'study-frame');
    frame.title = '현재 과제의 저널 팩트체크 작업 화면';
    frame.src = 'factcheck.html?study=1'; el('frame-host').append(frame);
  }
  function sendTask() {
    if (!frame || !session || assignment().method !== 'journal') return;
    const c = stimulus();
    frame.contentWindow.postMessage({type:'journal-study-task', nonce:frameNonce, article:c.article, sources:c.sources}, location.protocol === 'file:' ? '*' : location.origin);
  }
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow || !session || session.state !== 'running') return;
    if (event.origin !== (location.protocol === 'file:' ? 'null' : location.origin)) return;
    const m = event.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'journal-study-ready') { sendTask(); return; }
    if (m.nonce !== frameNonce) return;
    if (m.type === 'journal-study-error') { message('journal-status','저널에 과제가 열리지 않았습니다. 잠시 멈춘 뒤 과제를 다시 여세요.',true); return; }
    if (m.type === 'journal-study-loaded') {
      el('journal-status').textContent = session.used ? '저널에 판단을 기록했습니다. 아래에서 최종 답을 제출하세요.' : '아래 저널에서 자료를 대조한 뒤 문장 판단을 기록하세요.';
    }
    if (m.type !== 'journal-study-used') return;
    const verdict = {fact:'supported',held:'insufficient',contradicted:'contradicted',opinion:'opinion'}[m.status];
    session.used = true;
    el('verdict').value = verdict || '';
    if (typeof m.reason === 'string') el('reason').value = m.reason;
    const valid = Array.isArray(m.sourceIds) ? m.sourceIds.filter(id => stimulus().sources.some(s => s.id === id)) : [];
    el('source').value = valid.length === 1 ? valid[0] : (valid.length ? '' : 'none');
    cacheAnswer();
    el('journal-status').textContent = '저널에 판단을 기록했습니다. 아래의 최종 판정과 대표 근거를 확인해 제출하세요.';
    message('answer-status','');
  });
  function cacheAnswer() {
    if (session?.state !== 'running') return;
    session.verdict = el('verdict').value; session.source = el('source').value; session.reason = el('reason').value; persist();
  }
  function submitTrial(event) {
    event.preventDefault();
    if (session?.state !== 'running') return;
    try {
      const a = assignment();
      if (a.method === 'journal' && !session.used) throw new Error('위 저널 화면에서 자료를 대조한 뒤 문장 판단을 먼저 기록하세요.');
      if (!el('verdict').value || !el('source').value) throw new Error('최종 판정과 대표 근거 선택을 확인하세요.');
      const observedMs = Math.round(elapsed());
      const elapsedMs = Math.max(1, observedMs);
      const timing = session.partialTime ? {elapsedMs:null, observedMs, phaseMs:null} : {elapsedMs, phaseMs:phaseResult(elapsedMs)};
      const r = core.addTrial(currentRecord(), {...timing, verdict:el('verdict').value, reason:el('reason').value,
        kitVersion:core.kitVersion(session.kitVersion),
        sourceIds:el('source').value === 'none' ? [] : [el('source').value], journalUsed:a.method === 'journal' && session.used});
      records = core.mergeRecords(records, [r]);
      clearTaskState(r.trials.length === 4 ? 'done' : 'ready'); persist();
      message('answer-status',''); renderParticipant();
      el(session.state === 'done' ? 'ended-heading' : 'trial-heading').focus();
    } catch (err) { message('answer-status',err.message,true); }
  }
  function renderParticipant() {
    const r = currentRecord();
    el('enroll-box').hidden = !!r;
    const ended = r && ['done','withdrawn'].includes(session.state);
    el('run').hidden = !r || ended; el('session-actions').hidden = !r || ended; el('ended').hidden = !ended;
    el('transfer-pane').hidden = !r || ended;
    el('open-resume').hidden = !canOpenResume();
    if (!r) { message('transfer-status', ''); return; }
    if (ended) {
      el('ended-heading').textContent = session.state === 'done' ? '네 과제를 마쳤습니다' : '참여를 중단했습니다';
      el('ended-text').textContent = '배정 ' + r.ordinal + '번 · 제출한 과제 ' + r.trials.length + '건. 참여 기록을 내려받아 연구자에게 전달하세요.';
      const summary = el('personal-time');
      summary.hidden = session.state !== 'done';
      summary.replaceChildren();
      if (!summary.hidden && r.trials.some(t => t.elapsedMs === null)) {
        summary.append(node('p', '전체 시간을 확인할 수 없는 과제가 있어 개인 평균은 계산하지 않았습니다. 제출한 네 답은 기록에 포함됐습니다.'));
      } else if (!summary.hidden) {
        const means = ['manual','journal'].map(method =>
          r.trials.filter(t => t.method === method).reduce((sum, t) => sum + t.elapsedMs, 0) / 2000);
        const diff = means[0] - means[1];
        summary.append(metric('내 검토 시간 · 사례당 평균', fmt(Math.abs(diff)) + '초 ' + (diff === 0 ? '차이' : diff > 0 ? '단축' : '증가'), means, '초',
          '서로 다른 기사 2건씩을 본 개인 기록입니다. 집단의 시간 절감률과 정당 표기 효과는 4인 균형 묶음에서 비교합니다.'));
      }
      return;
    }
    const a = assignment(), s = session.state;
    const method = a.method === 'manual' ? '원자료로 검토' : '저널과 원자료로 검토';
    el('trial-heading').textContent = '과제 ' + (r.trials.length + 1) + ' / 4 · ' + method;
    el('trial-info').textContent = '배정 ' + r.ordinal + '번 · 제출 완료 ' + r.trials.length + '건';
    el('start-pane').hidden = s !== 'ready'; el('task-pane').hidden = s !== 'running';
    el('partial-start').hidden = s !== 'ready' || !session.partialTime;
    el('pause-pane').hidden = s !== 'paused'; el('recovery').hidden = s !== 'interrupted';
    el('pause-note').textContent = session.partialTime
      ? '이 과제는 일부 시간만 확인할 수 있습니다. 계속하면 지금부터 검토한 시간을 더합니다.'
      : '휴식 중입니다. 자료를 다시 볼 때부터 시간을 잽니다.' + recoveryNote(session);
    el('resume-unbroken').hidden = !!session.partialTime;
    updateTime();
    if (s !== 'running') return;
    updateStages();
    const c = stimulus();
    el('stimulus-title').textContent = c.title; el('stimulus-article').textContent = c.article;
    el('stimulus-sources').replaceChildren(...c.sources.map(source => {
      const part = node('section', undefined, 'source');
      part.append(node('strong',source.title),node('small',source.version + ' · ' + source.locator),node('p',source.excerpt));
      return part;
    }));
    el('common-question').textContent = c.question;
    el('source').replaceChildren();
    for (const [value,text] of [['','선택하세요'], ...c.sources.map(v => [v.id,v.title]), ['none','지정할 대표 근거 없음']]) {
      const opt = node('option',text); opt.value = value; el('source').append(opt);
    }
    el('verdict').value = session.verdict; el('source').value = session.source; el('reason').value = session.reason || '';
    el('journal-tools').hidden = a.method !== 'journal';
    if (a.method === 'journal') {
      el('journal-status').textContent = session.used ? '저널에 판단을 기록했습니다. 아래에서 최종 답을 제출하세요.' : '현재 과제의 저널을 열고 있습니다.';
      if (frame) sendTask(); else mountJournal();
    }
  }
  function route() {
    const inSession = !!session;
    const participant = participantOnly || location.hash === '#participate' || inSession;
    el('participant').hidden = !participant;
    if (!participantOnly) el('dashboard').hidden = participant;
    if (participant) renderParticipant();
  // coordinator-only:begin
    else showDashboard();
  // coordinator-only:end
  }
  el('enroll').onsubmit = enroll;
  el('begin-trial').onclick = el('resume-unbroken').onclick = el('resume-trial').onclick = () => start();
  el('resume-partial').onclick = () => start(true);
  for (const button of stageButtons) button.onclick = () => switchStage(button.dataset.phase);
  el('phase-omit').onchange = () => {
    if (session?.state !== 'running') return;
    session.phaseOmitted = el('phase-omit').checked; persist(); updateStages();
  };
  el('pause-trial').onclick = pause; el('withdraw').onclick = el('stop-interrupted').onclick = withdraw;
  el('answer').onsubmit = submitTrial;
  el('answer').addEventListener('input',cacheAnswer);
  el('export-resume').onclick = exportResume;
  el('resume-file').onchange = openResume;
  el('export-one').onclick = el('export-finished').onclick = exportSelf;
  // F4: the next person on a shared device returns to an empty enrollment form, not to the aggregate view.
  el('leave-session').onclick = () => {
    if (participantOnly) { location.reload(); return; }
    session = null; persist(); el('enroll').reset(); message('enroll-status', '');
    if (location.hash !== '#participate') location.hash = 'participate';
    route(); el('invite-code').focus();
  };
  // coordinator-only:begin
  if (!participantOnly) {
    el('recover-roster').onsubmit = event => {
      event.preventDefault();
      try {
        const m = invitePattern.exec(el('roster-code').value.trim().toUpperCase());
        if (!m) throw new Error('원래 배정한 초대 코드 전체를 입력하세요.');
        const roster = mergeInvitations(invitations, [registration(Number(m[1]), m[2])]);
        checkRosterConflicts(records, roster);
        invitations = roster; persist(); showDashboard(); el('roster-code').value = '';
        message('import-status','확인한 배정을 명부에 반영했습니다. 보관된 기록이 있으면 함께 집계합니다.');
      } catch (err) { message('import-status', err.message, true); }
    };
    el('real-view').onclick = () => { viewKind = 'editor'; showDashboard(); };
    el('demo-view').onclick = () => { viewKind = 'demo'; showDashboard(); };
    el('demo-example').onchange = showDashboard;
    el('issue-codes').onclick = issueCodes;
    el('export-all').onclick = () => {
      if (records.length || invitations.length) download({type:collectionType,records,invitations},'journal-editor-study-collection.json');
    };
    el('import-trigger').onclick = () => el('import-files').click();
    el('import-files').onchange = async event => {
      const files = [...event.target.files]; event.target.value = '';
      if (!files.length) return;
      try {
        const incoming = [], rosterGroups = [], individuals = [];
        for (const file of files) {
          const parsed = JSON.parse(await file.text());
          const data = parsed?.type === collectionType ? parsed.records : [parsed];
          if (!Array.isArray(data) || data.some(r => !r || r.kind !== 'editor')) throw new Error('실제 편집자용 참여 기록을 선택하세요.');
          incoming.push(...data);
          if (parsed?.type !== collectionType) individuals.push(...data);
          if (parsed?.type === collectionType && parsed.invitations !== undefined) {
            if (!Array.isArray(parsed.invitations)) throw new Error('초대 코드 명부 형식을 확인하세요.');
            rosterGroups.push(parsed.invitations);
          }
        }
        const updated = core.mergeRecords(records, incoming);
        const roster = importRosters(rosterGroups);
        checkRosterConflicts(updated, roster);
        if (individuals.some(r => !onRoster(roster, r.ordinal, r.participantId)))
          throw new Error('이 진행자의 명부에 없는 개인 기록입니다. 원래 명부를 먼저 가져오거나 별도로 보관한 배정 코드를 확인하세요.');
        records = updated; invitations = roster; persist(); showDashboard();
        const matched = records.filter(r => onRoster(roster, r.ordinal, r.participantId)).length;
        message('import-status', files.length + '개 파일을 확인했습니다. 현재 등록 ' + matched + '명입니다.' +
          (matched < records.length ? ' 명부 미확인 ' + (records.length - matched) + '명의 기록을 보관했습니다.' : ''));
      } catch (err) { message('import-status', '가져오지 못했습니다. ' + err.message, true); }
    };
  }
  // coordinator-only:end
  window.addEventListener('beforeunload', event => {
    if (session?.state === 'running') { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => {
    if (session?.state !== 'running' || liveStart === null) return;
    bankTime();
    session.state = 'interrupted';
    liveStart = null;
    persist();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && session?.state === 'interrupted') renderParticipant();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session?.state === 'running') persist();
  });
  window.addEventListener('hashchange',route);
  setInterval(() => {
    updateTime();
    if (session?.state === 'running' && liveStart !== null && clock() - liveStart >= 15000) persist();
  }, 1000);
  route();
})();

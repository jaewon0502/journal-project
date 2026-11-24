(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const core = window.JournalEditorStudy, cases = window.JournalStudyCases;
  const stageLabels = {select:'자료 선택', locate:'근거 위치 확인', decide:'판정 기록'};
  const stageButtons = [...document.querySelectorAll('[data-phase]')];
  const participantOnly = document.documentElement.hasAttribute('data-participant-kit');
  let storeKey = participantOnly ? null : 'journal-editor-study-workspace-v1';
  const collectionType = 'journal-editor-study-collection-v1';
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
        message('global-status', '다른 탭에서 기록이 바뀌었습니다. 현재 기록을 JSON으로 내려받은 뒤 이 탭을 다시 여세요.', true);
        return;
      }
      const json = JSON.stringify({records, invitations, session});
      localStorage.setItem(storeKey, json);
      storageVersion = json;
    } catch (_) {
      message('global-status', '브라우저 저장이 제한되어 있습니다. 창을 닫기 전에 기록을 JSON으로 내려받으세요.', true);
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
      message('global-status', '다른 탭의 기록이 있습니다. 현재 탭은 파일로만 보관합니다. 중복 참여가 없도록 한 탭에서 진행하세요.', true);
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
  function fmt(n) { return Number(n.toFixed(1)).toLocaleString('ko-KR'); }
  const percent = (a, b) => b ? fmt(100 * a / b) + '%' : '—';
  const ratio = (a, b) => b ? percent(a, b) + ' (' + a + '/' + b + ')' : '— (0/0)';
  function table(id, heads, rows, empty) {
    const wrap = el(id); wrap.replaceChildren();
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
  function showInvitations() {
    el('export-all').disabled = !records.length && !invitations.length;
    table('invites', ['발급 묶음', '전달할 초대 코드', '이 기기 수집 상태'], invitations.filter(inv => !inv.atDevice).map(inv => [
      String(Math.ceil(inv.ordinal / 4)), inv.code,
      records.some(r => r.participantId === inv.id) ? '기록 있음' : '기록 대기'
    ]), '발급된 초대 코드가 없습니다.');
  }
  function showDashboard() {
    const demo = viewKind === 'demo';
    const confirmed = records.filter(r => onRoster(invitations, r.ordinal, r.participantId));
    const a = core.analyze(demo ? core.demoRecords() : confirmed, viewKind);
    el('real-view').setAttribute('aria-pressed', String(!demo));
    el('demo-view').setAttribute('aria-pressed', String(demo));
    el('data-notice').textContent = demo ? '가상 수치 예시 · 계산 방법을 보여 주기 위해 만든 응답과 시간입니다. 실제 편집자 집계에는 들어가지 않습니다.'
      : a.completeBlocks ? '기사 편집·검증 업무를 수행한다고 본인이 응답한 참여자의 기록입니다. 완성된 배정 묶음만 지표에 반영했습니다.'
      : '실제 참여 기록 · 완성된 4인 묶음이 생기면 시간과 판정 차이를 표시합니다.';
    if (a.completeBlocks > 0 && a.completeBlocks <= 2) el('data-notice').textContent += ' 사례·방식·정당 표기별 응답은 각 ' + a.completeBlocks + '명으로, 한 사람의 응답에도 격차가 크게 바뀝니다.';
    if (!demo && confirmed.length < records.length) el('data-notice').textContent +=
      ' 명부 미확인 ' + (records.length - confirmed.length) + '명은 보관 중입니다. 아래에서 원래 명부나 개별 배정 코드를 확인하세요.';
    el('data-notice').classList.toggle('sample', demo);
    el('counts').replaceChildren(...['등록 ' + a.enrolled + '명', '4과제 완료 ' + a.completed + '명',
      '분석 ' + a.included + '명 · ' + a.trialCount + '건', '분석 미포함 ' + a.excluded + '명',
      '중단 확인 ' + a.withdrawn + '명', '완성 ' + a.completeBlocks + '묶음'].map(s => node('span', s)));
    const t = a.time, b = a.bias;
    const timeTitle = t && t.reductionPct < 0 ? '검토 시간 증가율' : '검토 시간 절감률';
    const biasTitle = !b ? '정당 표기별 사실 채택률 격차' : '정당 표기별 사실 채택률 격차 ' +
      (b.reductionPp > 0 ? '감소' : b.reductionPp < 0 ? '증가' : '변화 없음');
    const timeCard = metric(timeTitle, t && fmt(Math.abs(t.reductionPct)) + '%', t && [t.manualSeconds, t.journalSeconds], '초',
      t ? '사례당 평균 ' + fmt(Math.abs(t.savedSeconds)) + '초 ' + (t.savedSeconds >= 0 ? '단축' : '증가') : '사례 1건의 평균 검토 시간');
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
    el('metrics').replaceChildren(timeCard, biasCard);
    const phases = a.phases;
    el('phase-counts').textContent = '전체 시간 분석 대상 ' + a.trialCount + '건 중 세 단계를 기록한 과제 ' + phases.availableTrials +
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
    if (q) {
      const pointChange = (metricKey, denominator) => 100 * (q.journal[metricKey] / q.journal[denominator] - q.manual[metricKey] / q.manual[denominator]);
      const accuracy = pointChange('correct', 'total'), joint = pointChange('qualityCorrect', 'total'), unsafe = pointChange('unsafe', 'unsafeTotal');
      if (accuracy < 0) warnings.push('기준 판정 일치율 ' + fmt(-accuracy) + '%p 하락');
      if (joint < 0) warnings.push('판정·근거 동시 일치율 ' + fmt(-joint) + '%p 하락');
      if (unsafe > 0) warnings.push('근거 없는 사실 채택률 ' + fmt(unsafe) + '%p 상승');
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
    const dist = b?.distribution;
    el('distribution-gap').textContent = dist ? '네 판정의 평균 분포 차이 · 원자료 ' + fmt(dist.manualGapPp) + '%p → 저널 ' +
      fmt(dist.journalGapPp) + '%p · ' + (dist.reductionPp === 0 ? '변화 없음' : fmt(Math.abs(dist.reductionPp)) +
      '%p ' + (dist.reductionPp > 0 ? '감소' : '증가')) : '완성된 4인 묶음에서 네 판정의 분포를 비교합니다.';
    const verdictLabels = {supported:'근거로 지지됨', contradicted:'근거와 충돌', insufficient:'근거 불충분', opinion:'의견·가치판단'};
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
    persist(); showInvitations(); message('import-status', '배정한 초대 코드를 표시 순서대로 전달하세요.');
  }
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
    Object.assign(session, {state:next, activeMs:0, segmentAt:null, stage:null, phaseMs:null, phaseOmitted:false, used:false, verdict:'', source:'', reason:''});
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
      : '이 과제는 전체 검토 시간만 분석합니다.';
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
  function start() {
    if (!session || !['ready','paused','interrupted'].includes(session.state)) return;
    if (session.state === 'ready') {
      session.stage = 'select'; session.phaseMs = {select:0}; session.phaseOmitted = false;
    }
    if (session.state === 'interrupted') {
      const delta = Date.now() - session.segmentAt;
      if (!Number.isSafeInteger(session.segmentAt) || delta < 0) {
        message('session-status', '시계가 바뀌어 경과 시간을 복원할 수 없습니다. 중단 기록으로 종료하세요.', true); return;
      }
      session.activeMs += delta;
      // No phase boundaries can be verified while the task page was closed.
      session.phaseMs = null; session.stage = null;
    }
    liveStart = clock(); session.segmentAt = Date.now(); session.state = 'running';
    persist(); renderParticipant(); el('trial-heading').focus();
  }
  function pause() {
    if (session?.state !== 'running') return;
    bankTime(); session.segmentAt = null; liveStart = null; session.state = 'paused';
    persist(); renderParticipant(); el('resume-trial').focus();
  }
  function withdraw() {
    if (!session || !confirm('제출한 과제는 미완료 참여 기록으로 보관됩니다. 이번 참여를 중단할까요?')) return;
    records = core.mergeRecords(records, [{...currentRecord(), withdrawn:true}]);
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
      const elapsedMs = Math.max(1, Math.round(elapsed()));
      const r = core.addTrial(currentRecord(), {elapsedMs, phaseMs:phaseResult(elapsedMs), verdict:el('verdict').value, reason:el('reason').value,
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
    if (!r) return;
    if (ended) {
      el('ended-heading').textContent = session.state === 'done' ? '네 과제를 마쳤습니다' : '참여를 중단했습니다';
      el('ended-text').textContent = '배정 ' + r.ordinal + '번 · 제출한 과제 ' + r.trials.length + '건. 참여 기록을 내려받아 연구자에게 전달하세요.';
      const summary = el('personal-time');
      summary.hidden = session.state !== 'done';
      summary.replaceChildren();
      if (!summary.hidden) {
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
    el('pause-pane').hidden = s !== 'paused'; el('recovery').hidden = s !== 'interrupted';
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
    if (participant) renderParticipant(); else showDashboard();
  }
  el('enroll').onsubmit = enroll;
  el('begin-trial').onclick = el('resume-unbroken').onclick = el('resume-trial').onclick = start;
  for (const button of stageButtons) button.onclick = () => switchStage(button.dataset.phase);
  el('phase-omit').onchange = () => {
    if (session?.state !== 'running') return;
    session.phaseOmitted = el('phase-omit').checked; persist(); updateStages();
  };
  el('pause-trial').onclick = pause; el('withdraw').onclick = el('stop-interrupted').onclick = withdraw;
  el('answer').onsubmit = submitTrial;
  el('answer').addEventListener('input',cacheAnswer);
  el('export-one').onclick = el('export-finished').onclick = exportSelf;
  // F4: the next person on a shared device returns to an empty enrollment form, not to the aggregate view.
  el('leave-session').onclick = () => {
    if (participantOnly) { location.reload(); return; }
    session = null; persist(); el('enroll').reset(); message('enroll-status', '');
    if (location.hash !== '#participate') location.hash = 'participate';
    route(); el('invite-code').focus();
  };
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
  window.addEventListener('beforeunload', event => {
    if (session?.state === 'running') { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('hashchange',route);
  setInterval(updateTime, 1000); route();
})();

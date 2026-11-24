(() => {
  'use strict';
  const c = window.JournalFieldReview,
    el = (id) => document.getElementById(id);
  const format = 'journal-field-grades-v1',
    records = new Map();
  const anchors = new Map();
  const labels = {
    manual: '평소 검증 도구',
    journal: '평소 검증 도구와 저널',
    supported: '근거 지지',
    contradicted: '근거 반박',
    insufficient: '근거 부족'
  };
  const node = (tag, s) => {
    const n = document.createElement(tag);
    n.textContent = s;
    return n;
  };
  const pct = (hits, total) =>
    total ? ((100 * hits) / total).toFixed(1) + '% (' + hits + '/' + total + ')' : '산출 대기 (0/0)';
  function grade(value) {
    if (!['', 'yes', 'no'].includes(value)) throw Error('진행자 채점 형식을 확인하세요.');
    return value;
  }
  function selected() {
    return [...records.values()].filter((e) => e.trial.kind === el('kind').value);
  }
  function repeatIds() {
    const first = new Map(), repeated = new Set();
    for (const { trial, repeatExposure } of records.values()) {
      if (repeatExposure) repeated.add(trial.id);
      const article = new URL(trial.articleUrl);
      // Hash routers identify the story before an optional second, in-story anchor.
      article.hash = article.hash.match(/^#!?\/[^#]*/u)?.[0] || '';
      for (const [type, value] of [['case', trial.caseId], ['article', article.href]]) {
        const key = JSON.stringify([trial.participant, type, value]);
        if (first.has(key)) {
          repeated.add(first.get(key));
          repeated.add(trial.id);
        } else first.set(key, trial.id);
      }
    }
    return repeated;
  }
  function target(caseId, articleUrl, id, prompt) {
    return JSON.stringify([caseId, articleUrl, id, prompt]);
  }
  function trialTarget(t) {
    return target(t.caseId, t.articleUrl, t.taskId, t.prompt);
  }
  function basis(caseId, articleUrl, task) {
    const nonblank = (value) => typeof value === 'string' && !!value.trim();
    const ref = task?.reference;
    if (
      ![caseId, task?.id, task?.prompt, ref?.document, ref?.locator].every(nonblank) ||
      !c.url(articleUrl) ||
      !['supported', 'contradicted', 'insufficient'].includes(task.verdict) ||
      (task.explanation !== undefined && typeof task.explanation !== 'string') ||
      (ref.documentUrl != null && !c.url(ref.documentUrl))
    )
      throw Error('기사 주소·과제·원문과 기준 위치를 확인하세요.');
    function alternatives(list) {
      if (list === undefined) return [];
      if (!Array.isArray(list) || !list.every(nonblank))
        throw Error('기준의 허용 자료와 위치 목록을 확인하세요.');
      return [...new Set(list)].sort();
    }
    return {
      caseId,
      articleUrl,
      id: task.id,
      prompt: task.prompt,
      verdict: task.verdict,
      explanation: task.explanation || '',
      reference: {
        document: ref.document,
        locator: ref.locator,
        documentUrl: ref.documentUrl || null,
        acceptedDocuments: alternatives(ref.acceptedDocuments),
        acceptedLocators: alternatives(ref.acceptedLocators)
      }
    };
  }
  function sameBasis(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function bind(entry, anchor) {
    if (!anchor) return entry;
    return {
      ...entry,
      basis: anchor,
      verdictGrade:
        entry.trial.status === 'completed' ? (entry.trial.verdict === anchor.verdict ? 'yes' : 'no') : '',
      locationGrade: sameBasis(anchor, entry.basis) ? entry.locationGrade : ''
    };
  }
  function applyActiveKey(entry) {
    const tasks = anchors.get(entry.trial.caseId);
    if (!tasks) return entry;
    const match = tasks.get(trialTarget(entry.trial));
    if (match) return bind(entry, match);
    return entry.basis ? { ...entry, basis: null, verdictGrade: '', locationGrade: '' } : entry;
  }
  function applied(entry) {
    return { ...entry, expected: entry.basis?.verdict || '', anchor: entry.basis };
  }
  const seconds = (n, count) => (count ? (n / count / 1000).toFixed(1) + '초' : '산출 대기');
  function timeChangeText({ savedMs, savedPct }) {
    const change = savedMs < 0 ? '더 걸림' : savedMs > 0 ? '절감' : '차이 없음';
    const percent = savedPct === null ? '기준 시간 0초로 비율 산출 대기' : Math.abs(savedPct).toFixed(1) + '%';
    return seconds(Math.abs(savedMs), 1) + ' ' + change + ' (' + percent + ')';
  }
  function showComparisons(groups) {
    const area = el('comparisons');
    area.replaceChildren();
    if (!groups.length) {
      area.append(node('p', '같은 과제의 평소 도구 기록과 저널 기록을 불러오면 절감률을 계산합니다.'));
      return;
    }
    for (const task of c.compareTimes(groups)) {
      const card = node('article', '');
      const article = node('a', '과제의 기사 열기 ↗');
      article.href = task.articleUrl;
      article.target = '_blank';
      article.rel = 'noopener noreferrer';
      card.append(node('h3', task.caseId + ' · ' + task.taskId), node('p', task.prompt), article);
      if (task.savedMs === null) {
        card.append(node('strong', '산출 대기 · 두 방식 모두 시간 기록이 필요합니다.'));
      } else {
        card.append(node('strong', timeChangeText(task)));
      }
      for (const method of ['manual', 'journal']) {
        const group = task[method];
        if (!group?.totalTimed) {
          card.append(node('p', labels[method] + ' · 비교 가능한 완료 기록 0건'));
          continue;
        }
        card.append(node('p', labels[method] + ' · 평균 ' + seconds(group.totalMs, group.totalTimed) +
          ' (' + group.totalTimed + '건) · 근거 위치와 판정 모두 일치 ' + pct(group.timedVerified, group.timedGraded) +
          ' · 채점 대기 ' + (group.totalTimed - group.timedGraded) + '건'));
      }
      card.append(node('h4', '검증 성공 1건당 투입 시간'));
      for (const method of ['manual', 'journal']) {
        const group = task[method];
        if (!group || !(group.totalTimed + group.timedWithdrawn)) {
          card.append(node('p', labels[method] + ' · 비교할 시간 기록 0건'));
          continue;
        }
        const ms = task.perVerified[method + 'Ms'];
        card.append(node('p', labels[method] + ' · ' + (ms === null ? '산출 대기' : seconds(ms, 1) + '/건') +
          ' · 총 ' + seconds(group.totalMs + group.withdrawnMs, 1) + ' (완료 ' + group.totalTimed +
          '건, 중도 종료 ' + group.timedWithdrawn + '건) · 검증 성공 ' + group.timedVerified +
          '건 · 성공 여부 확인 대기 ' + group.timedOutcomePending + '건'));
      }
      if (task.perVerified.savedMs !== null)
        card.append(node('strong', '검증 성공 1건당 ' + timeChangeText(task.perVerified)));
      area.append(card);
    }
  }
  function stats() {
    const rows = selected(),
      dupe = repeatIds(),
      eligible = rows.filter((r) => !dupe.has(r.trial.id));
    el('count').textContent =
      '불러온 ' +
      rows.length +
      '건 · 같은 참여 코드로 같은 사례나 기사를 다시 열어 요약에서 제외 ' +
      (rows.length - eligible.length) +
      '건';
    el('save').disabled = !rows.length;
    el('groups').replaceChildren();
    const groups = c.group(eligible.map(applied));
    showComparisons(groups);
    if (!groups.length) el('groups').append(node('p', '집계할 참여 기록이 없습니다.'));
    for (const g of groups) {
      const d = node('article', '');
      d.append(
        node('h3', g.taskId + ' · ' + labels[g.method]),
        node('p', g.caseId + ' · 완료 ' + g.submitted + '건 · 중도 종료 ' + g.withdrawn + '건')
      );
      d.append(
        node('p', g.prompt),
        node(
          'p',
          '배정 기준 집계 · 실제 도구 사용은 본인 응답 · 배정대로 사용 ' +
            g.asAssigned +
            '건 · 다르게 사용 ' +
            g.differentMethod +
            '건 · 미확인 ' +
            g.unknownUse +
            '건'
        ),
        node(
          'p',
          '원자료 위치 재확인 성공률 ' +
            pct(g.locationHits, g.locationGraded) +
            ' · 채점 대기 ' +
            (g.submitted - g.locationGraded) +
            '건'
        ),
        node(
          'p',
          '판정 일치율 ' +
            pct(g.verdictHits, g.verdictGraded) +
            ' · 채점 대기 ' +
            (g.submitted - g.verdictGraded) +
            '건'
        ),
        node(
          'p',
          '근거 없는 사실 채택률 ' + pct(g.unsafe, g.unsafeTotal) + ' · 기준 판정이 반박·근거 부족인 과제 중'
        ),
        node(
          'p',
          '평균 총 활동 시간 ' +
            seconds(g.totalMs, g.totalTimed) +
            ' (' +
            g.totalTimed +
            '건) · 중단 복원 ' +
            g.recovered +
            '건'
        ),
        node(
          'p',
          '평균 원자료 찾기 ' +
            seconds(g.ms.search, g.timed) +
            ' · 표·발언 위치 찾기 ' +
            seconds(g.ms.locate, g.timed) +
            ' · 판정 기록 ' +
            seconds(g.ms.decide, g.timed) +
            ' (전 단계 표시 ' +
            g.timed +
            '건)'
        )
      );
      el('groups').append(d);
    }
  }
  function chooser(label, entry, field, disabled = false) {
    const wrap = node('label', label + ' '),
      sel = document.createElement('select');
    for (const [id, txt] of [
      ['', '채점 대기'],
      ['yes', '일치'],
      ['no', '불일치']
    ])
      sel.add(new Option(txt, id));
    const view = applied(entry);
    sel.value = disabled && field === 'locationGrade' ? 'no' : view[field];
    sel.disabled = disabled;
    sel.onchange = () => {
      entry[field] = sel.value;
      unexported.add(entry.trial.kind);
      persistDraft();
      stats();
    };
    wrap.append(sel);
    return wrap;
  }
  function render() {
    const rows = selected(),
      dupe = repeatIds();
    el('entries').replaceChildren();
    stats();
    for (const entry of rows) {
      const t = entry.trial,
        d = node('article', '');
      d.append(node('h3', t.participant + ' · ' + t.taskId + ' · ' + labels[t.method]), node('p', t.prompt));
      if (dupe.has(t.id))
        d.append(node('p', '같은 기사 사례에 반복 참여한 코드입니다. 연습·중도 종료를 포함해 시간과 품질 요약에서 제외했습니다.'));
      if (t.status === 'withdrawn') {
        d.append(node('p', '중도 종료'));
        el('entries').append(d);
        continue;
      }
      if (t.found === 'found') {
        const a = node('a', t.documentUrl);
        a.href = t.documentUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        d.append(a, node('p', '제출한 위치 · ' + t.locator));
      } else d.append(node('p', '참여자가 근거 위치를 찾지 못했습니다.'));
      const view = applied(entry);
      if (!view.anchor) d.append(node('p', '일치하는 기준 파일이 없어 수동으로 채점합니다.'));
      if (view.anchor) {
        d.append(
          node('p', '대조할 원표 · ' + view.anchor.reference.document + ' · ' + view.anchor.reference.locator)
        );
        if (c.url(view.anchor.reference.documentUrl)) {
          const a = node('a', '기준 PDF의 해당 위치 열기 ↗');
          a.href = view.anchor.reference.documentUrl;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          d.append(a);
          d.append(node('small', ' 다운로드되면 위의 PDF 쪽수를 사용하세요.'));
        }
        if (view.anchor.reference.acceptedLocators.length)
          d.append(node('p', '허용 위치 · ' + view.anchor.reference.acceptedLocators.join(' / ')));
        const ref = view.anchor.reference;
        const otherDocuments = ref.acceptedDocuments.filter(value =>
          value !== ref.document && value !== ref.documentUrl && value !== ref.documentUrl?.split('#')[0]);
        if (view.anchor.explanation || otherDocuments.length) {
          const details = node('details', '');
          details.append(node('summary', '채점 근거와 추가 허용 자료'));
          if (view.anchor.explanation) details.append(node('p', view.anchor.explanation));
          for (const value of otherDocuments) {
            const sourceLine = node('p', '허용 자료 · ');
            if (c.url(value)) {
              const a = node('a', value);
              a.href = value;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              sourceLine.append(a);
            } else {
              sourceLine.append(value);
            }
            details.append(sourceLine);
          }
          d.append(details);
        }
      }
      d.append(
        node('p', labels[t.verdict] + ' · ' + t.reason),
        chooser('근거 위치', entry, 'locationGrade', t.found === 'missing')
      );
      if (view.expected)
        d.append(
          node(
            'p',
            '기준 판정 · ' + labels[view.expected] + ' · ' + (view.verdictGrade === 'yes' ? '일치' : '불일치')
          )
        );
      else d.append(chooser('판정', entry, 'verdictGrade'));
      el('entries').append(d);
    }
  }
  function canonical(t) {
    return JSON.stringify([
      t.id,
      t.participant,
      t.caseId,
      t.taskId,
      t.prompt,
      t.articleUrl,
      t.kind,
      t.method,
      t.status,
      t.recovered,
      t.split,
      ...c.phases.map((p) => t.phaseMs[p]),
      t.found || '',
      t.documentUrl || '',
      t.locator || '',
      t.verdict || '',
      t.reason || '',
      t.journalUse || ''
    ]);
  }
  function loadKey(v) {
    if (!v || typeof v.caseId !== 'string' || !Array.isArray(v.tasks) || !v.tasks.length)
      throw Error('과제별 기준 파일이 필요합니다.');
    const incoming = new Map();
    for (const task of v.tasks) {
      const normalized = basis(v.caseId, v.articleUrl, task);
      const k = target(v.caseId, v.articleUrl, task.id, task.prompt);
      if (incoming.has(k)) throw Error('기준 파일에 같은 기사·과제의 기준이 중복됐습니다.');
      incoming.set(k, normalized);
    }
    anchors.set(v.caseId, incoming);
  }
  function showKeys() {
    const count = [...anchors.values()].reduce((n, tasks) => n + tasks.size, 0);
    el('key-name').textContent = count ? '불러온 기준 ' + count + '개' : '';
  }
  function mergeFiles(values) {
    const next = new Map(records);
    for (const v of values) {
      const list = v.format === format ? v.entries : [{ trial: v, locationGrade: '', verdictGrade: '' }];
      if (!Array.isArray(list)) throw Error('집계 파일 형식을 확인하세요.');
      for (const item of list) {
        const trial = c.validate(item.trial);
        if (item.repeatExposure !== undefined && typeof item.repeatExposure !== 'boolean')
          throw Error('반복 노출 표시를 확인하세요.');
        let row = {
          trial,
          repeatExposure: item.repeatExposure === true,
          locationGrade: grade(item.locationGrade),
          verdictGrade: grade(item.verdictGrade),
          basis: item.basis ? basis(item.basis.caseId, item.basis.articleUrl, item.basis) : null
        };
        if (row.basis) {
          if (
            trialTarget(trial) !==
              target(row.basis.caseId, row.basis.articleUrl, row.basis.id, row.basis.prompt) ||
            (item.expected && item.expected !== row.basis.verdict)
          ) {
            throw Error('저장된 기준의 기사·과제 또는 기준 판정이 제출 기록과 다릅니다.');
          }
          row = bind(row, row.basis);
        } else if (item.expected) {
          // Old keyed grades contain no article/reference binding; reconstruct from the current key.
          row.verdictGrade = '';
          row.locationGrade = '';
        }
        row = applyActiveKey(row);
        const prev = next.get(trial.id);
        if (prev && canonical(prev.trial) !== canonical(trial)) {
          throw Error('같은 과제 기록 ID에 내용이 다른 파일이 있습니다.');
        }
        if (prev?.repeatExposure) row.repeatExposure = true;
        if (prev && !sameBasis(row.basis, prev.basis)) {
          if (row.basis && prev.basis)
            throw Error('같은 기록을 다른 원자료 기준으로 채점했습니다. 사용할 집계본을 선택하세요.');
          if (prev.basis) {
            next.set(trial.id, { ...prev, repeatExposure: row.repeatExposure });
            continue;
          }
        } else if (prev) {
          for (const k of ['locationGrade', 'verdictGrade']) {
            if (row[k] && prev[k] && row[k] !== prev[k])
              throw Error('같은 기록의 채점 결과가 다릅니다. 사용할 집계본을 확인하세요.');
            row[k] = row[k] || prev[k];
          }
        }
        next.set(trial.id, row);
      }
    }
    const versions = new Map();
    for (const entry of next.values()) {
      if (!entry.basis) continue;
      const k = trialTarget(entry.trial);
      if (versions.has(k) && !sameBasis(versions.get(k), entry.basis))
        throw Error('같은 과제에 다른 기준이 섞였습니다. 사용할 진행자 기준 파일을 먼저 선택하세요.');
      versions.set(k, entry.basis);
    }
    for (const [id, entry] of next) {
      // A saved key establishes the same verdict for every response to this exact prompt.
      // An unkeyed location needs a fresh human check against that reference.
      const anchor = versions.get(trialTarget(entry.trial));
      records.set(id, !entry.basis && anchor ? bind(entry, anchor) : entry);
    }
  }
  // Scoped to this tab and checkout path. No participant draft is read by this page.
  const draftKey = 'journal-field-grading-v1/' + location.pathname;
  const unexported = new Set();
  function persistDraft() {
    const notice = el('draft-status');
    try {
      const keys = [...anchors.values()].map(tasks => {
        const entries = [...tasks.values()];
        return {caseId:entries[0].caseId, articleUrl:entries[0].articleUrl, tasks:entries};
      });
      const draft = {kind:el('kind').value, keys, entries:[...records.values()], unexported:[...unexported]};
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
      notice.textContent = '이 탭을 새로고침하면 채점을 복원합니다. 탭을 닫기 전 보관할 구분의 JSON을 저장하세요.';
    } catch {
      notice.textContent = '이 탭에 임시 저장할 수 없습니다. 페이지를 떠나기 전에 판정과 집계 기록을 JSON으로 저장하세요.';
    }
    if (unexported.size) notice.textContent += ' 파일 저장 전 · ' + [...unexported].map(k => k === 'editor' ? '현업 참여' : '연습').join(', ');
  }
  function restoreDraft() {
    try {
      const value = sessionStorage.getItem(draftKey);
      if (!value) return;
      const draft = JSON.parse(value);
      const kinds = ['editor', 'practice'];
      if (!kinds.includes(draft.kind) || !Array.isArray(draft.keys) || !Array.isArray(draft.entries) ||
          !Array.isArray(draft.unexported) || !draft.unexported.every(k => kinds.includes(k))) throw Error();
      for (const key of draft.keys) loadKey(key);
      mergeFiles([{format, entries:draft.entries}]);
      for (const kind of draft.unexported) unexported.add(kind);
      el('kind').value = draft.kind;
      showKeys();
      el('status').textContent = '이 탭에서 작업하던 집계를 복원했습니다.';
      persistDraft();
    } catch {
      anchors.clear();
      records.clear();
      el('draft-status').textContent = '이 탭의 임시 집계를 열 수 없습니다. 저장한 집계 JSON을 불러오세요.';
    }
  }
  window.addEventListener('beforeunload', event => {
    if (!unexported.size) return;
    event.preventDefault();
    event.returnValue = '';
  });
  let loading = false;
  function loadingState(on) {
    loading = on;
    el('imports').disabled = on;
    el('key-file').disabled = on;
    el('entries').inert = on;
    el('save').disabled = on || !selected().length;
  }
  el('key-file').onchange = async (e) => {
    if (loading) return;
    const f = e.target.files[0];
    if (!f) return;
    loadingState(true);
    try {
      const v = JSON.parse(await f.text());
      loadKey(v);
      let reset = 0;
      for (const [id, entry] of records) {
        const next = applyActiveKey(entry);
        if (entry.locationGrade && !next.locationGrade) reset++;
        if (!sameBasis(entry.basis, next.basis)) unexported.add(entry.trial.kind);
        records.set(id, next);
      }
      showKeys();
      persistDraft();
      el('status').textContent =
        '일치하는 과제에 기준을 적용했습니다.' +
        (reset ? ' 근거 위치 ' + reset + '건을 다시 확인하세요.' : '');
      render();
    } catch (err) {
      el('status').textContent = err.message;
    } finally {
      e.target.value = '';
      loadingState(false);
    }
  };
  el('imports').onchange = async (e) => {
    if (loading) return;
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    loadingState(true);
    try {
      const values = [];
      for (const f of files) values.push(JSON.parse(await f.text()));
      mergeFiles(values);
      persistDraft();
      el('status').textContent = '파일을 불러왔습니다.';
      render();
    } catch (err) {
      el('status').textContent = '파일을 불러오지 못했습니다. ' + err.message;
    } finally {
      loadingState(false);
    }
  };
  el('save').onclick = () => {
    const dupe = repeatIds();
    const a = document.createElement('a'),
      data = {
        format,
        entries: selected().map((entry) => {
          const v = applied(entry);
          return {
            trial: v.trial,
            ...(dupe.has(v.trial.id) ? { repeatExposure: true } : {}),
            locationGrade: v.locationGrade,
            verdictGrade: v.verdictGrade,
            expected: v.expected,
            basis: v.anchor || null
          };
        })
      };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.href = url;
    a.download = 'field-grades-' + el('kind').value + '.json';
    a.click();
    unexported.delete(el('kind').value);
    persistDraft();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  el('kind').onchange = () => { render(); persistDraft(); };
  restoreDraft();
  render();
})();

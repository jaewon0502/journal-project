(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const inputs = ['left', 'right'];
  const files = {left: null, right: null};
  const reads = {left: 0, right: 0};
  const returns = ['first', 'second', 'key'];
  const returnInput = id => byId('blind-return-' + id);
  let bundleFiles = [];
  const bundleReads = new WeakMap();
  let reviewTarget = null;
  let generation = 0, recovery = 0;
  let kit = null, preparing = false, resolving = false;
  let firstReview = null;
  const mode = () => document.querySelector('[name=mode]:checked').value;
  const names = () => mode() === 'revision' ? ['수정 전', '수정 후'] : ['편집자 A', '편집자 B'];
  const percent = value => Number.isFinite(value) ? Number(value.toFixed(1)) + '%' : '산출 대기';
  const ratio = (n, d, value) => percent(value) + ' (' + n + '/' + d + ')';
  const level = v => v === 'na' ? '해당 없음' : Number.isInteger(v) ? v + '단계' : '미평가';
  let showingExample = false;
  function element(tag, content, cls) {
    const node = document.createElement(tag);
    if (content != null) node.textContent = content;
    if (cls) node.className = cls;
    return node;
  }
  function section(title) {
    const panel = element('section', null, 'panel');
    panel.append(element('h3', title));
    return panel;
  }
  function note(content) { return element('p', content, 'note'); }
  function message(content, error = false) {
    byId('status').textContent = content;
    byId('status').classList.toggle('error', error);
  }
  function cancelRecovery() {
    recovery++;
    resolving = false;
    byId('blind-return-status').textContent = '';
  }
  function clearBundleSelection() {
    bundleFiles = [];
    renderBundleSelection();
    blindStatus('blind-bundle-status', '');
  }
  function clearResults(keepBundle = false) {
    generation++;
    kit = null;
    preparing = false;
    byId('blind-downloads').hidden = true;
    byId('blind-prep-status').textContent = '';
    cancelRecovery();
    if (!keepBundle) clearBundleSelection();
    showingExample = false;
    byId('example').textContent = '가상 예시 보기';
    byId('result').hidden = true;
    byId('output').replaceChildren();
    byId('ack').checked = false;
    message('');
    if (reviewTarget?.id && !reviewTarget.example) {
      blindStatus('review-target-status', '집계에 사용한 작업 파일과 대응표 또는 저장한 진행자용 대조 기록을 선택하세요.');
    }
  }
  function updateInputs() {
    const [left, right] = names();
    byId('label-left').textContent = left + ' 작업 파일';
    byId('label-right').textContent = right + ' 작업 파일';
    const both = !!files.left && !!files.right;
    const revision = mode() === 'revision';
    const tagged = revision && inputs.some(side => files[side]?.data.blindReview != null);
    byId('ack-wrap').hidden = !revision || !both || tagged;
    byId('compare').disabled = !both || (revision && (!byId('ack').checked || tagged));
    byId('blind-revision').hidden = !revision;
    byId('blind-prepare').disabled = !revision || byId('compare').disabled || preparing || !!kit;
    byId('blind-next').disabled = !kit || preparing;
    byId('blind-resolve').disabled = !revision || resolving || !returns.every(id => returnInput(id).files.length);
    byId('mode-note').textContent = tagged
      ? 'A·B로 배정된 작업 파일입니다. 아래 진행자용 메뉴의 ‘돌아온 평가 비교’에 두 파일과 대응표를 넣으세요.'
      : revision
      ? '같은 기사의 수정 전·후 작업 JSON을 순서대로 선택하세요.'
      : '같은 기사와 같은 원자료를 각자 검토한 편집자 두 명의 작업 JSON을 선택하세요.';
  }
  function renderPreview(side, file) {
    const preview = byId('preview-' + side);
    preview.replaceChildren(element('strong', file.name));
    const s = file.snapshot;
    preview.append(note(s.article.slice(0, 180) + (s.article.length > 180 ? '…' : '')),
      note((s.demo ? '연습 기록 · ' : '') + '기사 구간 ' + s.rows.length + '개 · 편향 기준 ' + s.assessment.bias.assessed + '/4개 평가'));
    if (s.stale) preview.append(note('현재 기사와 일치하지 않는 이전 평가가 제외되었습니다.'));
    if (s.sourceDraftPending) preview.append(note('원자료 입력 초안이 있습니다. 비교에는 등록된 자료만 사용합니다.'));
  }
  async function readJson(file) {
    const raw = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
      reader.readAsText(file);
    });
    try { return {name:file.name, raw, data:JSON.parse(raw)}; }
    catch (_) { throw new Error('JSON을 읽지 못했습니다. 파일 형식을 확인하세요.'); }
  }
  async function loadFile(side, file) {
    const current = ++reads[side];
    files[side] = null;
    selectFirstReview(null);
    clearResults();
    updateInputs();
    const preview = byId('preview-' + side);
    preview.classList.remove('error');
    preview.textContent = file ? '파일을 읽고 있습니다.' : '';
    if (!file) return;
    try {
      const loaded = await readJson(file);
      if (current !== reads[side]) return;
      const snapshot = window.JournalWorkspaceSnapshot.read(loaded.data);
      files[side] = {...loaded, snapshot};
      renderPreview(side, files[side]);
    } catch (error) {
      if (current !== reads[side]) return;
      preview.classList.add('error');
      preview.textContent = file.name + ' · ' + error.message;
    }
    updateInputs();
  }
  function card(title, stat, basis) {
    const box = element('div', null, 'metric');
    box.append(element('p', title), element('strong', percent(stat.pct)), element('small', stat.numerator + ' / ' + stat.denominator + '개 · ' + basis));
    return box;
  }
  function detail(title) {
    const d = element('details', null, 'case');
    d.append(element('summary', title));
    return d;
  }
  function sourceReference(s, id, label) {
    const source = s.sources?.find(src => src.id === id);
    const reference = note(label + ' · ' + (source ? [source.title || id, source.version, source.locator].filter(Boolean).join(' · ') : id));
    const target = source && window.JournalFactcheck.sourceTarget(source);
    if (target) {
      const link = element('a', target.page ? '원자료 ' + target.page + '쪽 열기' : '원자료 열기');
      link.href = target.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      reference.append(' · ', link);
      if (target.localPage) reference.append(' · PDF 파일 ' + target.localPage + '쪽 직접 확인');
      if (source.originUrl) {
        const origin = element('a', '최초 문서 열기');
        origin.href = source.originUrl;
        origin.target = '_blank';
        origin.rel = 'noopener noreferrer';
        reference.append(' · ', origin);
      }
    }
    return reference;
  }
  function ratingPassage(snapshot, label, quote, rowId) {
    const {article, rows} = snapshot;
    let first = -1, last = -1, start;
    if (rowId) {
      first = last = rows.findIndex(row => row.id === rowId && row.text.includes(quote));
      if (first >= 0) {
        const row = rows[first], offset = row.text.indexOf(quote);
        if (row.positions.length === 1 && offset === row.text.lastIndexOf(quote)) start = row.positions[0].start + offset;
      }
    } else {
      // Older comparison quotes have no row ID and can span more than one row.
      const offset = article.indexOf(quote);
      if (offset >= 0 && offset === article.lastIndexOf(quote)) {
        const containing = at => rows.findIndex(row => row.positions.some(pos => pos.start <= at && at < pos.end));
        first = containing(offset);
        last = containing(offset + quote.length - 1);
        start = offset;
      }
    }
    const passage = element('div', null, 'rating-passage');
    if (first < 0 || last < first) {
      passage.append(note(label + ' · 구간 위치 확인 불가'), element('blockquote', quote));
      return passage;
    }
    const range = first === last ? String(first + 1) : (first + 1) + '–' + (last + 1);
    passage.append(note(label + ' · 구간 ' + range + ' · 앞뒤 문맥'));
    const from = rows[first - 1]?.positions.at(-1).start ?? rows[first].positions[0].start;
    const to = rows[last + 1]?.positions[0].end ?? rows[last].positions.at(-1).end;
    const surrounding = (a, b) => article.slice(a, b).replace(/[\r\n]+/gu, ' ');
    const context = element('blockquote');
    if (start === undefined) {
      passage.append(element('blockquote', quote), note('선택한 구간 안에 같은 표현이 여러 번 나와 정확한 위치를 특정할 수 없습니다.'));
      context.textContent = surrounding(from, to);
    } else {
      context.append(document.createTextNode(surrounding(from, start)), element('mark', quote),
        document.createTextNode(surrounding(start + quote.length, to)));
    }
    passage.append(context);
    return passage;
  }
  function ratingEvidence(s, r, name) {
    const div = element('div');
    div.append(element('h4', name + ' · ' + level(r?.level)));
    if (!r) { div.append(note('저장된 단계가 없습니다.')); return div; }
    if (r.quote) div.append(ratingPassage(s, '기사 구절', r.quote, r.rowId));
    if (r.compareQuote) div.append(ratingPassage(s, '기사의 비교 구절', r.compareQuote, r.compareRowId));
    if (r.sourceQuote) div.append(sourceReference(s, r.sourceId, r.compareSourceQuote ? '첫 구절의 원자료' : '원자료'), element('blockquote', r.sourceQuote));
    if (r.compareSourceQuote) div.append(sourceReference(s, r.compareSourceId, '비교 구절의 원자료'), element('blockquote', r.compareSourceQuote));
    div.append(element('p', '판단 이유 · ' + r.reason));
    if (r.impact) div.append(element('p', '독자 판단에 미치는 영향 · ' + r.impact));
    if (r.direction) div.append(note('기록한 영향 방향 · ' + r.direction));
    return div;
  }
  function singleWordingPositions(snapshot) {
    const positions = new Map();
    snapshot.rows.forEach((row, index) => {
      positions.set(row.text, positions.has(row.text) || row.positions.length !== 1 ? null : index);
    });
    return positions;
  }
  function biasPanel(c, snapshots) {
    const revision = c.mode === 'revision';
    const sameText = revision && !c.bias.hasRevision;
    const panel = section(sameText ? '같은 기사에 대한 편향 평가' : (revision ? '편향의 변화' : '편향 판정 일치도'));
    const b = c.bias;
    const grid = element('div', null, 'metrics');
    if (revision) {
      const pendingSupport = c.originalSupported.filter(row => !row.revisedFullySupported);
      if (pendingSupport.length) {
        const group = detail('수정본에서 다시 대조할 원본 사실 ' + pendingSupport.length + '개');
        const wording = singleWordingPositions(snapshots[1]);
        group.append(note('원본에서 구절 전체가 근거로 지지된 ' + c.originalSupported.length +
          '개 중 같은 구절의 전체 지지를 다시 확인하지 못한 항목입니다. 표현이나 문맥이 바뀐 경우도 포함됩니다.'));
        for (const row of pendingSupport) {
          const item = detail(row.text);
          item.append(decisionEvidence(snapshots[0], row.original, row.text, '원본'),
            decisionEvidence(snapshots[1], row.revised, row.text, '수정본'));
          const candidate = wording.get(row.text);
          if (!row.revised && candidate != null) {
            item.append(note('수정본 ' + (candidate + 1) + '번에 같은 문구가 있습니다. 주변 문맥을 대조하세요.'),
              element('blockquote', snapshots[1].rows[candidate].context));
          }
          group.append(item);
        }
        panel.append(group);
      }
    }
    if (sameText) {
      grid.append(element('p', '두 파일의 기사 본문이 같습니다. 아래에서 같은 본문에 매긴 단계를 대조할 수 있습니다. 수정에 따른 편향 개선율과 악화율을 보려면 수정된 본문을 선택하세요.', 'notice'));
    } else if (revision) {
      if (b.pendingImportant.length) {
        const originalCount = b.improved.denominator + b.pendingImportant.length;
        panel.append(element('p', '원본의 중요한 왜곡 ' + originalCount + '개 중 개선 확인 ' + b.improved.numerator +
          '개 · 여전히 2~3단계 ' + (b.improved.denominator - b.improved.numerator) + '개 · 수정 후 단계 비교 불가 ' +
          b.pendingImportant.length + '개 (' + b.pendingImportant.join(', ') + ').', 'notice'));
      }
      if (b.revisedImportantWithoutPrior.length) {
        const continuing = b.improved.denominator - b.improved.numerator;
        const unmatched = b.revisedImportantWithoutPrior;
        const total = continuing + b.worsened.numerator + unmatched.length;
        panel.append(element('p', '수정본의 중요한 왜곡 ' + total + '개 중 원본도 2~3단계 ' + continuing +
          '개 · 원본 0~1단계에서 악화 ' + b.worsened.numerator + '개 · 원본 단계 비교 불가 ' + unmatched.length +
          '개 (' + unmatched.map(d => d.title + ' · 원본 ' + level(d.prior)).join(', ') + ').', 'notice'));
      }
      grid.append(card('중요한 왜곡 개선율', b.improved, '양쪽 채점 · 2~3단계에서 0~1단계로'),
        card('중요한 왜곡 악화율', b.worsened, '0~1단계에서 2~3단계로'));
    } else {
      grid.append(card('같은 단계로 판정', b.agreement, '양쪽 모두 채점한 기준'));
      const diff = element('div', null, 'metric');
      diff.append(element('p', '2단계 이상 차이'), element('strong', b.largeDifferences + '개'), element('small', '양쪽 모두 채점한 ' + b.paired + '개 기준 중'));
      grid.append(diff);
    }
    panel.append(grid, note('양쪽 모두 채점 ' + b.paired + '/' + b.total + '개 · 미평가 또는 해당 없음으로 비교에서 제외 ' + b.unpaired + '개'));
    const labels = names();
    for (const d of c.dimensions) {
      const comparison = revision ? level(d.left) + ' → ' + level(d.right)
        : 'A ' + level(d.left) + ' / B ' + level(d.right);
      const item = detail(d.title + ' · ' + comparison);
      const pair = element('div', null, 'pair');
      pair.append(ratingEvidence(snapshots[0], d.leftRating, labels[0]), ratingEvidence(snapshots[1], d.rightRating, labels[1]));
      item.append(pair);
      panel.append(item);
    }
    return panel;
  }
  function accuracyPanel(c, snapshots) {
    const panel = section('사실 정확성과 확인 범위');
    const table = element('table');
    const header = table.createTHead().insertRow();
    for (const title of ['지표', ...names()]) {
      const th = element('th', title); th.scope = 'col'; header.append(th);
    }
    const body = table.createTBody();
    const indicators = [
      ['근거 지지율', a => ratio(a.supported, a.adjudicated, a.accuracyPct)],
      ['판정 완료율', a => ratio(a.reviewed, a.total, a.coveragePct)],
      ['근거 충돌 / 미결', a => a.contradicted + '개 / ' + a.unresolved + '개'],
      ['인용 속 사실 주장 충돌 (핵심 중)', a => a.quotedConflict + '개 (핵심 ' + a.coreQuotedConflict.length + '개)'],
      ['의견·평가로 분모 제외', a => a.excluded + '개'],
      ['핵심 주장 충돌 / 미결', a => a.coreRowIds.length ? a.coreContradicted.length + '개 / ' + a.coreUnresolved.length + '개' : '핵심 미지정']
    ];
    for (const [title, format] of indicators) {
      const row = body.insertRow();
      const heading = element('th', title); heading.scope = 'row';
      row.append(heading, element('td', format(c.accuracy.left)), element('td', format(c.accuracy.right)));
    }
    panel.append(table);
    if (c.accuracy.left.quotedConflict || c.accuracy.right.quotedConflict) {
      panel.append(note('발언 귀속을 확인하고 그 내용의 반증까지 기록한 구간은 판정 완료율에 포함하고, 기사 서술의 근거 지지율에서는 제외합니다.'));
      if (c.mode === 'revision') return panel; // Both versions' quoted conflicts have a paired detail below.
      for (const [index, side] of ['left', 'right'].entries()) {
        const a = c.accuracy[side];
        const list = detail(names()[index] + ' · 인용 속 사실 주장 충돌 ' + a.quotedConflict + '개');
        for (const row of a.rows.filter(item => item.category === 'quotedConflict')) {
          const record = snapshots[index].rows.find(item => item.id === row.rowId);
          const item = element('div', null, 'item');
          if (a.coreQuotedConflict.includes(row.rowId)) item.append(element('strong', '핵심 주장'));
          item.append(element('blockquote', record.text), receiptEvidence(snapshots[index], row.rowId));
          list.append(item);
        }
        if (a.quotedConflict) panel.append(list);
      }
    }
    return panel;
  }
  function appendSource(div, snapshot, id, label) {
    div.append(sourceReference(snapshot, id, label));
    const source = snapshot.sources?.find(s => s.id === id);
    if (source?.excerpt) div.append(element('blockquote', source.excerpt));
  }
  function receiptEvidence(snapshot, rowId) {
    const r = snapshot.rows.find(item => item.id === rowId)?.receipt;
    const div = element('div');
    if (!r) return div;
    if (r.reason) div.append(element('p', '판단 이유 · ' + r.reason));
    if (r.correction) div.append(note('근거와 대조한 정정 문구'), element('blockquote', r.correction));
    for (const sourceId of r.sourceIds || []) appendSource(div, snapshot, sourceId, r.status === 'attribution' ? '원발언' : '원자료');
    if (r.contentClaim) div.append(note('내용을 대조한 인용 구간'), element('blockquote', r.contentClaim));
    if (r.contentReason) div.append(element('p', '발언 내용 판단 · ' + r.contentReason));
    for (const id of r.contentSourceIds || []) appendSource(div, snapshot, id, '내용 근거');
    return div;
  }
  function decisionEvidence(snapshot, decision, text, name) {
    const side = element('div');
    side.append(element('h4', name + ' · ' + (decision?.label ?? '대응 구절 미확인')));
    if (!decision) return side;
    if (snapshot.assessment.accuracy.coreRowIds.includes(decision.rowId)) side.append(element('strong', '핵심 주장'));
    if (decision.scope !== text && decision.category !== 'quotedConflict') side.append(note('확인 범위'), element('blockquote', decision.scope));
    side.append(receiptEvidence(snapshot, decision.rowId));
    return side;
  }
  function sameWordingDetails(snapshot, indexes, originalItem, quoted) {
    const total = indexes.reduce((n, index) => n + snapshot.rows[index].positions.length, 0);
    const title = '수정본에서 같은 문구가 나온 위치 ' + total + '곳';
    const list = element('section', null, 'wording-locations');
    originalItem.firstChild.append(element('small', title, 'joint-levels'));
    const guidance = quoted
      ? '앞뒤 문맥에서 발언자를 확인하고, 발언을 입증한 원자료와 인용 속 주장을 검토한 근거를 각각 대조하세요.'
      : '원본과 같은 주장을 하는지 앞뒤 문맥과 수정본의 판정 근거를 대조하세요.';
    list.append(element('h4', title), note(guidance + ' 이 위치들은 판본 간 대응으로 집계하지 않습니다.'));
    function showLocations() {
      if (!originalItem.open) return;
      originalItem.removeEventListener('toggle', showLocations);
      let n = 0;
      for (const index of indexes) {
        const {text, positions} = snapshot.rows[index];
        const decision = snapshot.assessment.accuracy.rows[index];
        for (const [i, pos] of positions.entries()) {
          n++;
          const item = detail('수정본 구간 ' + (index + 1) + ' · 같은 문구 ' + n + '/' + total + ' · ' + decision.label);
          item.open = total === 1;
          const before = positions[i - 1] ?? snapshot.rows[index - 1]?.positions.at(-1) ?? pos;
          const after = positions[i + 1] ?? snapshot.rows[index + 1]?.positions[0] ?? pos;
          item.append(markedContext(snapshot.article, before.start, after.end, [pos]),
            decisionEvidence(snapshot, decision, text, '수정본의 현재 판정'));
          list.append(item);
        }
      }
    }
    originalItem.addEventListener('toggle', showLocations);
    return list;
  }
  function originalConflictList(panel, snapshots, rows, quoted) {
    panel.append(element('h4', (quoted ? '수정 전 인용 속 사실 주장 충돌 ' : '수정 전 충돌 구절 ') + rows.length + '개'));
    for (const row of rows) {
      const {revised} = row;
      const item = detail((revised ? revised.label : '대응 구절 미확인') + ' · ' + row.text);
      const pair = element('div', null, 'pair');
      const before = decisionEvidence(snapshots[0], row.original, row.text, '수정 전');
      const after = decisionEvidence(snapshots[1], revised, row.text, '수정 후');
      if (!revised && row.candidate) {
        after.append(note('저장한 정정 문구와 일치하는 수정본 구절 · ' + row.candidate.label),
          ratingPassage(snapshots[1], '수정본', row.candidate.text, row.candidate.rowId));
        if (row.candidate.scope !== row.candidate.text) {
          after.append(note('확인 범위'), element('blockquote', row.candidate.scope));
        }
        after.append(receiptEvidence(snapshots[1], row.candidate.rowId), note('이 구절이 원래 주장을 바로잡았는지 대조하세요.'));
      }
      if (row.sameWordingRows) {
        after.append(sameWordingDetails(snapshots[1], row.sameWordingRows, item, quoted));
      } else if (!revised && !row.candidate) after.append(note('수정본에서 이 주장과 대응하는 구절을 찾아 대조하세요.'));
      pair.append(before, after);
      item.append(pair);
      panel.append(item);
    }
  }
  function revisedConflictList(panel, snapshots, inventory, title) {
    const groups = [
      ['새로 충돌로 판정된 기존 구절', inventory.newlyObserved],
      ['충돌로 판단한 범위가 달라진 구절', inventory.scopeChanged],
      ['원본과 짝을 확인할 수 없는 충돌 구절', inventory.unmatched],
      ['두 판본 모두 같은 범위에서 충돌한 구절', inventory.persisting]
    ];
    const count = groups.reduce((n, [, rows]) => n + rows.length, 0);
    panel.append(element('h4', title + ' ' + count + '개'));
    for (const [label, rows] of groups) {
      if (!rows.length) continue;
      const group = detail(label + ' · ' + rows.length + '개');
      for (const row of rows) {
        const div = element('div', null, 'item');
        div.append(element('blockquote', row.text));
        const pair = element('div', null, 'pair');
        pair.append(decisionEvidence(snapshots[0], row.priorDecision, row.text, '수정 전'),
          decisionEvidence(snapshots[1], row.revised, row.text, '수정 후'));
        div.append(pair);
        group.append(div);
      }
      panel.append(group);
    }
  }
  function revisionFacts(c, snapshots) {
    const panel = section('원자료와 충돌한 구절 대조');
    panel.append(note('같은 구절의 판정이 바뀌었거나 대응할 구절이 없으면, 새 오류가 생겼는지 원문과 자료를 대조하세요.'));
    originalConflictList(panel, snapshots, c.originalConflicts, false);
    revisedConflictList(panel, snapshots, c.conflicts, '수정 후 원자료와 충돌한 구절');
    if (c.originalQuotedConflicts.length || c.accuracy.right.quotedConflict) {
      originalConflictList(panel, snapshots, c.originalQuotedConflicts, true);
      revisedConflictList(panel, snapshots, c.quotedConflicts, '수정 후 인용 속 사실 주장 충돌');
    }
    return panel;
  }
  function reviewerFacts(c, snapshots) {
    const f = c.facts;
    const panel = section('사실 판정 일치도');
    panel.append(card('같은 범위와 판정으로 확인', f.agreement, '두 사람 모두 지지·충돌을 판정한 구간 (인용 속 사실 주장 포함)'),
      note('전체 ' + f.total + '개 · 한쪽 이상 미결 ' + f.unresolved + '개 · 한쪽 이상 분모 제외 ' + f.excluded + '개 (두 집계는 겹칠 수 있습니다.)'));
    const shared = '양쪽에 동일한 판정 기록 · ' + f.sharedReceipts.length + '/' + f.agreement.denominator + '개';
    if (f.sharedReceipts.length) {
      const list = detail(shared);
      list.append(note('두 작업 파일에 구절·판정·근거·기록 시각이 모두 같은 저장 기록이 있습니다.'));
      for (const row of f.sharedReceipts) list.append(element('blockquote', row.text));
      const a = f.distinctAgreement;
      panel.append(list, note('동일 기록을 제외한 사실 판정 일치율 ' + ratio(a.numerator, a.denominator, a.pct)));
    } else panel.append(note(shared));
    const disputed = detail('판정 또는 확인 범위가 다른 구절 · ' + f.disagreements.length + '개');
    if (!f.disagreements.length) disputed.append(note(f.agreement.denominator
      ? '판정 또는 확인 범위의 차이가 발견되지 않았습니다.' : '두 사람이 모두 판정을 마친 사실 구간이 없습니다.'));
    const labels = {source:'원자료', speech:'원발언', content:'내용 근거'};
    function rowEvidence(row, compareSources = false) {
      const div = element('div', null, 'item');
      div.append(element('blockquote', row.text));
      if (compareSources) div.append(note('선택이 다른 근거 · ' + row.differentSources.map(d => labels[d.role]).join(', ')));
      const pair = element('div', null, 'pair');
      [row.leftLabel, row.rightLabel].forEach((label, i) => {
        const side = element('div');
        side.append(element('h4', names()[i] + ' · ' + label));
        const scope = i ? row.rightScope : row.leftScope;
        if (scope && scope !== row.text) side.append(note('확인 범위 · ' + scope));
        if (compareSources) {
          for (const diff of row.differentSources) {
            const ids = i ? diff.right : diff.left;
            if (!ids.length) side.append(note(labels[diff.role] + ' · 이 편집자만 선택한 자료 없음'));
            for (const id of ids) appendSource(side, snapshots[i], id, labels[diff.role]);
          }
        } else side.append(receiptEvidence(snapshots[i], row.rowId));
        pair.append(side);
      });
      div.append(pair);
      return div;
    }
    for (const row of f.disagreements) disputed.append(rowEvidence(row));
    const evidence = detail('선택한 근거가 다른 구절 · ' + f.evidenceDifferences.length + '개');
    evidence.append(note('두 사람이 판단을 기록하고 한 사람 이상 근거를 선택한 ' + f.evidenceCompared +
      '개 구절을 비교했습니다. 각 구절에는 같은 용도로 한 편집자만 선택한 자료와 발췌문을 표시합니다.'));
    for (const row of f.evidenceDifferences) evidence.append(rowEvidence(row, true));
    const core = detail('핵심 주장 선정이 다른 구절 · ' + f.coreDifferences.length + '개');
    for (const r of f.coreDifferences) {
      core.append(element('blockquote', r.text), note((r.coreLeft ? '편집자 A' : '편집자 B') + '가 핵심 주장으로 지정했습니다.'));
    }
    if (!f.coreDifferences.length) core.append(note('핵심 주장 선정 차이가 없습니다.'));
    panel.append(disputed, evidence, core);
    return panel;
  }
  function selectFirstReview(review) {
    firstReview = review;
    byId('agreement-held').hidden = !review;
    byId('agreement-status').textContent = review
      ? '첫 편집자 묶음 ' + review.key.pairId.slice(0, 8) + '을 선택했습니다. 두 번째 편집자의 결과 두 개와 대응표를 여세요.' : '';
  }
  function clearReturnFiles() {
    for (const id of returns) returnInput(id).value = '';
    clearResults();
    updateInputs();
  }
  function markedContext(article, start, end, positions) {
    const context = element('blockquote');
    let cursor = start;
    for (const pos of positions) {
      context.append(document.createTextNode(article.slice(cursor, pos.start)), element('mark', article.slice(pos.start, pos.end)));
      cursor = pos.end;
    }
    context.append(document.createTextNode(article.slice(cursor, end)));
    return context;
  }
  function markRepeatedPassage(item, snapshot, index, first, total) {
    const {article, rows} = snapshot;
    const positions = rows[index].positions;
    const last = first + positions.length - 1;
    item.firstChild.append(element('small', '같은 문구 ' + total + '곳 중 ' +
      (first === last ? first : first + '–' + last) + '번째 · 기사 검토 구절 ' + (index + 1), 'joint-levels'));
    const start = rows[index - 1]?.positions.at(-1).start ?? positions[0].start;
    const end = rows[index + 1]?.positions[0].end ?? positions.at(-1).end;
    item.append(note('같은 문구가 나온 위치와 앞뒤 원문'), markedContext(article, start, end, positions));
  }
  function jointRetention(panel, joint, editors) {
    const trace = window.JournalRevisionFacts.summarizeFactMatches(joint.factMatches, joint.facts.after);
    if (!trace.total) {
      panel.append(note('원본에서 두 편집자가 구절 전체를 근거로 확인한 사실이 없어 유지 여부를 계산할 수 없습니다.'));
      return;
    }
    panel.append(element('p', '원본에서 두 편집자가 확인한 사실 중 같은 문구와 문맥으로 연결해 수정본에서도 전체 지지를 확인한 수 ' +
      trace.retained + '/' + trace.total + '개', trace.retained === trace.total ? 'note' : 'warn'));
    if (trace.retained === trace.total) return;
    const group = detail('원본 사실을 다시 대조할 구절 ' + (trace.unmatched + trace.changed) + '개');
    group.classList.add('fact-retention');
    group.append(note('수정본에서 대응 구절 미확인 ' + trace.unmatched + '개 · 대응 구절은 찾았으나 두 사람의 전체 지지 미확인 ' +
      trace.changed + '개. 다시 쓴 표현이나 달라진 문맥은 원문과 대조하세요.'));
    const revisedText = editors[0].snapshots[1];
    const wording = singleWordingPositions(revisedText);
    for (const [before, after] of joint.factMatches) {
      if (after !== null && joint.facts.after[after].outcome === 'supported') continue;
      const originalRow = editors[0].snapshots[0].rows[before], text = originalRow.text;
      const item = detail('원본 ' + (before + 1) + '번 · ' + text);
      item.dataset.retentionBefore = before;
      if (joint.factContext.beforeCore[before] === 2) item.append(note('두 편집자가 원본에서 모두 핵심 사실로 표시한 구절입니다.'));
      const candidate = after === null ? wording.get(text) : null;
      for (const [edition, index] of [before, after ?? candidate].entries()) {
        if (index == null) {
          item.append(note('수정본 대응 구절 미확인'));
          continue;
        }
        const side = edition ? '수정본 ' : '원본 ';
        item.append(element('h4', side + (index + 1) + '번 구절'));
        if (candidate != null) {
          if (edition) item.append(note('문구는 같지만 대응 여부를 확정하기 어렵습니다. 두 판본의 앞뒤 문맥을 대조하세요.'));
          item.append(element('blockquote', edition ? revisedText.rows[index].context : originalRow.context));
        }
        const pair = element('div', null, 'pair');
        for (const [person, editor] of editors.entries()) {
          const snapshot = editor.snapshots[edition];
          pair.append(decisionEvidence(snapshot, snapshot.assessment.accuracy.rows[index],
            snapshot.rows[index].text, person ? '둘째 편집자' : '첫 편집자'));
        }
        item.append(pair);
      }
      group.append(item);
    }
    panel.append(group);
    if (trace.unmatched) {
      for (const [i, name] of ['원본', '수정본'].entries()) {
        const fullText = detail('대응 구절을 찾기 위해 ' + name + ' 전문 보기');
        fullText.append(element('blockquote', editors[0].snapshots[i].article));
        panel.append(fullText);
      }
    }
  }
  const contextForms = new WeakMap();
  function mountReviewNotes(panel, editors, record, reopened) {
    const group = panel.querySelector('.core-context');
    if (!record || (!group && !panel.querySelector('.fact-retention'))) return;
    let contextForm;
    if (group) {
      contextForm = window.JournalCoreContextNotesUI.mount({container:group, record, editors,
        notes:reopened?.contextNotes || [], ratingPassage});
      contextForms.set(group, contextForm);
    }
    window.JournalRetentionNotesUI.mount({container:panel, record, editors, notes:reopened?.notes || [],
      contextForm, decisionEvidence,
      async onSave(entries, contexts) {
        const items = editors.flatMap(editor => [editor.keyFile, ...editor.ordered]);
        const saved = await window.JournalRetentionCase.create(record, items, entries, contexts ?? reopened?.contextNotes ?? []);
        downloadJson(saved, '진행자용-대조기록-' + record.before.articleSha256.slice(0, 12) + '.json');
      }});
  }

  function jointFactPanel(joint, editors, record, reopened) {
    const panel = section('편향 평가와 함께 본 사실 판정');
    panel.id = 'joint-facts';
    const before = window.JournalRevisionFacts.summarize(joint.facts.before);
    const after = window.JournalRevisionFacts.summarize(joint.facts.after);
    if (joint.improved.numerator && after.flagged) panel.append(element('p',
      '두 사람이 개선으로 본 편향 항목 ' + joint.improved.numerator + '개 · 수정본에서 한 명 이상 원자료와 충돌한다고 표시한 구절 ' +
        after.flagged + '개', 'warn'));
    jointRetention(panel, joint, editors);
    const coreContext = unmatchedCoreDetails(joint, editors);
    if (coreContext) panel.append(coreContext);
    mountReviewNotes(panel, editors, record, reopened);
    panel.append(window.JournalRevisionFactsView(before, after));
    const originalRows = new Map(joint.factContext.matches.map(([before, after]) => [after, before]));
    for (const role of ['after', 'before']) {
      const isAfter = role === 'after';
      const sameEdition = editors.map(editor => editor.snapshots[isAfter ? 1 : 0]);
      const totals = new Map(), seen = new Map();
      for (const row of sameEdition[0].rows) totals.set(row.text, (totals.get(row.text) || 0) + row.positions.length);
      const flagged = [], disputed = [];
      joint.facts[role].forEach((fact, index) => {
        const row = sameEdition[0].rows[index], passage = row.text;
        const previous = seen.get(passage) || 0;
        seen.set(passage, previous + row.positions.length);
        if (fact.flag === 'none' && fact.outcome !== 'disputed') return;
        const item = detail(passage);
        if (isAfter && fact.flag !== 'none') {
          const original = originalRows.get(index);
          let origin = '원본 대응 구절 미확인';
          if (original !== undefined) {
            const prior = joint.facts.before[original];
            const state = prior.flag !== 'none' ? '충돌 표시 있음' :
              prior.outcome === 'supported' ? '두 편집자가 구절 전체를 근거로 확인' : '충돌 표시 없음 · 전체 지지 미확인';
            origin = '원본 ' + (original + 1) + '번 구절 · ' + state;
          }
          item.append(note('수정본 ' + (index + 1) + '번 구절 · ' + origin));
          if (joint.factContext.afterCore[index] === 2) item.append(note('두 편집자가 수정본에서 모두 핵심 사실로 표시한 구절입니다.'));
        }
        if (totals.get(passage) > 1) markRepeatedPassage(item, sameEdition[0], index, previous + 1, totals.get(passage));
        const pair = element('div', null, 'pair');
        sameEdition.forEach((snapshot, i) => {
          const decision = snapshot.assessment.accuracy.rows[index];
          pair.append(decisionEvidence(snapshot, decision, passage, i ? '둘째 편집자' : '첫 편집자'));
        });
        item.append(pair);
        (fact.flag === 'none' ? disputed : flagged).push(item);
      });
      for (const [items, title, style] of [
        [flagged, '충돌 표시 구절과 근거', 'fact-alerts'],
        [disputed, '충돌 표시 없이 판정이나 범위가 엇갈린 구절', 'fact-disputes']
      ]) {
        if (!items.length) continue;
        const group = detail((isAfter ? '수정 후 ' : '수정 전 ') + title + ' · ' + items.length + '개');
        group.classList.add(style);
        group.dataset.edition = role;
        group.append(...items);
        panel.append(group);
      }
    }
    return panel;
  }
  const editorNames = ['첫 편집자', '둘째 편집자'];
  function unmatchedCoreDetails(joint, editors) {
    const {unmatched: indices} = window.JournalRevisionFacts.coreContextReview(joint.facts, joint.factContext);
    if (!indices.length) return null;
    const group = detail('수정본과 대응을 확인할 원본 핵심 구절 ' + indices.length + '개');
    group.classList.add('core-context');
    group.append(note('두 편집자 모두 핵심으로 골랐지만 구절 전체를 지지하는 공동 판정이 없고, 수정본에서 같은 구절을 연결하지 못했습니다. 다른 표현으로 담겼는지 수정본 전문을 대조하세요.'));
    const [original, revision] = editors[0].snapshots;
    for (const index of indices) {
      const row = original.rows[index];
      const item = detail('원본 ' + (index + 1) + '번 · ' + row.text);
      item.dataset.coreContextBefore = String(index);
      item.append(ratingPassage(original, '원본 기사', row.text, row.id));
      const pair = element('div', null, 'pair');
      editors.forEach((editor, i) => {
        const snapshot = editor.snapshots[0];
        pair.append(decisionEvidence(snapshot, snapshot.assessment.accuracy.rows[index], row.text, editorNames[i]));
      });
      item.append(pair);
      group.append(item);
    }
    const full = detail('수정본 전문에서 대응 구절 찾기');
    full.append(element('blockquote', revision.article));
    group.append(full);
    return group;
  }
  function jointDimensionDetails(dimension, editors) {
    const labels = {improved:'개선', worsened:'악화', high:'중요한 왜곡 유지', low:'0~1단계 유지', unpaired:'비교 보류'};
    const line = [dimension.first, dimension.second].map((d, i) =>
      editorNames[i] + ' ' + level(d.before) + ' → ' + level(d.after) + ' (' + labels[d.change] + ')');
    const item = detail(dimension.title);
    item.dataset.biasAxis = dimension.id;
    item.firstChild.append(element('small', line.join(' / '), 'joint-levels'));
    const pair = element('div', null, 'pair');
    editors.forEach((editor, i) => {
      const column = element('div');
      column.append(element('h4', editorNames[i]));
      editor.snapshots.forEach((snapshot, j) => {
        const rating = snapshot.assessment.bias.items.find(d => d.id === dimension.id).rating;
        column.append(ratingEvidence(snapshot, rating, j ? '수정 후' : '수정 전'));
      });
      pair.append(column);
    });
    item.append(pair);
    return item;
  }

  function jointImprovementRange(range) {
    const panel = element('div');
    panel.id = 'joint-improvement-range';
    panel.append(element('h4', '원본의 중요한 왜곡 전체에서 확인한 개선'));
    if (!range.baseline) {
      panel.append(note('원본에서 두 편집자 모두 2~3단계로 기록한 항목이 없어 개선율을 계산할 수 없습니다.'));
      return panel;
    }
    if (range.notApplicable === range.baseline) {
      panel.append(note('원본 ' + range.baseline + '개 모두 수정본에 ‘해당 없음’ 판정이 있어 개선 여부를 판단할 수 없습니다.'));
      return panel;
    }
    panel.append(element('p', '원본 ' + range.baseline + '개 중 두 사람 모두 개선 확인 ' + range.confirmed + '개 (' + percent(range.lowerPct) + ')'));
    if (range.unresolved) {
      panel.append(element('p', '남은 미평가를 채울 때 가능한 개선율 ' + percent(range.lowerPct) + ' ~ ' +
        percent(range.upperPct) + ' · 추가로 개선을 확인할 수 있는 항목 ' + range.unresolved + '개'));
    }
    if (range.ruledOut) panel.append(note('수정본에 한 사람이라도 2~3단계를 매긴 항목 ' + range.ruledOut + '개'));
    if (range.notApplicable) panel.append(note('수정본에 ‘해당 없음’ 판정이 있어 개선을 확인할 수 없는 항목 ' + range.notApplicable +
      '개. 해당 판정이 유지되면 미평가를 마쳐도 개선 건수에 들지 않습니다.'));
    return panel;
  }

  function jointSeverity(joint) {
    const panel = element('div');
    panel.id = 'joint-severity';
    panel.append(element('h4', '같은 항목에서 두 편집자가 본 왜곡 단계'));
    if (joint.revised.rated) panel.append(element('p', '수정본에서 두 사람이 모두 중요한 왜곡으로 평가한 항목 ' +
      joint.revised.important + '/' + joint.revised.rated + '개 (수정본에 두 사람 모두 점수를 매긴 항목 기준)'));
    if (joint.revised.withoutBaseline) panel.append(note('이 중 ' + joint.revised.withoutBaseline +
      '개는 원본의 평가가 부족해 언제 생긴 왜곡인지 확인이 필요합니다. 아래 항목을 펼쳐 두 사람이 기록한 근거를 대조하세요.'));
    if (!joint.paired) {
      panel.append(note('비교 대기 · 두 편집자가 원본과 수정본에 모두 단계를 매긴 항목이 없습니다.'));
      return panel;
    }
    const {oppositeSteps, withinBandOppositeSteps} = joint.severity;
    const {beforeImportant, afterImportant, paired, relativeReductionPct, deltaPoints} = joint.netSeverityChange;
    const change = element('p');
    change.id = 'joint-net-change';
    const direction = deltaPoints < 0 ? '감소' : '증가';
    const absolute = deltaPoints === 0 ? '비율 차이 0%p' : Number(Math.abs(deltaPoints).toFixed(1)) + '%p ' + direction;
    const relative = relativeReductionPct === null ? '두 편집자가 두 판본을 모두 채점한 항목 중 원본에 함께 2~3단계를 매긴 항목이 없어 상대 변화율 산출 불가'
      : relativeReductionPct === 0 ? '원본 대비 변화 없음 (0%)' : '원본 대비 ' + percent(Math.abs(relativeReductionPct)) + ' ' + direction;
    change.textContent = '두 사람이 모두 중요한 왜곡(2~3단계)으로 본 항목 · 원본 ' +
      beforeImportant + '/' + paired + '개 → 수정본 ' + afterImportant + '/' + paired + '개 · ' + absolute + ' · ' + relative;
    panel.append(change,
      note('한 편집자는 단계를 낮추고 다른 편집자는 높인 항목 ' + oppositeSteps +
        '개 · 그중 둘 다 1단계와 2단계 사이의 경계를 넘지 않은 항목 ' + withinBandOppositeSteps + '개'));
    return panel;
  }
  function jointPanel(current, priorReview, reopened) {
    const panel = section('두 편집자가 함께 확인한 변화');
    panel.id = 'revision-agreement';
    if (!priorReview) {
      if (current.sourceChanged) return null;
      const keep = element('button', '첫 편집자 결과로 선택');
      keep.type = 'button';
      keep.id = 'agreement-keep';
      keep.addEventListener('click', () => {
        selectFirstReview(current);
        clearReturnFiles();
        byId('blind-revision').open = true;
        returnInput('first').focus();
      });
      panel.append(note('두 사람이 같은 두 판본을 따로 평가했다면 이 결과를 선택한 뒤, 다른 편집자의 결과 두 개와 대응표를 여세요. 첫 결과는 이 화면을 열어 둔 동안 보관합니다.'), keep);
      return panel;
    }
    let joint;
    try { joint = reopened?.joint ?? window.JournalRevisionAgreement.compare(priorReview, current); }
    catch (error) {
      panel.append(element('p', error.message, 'warn'), note('아래 수치는 방금 연 편집자 한 사람의 결과입니다.'));
      return panel;
    }
    const grid = element('div', null, 'metrics');
    grid.append(card('두 사람 모두 개선으로 판정', joint.improved, '두 사람 모두 원본을 2~3단계로 평가하고 수정본도 채점한 항목 중'),
      card('두 사람 모두 악화로 판정', joint.worsened, '두 사람 모두 원본을 0~1단계로 평가하고 수정본도 채점한 항목 중'));
    const editors = [priorReview, current];
    panel.append(note(editors.map((r, i) => editorNames[i] + ' 묶음 ' + r.key.pairId.slice(0, 8)).join(' · ')), grid, jointImprovementRange(joint.improvementRange),
      note('네 판정이 모두 있는 항목 ' + joint.paired + '/' + joint.total + '개 · 비교할 단계가 부족한 항목 ' + joint.unpaired +
        '개 · 중요한 왜곡(2~3단계)의 개선·악화·유지 판단이 갈린 항목 ' + joint.disagreed + '개'), jointSeverity(joint));
    if (joint.stableSeverityDifferences) panel.append(note('두 사람 모두 유지로 보았지만 중요한 왜곡이 있는지에 대한 판단이 다른 항목 ' +
      joint.stableSeverityDifferences + '개'));
    const series = element('a', '여러 기사 집계 새 탭에서 열기');
    series.href = 'revision-series.html';
    series.target = '_blank';
    series.rel = 'noopener';
    const actions = element('div', null, 'actions');
    let record;
    if (joint.missingReturns.length) {
      const warning = element('div', null, 'warn');
      warning.id = 'missing-returns';
      warning.append(element('strong', '집계 전에 확인할 파일 ' + joint.missingReturns.length + '개'));
      const problems = {empty:'저장된 판정이 없습니다.', draft:'작성 중인 판정만 있습니다.',
        invalid:'현재 판본에 사용할 수 있는 저장 판정이 없습니다.'};
      const list = element('ul');
      for (const missing of joint.missingReturns) {
        const editor = editors[missing.editor];
        const before = missing.role === 'before';
        const file = editor.ordered[before ? 0 : 1];
        const selected = file.position ? ' · 선택 ' + file.position + '번' : '';
        list.append(element('li', editorNames[missing.editor] + ' · ' + (before ? '수정 전' : '수정 후') +
          ' · 묶음 ' + editor.code + selected + ' · ' + file.name + ' — ' + problems[missing.state]));
      }
      warning.append(list, note('현재 들어온 판정은 아래에서 확인할 수 있습니다. 해당 편집자가 판정을 기록한 결과 파일로 교체하면 기사별 요약을 저장할 수 있습니다.'));
      panel.append(warning);
    } else {
      record = reopened?.record ?? window.JournalRevisionSeries.makeRecord(joint, current.key);
      const save = element('button', '기사별 평가 요약 저장');
      save.type = 'button';
      save.id = 'agreement-export';
      save.addEventListener('click', () => downloadJson(record, '기사평가-' + record.before.articleSha256.slice(0, 12) +
        '-' + record.after.articleSha256.slice(0, 12) + '.json'));
      actions.append(save);
    }
    actions.append(series);
    panel.append(actions, note('집계용 요약에는 편향 점수, 구절별 사실 판정과 충돌 표시, 원본과 수정본의 대응 구절 번호, 판본·원자료 식별값이 담깁니다. 기사 구절과 근거는 원래 작업 파일에 보관됩니다.'));
    for (const dimension of joint.dimensions) panel.append(jointDimensionDetails(dimension, editors));
    panel.append(jointFactPanel(joint, editors, record, reopened), note('아래의 개별 편향 변화와 사실 확인 결과는 둘째 편집자가 제출한 두 판본의 기록입니다.'));
    return panel;
  }
  function show(snapshots, synthetic, restored, priorReview = firstReview, reopened) {
    try {
      const c = window.JournalArticleCompare.compare(...snapshots, mode());
      const output = byId('output');
      output.replaceChildren();
      const sample = synthetic || c.demo;
      byId('result-title').textContent = (sample ? '가상 예시 · ' : '') + (mode() === 'revision' ? '수정 전후 비교 결과' : '두 편집자의 비교 결과');
      if (sample) output.append(element('p', '연습용 평가 결과입니다. 실제 편집자의 효과 측정과 구분해 보세요.', 'warn'));
      if (!synthetic) {
        const [left, right] = names();
        const [first, second] = restored?.ordered || [files.left, files.right];
        if (restored) output.append(note('대응표로 확인한 판본 순서 · 묶음 ' + restored.code));
        output.append(note(left + ' · ' + first.name + ' / ' + right + ' · ' + second.name));
        if (first.raw === second.raw) {
          output.append(element('p', mode() === 'revision'
            ? '두 작업 파일의 내용이 같습니다. 원본과 수정본을 각각 선택했는지 확인하세요.'
            : '두 작업 파일의 내용이 같습니다. 서로 독립적으로 작성한 평가인지 원본을 확인하세요.', 'warn'));
        }
      }
      if (mode() === 'reviewers') output.append(note('독립 일치도로 해석하려면 서로의 기록을 보기 전에 각자 평가했는지 확인하세요.'));
      if (c.sourceChanged) output.append(element('p', '두 판본의 원자료 묶음이 다릅니다. 수치의 변화에는 근거가 바뀐 영향도 포함됩니다.', 'warn'));
      if (restored?.sourceChanged) output.append(element('p', '평가 중 등록된 원자료가 배포할 때와 달라졌습니다. 변경된 자료가 판정에 미친 영향을 확인하세요. 두 편집자의 공통 집계에는 배포 당시 자료로 평가한 결과만 사용합니다.', 'warn'));
      if (mode() === 'revision') {
        const {left, right} = c.accuracy;
        if (right.total < left.total || right.reviewed < left.reviewed || right.adjudicated < left.adjudicated ||
            (left.coveragePct != null && right.coveragePct != null && right.coveragePct < left.coveragePct)) {
          output.append(element('p', '사실 확인 대상 또는 판정 범위가 줄었습니다. 확인 대상 ' + left.total + ' → ' + right.total
            + '개, 지지율 분모 ' + left.adjudicated + ' → ' + right.adjudicated
            + '개, 판정을 마친 구간 ' + left.reviewed + ' → ' + right.reviewed + '개, 완료율 '
            + percent(left.coveragePct) + ' → ' + percent(right.coveragePct) + '입니다.', 'warn'));
        }
        if (c.untracedCore?.length) {
          const check = element('div', null, 'warn');
          check.append(element('strong', '원본 핵심 주장 ' + c.untracedCore.length + '개의 수정 후 위치를 확인하세요.'),
            element('p', '표현이나 주변 문맥이 바뀌면 자동 연결이 어려울 수 있습니다. 아래 구절의 핵심 의미가 수정본에도 남아 있는지 대조하세요.'));
          for (const row of c.untracedCore) check.append(element('blockquote',row.text));
          output.append(check);
        }
      }
      if (restored) {
        const joint = jointPanel(restored, priorReview, reopened);
        if (joint) output.append(joint);
      }
      output.append(biasPanel(c, snapshots), accuracyPanel(c, snapshots), mode() === 'revision' ? revisionFacts(c, snapshots) : reviewerFacts(c, snapshots));
      byId('result').hidden = false;
      showingExample = synthetic;
      byId('example').textContent = synthetic ? '가상 예시 닫기' : '가상 예시 보기';
      message(sample ? '가상 비교 결과를 열었습니다.' : '작업 파일 비교를 마쳤습니다.');
      const factGroup = byId('joint-facts')?.querySelector('.fact-retention');
      const coreGroup = byId('joint-facts')?.querySelector('.core-context');
      if (reopened && factGroup?.querySelector('[data-retention-pending="true"]')) {
        focusReviewGroup(factGroup, true);
      } else if (reopened && coreGroup && contextForms.has(coreGroup)) {
        contextForms.get(coreGroup).focusNext();
      } else if (reopened && factGroup) {
        focusReviewGroup(factGroup, true);
      } else {
        byId('result-title').focus();
        byId('result').scrollIntoView?.({block: 'start'});
      }
    } catch (error) {
      clearResults(); updateInputs();
      message(error.message, true);
    }
  }
  function blindStatus(id, content, error = false) {
    const status = byId(id);
    status.textContent = content;
    status.classList.toggle('error', error);
  }
  async function prepareKit(event) {
    if (event.currentTarget.disabled) return;
    const current = ++generation;
    kit = null;
    byId('blind-downloads').hidden = true;
    preparing = true;
    updateInputs();
    blindStatus('blind-prep-status', '검토용 파일을 준비하고 있습니다.');
    try {
      const ready = await window.JournalBlindRevision.prepare(files.left.data, files.right.data);
      if (current !== generation) return;
      kit = ready;
      blindStatus('blind-prep-status', '묶음 ' + kit.key.pairId.slice(0, 8) + ' · 파일 세 개를 각각 저장하세요.');
      byId('blind-downloads').hidden = false;
    } catch (error) {
      if (current === generation) blindStatus('blind-prep-status', error.message, true);
    } finally {
      if (current === generation) { preparing = false; updateInputs(); }
    }
  }
  function downloadJson(data, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    const link = element('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function downloadKitPart(part) {
    if (!kit || mode() !== 'revision') return;
    const key = part === 'key';
    const code = kit.key.pairId.slice(0, 8);
    downloadJson(key ? kit.key : kit.packets[part], (key ? '진행자전용-대응표-' + code : '검토-' + code + '-' + part) + '.json');
  }
  async function readReturnFile(file, position) {
    try { return {...await readJson(file), position}; }
    catch (error) { throw new Error((position ? position + '번 파일 ' : '') + file.name + ' · ' + error.message); }
  }
  function renderBundleSelection() {
    const list = byId('blind-bundle-list');
    list.replaceChildren();
    byId('blind-bundle-selection').hidden = !bundleFiles.length;
    bundleFiles.forEach((file, index) => {
      const item = element('li');
      const remove = element('button', '빼기');
      remove.type = 'button';
      remove.setAttribute('aria-label', (index + 1) + '번째 파일 ' + file.name + ' 빼기');
      remove.addEventListener('click', () => {
        bundleFiles.splice(index, 1);
        compareBundleSelection();
        byId('blind-bundle-files').focus();
      });
      item.append(document.createTextNode(file.name + ' '), remove);
      list.append(item);
    });
  }
  function focusReviewGroup(group, resume) {
    const pending = resume && group.querySelector('[data-retention-pending="true"]');
    const finished = resume && !pending && group.parentNode.querySelector('[data-retention-summary]');
    if (finished) {
      finished.tabIndex = -1;
      finished.focus();
      finished.scrollIntoView?.({block:'start'});
      return;
    }
    const row = pending || group.querySelector('details');
    group.open = true;
    openReviewRow(row);
  }
  function openReviewRow(row) {
    row.open = true;
    row.firstElementChild.focus();
    row.firstElementChild.scrollIntoView?.({block:'start'});
  }
  function targetMatch(record, joint, key) {
    const min = reviewTarget.coreContext || reviewTarget.quoteCheck ? 4 :
      reviewTarget.retention || reviewTarget.numericCheck ? 3 : 2;
    const series = window.JournalRevisionSeries;
    if (series.reviewId(record) === reviewTarget.id) return record;
    const historical = [7, 6, 5].map(version => series.makeLegacyMatchRecord(joint, key, version));
    for (const prior of historical) {
      if (series.reviewId(prior) === reviewTarget.id) return prior;
    }
    // Pre-v5 links used fewer fields and did not name the passage-matching rule.
    for (const candidate of [record, ...historical]) {
      for (let version = 4; version >= min; version--) {
        if (series.reviewId(candidate, version) === reviewTarget.id) return candidate;
      }
    }
    return null;
  }
  function showTargetEvidence(reviews, reopened) {
    const joint = reopened?.joint ?? window.JournalRevisionAgreement.compare(...reviews);
    if (joint.missingReturns.length) {
      const missing = joint.missingReturns.map(({editor, role}) => {
        const file = reviews[editor].ordered[role === 'before' ? 0 : 1];
        return file.position + '번 ' + file.name;
      });
      throw new Error('저장된 판정을 확인할 수 없는 파일이 있습니다. ' + missing.join(', ') + ' 파일을 교체하세요.');
    }
    const record = reopened?.record ?? window.JournalRevisionSeries.makeRecord(joint, reviews[0].key);
    const match = targetMatch(record, joint, reviews[0].key);
    if (!match) {
      throw new Error('집계에서 선택한 요약과 일치하지 않습니다. 같은 기사의 원본·수정본, 원자료와 당시 편집자 판정을 확인하세요.');
    }
    let panel, group, row, title, quoteResult;
    if (reviewTarget.quoteCheck || reviewTarget.numericCheck) {
      const numeric = reviewTarget.numericCheck;
      const v7 = window.JournalRevisionSeries.makeLegacyMatchRecord(joint, reviews[0].key, 7);
      const v7Links = new Map(v7.factContext.matches);
      const currentLinks = new Map(record.factContext.matches);
      const removed = match.factContext.matches.filter(([before, after]) =>
        (numeric ? v7Links.get(before) === after : v7Links.get(before) !== after) &&
        (numeric || match.factContext.beforeCore[before] === 2 || match.facts.before[before].outcome === 'supported') && currentLinks.get(before) !== after);
      const coreCount = removed.filter(([before]) => match.factContext.beforeCore[before] === 2).length;
      title = numeric ? '이전에 연결한 수치 구절의 조사 대상·단위 대조' : '이전에 연결한 구절의 인용 대응';
      panel = jointFactPanel(joint, reviews, record, reopened);
      quoteResult = element('p', numeric ? '수치의 표제가 달라 자동 대응에서 뺀 원본 구절 ' + removed.length + '개' :
        '발언자 확인을 위해 자동 대응에서 뺀 원본 핵심 구절 ' + coreCount + '개' +
        (removed.length > coreCount ? ' · 그 밖의 공동 지지 구절 ' + (removed.length - coreCount) + '개' : ''));
      quoteResult.tabIndex = -1;
      if (numeric) quoteResult.dataset.numericCheckCount = '';
      else quoteResult.dataset.quoteCheckCount = '';
      const save = element('button', '현재 기준의 기사별 평가 요약 저장');
      save.type = 'button';
      save.onclick = () => downloadJson(record, '기사평가-' + record.before.articleSha256.slice(0, 12) + '.json');
      panel.prepend(quoteResult, save);
      const rows = removed.map(([i]) => panel.querySelector('[data-core-context-before="' + i + '"], [data-retention-before="' + i + '"]'));
      row = rows.find(r => r && (r.dataset.coreContextPending === 'true' || r.dataset.retentionPending === 'true'));
      if (row) row.parentElement.open = true;
    } else if (reviewTarget.axis) {
      const dimension = joint.dimensions.find(d => d.id === reviewTarget.axis);
      panel = section('두 편집자가 기록한 구절과 원자료');
      row = jointDimensionDetails(dimension, reviews);
      panel.append(note('단계는 집계한 요약과 대조했습니다. 발췌문과 판단 이유는 지금 연 작업 파일에서 읽었습니다.'), row);
      title = dimension.title + ' · 수정 전후 판정 근거';
    } else if (reviewTarget.coreContext) {
      group = unmatchedCoreDetails(joint, reviews);
      if (!group) throw new Error('선택한 요약에는 수정본과 다시 대조할 원본 핵심 구절이 없습니다.');
      title = '수정본과 대응을 확인할 원본 핵심 구절';
      panel = section('두 편집자의 원본 판정과 수정본 전문');
      panel.append(group);
      mountReviewNotes(panel, reviews, record, reopened);
    } else {
      panel = jointFactPanel(joint, reviews, record, reopened);
      group = panel.querySelector(reviewTarget.retention ? '.fact-retention' : '.fact-alerts[data-edition="after"]');
      if (!group?.querySelector('details')) throw new Error(reviewTarget.retention ? '선택한 요약에는 다시 대조할 원본 사실이 없습니다.'
        : '선택한 요약에는 수정본과 원자료의 충돌 표시가 없습니다.');
      title = reviewTarget.retention ? '원본 사실과 수정본 대조' : '수정본의 충돌 구절과 근거';
    }
    byId('result-title').textContent = (joint.demo ? '가상 예시 · ' : '') + title;
    byId('output').replaceChildren(panel);
    byId('result').hidden = false;
    const notice = reopened ? '저장한 진행자용 대조 기록을 복원했습니다.'
      : reviewTarget.example ? '연습용 판정 기록을 열었습니다.' : '선택한 파일에서 요약을 다시 계산했습니다.';
    blindStatus('review-target-status', notice + (match !== record
      ? ' 이전 요약의 판본과 판정을 확인했습니다. 구절 대응은 현재 기준으로 다시 계산했습니다.'
      : ' 판본, 원자료 묶음과 익명 판정이 집계에 사용한 요약과 일치합니다.'));
    if (row) openReviewRow(row);
    else if (quoteResult) quoteResult.focus();
    else if (reopened && reviewTarget.coreContext) contextForms.get(group).focusNext();
    else focusReviewGroup(group, reviewTarget.retention && !!reopened);
  }
  function showRecoveredArchive(archive, items, reviews, joint, record) {
    if (reviewTarget && reviewTarget.id !== archive.reviewId &&
        (!record || !targetMatch(record, joint, reviews[0].key))) throw new Error('집계에서 선택한 요약과 일치하지 않습니다.');
    if (record && (reviewTarget?.quoteCheck || reviewTarget?.numericCheck || reviewTarget?.coreContext)) showTargetEvidence(reviews);
    else show(reviews[1].snapshots, false, reviews[1], reviews[0], {joint, record, notes:[]});
    const recoveryFiles = detail('기사 작업 파일 4개와 대응표 2개 꺼내기');
    recoveryFiles.append(note('보완할 작업 파일을 저장해 기사 팩트체크에서 여세요. 대응표는 진행자가 보관합니다.'));
    for (const item of items) {
      const save = element('button', item.name + ' 저장');
      save.type = 'button';
      save.addEventListener('click', () => downloadJson(item.data, item.name));
      recoveryFiles.append(save);
    }
    byId('output').prepend(recoveryFiles);
    for (const [heading, notes] of [['사후 판단', archive.notes], ['핵심 맥락 대조', archive.contextNotes ?? []]]) {
      if (!notes.length) continue;
      const previous = detail('이전 기준으로 기록한 ' + heading + ' ' + notes.length + '개 보기');
      for (const entry of notes) {
        const state = {retained:'유지 확인', changed:'내용 변경', notFound:'대응 구절을 찾지 못함', absent:'대응 구절을 찾지 못함',
          open:'검토 중', pending:'검토 중'}[entry.status];
        previous.append(element('p', '원본 ' + (entry.before + 1) + '번' + (entry.after === null ? '' : ' · 수정본 ' + (entry.after + 1) + '번') +
          ' · ' + state + ' · ' + entry.reason));
      }
      byId('output').prepend(previous);
    }
    blindStatus(reviewTarget ? 'review-target-status' : 'blind-bundle-status',
      '이전 대조 기록의 작업 파일 6개를 열어 현재 기준으로 다시 계산했습니다. 당시 사후 판단을 남기려면 이전 대조 파일도 보관하세요.');
  }
  async function openReviewFiles(items, current, archive) {
    if (current !== recovery) return;
    const reviews = await window.JournalBlindRevision.resolveBundle(items);
    if (current !== recovery) return;
    for (const review of reviews) {
      review.snapshots = [review.before, review.after].map(work => window.JournalWorkspaceSnapshot.read(work));
      review.keyFile = items.find(item => item.data === review.key);
    }
    let reopened;
    if (archive) {
      const joint = window.JournalRevisionAgreement.compare(...reviews);
      if (joint.missingReturns.length && archive.version < 3) {
        showRecoveredArchive(archive, items, reviews, joint, null);
        return;
      }
      const record = window.JournalRevisionSeries.makeRecord(joint, reviews[0].key);
      try { reopened = {joint, record, ...window.JournalRetentionCase.verifyAll(archive, record)}; }
      catch (error) {
        if (error.code !== 'legacy-review-changed') throw error;
        if (archive.version >= 3) {
          const historical = window.JournalRevisionSeries.makeLegacyMatchRecord(joint, reviews[0].key, archive.version + 2);
          window.JournalRetentionCase.verifyLegacyMatchNotes(archive, historical);
        }
        showRecoveredArchive(archive, items, reviews, joint, record);
        return;
      }
    }
    if (reviewTarget) {
      showTargetEvidence(reviews, reopened);
      blindStatus('blind-bundle-status', '');
    } else {
      blindStatus('blind-bundle-status', reopened ? '진행자용 기록에서 기사 두 판본과 사후 대조 기록을 복원했습니다.' :
        '파일 6개의 배정 번호와 수정 전후 판본이 일치합니다.');
      show(reviews[1].snapshots, false, reviews[1], reviews[0], reopened);
    }
  }
  function archivedItems(data) {
    return window.JournalRetentionCase.read(data).items.map((item, index) => ({
      ...item, raw:JSON.stringify(item.data), position:index + 1
    }));
  }

  async function compareBundleSelection() {
    selectFirstReview(null);
    clearResults(true);
    updateInputs();
    renderBundleSelection();
    const current = recovery;
    const count = bundleFiles.length;
    if (count !== 6) {
      const message = count > 6 ? '개를 선택했습니다. 작업 파일 4개와 대응표 2개만 남겨 주세요.'
        : '/6개를 선택했습니다.';
      blindStatus('blind-bundle-status', '파일 ' + count + message, count > 6);
      if (!count || count > 6) return;
    } else {
      blindStatus('blind-bundle-status', '파일 6개의 배정 번호와 기사 판본을 확인하고 있습니다.');
    }
    try {
      const items = await Promise.all(bundleFiles.map(async (file, index) => {
        if (!bundleReads.has(file)) bundleReads.set(file, readJson(file));
        try { return {...await bundleReads.get(file), position:index + 1}; }
        catch (error) { throw new Error((index + 1) + '번 파일 ' + file.name + ' · ' + error.message); }
      }));
      if (current !== recovery) return;
      const archive = items.find(item => item.data?.format === window.JournalRetentionCase.format);
      if (archive) {
        if (count !== 1) throw new Error('진행자용 대조 기록에는 원래 파일이 모두 들어 있습니다. 해당 기록 한 개만 선택하세요.');
        await openReviewFiles(archivedItems(archive.data), current, archive.data);
        return;
      }
      if (items.some(item => item.data?.format === 'journal-revision-series-record')) {
        throw new Error('선택한 기사별 평가 요약은 여러 기사 집계용입니다. 여기서는 진행자용 대조 기록이나 당시의 작업 파일과 대응표를 여세요.');
      }
      if (count < 6) return;
      await openReviewFiles(items, current);
    } catch (error) {
      if (current === recovery) blindStatus('blind-bundle-status', error.message, true);
    }
  }
  async function restoreKit() {
    if (byId('blind-resolve').disabled) return;
    clearResults();
    const current = ++recovery;
    resolving = true;
    updateInputs();
    blindStatus('blind-return-status', '파일과 대응표를 확인하고 있습니다.');
    try {
      const [first, second, key] = await Promise.all(returns.map(id => readReturnFile(returnInput(id).files[0])));
      if (current !== recovery) return;
      const result = await window.JournalBlindRevision.resolve(key.data, first.data, second.data);
      if (current !== recovery) return;
      const ordered = first.data === result.before ? [first, second] : [second, first];
      const code = key.data.pairId.slice(0, 8);
      const snapshots = [result.before, result.after].map(work => window.JournalWorkspaceSnapshot.read(work));
      blindStatus('blind-return-status', '묶음 ' + code + '의 수정 전후 순서를 복원했습니다.');
      show(snapshots, false, {...result, ordered, code, snapshots, key:key.data, keyFile:key});
    } catch (error) {
      if (current === recovery) blindStatus('blind-return-status', error.message, true);
    } finally {
      if (current === recovery) { resolving = false; updateInputs(); }
    }
  }
  for (const side of inputs) {
    const input = byId('file-' + side);
    input.addEventListener('change', () => loadFile(side, input.files[0]));
  }
  document.querySelectorAll('[name=mode]').forEach(radio => radio.addEventListener('change', () => {
    selectFirstReview(null);
    clearReturnFiles();
  }));
  byId('agreement-reset').addEventListener('click', () => {
    selectFirstReview(null);
    clearReturnFiles();
    returnInput('first').focus();
  });
  byId('ack').addEventListener('change', () => {
    if (!byId('ack').checked) clearResults();
    updateInputs();
  });
  byId('compare').addEventListener('click', () => {
    if (byId('compare').disabled) return;
    cancelRecovery();
    clearBundleSelection();
    updateInputs();
    show([files.left.snapshot, files.right.snapshot], false);
  });
  byId('example').addEventListener('click', () => {
    if (showingExample) { clearResults(); updateInputs(); return; }
    clearResults(); updateInputs();
    try { show(window.JournalCompareExample(mode()), true); }
    catch (error) { message(error.message, true); }
  });
  byId('blind-prepare').addEventListener('click', prepareKit);
  byId('blind-next').addEventListener('click', prepareKit);
  for (const part of ['A', 'B', 'key']) {
    byId('blind-download-' + part.toLowerCase()).addEventListener('click', () => downloadKitPart(part));
  }
  for (const id of returns) returnInput(id).addEventListener('change', () => {
    clearResults(); updateInputs();
  });
  const bundleInput = byId('blind-bundle-files');
  bundleInput.addEventListener('change', () => {
    if (!bundleInput.files.length) return;
    bundleFiles = bundleFiles.concat(Array.from(bundleInput.files));
    bundleInput.value = '';
    compareBundleSelection();
  });
  byId('blind-bundle-clear').addEventListener('click', () => {
    bundleFiles = [];
    compareBundleSelection();
    bundleInput.focus();
  });
  byId('blind-resolve').addEventListener('click', restoreKit);
  const picker = byId('blind-bundle-picker');
  const resumeExample = byId('review-example-resume');
  resumeExample.addEventListener('click', () => {
    resumeExample.hidden = true;
    picker.hidden = false;
    bundleInput.focus();
  });
  const originalParent = picker.parentNode;
  const nextField = picker.nextElementSibling;
  async function openCoordinatorLink() {
    const requested = /^#review(?:=|&|$)/.test(location.hash);
    const leaving = reviewTarget && !requested;
    if (reviewTarget || requested) {
      selectFirstReview(null);
      reviewTarget = null;
      clearReturnFiles();
      byId('inputs').hidden = requested;
      byId('review-target').hidden = !requested;
      resumeExample.hidden = true;
      document.querySelector('main > .intro').hidden = requested;
      picker.hidden = false;
      blindStatus('review-target-status', '');
      if (!requested) {
        originalParent.insertBefore(picker, nextField);
      }
    }
    if (requested) {
      const match = /^#review=([a-f0-9]{64})(?:&focus=(retention|core-context|quote-check|numeric-check|bias-(wording|framing|omission|standards)))?(?:&example=(library|quote))?$/.exec(location.hash);
      const packagedQuote = byId('quote-practice');
      reviewTarget = {id:match?.[1], retention:match?.[2] === 'retention', coreContext:match?.[2] === 'core-context',
        quoteCheck:match?.[2] === 'quote-check', numericCheck:match?.[2] === 'numeric-check', axis:match?.[3], example:match?.[4] === 'quote' && !packagedQuote ? null : match?.[4]};
      resumeExample.hidden = !(reviewTarget.example && (reviewTarget.retention || reviewTarget.coreContext));
      byId('review-upload').append(picker);
      picker.hidden = !match || reviewTarget.example;
      if (!match) {
        blindStatus('review-target-status', '기사 요약을 식별할 수 없는 링크입니다. 여러 기사 집계에서 해당 기사를 다시 선택하세요.', true);
        byId('review-target-title').focus();
        return;
      }
      if (!reviewTarget.example) {
        blindStatus('review-target-status', '집계에 사용한 작업 파일과 대응표 또는 저장한 진행자용 대조 기록을 선택하세요.');
        bundleInput.focus();
        return;
      }
      const current = recovery;
      blindStatus('review-target-status', '연습 기사의 두 판본과 근거를 열고 있습니다.');
      try {
        if (reviewTarget.example === 'quote') {
          const archive = JSON.parse(packagedQuote.textContent);
          await openReviewFiles(archivedItems(archive), current, archive);
        } else {
          const items = await window.JournalRevisionEvidenceExample.files();
          await openReviewFiles(items, current);
        }
      } catch (error) {
        if (current === recovery) blindStatus('review-target-status', error.message, true);
      }
      return;
    }
    if (location.hash === '#blind-revision' && mode() === 'revision') byId('blind-revision').open = true;
    if (leaving) (byId('blind-revision').open && mode() === 'revision' ? bundleInput : byId('inputs')).focus();
  }
  for (const link of document.querySelectorAll('a[href="#inputs"]')) link.addEventListener('click', event => {
    if (!reviewTarget) return;
    event.preventDefault();
    (picker.hidden ? byId('review-target-title') : bundleInput).focus();
  });
  window.addEventListener('hashchange', openCoordinatorLink);
  updateInputs();
  openCoordinatorLink();
})();

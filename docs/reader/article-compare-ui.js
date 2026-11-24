(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const inputs = ['left', 'right'];
  const files = {left: null, right: null};
  const reads = {left: 0, right: 0};
  const returns = ['first', 'second', 'key'];
  const returnInput = id => byId('blind-return-' + id);
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
  function clearResults() {
    generation++;
    kit = null;
    preparing = false;
    byId('blind-downloads').hidden = true;
    byId('blind-prep-status').textContent = '';
    cancelRecovery();
    showingExample = false;
    byId('example').textContent = '가상 예시 보기';
    byId('result').hidden = true;
    byId('output').replaceChildren();
    byId('ack').checked = false;
    message('');
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
  function ratingEvidence(s, r, name) {
    const div = element('div');
    div.append(element('h4', name + ' · ' + level(r?.level)));
    if (!r) { div.append(note('저장된 단계가 없습니다.')); return div; }
    if (r.quote) div.append(note('기사 구절'), element('blockquote', r.quote));
    if (r.compareQuote) div.append(note('기사의 비교 구절'), element('blockquote', r.compareQuote));
    if (r.sourceQuote) div.append(sourceReference(s, r.sourceId, '원자료'), element('blockquote', r.sourceQuote));
    div.append(element('p', '판단 이유 · ' + r.reason));
    if (r.impact) div.append(element('p', '독자 판단에 미치는 영향 · ' + r.impact));
    if (r.direction) div.append(note('기록한 영향 방향 · ' + r.direction));
    return div;
  }
  function biasPanel(c, snapshots) {
    const revision = c.mode === 'revision';
    const panel = section(revision ? '편향의 변화' : '편향 판정 일치도');
    const b = c.bias;
    const grid = element('div', null, 'metrics');
    if (revision) {
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
  function originalConflictList(panel, snapshots, rows, quoted) {
    panel.append(element('h4', (quoted ? '수정 전 인용 속 사실 주장 충돌 ' : '수정 전 충돌 구절 ') + rows.length + '개'));
    for (const row of rows) {
      const {revised} = row;
      const item = detail((revised ? revised.label : '대응 구절 미확인') + ' · ' + row.text);
      const pair = element('div', null, 'pair');
      const before = decisionEvidence(snapshots[0], row.original, row.text, '수정 전');
      const after = decisionEvidence(snapshots[1], revised, row.text, '수정 후');
      if (!revised && row.candidate) {
        after.append(note('저장한 정정 문구와 일치하는 수정본 구절 · ' + row.candidate.label), element('blockquote', row.candidate.text));
        if (row.candidate.scope !== row.candidate.text) {
          after.append(note('확인 범위'), element('blockquote', row.candidate.scope));
        }
        after.append(receiptEvidence(snapshots[1], row.candidate.rowId), note('이 구절이 원래 주장을 바로잡았는지 대조하세요.'));
      } else if (!revised) after.append(note('수정본에서 이 주장과 대응하는 구절을 찾아 대조하세요.'));
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
  function jointPanel(current) {
    const panel = section('두 편집자가 함께 확인한 변화');
    panel.id = 'revision-agreement';
    if (!firstReview) {
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
    try { joint = window.JournalRevisionAgreement.compare(firstReview, current); }
    catch (error) {
      panel.append(element('p', error.message, 'warn'), note('아래 수치는 방금 연 편집자 한 사람의 결과입니다.'));
      return panel;
    }
    const grid = element('div', null, 'metrics');
    grid.append(card('두 사람 모두 개선으로 판정', joint.improved, '두 사람 모두 원본을 2~3단계로 평가하고 수정본도 채점한 항목 중'),
      card('두 사람 모두 악화로 판정', joint.worsened, '두 사람 모두 원본을 0~1단계로 평가하고 수정본도 채점한 항목 중'));
    const editors = [firstReview, current];
    const editorNames = ['첫 편집자', '둘째 편집자'];
    panel.append(note(editors.map((r, i) => editorNames[i] + ' 묶음 ' + r.key.pairId.slice(0, 8)).join(' · ')), grid,
      note('네 판정이 모두 있는 항목 ' + joint.paired + '/' + joint.total + '개 · 비교할 단계가 부족한 항목 ' + joint.unpaired +
        '개 · 개선·악화·유지 판단이 갈린 항목 ' + joint.disagreed + '개'));
    if (joint.stableSeverityDifferences) panel.append(note('두 사람 모두 유지로 보았지만 중요한 왜곡이 있는지에 대한 판단이 다른 항목 ' +
      joint.stableSeverityDifferences + '개'));
    const labels = {improved:'개선', worsened:'악화', high:'중요한 왜곡 유지', low:'0~1단계 유지', unpaired:'비교 보류'};
    for (const dimension of joint.dimensions) {
      const line = [dimension.first, dimension.second].map((d, i) =>
        editorNames[i] + ' ' + level(d.before) + ' → ' + level(d.after) + ' (' + labels[d.change] + ')');
      const item = detail(dimension.title);
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
      panel.append(item);
    }
    panel.append(note('아래의 편향 변화와 사실 확인 결과는 둘째 편집자가 제출한 두 판본의 기록입니다.'));
    return panel;
  }
  function show(snapshots, synthetic, restored) {
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
        const joint = jointPanel(restored);
        if (joint) output.append(joint);
      }
      output.append(biasPanel(c, snapshots), accuracyPanel(c, snapshots), mode() === 'revision' ? revisionFacts(c, snapshots) : reviewerFacts(c, snapshots));
      byId('result').hidden = false;
      showingExample = synthetic;
      byId('example').textContent = synthetic ? '가상 예시 닫기' : '가상 예시 보기';
      message(sample ? '가상 비교 결과를 열었습니다.' : '작업 파일 비교를 마쳤습니다.');
      byId('result-title').focus();
      byId('result').scrollIntoView?.({block: 'start'});
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
  function downloadKitPart(part) {
    if (!kit || mode() !== 'revision') return;
    const key = part === 'key';
    const data = key ? kit.key : kit.packets[part];
    const code = kit.key.pairId.slice(0, 8);
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    const link = element('a');
    link.href = url;
    link.download = (key ? '진행자전용-대응표-' + code : '검토-' + code + '-' + part) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function restoreKit() {
    if (byId('blind-resolve').disabled) return;
    clearResults();
    const current = ++recovery;
    resolving = true;
    updateInputs();
    blindStatus('blind-return-status', '파일과 대응표를 확인하고 있습니다.');
    try {
      const [first, second, key] = await Promise.all(returns.map(async id => {
        const file = returnInput(id).files[0];
        try { return await readJson(file); }
        catch (error) { throw new Error(file.name + ' · ' + error.message); }
      }));
      if (current !== recovery) return;
      const result = await window.JournalBlindRevision.resolve(key.data, first.data, second.data);
      if (current !== recovery) return;
      const ordered = first.data === result.before ? [first, second] : [second, first];
      const code = key.data.pairId.slice(0, 8);
      const snapshots = [result.before, result.after].map(work => window.JournalWorkspaceSnapshot.read(work));
      blindStatus('blind-return-status', '묶음 ' + code + '의 수정 전후 순서를 복원했습니다.');
      show(snapshots, false, {...result, ordered, code, snapshots, key:key.data});
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
  byId('blind-resolve').addEventListener('click', restoreKit);
  function openCoordinatorLink() {
    if (location.hash === '#blind-revision' && mode() === 'revision') byId('blind-revision').open = true;
  }
  window.addEventListener('hashchange', openCoordinatorLink);
  updateInputs();
  openCoordinatorLink();
})();

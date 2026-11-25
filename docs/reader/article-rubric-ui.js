// Offline article-level assessment, shared by the reader's results and saved workspace.
(function (root) {
  'use strict';

  const api = root.JournalArticleRubric;
  const lastBinding = new WeakMap();
  const {copyFields, restoreDraft} = api;
  const text = (tag, value, cls) => {
    const el = document.createElement(tag);
    if (value !== undefined) el.textContent = value;
    if (cls) el.className = cls;
    return el;
  };
  function btn(label, handle) {
    const el = text('button', label);
    el.type = 'button';
    el.addEventListener('click', handle);
    return el;
  }
  function select(options) {
    const el = text('select');
    for (const [value, label] of options) {
      const option = text('option', label);
      option.value = value;
      el.append(option);
    }
    return el;
  }
  function field(title, input) {
    const label = text('label', undefined, 'rub-field');
    label.append(text('span', title), input);
    return label;
  }
  function area() {
    const el = text('textarea');
    el.rows = 2;
    return el;
  }
  function disclosure(label, name) {
    const el = text('details', undefined, 'rub-disclosure');
    el.dataset.section = name;
    el.append(text('summary', label));
    return el;
  }
  // Keep source coordinates in the original excerpt. The stored evidence is
  // still the editor's exact quotation; choosing a line never records a score.
  function sourceLinePicker(title, quote) {
    const choices = select([]);
    const label = field(title, choices);
    label.hidden = true;
    let previousSource;
    function sync(source) {
      if (previousSource !== source) {
        previousSource = source;
        const placeholder = new Option('행을 선택하세요', '');
        placeholder.disabled = true;
        choices.replaceChildren(placeholder);
        const lines = (source?.excerpt || '').split(/\r\n|[\n\r\u2028\u2029]/u).map(line => line.trim());
        const seen = new Set(), duplicates = new Set();
        for (const line of lines) {
          if (seen.has(line)) duplicates.add(line);
          seen.add(line);
        }
        if (lines.filter(Boolean).length > 1) lines.forEach((line, i) => {
          if (line && !duplicates.has(line)) choices.add(new Option((i + 1) + '행 · ' + line, line));
        });
        label.hidden = choices.length < 2;
      }
      choices.value = quote.value;
      if (choices.selectedIndex < 0) choices.selectedIndex = 0;
    }
    choices.addEventListener('change', () => {
      if (!choices.value) return;
      quote.value = choices.value;
      quote.dispatchEvent(new Event('input', {bubbles:true}));
    });
    return {label,sync};
  }
  function sourceLabel(s) {
    return [s.title || s.id, s.version, s.locator].filter(Boolean).join(' · ');
  }
  function sourceLink(s) {
    return s ? root.JournalSourceReader.link(s) : null;
  }
  function scoreName(value) {
    return value === 'na' ? '해당 없음' : String(value) + '단계 · ' + api.severityLabels[value];
  }
  function scaleList(dim) {
    const levels = text('ol', undefined, 'rub-scale');
    levels.start = 0;
    for (const desc of dim.levels) levels.append(text('li', desc));
    return levels;
  }
  function showGuide() {
    const guide = document.getElementById('rubric-guide');
    if (!guide) return;
    if (new URLSearchParams(root.location.search).get('study') === '1') {
      guide.hidden = true;
      return;
    }
    const scales = document.getElementById('rubric-guide-scales');
    scales.append(text('p', api.severityLabels.map((_, i) => scoreName(i)).join(' / ')));
    for (const dim of api.dimensions) {
      const axis = text('section', undefined, 'guide-axis');
      axis.append(text('h3', dim.title), text('p', dim.question), scaleList(dim));
      scales.append(axis);
    }
    function openLinkedGuide() {
      if (root.location.hash === '#rubric-guide') guide.open = true;
    }
    openLinkedGuide();
    root.addEventListener('hashchange', openLinkedGuide);
    document.getElementById('print-rubric').addEventListener('click', () => {
      document.documentElement.classList.add('print-rubric');
      root.print();
    });
    root.addEventListener('afterprint', () => document.documentElement.classList.remove('print-rubric'));
  }
  function render(container, report, sources, saved, onChange, rawDraft, onDraft, reviewAction) {
    if (!container || !api) return;
    const binding = api.bind(report);
    const open = new Set([...container.querySelectorAll('details[data-section][open]')].map(d => d.dataset.section));
    const sameContext = lastBinding.get(container) === binding;
    const draft = restoreDraft(report, sources, rawDraft, saved) || {binding, activeId: '', entries: {}};
    let review = api.evaluate(report, sources, saved);
    let assessment = review.saved;
    lastBinding.set(container, binding);
    let summaryBox, biasBox, caseList;
    const editors = new Map();
    const sourceById = new Map(sources.map(s => [s.id, s]));
    const rowById = new Map(report.rows.map((row, i) => [row.id, {row, n: i + 1}]));

    function writeDraft() {
      if (typeof onDraft === 'function') {
        const result = Object.keys(draft.entries).length ? {binding, activeId: draft.activeId, entries: {...draft.entries}} : null;
        onDraft(result);
      }
    }
    // Ratings excluded as stale still sit in the saved assessment. They come back if the
    // reviewer cancels the sentence edit, so a rubric change must not erase them silently.
    const staleRatings = review.stale && saved?.ratings ? Object.keys(saved.ratings).filter(id => !Object.hasOwn(assessment?.ratings || {}, id)).length : 0;
    let discardConfirmed = false;
    function commit(coreRowIds, ratings) {
      if (staleRatings && !discardConfirmed) {
        if (!root.confirm('현재 판단과 맞지 않아 제외한 이전 기사 평가 ' + staleRatings + '개가 지워집니다. 계속할까요? 취소하면 이전 평가를 보관하므로 작업 파일을 먼저 저장할 수 있습니다.')) return false;
        discardConfirmed = true;
      }
      assessment = coreRowIds.length || Object.keys(ratings).length ? api.save(report, sources, {coreRowIds, ratings}) : null;
      review = api.evaluate(report, sources, assessment);
      if (typeof onChange === 'function') onChange(assessment);
      return true;
    }
    function replaceRating(id, value) {
      const ratings = {...assessment?.ratings};
      if (value) ratings[id] = value; else delete ratings[id];
      return commit(assessment?.coreRowIds || [], ratings);
    }
    function metric(label, numerator, denominator, value) {
      const box = text('div', undefined, 'rub-metric');
      const number = Number.isFinite(value) ? Number(value.toFixed(1)).toLocaleString('ko-KR') + '%' : '산출 대기';
      box.append(text('p', label), text('strong', number), text('small', numerator + ' / ' + denominator + '개 구간'));
      return box;
    }
    function accuracySummary() {
      const a = review.accuracy;
      const cards = text('div', undefined, 'rub-metrics');
      cards.append(metric('판정한 구간 중 근거가 지지한 비율', a.supported, a.adjudicated, a.accuracyPct),
        metric('판정 대상 중 확인을 마친 비율', a.reviewed, a.total, a.coveragePct));
      const counts = text('p', '근거 지지 ' + a.supported + ' · 원문과 근거 충돌 ' + a.contradicted + ' · 인용 속 사실 주장 충돌 ' + a.quotedConflict + ' · 미결 ' + a.unresolved + ' · 의견 제외 ' + a.excluded, 'rub-counts');
      const centralConcern = a.coreContradicted.length || a.coreQuotedConflict.length || a.coreUnresolved.length || a.coreExcluded.length || a.coreLimited.length;
      summaryBox.replaceChildren(text('h3', '사실 정확성'), cards, counts, text('p', a.summary, centralConcern ? 'callout' : 'rub-note'));
      const listTitle = container.querySelector('[data-section="accuracy"] > summary');
      if (listTitle) listTitle.textContent = '구간별 집계와 핵심 주장 · ' + (a.coreRowIds.length ? a.coreRowIds.length + '개 지정' : '핵심 구절 미지정');
    }
    function accuracyRows() {
      caseList.replaceChildren();
      for (const a of review.accuracy.rows) {
        const record = rowById.get(a.rowId);
        if (!record) continue;
        const li = text('li');
        const check = text('input');
        check.type = 'checkbox';
        check.checked = (assessment?.coreRowIds || []).includes(a.rowId);
        check.dataset.coreRow = a.rowId;
        check.setAttribute('aria-label', '구간 ' + record.n + ': 제목 또는 핵심 주장으로 표시');
        check.onchange = () => {
          const ids = new Set(assessment?.coreRowIds || []);
          if (check.checked) ids.add(a.rowId); else ids.delete(a.rowId);
          if (!commit([...ids], assessment?.ratings || {})) { check.checked = !check.checked; return; }
          accuracySummary();
        };
        const bar = text('div', undefined, 'rub-unit');
        const mark = text('label');
        mark.append(check, document.createTextNode(' 핵심 주장'));
        bar.append(text('strong', '구간 ' + record.n + ' · ' + a.label), mark);
        li.append(bar, text('p', record.row.text, 'verbatim'));
        if (a.scope && a.scope !== record.row.text) li.append(text('small', (a.category === 'quotedConflict' ? '원자료와 충돌한 인용 구절 · ' : '원자료로 확인한 사실 구절 · ') + a.scope, 'rub-note'));
        if (reviewAction) li.append(reviewAction(record.row, record.n));
        caseList.append(li);
      }
    }
    function biasSummary() {
      const b = review.bias;
      biasBox.replaceChildren(text('h3', '편향의 근거와 정도'), text('p', b.summary, 'rub-bias-summary'),
        text('p', '근거로 채점 ' + b.assessed + '/' + api.dimensions.length + '개 기준 · 해당 없음 ' + b.notApplicable + ' · 미평가 ' + b.unknown, 'rub-counts'));
    }
    function stage(id, value) {
      const previous = assessment?.ratings?.[id] || draft.entries[id]?.previous;
      const legacyPrevious = draft.entries[id]?.legacyPrevious;
      if (assessment?.ratings?.[id] && !replaceRating(id, null)) return false;
      draft.entries[id] = {...copyFields(value), ...(previous ? {previous} : {}), ...(legacyPrevious ? {legacyPrevious} : {})};
      draft.activeId = id;
      writeDraft();
      updateDimension(id);
      biasSummary();
      return true;
    }
    function updateDimension(id) {
      const state = editors.get(id);
      if (!state) return;
      const r = assessment?.ratings?.[id];
      const entry = draft.entries[id];
      const needsEvidence = id === 'standards' && /^[0-3]$/.test(entry?.level) && !entry.compareSourceQuote.trim();
      const priorPair = id === 'standards' && entry?.legacyPrevious?.compareSourceQuote;
      state.badge.textContent = needsEvidence ? '둘째 근거 필요 · 미평가' : priorPair ? '이전 근거 재확인 · 미평가' :
        entry ? '작성 중 · 집계 제외' : r ? scoreName(r.level) : '미평가';
    }
    function showDimension(dim) {
      const section = disclosure('', 'dim-' + dim.id);
      const heading = section.querySelector('summary');
      const badge = text('span', '', 'rub-badge');
      heading.append(text('strong', dim.title), document.createTextNode(' '), badge);
      section.append(text('p', dim.question, 'rub-note'));
      if (dim.id === 'omission') section.append(text('p', '보도 당시에 확인할 수 있었던 자료와 대조하세요. 이후에 처음 밝혀진 사실은 그때의 누락 근거로 쓰기 어렵습니다.', 'rub-note'));
      const standards = dim.id === 'standards';
      if (standards) section.append(text('p', '0~3단계 모두 두 주장의 근거가 필요합니다. 같은 원자료라면 각 주장을 다룬 대목을 고르세요. 자료 미제출을 근거로 쓸 때는 대상과 기간을 확인할 수 있는 명부나 회신을 인용하세요. 한쪽 근거를 아직 찾지 못했다면 미평가로 두세요.', 'rub-note'));
      const scale = disclosure('단계별 판단 기준', 'scale-' + dim.id);
      scale.append(scaleList(dim)); section.append(scale);
      const body = text('div', undefined, 'rub-body');
      const feedback = text('p', '', 'rub-feedback');
      feedback.setAttribute('role', 'status');
      section.append(body, feedback);
      editors.set(dim.id, {badge});
      function show() {
        const savedRating = assessment?.ratings?.[dim.id];
        const pending = draft.entries[dim.id];
        updateDimension(dim.id);
        body.replaceChildren();
        if (standards && pending?.legacyPrevious?.compareSourceQuote) {
          const prior = pending.legacyPrevious;
          try {
            api.save(report, sources, {coreRowIds:[], ratings:{standards:{...prior, level:Number(prior.level)}}});
          } catch (error) {
            body.append(text('p', '이전 점수는 집계에서 제외했습니다. ' + error.message, 'callout'));
          }
        }
        if (savedRating && !pending) {
          const entries = [];
          if (savedRating.rowId) entries.push(['기사 구절 · 구간 ' + rowById.get(savedRating.rowId)?.n, savedRating.quote]);
          const compareNumber = rowById.get(savedRating.compareRowId)?.n;
          const comparison = [compareNumber ? '비교 구절 · 구간 ' + compareNumber : '비교 구절', savedRating.compareQuote];
          if (savedRating.compareQuote && !standards) entries.push(comparison);
          if (savedRating.sourceId) {
            const s = sourceById.get(savedRating.sourceId);
            entries.push([(standards ? '첫째 구절의 근거 · ' : '대조한 근거 · ') + sourceLabel(s), savedRating.sourceQuote, s]);
          }
          if (savedRating.compareQuote && standards) entries.push(comparison);
          if (savedRating.compareSourceId) {
            const s = sourceById.get(savedRating.compareSourceId);
            entries.push(['둘째 구절의 근거 · ' + sourceLabel(s), savedRating.compareSourceQuote, s]);
          }
          entries.push(['판단 이유', savedRating.reason]);
          if (savedRating.impact) entries.push(['독자 해석에 미치는 영향', savedRating.impact]);
          if (savedRating.direction) entries.push(['표현의 영향을 받는 대상', savedRating.direction]);
          const list = text('dl', undefined, 'rub-evidence');
          for (const [key, value, source] of entries) {
            const dd = text('dd', value);
            const link = sourceLink(source);
            if (link) dd.append(document.createTextNode(' '), link);
            list.append(text('dt', key), dd);
          }
          body.append(list);
          body.append(btn('이 판단 수정', () => {
            if (!stage(dim.id, savedRating)) return;
            feedback.textContent = ''; show();
            body.querySelector('select')?.focus();
          }), btn('미평가로 되돌리기', () => {
            if (!root.confirm('이 항목의 판단을 지우고 미평가로 되돌릴까요?')) return;
            if (!replaceRating(dim.id, null)) return;
            show(); biasSummary(); feedback.textContent = '미평가로 되돌렸습니다.';
            body.querySelector('select')?.focus();
          }));
          return;
        }

        const form = text('form', undefined, 'rub-form');
        form.noValidate = true;
        const controls = {};
        const options = [['', '미평가 · 단계 선택'], ...dim.levels.map((_, i) => [i, scoreName(i)])];
        if (dim.allowNA) options.push(['na', '해당 없음 · 이유 기록']);
        controls.level = select(options);
        const rowOptions = [['', '기사 구간 선택'], ...report.rows.map((r, i) => [
          r.id, (i + 1) + '. ' + r.text + (r.positions.length > 1 ? ' (원문 ' + r.positions.length + '곳)' : '')
        ])];
        controls.rowId = select(rowOptions);
        controls.compareRowId = select(rowOptions);
        controls.quote = area();
        controls.compareQuote = area();
        const sourceOptions = [['', '대조할 원자료 선택'], ...sources.map(s => [s.id, sourceLabel(s)])];
        controls.sourceId = select(sourceOptions);
        controls.sourceQuote = area();
        if (standards) {
          controls.compareSourceId = select(sourceOptions);
          controls.compareSourceQuote = area();
        }
        controls.reason = area(); controls.impact = area(); controls.direction = text('input');
        for (const [key, input] of Object.entries(controls)) input.value = pending?.[key] || '';
        controls.level.dataset.dimension = dim.id;
        const articleGroup = text('div');
        const citation = text('div', undefined, 'rub-link');
        const comparisonCitation = text('div', undefined, 'rub-link');
        const compare = text('div');
        compare.append(field('비교할 다른 구간 불러오기', controls.compareRowId), field('비교할 기사 구절 (두 위치가 겹치지 않게 선택)', controls.compareQuote));
        articleGroup.append(field('대조할 기사 구간', controls.rowId), field('평가에 사용한 기사 구절', controls.quote));
        if (!standards) articleGroup.append(compare);
        articleGroup.append(field(standards ? '첫째 구절의 원자료와 확인 위치' : '원자료와 확인 위치', controls.sourceId),
          citation, field(standards ? '첫째 주장과 대조한 자료 구절' : '대조한 원자료 구절', controls.sourceQuote));
        const firstRows = standards && sourceLinePicker('첫째 근거로 인용할 원자료 행', controls.sourceQuote);
        const secondRows = standards && sourceLinePicker('둘째 근거로 인용할 원자료 행', controls.compareSourceQuote);
        if (standards) articleGroup.append(firstRows.label, compare, field('둘째 구절의 원자료와 확인 위치', controls.compareSourceId),
          comparisonCitation, field('둘째 주장과 대조한 자료 구절', controls.compareSourceQuote), secondRows.label);
        if (!sources.length) articleGroup.append(text('p','단계를 기록하려면 위 원자료 관리에서 대조할 문서를 추가하세요.', 'rub-note'));
        const reasonLabel = field('판단 이유', controls.reason);
        const impactLabel = field('이 차이가 독자의 해석에 미치는 영향', controls.impact);
        const directionLabel = field('어느 대상에게 어떻게 작용하는지 (선택)', controls.direction);
        const actions = text('div', undefined, 'actions compact');
        const save = text('button','이 항목 기록','primary');
        save.type = 'submit';
        const cancel = btn('작성 취소', () => {
          const d = draft.entries[dim.id];
          if (d?.previous && !replaceRating(dim.id, d.previous)) return;
          if (d?.legacyPrevious) draft.entries[dim.id] = {...d.legacyPrevious, legacyPrevious: d.legacyPrevious};
          else delete draft.entries[dim.id];
          draft.activeId = ''; writeDraft();
          feedback.textContent = d?.legacyPrevious ? '두 근거를 다시 대조할 이전 판단 초안으로 돌아갔습니다.' : d?.previous ? '이전 판단을 복원했습니다.' : '작성 중인 입력을 비웠습니다.';
          show(); biasSummary();
          body.querySelector('select, button')?.focus();
        });
        actions.append(save, cancel);
        if (pending?.legacyPrevious) actions.append(btn('이전 판단 초안 삭제', () => {
          if (!root.confirm('이전 단계와 구절, 판단 이유를 초안에서 삭제할까요?')) return;
          delete draft.entries[dim.id]; draft.activeId = ''; writeDraft();
          feedback.textContent = '이전 판단 초안을 삭제했습니다.'; show(); biasSummary();
        }));
        form.append(field('판정 단계', controls.level), articleGroup, reasonLabel, impactLabel, directionLabel, actions);
        body.append(form);
        const rawValues = () => Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value]));
        function applicability() {
          const level = controls.level.value;
          const numeric = ['0','1','2','3'].includes(level);
          const positive = numeric && Number(level) > 0;
          articleGroup.hidden = !numeric;
          const link = sourceLink(sourceById.get(controls.sourceId.value));
          citation.replaceChildren(...(link ? [link] : []));
          if (standards) {
            firstRows.sync(sourceById.get(controls.sourceId.value));
            secondRows.sync(sourceById.get(controls.compareSourceId.value));
            const otherLink = sourceLink(sourceById.get(controls.compareSourceId.value));
            comparisonCitation.replaceChildren(...(otherLink ? [otherLink] : []));
          }
          compare.hidden = !numeric || !['framing','standards'].includes(dim.id);
          reasonLabel.hidden = level === '';
          impactLabel.hidden = !positive;
          directionLabel.hidden = !positive;
          save.disabled = level === '';
          cancel.hidden = !Object.hasOwn(draft.entries, dim.id);
        }
        function changed(event) {
          if (event.target === controls.rowId) controls.quote.value = rowById.get(controls.rowId.value)?.row.text || '';
          if (event.target === controls.compareRowId) controls.compareQuote.value = rowById.get(controls.compareRowId.value)?.row.text || '';
          if (event.target === controls.sourceId) controls.sourceQuote.value = sourceById.get(controls.sourceId.value)?.excerpt || '';
          if (event.target === controls.compareSourceId) controls.compareSourceQuote.value = sourceById.get(controls.compareSourceId.value)?.excerpt || '';
          stage(dim.id, rawValues()); applicability(); feedback.textContent = '';
        }
        for (const control of Object.values(controls)) {
          control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', changed);
        }
        applicability();
        form.onsubmit = event => {
          event.preventDefault();
          const raw = rawValues();
          const numeric = raw.level !== 'na' && raw.level !== '';
          const rating = numeric ? {
            level: Number(raw.level), rowId: raw.rowId, quote: raw.quote, sourceId:raw.sourceId,
            sourceQuote:raw.sourceQuote, reason:raw.reason,
            ...(standards ? {compareSourceId:raw.compareSourceId, compareSourceQuote:raw.compareSourceQuote} : {}),
            impact: raw.level === '0' ? '' : raw.impact,
            compareRowId: compare.hidden ? '' : raw.compareRowId,
            compareQuote: compare.hidden ? '' : raw.compareQuote,
            direction: raw.level === '0' ? '' : raw.direction
          } : {level: raw.level, reason: raw.reason};
          try {
            if (!replaceRating(dim.id, rating)) {
              feedback.classList.remove('error'); feedback.textContent = '기록하지 않았습니다. 제외한 이전 평가를 보관합니다.';
              return;
            }
            delete draft.entries[dim.id]; draft.activeId = ''; writeDraft();
            feedback.classList.remove('error'); feedback.textContent = '근거와 판단을 기록했습니다.';
            show(); biasSummary(); body.querySelector('button')?.focus();
          } catch (err) {
            feedback.classList.add('error'); feedback.textContent = err.message;
          }
        };
      }
      show();
      return section;
    }

    container.replaceChildren(text('h2','기사 정확성과 편향 평가'));
    if (review.stale) container.append(text('p','현재 기사·근거·문장 판단과 대조할 수 없는 이전 평가를 집계에서 제외했습니다.', 'callout'));
    summaryBox = text('section'); container.append(summaryBox); accuracySummary();
    const nCore = review.accuracy.coreRowIds.length;
    const list = disclosure('구간별 집계와 핵심 주장 · ' + (nCore ? nCore + '개 지정' : '핵심 구절 미지정'), 'accuracy');
    list.append(text('p','독자가 기사의 결론으로 받아들일 제목이나 본문의 중심 주장에 표시하세요. 핵심 구간의 충돌과 미결 상태를 위에 표시합니다.', 'rub-note'));
    caseList = text('ol', undefined, 'rub-list'); list.append(caseList); container.append(list); accuracyRows();
    biasBox = text('section', undefined, 'rub-bias'); container.append(biasBox); biasSummary();
    for (const dim of api.dimensions) container.append(showDimension(dim));
    for (const details of container.querySelectorAll('details[data-section]')) {
      details.open = (sameContext && open.has(details.dataset.section)) || details.dataset.section === 'dim-' + draft.activeId;
    }
  }
  root.JournalArticleRubricUI = Object.freeze({render, restoreDraft});
  showGuide();
})(globalThis);

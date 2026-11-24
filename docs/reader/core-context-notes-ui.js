/* Private coordinator judgments on original core passages without a matched revision. */
(function (root) {
  'use strict';
  const labels = {retained:'주체와 취지 유지', changed:'주체 또는 취지 달라짐', absent:'수정본에서 대응 구절을 찾지 못함', pending:'검토 중'};
  let instance = 0;

  function mount({container, record, editors, notes = [], ratingPassage}) {
    const doc = container.ownerDocument;
    const model = root.JournalRetentionCase;
    const revision = editors[0].snapshots[1];
    const forms = [];
    const savedByRow = new Map(notes.map(note => [note.before, note]));
    const prefix = 'core-context-' + ++instance;
    function el(tag, text) {
      const n = doc.createElement(tag);
      if (text !== undefined) n.textContent = text;
      return n;
    }
    function label(form, caption, input) {
      const wrap = el('label', caption);
      wrap.append(el('br'), input);
      form.append(wrap);
    }

    const summary = el('p');
    summary.dataset.coreContextSummary = '';
    summary.tabIndex = -1;
    const choices = el('datalist');
    choices.id = prefix + '-passages';
    revision.rows.forEach((row, i) => {
      const option = el('option');
      option.value = String(i + 1);
      option.label = row.text;
      choices.append(option);
    });
    container.querySelector('summary').after(summary, choices);

    function targetIndex(form) {
      const number = form.target.value.normalize('NFKC').trim();
      if (!/^[1-9]\d*$/u.test(number) || Number(number) > revision.rows.length) return null;
      return Number(number) - 1;
    }
    function refreshMark(form) {
      const prior = savedByRow.get(form.before);
      const target = form.target.value.normalize('NFKC').trim();
      const changed = form.state.value !== (prior?.status || '') || form.reason.value.trim() !== (prior?.reason || '').trim() ||
        target !== (prior?.after != null ? String(prior.after + 1) : '');
      const name = labels[form.state.value];
      form.mark.textContent = (name ? '진행자 판단 · ' + name : '') + (changed ? ' · 저장 전' : '');
      form.detail.dataset.coreContextPending = String(changed || !name || form.state.value === 'pending');
    }
    function preview(form) {
      form.preview.replaceChildren();
      const index = targetIndex(form);
      if (index === null) return;
      const row = revision.rows[index];
      if (ratingPassage) form.preview.append(ratingPassage(revision, '수정본 기사', row.text, row.id));
      else form.preview.append(el('p', '수정본 ' + (index + 1) + '번 구절'), el('blockquote', row.text));
    }
    function refresh(form, readTarget) {
      const status = form.state.value;
      form.target.disabled = status === 'absent';
      if (form.target.disabled) form.target.value = '';
      form.target.required = status === 'retained' || status === 'changed';
      form.reason.required = !!status && status !== 'pending';
      form.clear.disabled = !status && !form.target.value && !form.reason.value;
      for (const control of [form.state, form.target, form.reason]) {
        control.removeAttribute('aria-invalid');
        control.removeAttribute('aria-describedby');
      }
      form.error.textContent = '';
      if (readTarget) preview(form);
      refreshMark(form);
    }
    for (const detail of container.querySelectorAll('details[data-core-context-before]')) {
      const before = Number(detail.dataset.coreContextBefore);
      const note = savedByRow.get(before);
      const group = el('fieldset');
      group.className = 'retention-note-form';
      group.append(el('legend', '원본 ' + (before + 1) + '번 핵심 구절에 대한 진행자 판단'));
      const state = el('select');
      state.dataset.coreContextState = '';
      for (const [value, caption] of [['','판단 선택'], ...Object.entries(labels)]) {
        const option = el('option', caption);
        option.value = value;
        state.append(option);
      }
      state.value = note?.status || '';
      const target = el('input');
      target.dataset.coreContextTarget = '';
      target.setAttribute('list', choices.id);
      target.setAttribute('autocomplete', 'off');
      target.value = note?.after != null ? String(note.after + 1) : '';
      const text = el('div');
      text.dataset.coreContextPreview = '';
      text.id = prefix + '-preview-' + before;
      target.setAttribute('aria-controls', text.id);
      const reason = el('textarea');
      reason.dataset.coreContextReason = '';
      reason.rows = 2;
      reason.value = note?.reason || '';
      label(group, '원본의 주체와 취지 (인용은 발언자까지 확인)', state);
      label(group, '대조한 수정본 구절 번호 (1~' + revision.rows.length + ')', target);
      group.append(text);
      label(group, '판단 이유 또는 이어서 확인할 내용', reason);
      const clear = el('button', '이 구절 판단 비우기');
      clear.type = 'button';
      clear.dataset.coreContextClear = '';
      const error = el('p');
      error.className = 'status error';
      error.id = prefix + '-error-' + before;
      error.setAttribute('role', 'status');
      group.append(clear, error);
      detail.append(group);
      const mark = el('small');
      mark.className = 'joint-levels';
      detail.querySelector('summary').append(mark);
      const form = {before, detail, state, target, reason, clear, error, preview:text, mark};
      forms.push(form);
      refresh(form, true);
      state.addEventListener('change', () => refresh(form, true));
      target.addEventListener('input', () => refresh(form, true));
      reason.addEventListener('input', () => refresh(form, false));
      clear.addEventListener('click', () => {
        state.value = target.value = reason.value = '';
        refresh(form, true);
        state.focus();
      });
    }
    function invalid(form, control, message) {
      container.open = form.detail.open = true;
      form.error.textContent = '원본 ' + (form.before + 1) + '번 · ' + message;
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', form.error.id);
      control.focus();
      throw new Error(form.error.textContent);
    }
    function collect() {
      const entries = [];
      for (const form of forms) {
        const status = form.state.value;
        const reason = form.reason.value.trim();
        if (!status) {
          if (form.target.value.trim() || reason) invalid(form, form.state, '판단을 선택하세요. 더 살펴볼 구절은 ‘검토 중’으로 기록할 수 있습니다.');
          continue;
        }
        const after = targetIndex(form);
        if (after === null && (form.target.required || form.target.value.trim())) invalid(form, form.target, '대조한 수정본 구절의 번호를 선택하세요.');
        if (form.reason.required && !reason) invalid(form, form.reason, '원본과 수정본을 대조한 판단 이유를 적으세요.');
        entries.push({before:form.before, after, status, reason});
      }
      try { return model.validateContextNotes(record, entries); }
      catch (error) {
        const form = forms.find(f => f.before === error.before);
        if (form) invalid(form, form.reason, error.message);
        throw error;
      }
    }
    function saved(entries) {
      const counts = model.summarizeContext(record, entries);
      savedByRow.clear();
      entries.forEach(note => savedByRow.set(note.before, note));
      forms.forEach(refreshMark);
      summary.textContent = '저장한 진행자 판단 · 대조 완료 ' + (counts.total - counts.pending) + '/' + counts.total +
        '개 · 주체와 취지 유지 ' + counts.retained + '개 · 주체 또는 취지 달라짐 ' + counts.changed +
        '개 · 대응 구절을 찾지 못함 ' + counts.absent + '개 · 남은 구절 ' + counts.pending + '개';
    }
    function focusNext() {
      container.open = true;
      const next = forms.find(form => form.detail.dataset.coreContextPending === 'true');
      if (next) next.detail.open = true;
      const destination = next ? next.detail.querySelector('summary') : summary;
      destination.focus();
      destination.scrollIntoView?.({block:'start'});
    }
    saved(notes);
    return {collect, saved, focusNext};
  }
  root.JournalCoreContextNotesUI = Object.freeze({mount});
})(globalThis);

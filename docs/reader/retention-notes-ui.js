/* Coordinator follow-up on previously verified facts in an edited article. */
(function (root) {
  'use strict';
  const states = {retained:'유지 확인', changed:'내용 변경', notFound:'대응 구절을 찾지 못함', open:'검토 중'};
  const outcomes = {supported:'구절 전체 지지', limited:'일부만 지지', contradicted:'기사 서술 반박',
    quotedConflict:'인용 속 사실 주장 반박', disputed:'두 판정 불일치', pending:'미결', excluded:'두 사람 모두 의견', shared:'동일한 판정 기록'};
  let mounted = 0;

  function mount({container, record, editors, notes = [], onSave, decisionEvidence}) {
    const doc = container.ownerDocument;
    const core = root.JournalRetentionCase;
    const revised = editors[0].snapshots[1].rows;
    const listId = 'retention-passages-' + ++mounted;
    const savedByRow = new Map(notes.map(note => [note.before, note]));
    const forms = [];
    let changes = 0;

    function el(tag, value, cls) {
      const node = doc.createElement(tag);
      if (value != null) node.textContent = value;
      if (cls) node.className = cls;
      return node;
    }
    function field(parent, caption, control) {
      const label = el('label', caption);
      label.append(doc.createElement('br'), control);
      parent.append(label);
    }
    function option(value, title) {
      const item = el('option', title);
      item.value = value;
      return item;
    }
    function targetIndex(input) {
      const raw = input.value.trim();
      if (!/^[1-9]\d*$/.test(raw)) return null;
      const index = Number(raw) - 1;
      return index < revised.length ? index : null;
    }

    const box = el('section', null, 'retention-note-summary');
    const summary = el('p');
    summary.dataset.retentionSummary = '';
    const save = el('button', '진행자용 대조 파일 저장');
    save.type = 'button';
    save.dataset.retentionSave = '';
    const feedback = el('p', '', 'status');
    feedback.dataset.retentionFeedback = '';
    feedback.id = listId + '-status';
    feedback.setAttribute('role', 'status');
    const passageList = el('datalist');
    passageList.id = listId;
    revised.forEach((row, index) => {
      const pick = option(String(index + 1), row.text.slice(0, 45));
      passageList.append(pick);
    });
    box.append(el('h4', '진행자의 원본 사실 대조'), summary, save,
      el('p', '개인 보관용 파일에 기사·원자료와 미적용 초안을 포함한 두 편집자의 작업 파일 4개, 진행자 대응표 2개, 사후 판단을 담습니다. 이 화면은 파일을 외부로 보내지 않습니다.', 'note'),
      feedback, passageList);
    const group = container.querySelector('.fact-retention');
    if (group) group.before(box);
    else container.append(box);

    function summarize(saved) {
      const s = core.summarize(record, saved);
      const confirmed = s.autoRetained + s.manualRetained;
      const rate = s.total ? Number((100 * confirmed / s.total).toFixed(1)) + '%' : '산출 대기';
      summary.textContent = '현재까지 유지 확인 ' + confirmed + '/' + s.total + '개 (' + rate + ') · 자동 대응으로 확인 ' + s.autoRetained +
        '개 · 진행자가 유지 확인 ' + s.manualRetained + '개 · 내용 변경 ' + s.changed + '개 · 대응 구절을 찾지 못함 ' +
        s.notFound + '개 · 검토 남음 ' + s.open + '개';
    }
    function rowMark(form, draft) {
      const status = form.state.value;
      form.detail.dataset.retentionPending = String(!status || status === 'open' || draft);
      form.mark.textContent = (status || draft) ? '진행자 ' + (states[status] || '판단 미선택') + (draft ? ' · 작성 중' : '') : '';
    }
    function previewTarget(form) {
      const {target, preview} = form;
      const index = targetIndex(target);
      preview.replaceChildren();
      if (target.disabled || index === null) return;
      preview.append(el('p', '수정본 ' + (index + 1) + '번 · 두 편집자의 판정 ' + outcomes[record.facts.after[index].outcome]),
        el('blockquote', revised[index].text));
      if (!decisionEvidence) return;
      const detail = el('details', null, 'case');
      detail.append(el('summary', '이 구절을 검토한 두 편집자의 근거'));
      const pair = el('div', null, 'pair');
      editors.forEach((editor, i) => {
        const snapshot = editor.snapshots[1];
        pair.append(decisionEvidence(snapshot, snapshot.assessment.accuracy.rows[index], snapshot.rows[index].text, i ? '둘째 편집자' : '첫 편집자'));
      });
      detail.append(pair);
      preview.append(detail);
    }
    function setFields(form) {
      const status = form.state.value;
      form.target.disabled = status === 'notFound';
      if (form.target.disabled) form.target.value = '';
      form.target.required = status === 'retained' || status === 'changed';
      form.reason.required = Boolean(status && status !== 'open');
      form.clear.disabled = !status && !form.target.value && !form.reason.value;
    }
    function edited(form, showTarget) {
      changes++;
      for (const control of [form.state, form.target, form.reason]) {
        control.removeAttribute('aria-invalid');
        control.removeAttribute('aria-describedby');
      }
      setFields(form);
      rowMark(form, true);
      if (showTarget) previewTarget(form);
      feedback.classList.remove('error');
      feedback.textContent = '입력한 변경 사항은 파일을 저장할 때 사후 집계에 반영됩니다.';
    }
    for (const detail of container.querySelectorAll('details[data-retention-before]')) {
      const before = Number(detail.dataset.retentionBefore);
      const note = savedByRow.get(before);
      const group = el('fieldset', null, 'retention-note-form');
      group.append(el('legend', '원본 ' + (before + 1) + '번 사후 판단'));
      const state = el('select');
      state.dataset.retentionState = '';
      state.append(option('', '판단 선택'));
      for (const [value, title] of Object.entries(states)) state.append(option(value, title));
      state.value = note?.status || '';
      const target = el('input');
      target.type = 'text';
      target.inputMode = 'numeric';
      target.setAttribute('list', listId);
      target.setAttribute('autocomplete', 'off');
      target.dataset.retentionTarget = '';
      target.value = note?.after != null ? String(note.after + 1) : '';
      const preview = el('div');
      preview.dataset.retentionPreview = '';
      const reason = el('textarea');
      reason.dataset.retentionReason = '';
      reason.rows = 2;
      reason.value = note?.reason || '';
      const clear = el('button', '이 구절 기록 비우기');
      clear.type = 'button';
      clear.dataset.retentionClear = '';
      field(group, '진행자 판단', state);
      field(group, '대조할 수정본 구절 번호 (1~' + revised.length + ')', target);
      group.append(preview);
      field(group, '판단 이유 또는 검토 메모', reason);
      group.append(clear);
      detail.append(group);
      const mark = el('small', '', 'joint-levels');
      detail.querySelector('summary').append(mark);
      const form = {before, detail, state, target, preview, reason, clear, mark};
      forms.push(form);
      setFields(form);
      rowMark(form, false);
      previewTarget(form);
      state.addEventListener('change', () => edited(form, true));
      target.addEventListener('input', () => edited(form, true));
      reason.addEventListener('input', () => edited(form, false));
      clear.addEventListener('click', () => {
        state.value = target.value = reason.value = '';
        edited(form, true);
        state.focus();
      });
    }

    function invalid(form, input, message) {
      for (let at = form.detail; at && at !== container; at = at.parentElement) {
        if (at.tagName === 'DETAILS') at.open = true;
      }
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', feedback.id);
      input.focus();
      throw new Error('원본 ' + (form.before + 1) + '번 · ' + message);
    }
    function collect() {
      const collected = [];
      for (const form of forms) {
        const status = form.state.value;
        const reason = form.reason.value.trim();
        const after = targetIndex(form.target);
        if (!status) {
          if (reason || form.target.value.trim()) invalid(form, form.state, '사후 판단을 선택하세요. 더 검토하려면 ‘검토 중’을 선택하세요.');
          continue;
        }
        if (form.target.value.trim() && after === null) invalid(form, form.target, '수정본에 있는 구절 번호를 입력하세요.');
        if (form.target.required && after === null) invalid(form, form.target, '판단에 사용한 수정본 구절을 선택하세요.');
        if (status === 'retained' && record.facts.after[after].outcome !== 'supported') {
          invalid(form, form.target, '유지를 확인하려면 두 편집자가 구절 전체를 지지한 수정본 구절이 필요합니다.');
        }
        if (form.reason.required && !reason) invalid(form, form.reason, '이렇게 판단한 이유를 입력하세요.');
        collected.push({before:form.before, after, status, reason});
      }
      try { core.validateNotes(record, collected); }
      catch (error) {
        const form = forms.find(item => item.before === error.before);
        if (form) invalid(form, form.reason, error.message);
        throw error;
      }
      return collected;
    }
    summarize(notes);
    save.addEventListener('click', async () => {
      const revision = changes;
      save.disabled = true;
      try {
        const entries = collect();
        await onSave(entries);
        summarize(entries);
        if (changes === revision) {
          forms.forEach(form => rowMark(form, false));
          feedback.classList.remove('error');
          feedback.textContent = '현재 사후 판단을 담은 개인 보관용 파일의 다운로드를 시작했습니다.';
        }
      } catch (error) {
        feedback.classList.add('error');
        feedback.textContent = error.message;
      } finally { save.disabled = false; }
    });
  }
  root.JournalRetentionNotesUI = Object.freeze({mount});
})(globalThis);

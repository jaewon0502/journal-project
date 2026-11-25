(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const core = window.JournalFieldReview;
  let selectedCase = null, roster = null, saved = false, filename = '';

  function randomIndex(size) {
    const value = new Uint32Array(1);
    const limit = 2 ** 32 - (2 ** 32 % size);
    do { crypto.getRandomValues(value); } while (value[0] >= limit);
    return value[0] % size;
  }

  function shuffledBlock(tasks) {
    const block = tasks.flatMap(task => ['manual', 'journal'].map(method => ({task, method})));
    for (let i = block.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [block[i], block[j]] = [block[j], block[i]];
    }
    return block;
  }

  const catalog = JSON.parse(el('allocation-catalog')?.textContent || '[]');
  const picker = el('bundled-case'), fileInput = el('case-file');
  for (const [i, entry] of catalog.entries()) picker.add(new Option(entry.material.title, String(i)));
  el('bundled-picker').hidden = !catalog.length;
  el('kit-setup').hidden = catalog.length > 0;
  if (catalog.length) {
    fileInput.labels[0].textContent = '또는 다른 참여자용 과제 파일 열기';
    el('case-note').textContent = '기사를 선택하거나 별도로 보관한 과제 파일을 여세요.';
  }

  function selectCase(data) {
    selectedCase = data;
    el('generate').disabled = !data;
    el('targets').hidden = !data;
    el('target-inputs').replaceChildren();
    el('status').textContent = '';
    el('case-note').textContent = data ? data.title + ' · 과제 ' + data.tasks.length + '개' : '';
    if (!data) return;
    const edition = core.kitVersion(catalog[picker.value]?.kitVersion);
    el('case-note').textContent += edition ? ' · 예정 배포본 ' + edition.slice(0,12)
      : ' · 별도 과제 파일에는 예정 배포본 ID가 없습니다.';
    for (const task of data.tasks) {
      const label = document.createElement('label'), input = document.createElement('input');
      label.textContent = task.id + ' · ' + task.prompt;
      input.inputMode = 'numeric';
      input.dataset.taskId = task.id;
      input.setAttribute('aria-describedby', 'target-note');
      label.append(input);
      el('target-inputs').append(label);
    }
  }

  picker.onchange = () => {
    if (roster) return;
    fileInput.value = '';
    const entry = catalog[picker.value];
    fileInput.required = !entry;
    selectCase(entry?.material || null);
  };

  fileInput.onchange = async () => {
    if (roster) return;
    const file = fileInput.files[0];
    picker.value = '';
    fileInput.required = true;
    selectCase(null);
    if (!file) return;
    try {
      const data = core.readCase(JSON.parse(await file.text()));
      if (!roster && picker.value === '' && fileInput.files[0] === file) selectCase(data);
    } catch {
      if (!roster && picker.value === '' && fileInput.files[0] === file)
        el('status').textContent = '참여자용 blind-tasks.json 파일을 확인하세요.';
    }
  };

  function showAssignments(assignments, note, scope) {
    roster = {format:core.assignmentFormat, assignments};
    if (scope !== undefined) roster.scope = scope;
    for (const row of assignments) {
      const tr = el('allocations').insertRow();
      const kit = row.method === 'manual' ? '평소 도구' : '저널 병행';
      for (const value of [row.participant, row.caseId, row.taskId]) tr.insertCell().textContent = value;
      const kitCell = tr.insertCell();
      const edition = catalog.find(({material}) => material.caseId === row.caseId && material.articleUrl === row.articleUrl &&
        material.tasks.some(task => task.id === row.taskId && task.prompt === row.prompt));
      if (edition && (!row.assignedKitVersion || row.assignedKitVersion === edition.kitVersion)) {
        const link = document.createElement('a');
        link.href = edition.files[row.method];
        link.download = '';
        link.textContent = edition.label + ' · ' + kit + ' ZIP';
        link.setAttribute('aria-label', row.participant + '에게 전달할 ' + link.textContent);
        kitCell.append(link);
        if (!row.assignedKitVersion) kitCell.append(document.createTextNode(' · 명부에 예정 판본 없음'));
      } else if (edition && row.assignedKitVersion) {
        kitCell.textContent = kit + ' · 예정 배포본 ' + row.assignedKitVersion.slice(0,12) + '에서 ZIP을 받으세요.';
      } else {
        kitCell.textContent = kit + ' · participant-' + row.method + '.zip' +
          (catalog.length ? ' (이 배포본에 일치하는 과제 없음)' : '');
      }
      const cell = tr.insertCell();
      const copy = document.createElement('button'), field = document.createElement('input');
      copy.type = 'button';
      copy.textContent = '코드 복사';
      copy.setAttribute('aria-label', row.participant + ' 배정 코드 복사');
      field.readOnly = true;
      field.hidden = true;
      field.setAttribute('aria-label', row.participant + ' 배정 코드');
      copy.onclick = async () => {
        try {
          field.value = await window.JournalFieldInvite.encode(row);
          field.hidden = false;
          try {
            await navigator.clipboard.writeText(field.value);
            el('status').textContent = row.participant + '의 배정 코드를 복사했습니다.';
          } catch {
            field.select();
            el('status').textContent = '선택한 배정 코드를 복사해 전달하세요.';
          }
        } catch {
          el('status').textContent = '이 브라우저에서 배정 코드를 만들 수 없습니다. 해당 행의 익명 코드와 과제 번호를 전달해 직접 입력할 수 있습니다.';
        }
      };
      cell.append(copy, field);
      tr.insertCell().textContent = row.targetSeconds === undefined ? '미설정' : row.targetSeconds + '초';
    }
    el('block-count').textContent = note;
    el('allocation-form').hidden = true;
    el('reopen').hidden = true;
    el('allocation').hidden = false;
  }

  el('roster-file').onchange = async () => {
    const file = el('roster-file').files[0];
    if (!file || roster) return;
    try {
      const original = JSON.parse(await file.text());
      const assignments = core.mergeAssignments([], [original]);
      if (roster || el('roster-file').files[0] !== file) return;
      showAssignments(assignments, '저장된 배정 ' + assignments.length + '건', original.scope);
      saved = true;
      filename = file.name;
      el('status').textContent = '저장한 배정표를 열었습니다.';
      el('download').focus();
    } catch (error) {
      if (!roster && el('roster-file').files[0] === file) {
        el('status').textContent = '현장 기사 배정표 JSON을 확인하세요.' + (error instanceof SyntaxError ? '' : ' ' + error.message);
      }
    }
  };

  el('allocation-form').onsubmit = event => {
    event.preventDefault();
    if (roster || !selectedCase) return;
    const codes = el('participant-codes').value.split(/\r?\n/u).map(code => code.trim()).filter(Boolean);
    if (!codes.length || codes.some(code => code.length > 64) || new Set(codes).size !== codes.length) {
      el('status').textContent = '참여 화면에 쓸 64자 이내의 익명 코드를 한 명당 하나씩, 중복 없이 입력하세요.';
      return;
    }
    const {caseId, articleUrl, tasks} = selectedCase;
    const targets = new Map();
    for (const input of el('target-inputs').querySelectorAll('input')) {
      input.removeAttribute('aria-invalid');
      const value = input.value.trim();
      if (!value) continue;
      const seconds = Number(value);
      if (!/^\d+$/u.test(value) || !core.validTargetSeconds(seconds)) {
        el('targets').open = true;
        input.setAttribute('aria-invalid', 'true');
        el('status').textContent = input.dataset.taskId + '의 목표 시간을 확인하세요. 초 단위의 양의 정수로 입력하거나 비워 두세요.';
        input.focus();
        return;
      }
      targets.set(input.dataset.taskId, seconds);
    }
    const blockSize = tasks.length * 2;
    const assignedKitVersion = core.kitVersion(catalog[picker.value]?.kitVersion);
    let block;
    const assignments = codes.map((participant, index) => {
      if (index % blockSize === 0) block = shuffledBlock(tasks);
      const {task, method} = block[index % blockSize];
      const assignment = {participant, caseId, articleUrl, taskId:task.id, prompt:task.prompt, method};
      if (assignedKitVersion) assignment.assignedKitVersion = assignedKitVersion;
      if (targets.has(task.id)) assignment.targetSeconds = targets.get(task.id);
      return assignment;
    });
    const full = Math.floor(assignments.length / blockSize), remainder = assignments.length % blockSize;
    const note = '배정 ' + assignments.length + '명. 과제와 방식 조합을 모두 배정한 ' + blockSize + '인 묶음 ' +
      full + '개' + (remainder ? ', 남은 묶음 ' + remainder + '/' + blockSize + '명' : '') + '.';
    showAssignments(assignments, note, 'single-allocation');
    filename = 'field-assignments-' + selectedCase.caseId.replace(/[^a-zA-Z0-9_-]/gu, '_') +
      '-' + new Date().toISOString().replace(/[:.]/gu, '-') + '.json';
    el('status').textContent = '배정표를 저장한 뒤 배부하세요. 결과를 집계할 때 이 파일을 다시 불러옵니다.';
    el('download').focus();
  };

  el('download').onclick = () => {
    if (!roster) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(roster, null, 2)], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    saved = true;
    el('status').textContent = '다운로드 폴더에 배정표가 저장됐는지 확인하세요. 같은 표를 다시 내려받을 수 있습니다.';
  };
  window.addEventListener('beforeunload', event => {
    if (roster && !saved) { event.preventDefault(); event.returnValue = ''; }
  });
})();

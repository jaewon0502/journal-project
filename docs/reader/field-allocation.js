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

  function shuffled(block) {
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

  const crossoverDesign = 'two-article-crossover-v1';
  const catalogOptions = catalog.map((entry, index) => ({...entry, index})).filter(entry =>
    core.kitVersion(entry.kitVersion) && entry.material.tasks.length && entry.files?.manual && entry.files?.journal);
  function distinctArticles(a, b) {
    return a && b && a.caseId !== b.caseId && core.articleIdentity(a.articleUrl) !== core.articleIdentity(b.articleUrl);
  }
  const first = catalogOptions[0], second = catalogOptions.find(option => distinctArticles(first?.material, option.material));
  if (second) {
    el('allocation-mode-picker').hidden = false;
    for (const side of ['a','b']) {
      const pick = el('cross-case-' + side), tasks = el('cross-task-' + side);
      for (const entry of catalogOptions) pick.add(new Option(entry.material.title, String(entry.index)));
      function selectTasks() {
        tasks.replaceChildren(new Option('과제를 선택하세요', ''));
        const material = catalog[pick.value]?.material;
        for (const task of material?.tasks || []) tasks.add(new Option(task.id + ' · ' + task.prompt, task.id));
        if (material?.tasks.length === 1) tasks.value = material.tasks[0].id;
        el('cross-target-' + side).value = '';
      }
      pick.value = String((side === 'a' ? first : second).index);
      pick.onchange = selectTasks;
      tasks.onchange = () => { el('cross-target-' + side).value = ''; };
      selectTasks();
    }
    el('allocation-mode').onchange = () => {
      if (roster) return;
      const cross = el('allocation-mode').value === 'crossover';
      el('allocation-form').hidden = cross;
      el('crossover-form').hidden = !cross;
      el('status').textContent = '';
    };
  }

  function participantCodes(input) {
    const codes = input.value.split(/\r?\n/u).map(code => code.trim()).filter(Boolean);
    if (!codes.length || codes.some(code => code.length > 64) || new Set(codes).size !== codes.length) {
      el('status').textContent = '참여 화면에 쓸 64자 이내의 익명 코드를 한 명당 하나씩, 중복 없이 입력하세요.';
      return null;
    }
    return codes;
  }

  function readTarget(input, id) {
    input.removeAttribute('aria-invalid');
    const value = input.value.trim();
    if (!value) return undefined;
    const seconds = Number(value);
    if (/^\d+$/u.test(value) && core.validTargetSeconds(seconds)) return seconds;
    const details = input.closest('details');
    if (details) details.open = true;
    input.setAttribute('aria-invalid', 'true');
    el('status').textContent = id + '의 목표 시간을 확인하세요. 초 단위의 양의 정수로 입력하거나 비워 두세요.';
    input.focus();
    return null;
  }

  function showAssignments(assignments, note, scope, design) {
    roster = {format:core.assignmentFormat, assignments};
    if (scope !== undefined) roster.scope = scope;
    const crossed = design === crossoverDesign;
    if (crossed) roster.design = design;
    const showOrder = crossed || assignments.some(row => row.plannedPeriod);
    el('cross-order-heading').hidden = !showOrder;
    const seenParticipants = new Set();
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
      const copyLabel = crossed ? row.participant + ' · ' + row.caseId + ' · ' + row.taskId : row.participant;
      copy.type = 'button';
      copy.textContent = '코드 복사';
      copy.setAttribute('aria-label', copyLabel + ' 배정 코드 복사');
      field.readOnly = true;
      field.hidden = true;
      field.setAttribute('aria-label', copyLabel + ' 배정 코드');
      copy.onclick = async () => {
        try {
          field.value = await window.JournalFieldInvite.encode(row);
          field.hidden = false;
          try {
            await navigator.clipboard.writeText(field.value);
            el('status').textContent = copyLabel + '의 배정 코드를 복사했습니다.';
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
      if (showOrder) {
        const period = row.plannedPeriod ?? (crossed ? (seenParticipants.has(row.participant) ? 2 : 1) : null);
        tr.insertCell().textContent = period === 1 ? '첫 번째' : period === 2 ? '두 번째' : '미기록';
        seenParticipants.add(row.participant);
      }
    }
    el('block-count').textContent = note + (crossed ? ' 각 참여자에게 첫 번째 과제부터 순서대로 전달하세요.' : '');
    el('crossover-form').hidden = true;
    el('allocation-mode-picker').hidden = true;
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
      if (original.design === crossoverDesign && !validCrossoverRoster(assignments, original)) {
        throw Error('교차 배정의 두 기사와 과제, 판본과 권장 순서를 확인하세요.');
      }
      showAssignments(assignments, '저장된 배정 ' + assignments.length + '건', original.scope, original.design);
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
    if (roster || !selectedCase || el('allocation-mode').value === 'crossover') return;
    const codes = participantCodes(el('participant-codes'));
    if (!codes) return;
    const {caseId, articleUrl, tasks} = selectedCase;
    const targets = new Map();
    for (const input of el('target-inputs').querySelectorAll('input')) {
      const seconds = readTarget(input, input.dataset.taskId);
      if (seconds === null) return;
      if (seconds !== undefined) targets.set(input.dataset.taskId, seconds);
    }
    const blockSize = tasks.length * 2;
    const assignedKitVersion = core.kitVersion(catalog[picker.value]?.kitVersion);
    let block;
    const assignments = codes.map((participant, index) => {
      if (index % blockSize === 0) block = shuffled(tasks.flatMap(task => ['manual', 'journal'].map(method => ({task, method}))));
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

  function validCrossoverRoster(rows, original) {
    if (original.scope !== 'single-allocation' || original.assignments.length !== rows.length || !rows.length || rows.length % 4) return false;
    const people = new Set(), tasks = new Map(), firstMethods = {manual:0, journal:0};
    if (rows.some(row => row.plannedPeriod)) {
      if (!rows.every(row => row.plannedPeriod)) return false;
      rows = [...rows].sort((a,b) => a.participant < b.participant ? -1 : a.participant > b.participant ? 1 : a.plannedPeriod - b.plannedPeriod);
    }
    // Older single-allocation rosters encoded the recommendation in consecutive rows.
    for (let i = 0; i < rows.length; i += 2) {
      const a = rows[i], b = rows[i+1];
      if ((a.plannedPeriod && (a.plannedPeriod !== 1 || b.plannedPeriod !== 2)) || people.has(a.participant) || a.participant !== b.participant || a.method === b.method || !distinctArticles(a, b)) return false;
      people.add(a.participant);
      firstMethods[a.method]++;
      for (const [index, row] of [a,b].entries()) {
        if (!core.kitVersion(row.assignedKitVersion)) return false;
        const key = JSON.stringify([row.caseId, row.articleUrl, row.taskId, row.prompt, row.assignedKitVersion]);
        if (!tasks.has(key)) tasks.set(key, {manual:0, journal:0, first:0});
        const task = tasks.get(key);
        task[row.method]++;
        if (index === 0) task.first++;
      }
    }
    if (tasks.size !== 2 || firstMethods.manual !== firstMethods.journal) return false;
    return [...tasks.values()].every(t => t.manual === t.journal && Math.abs(people.size - 2*t.first) === people.size % 4);
  }

  el('crossover-form').onsubmit = event => {
    event.preventDefault();
    if (roster || el('allocation-mode').value !== 'crossover' || !second) return;
    const articles = ['a','b'].map(side => catalog[el('cross-case-' + side).value]);
    if (!distinctArticles(articles[0]?.material, articles[1]?.material)) {
      el('status').textContent = '기사 A와 기사 B에 서로 다른 기사를 선택하세요.';
      return;
    }
    const specs = [];
    for (const [index, side] of ['a','b'].entries()) {
      const entry = articles[index], task = entry.material.tasks.find(item => item.id === el('cross-task-' + side).value);
      if (!task || !core.kitVersion(entry.kitVersion)) { el('status').textContent = '기사별 배포본과 과제를 선택하세요.'; return; }
      const targetSeconds = readTarget(el('cross-target-' + side), task.id);
      if (targetSeconds === null) return;
      const spec = {caseId:entry.material.caseId, articleUrl:entry.material.articleUrl,
        taskId:task.id, prompt:task.prompt, assignedKitVersion:entry.kitVersion};
      if (targetSeconds !== undefined) spec.targetSeconds = targetSeconds;
      specs.push(spec);
    }
    const codes = participantCodes(el('cross-codes'));
    if (!codes) return;
    if (codes.length < 2 || codes.length % 2) { el('status').textContent = '교차 배정은 2명 이상 짝수 인원으로 구성하세요.'; return; }
    const assignments = [];
    for (let start = 0; start < codes.length; start += 4) {
      const full = codes.length - start >= 4;
      // In a group of four, each article starts once per method. With two remaining,
      // randomize the starting article and give one editor each first method.
      const firstArticles = full ? [0,1] : [randomIndex(2)];
      const plan = shuffled(firstArticles.flatMap(index => ['manual','journal'].map(method => ({index, method}))));
      for (const [offset, {index, method}] of plan.entries()) {
        const participant = codes[start + offset];
        assignments.push({...specs[index], participant, method, plannedPeriod:1},
          {...specs[1-index], participant, plannedPeriod:2, method:method === 'manual' ? 'journal' : 'manual'});
      }
    }
    const note = codes.length + '명에게 두 과제씩, 총 ' + assignments.length + '건을 교차 배정했습니다.' +
      (codes.length % 4 ? ' 마지막 두 사람은 같은 기사부터 시작합니다.' : ' 기사별 첫 방식과 방식별 첫 기사 인원이 같습니다.');
    showAssignments(assignments, note, 'single-allocation', crossoverDesign);
    filename = 'field-crossover-' + new Date().toISOString().replace(/[:.]/gu, '-') + '.json';
    el('status').textContent = '명부를 저장하고 각 편집자에게 권장 순서의 배정 코드와 해당 ZIP을 전달하세요.';
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

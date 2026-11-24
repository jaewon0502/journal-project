(() => {
  'use strict';
  const c = window.JournalFieldReview,
    el = (id) => document.getElementById(id);
  const format = 'journal-field-grades-v1',
    records = new Map();
  const anchors = new Map();
  const blindRanks = new Map();
  let showingResults = false;
  let assignments = [];
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
      for (const [type, value] of [['case', trial.caseId], ['article', c.articleIdentity(trial.articleUrl)]]) {
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
    const amount = Math.abs(savedMs);
    const duration = amount > 0 && amount < 50 ? '0.1초 미만' : seconds(amount, 1);
    if (savedPct === null) return duration + ' ' + change + ' (기준 시간 0초로 비율 산출 대기)';
    const rate = Math.abs(savedPct);
    const percent = rate > 0 && rate < 0.05 ? '0.1% 미만' : rate.toFixed(1) + '%';
    return duration + ' ' + change + ' (' + percent + ')';
  }
  function kitCoverage(groups, count) {
    const versions = new Set();
    let unknown = 0;
    for (const group of groups) {
      for (const [version, counts] of group.timedKits) {
        const n = count(counts);
        if (!n) continue;
        if (version) versions.add(version);
        else unknown += n;
      }
    }
    return '기록에 적힌 배포본 ' + versions.size + '종 · 버전 미확인 ' + unknown + '건.' +
      (versions.size > 1 ? ' 여러 버전의 기록이 있습니다.' : '');
  }
  function kitDetails(groups) {
    const details = node('details', '');
    details.append(node('summary', '시간 집계에 포함된 배포본 ID와 건수'));
    for (const group of groups) {
      for (const [version, counts] of group.timedKits) {
        if (!counts.totalTimed && !counts.timedWithdrawn) continue;
        details.append(node('p', labels[group.method] + ' · ' + (version || '버전 미확인') +
          ' · 완료 ' + counts.totalTimed + '건 (단계별 측정 ' + counts.timed + '건) · 중도 종료 ' + counts.timedWithdrawn + '건'));
      }
    }
    return details;
  }
  function showComparisons(groups, area, yieldTargets) {
    area.replaceChildren();
    if (!groups.length) {
      area.append(node('p', '같은 배포본·과제의 평소 도구 기록과 저널 기록을 불러오면 절감률을 계산합니다.'));
      return;
    }
    for (const task of c.compareTimes(groups)) {
      const card = node('article', '');
      const article = node('a', '과제의 기사 열기 ↗');
      article.href = task.articleUrl;
      article.target = '_blank';
      article.rel = 'noopener noreferrer';
      card.append(node('h3', task.caseId + ' · ' + task.taskId), node('p', task.prompt));
      const yieldId = yieldTargets?.get(trialTarget(task));
      if (yieldId) {
        const link = node('a', '전체 배정에서 이 과제의 검증 성공률 보기');
        link.href = '#' + yieldId;
        link.setAttribute('aria-label', link.textContent + ' · ' + task.caseId + ' · ' + task.taskId + ' · ' + task.prompt);
        const line = node('p', '');
        line.append(link);
        card.append(line);
      }
      card.append(article);
      const arms = [task.manual, task.journal].filter(Boolean);
      if (arms.some(g => g.totalTimed))
        card.append(node('p', '완료 시간 평균 · ' + kitCoverage(arms, n => n.totalTimed)));
      if (arms.some(g => g.totalTimed + g.timedWithdrawn))
        card.append(node('p', '완료·중도 종료 시간 · ' + kitCoverage(arms, n => n.totalTimed + n.timedWithdrawn)));
      if (!task.byVersion.length)
        card.append(node('p', '산출 대기 · 두 방식 모두 시간 기록이 필요합니다.'));
      for (const comparison of task.byVersion) card.append(versionComparison(comparison));
      if (arms.some(g => g.totalTimed + g.timedWithdrawn)) card.append(kitDetails(arms));
      area.append(card);
    }
  }
  function minimumSeconds(ms) {
    // Round down so a displayed lower bound never exceeds the observed duration.
    return (Math.floor(ms) / 1000).toLocaleString('ko-KR', {maximumFractionDigits:3}) + '초';
  }
  function partialTimePanel(comparison) {
    const part = document.createDocumentFragment();
    if (![comparison.manual, comparison.journal].some(g => g?.partialCompleted || g?.partialWithdrawn)) return part;
    const section = node('section', '');
    section.className = 'partial-times';
    section.append(node('h5', '중단 후 복원한 기록까지 포함한 활동 시간'));
    for (const method of ['manual', 'journal']) {
      const group = comparison[method];
      if (!group) continue;
      const mean = comparison.completedMeans[method];
      if (mean) section.append(node('p', labels[method] + ' · 제출한 ' + mean.count + '건 전체의 평균 ' +
        (mean.exact ? seconds(group.totalMs, mean.count) : '최소 ' + minimumSeconds(mean.minMs)) +
        ' · 시간이 일부만 남은 답안 ' + group.partialCompleted + '건'));
      const stopped = group.timedWithdrawn + group.partialWithdrawn;
      if (stopped) section.append(node('p', labels[method] + ' · 중도 종료 ' + stopped + '건의 활동 시간 합계 ' +
        (group.partialWithdrawn ? '최소 ' : '') + minimumSeconds(group.withdrawnMs + group.partialWithdrawnMs) +
        ' · 시간이 일부만 남은 기록 ' + group.partialWithdrawn + '건'));
    }
    const {manual, journal} = comparison.completedMeans;
    if (comparison.version && manual && journal && (!manual.exact || !journal.exact)) {
      const gap = Math.abs(manual.minMs - journal.minMs);
      const duration = gap >= 1 ? minimumSeconds(gap) + ' 이상 ' : '';
      if (manual.exact && journal.minMs > manual.minMs) {
        section.append(node('p', '회수한 완료 답안 전체에서는 저널 방식이 평균 ' + duration + '더 걸렸습니다.'));
      } else if (journal.exact && manual.minMs > journal.minMs) {
        section.append(node('p', '회수한 완료 답안 전체에서는 저널 방식이 평균 ' + duration + '빨랐습니다.'));
      } else section.append(node('p', '남아 있는 구간만으로는 완료 답안 전체의 평균 시간 차이를 확정할 수 없습니다.'));
    }
    section.append(node('p', '활동 구간이 빠진 답안의 실제 시간에는 상한을 정할 수 없습니다. 중도 종료 시간은 별도 합계에만 들어갑니다.'));
    part.append(section);
    return part;
  }
  function versionComparison(comparison) {
    const card = node('section', '');
    const heading = node('h4', comparison.version ? '배포본 ' + comparison.version : '버전 미확인');
    heading.style.overflowWrap = 'anywhere';
    card.append(heading);
    if (!comparison.version)
      card.append(node('p', '같은 배포본인지 확인할 수 없어 절감률 계산을 보류합니다. 아래에서 방식별 시간과 채점 결과를 볼 수 있습니다.'));
    else if (comparison.savedMs === null)
      card.append(node('p', '완료 시간 차이 산출 대기 · 두 방식 모두 시간 기록이 필요합니다. 온전한 완료 기록끼리 같은 배포본에서 비교합니다.'));
    else
      card.append(node('strong', '완료 시간 ' + timeChangeText(comparison)));
    for (const method of ['manual', 'journal']) {
      const group = comparison[method];
      if (!group?.totalTimed) {
        card.append(node('p', labels[method] + ' · 비교 가능한 완료 기록 0건'));
        continue;
      }
      card.append(node('p', labels[method] + ' · 평균 ' + seconds(group.totalMs, group.totalTimed) + ' · 중앙값 ' + seconds(group.medianMs, 1) +
        ' (' + group.totalTimed + '건) · 근거 위치와 판정 모두 일치 ' + pct(group.timedVerified, group.totalTimed - group.timedOutcomePending) +
        ' · 성공 여부 확인 대기 ' + group.timedOutcomePending + '건'));
    }
    card.append(partialTimePanel(comparison));
    const medianDifference = comparison.median.savedMs;
    if ((comparison.savedMs > 0 && medianDifference < 0) || (comparison.savedMs < 0 && medianDifference > 0)) {
      const difference = Math.abs(medianDifference);
      const gap = difference < 50 ? difference.toLocaleString('ko-KR') + '밀리초' : seconds(difference, 1);
      card.append(node('p', '평균과 중앙값이 반대 방향입니다. 저널 집단의 완료 시간 중앙값은 평소 검증 도구 집단보다 ' +
        gap + (medianDifference > 0 ? ' 짧습니다.' : ' 깁니다.')));
    }
    card.append(node('h5', '검증 성공 1건당 투입 시간'));
    for (const method of ['manual', 'journal']) {
      const group = comparison[method];
      if (!group || !(group.totalTimed + group.timedWithdrawn)) {
        card.append(node('p', labels[method] + ' · 비교할 시간 기록 0건'));
        continue;
      }
      const ms = comparison.perVerified[method + 'Ms'];
      card.append(node('p', labels[method] + ' · ' + (ms === null ? '산출 대기' : seconds(ms, 1) + '/건') +
        ' · 총 ' + seconds(group.totalMs + group.withdrawnMs, 1) + ' (완료 ' + group.totalTimed +
        '건, 중도 종료 ' + group.timedWithdrawn + '건) · 검증 성공 ' + group.timedVerified +
        '건 · 성공 여부 확인 대기 ' + group.timedOutcomePending + '건'));
    }
    if (comparison.perVerified.savedMs !== null)
      card.append(node('strong', '검증 성공 1건당 ' + timeChangeText(comparison.perVerified)));
    return card;
  }
  function assignmentCounts(n) {
    return '배정 ' + n.assigned + '건 · 완료 ' + n.completed + '건 · 중도 종료 ' + n.withdrawn +
      '건 · 기사·과제 불일치 ' + n.wrongTask + '건 · 반복·배정 충돌 ' + n.excluded +
      '건 · 연결된 현업 기록 없음 ' + n.missing + '건';
  }
  function qualityLines({submitted=0, locationHits=0, locationGraded=0, verdictHits=0, verdictGraded=0,
    verified=0, verificationKnown=0, unsafe=0, unsafeTotal=0, referencePending=0} = {}) {
    return [
      node('p', '원자료 위치 재확인 성공률 ' + pct(locationHits, locationGraded) +
        ' · 채점 대기 ' + (submitted - locationGraded) + '건'),
      node('p', '판정 일치율 ' + pct(verdictHits, verdictGraded) +
        ' · 채점 대기 ' + (submitted - verdictGraded) + '건'),
      node('p', '근거 위치와 판정 모두 일치 ' + pct(verified, verificationKnown) +
        ' · 성공 여부 확인 대기 ' + (submitted - verificationKnown) + '건'),
      node('p', '근거 없는 사실 채택률 ' + pct(unsafe, unsafeTotal) +
        ' (반박·근거 부족으로 판정한 과제) · 기준 판정 미확인 ' + referencePending + '건')
    ];
  }
  function yieldCardHeader(task, heading) {
    const card = node('article', '');
    card.className = 'case';
    const article = node('a', '과제의 기사 열기 ↗');
    article.href = task.articleUrl;
    article.target = '_blank';
    article.rel = 'noopener noreferrer';
    card.append(node('h4', heading), node('p', task.prompt), article);
    return card;
  }
  function yieldNumber(value) {
    const magnitude = Math.abs(value);
    const distance = Math.min(magnitude, 100 - magnitude);
    // Keep two significant digits of the gap when one decimal would imply zero or a full 100.
    const digits = distance > 0 && distance < 0.05 ? 1 - Math.floor(Math.log10(distance)) : 1;
    return value.toFixed(digits);
  }
  function yieldRange(verified, unknown, assigned) {
    const percent = count => yieldNumber(100 * count / assigned) + '%';
    return unknown ? percent(verified) + ' ~ ' + percent(verified + unknown) : percent(verified);
  }
  function assignmentYieldCard(task) {
    const card = yieldCardHeader(task, task.caseId + ' · ' + task.taskId);
    for (const method of ['manual', 'journal']) {
      const arm = task[method];
      if (!arm) {
        card.append(node('p', labels[method] + ' · 배정 0건'));
        continue;
      }
      const { verified, failed, withdrawn, unknown } = arm.yieldBounds;
      const range = yieldRange(verified, unknown, arm.assigned);
      card.append(node('p', labels[method] + ' · 검증 성공률 ' + range + ' (배정 ' + arm.assigned + '건)'),
        node('p', '성공 ' + verified + '건 · 위치 또는 판정 불일치 ' + failed + '건 · 중도 종료 ' + withdrawn +
          '건 · 결과 미확인 ' + unknown + '건'));
    }
    appendYieldDifference(card, task.difference, '같은 과제를 두 방식 모두에 배정하면 성공률 차이를 계산할 수 있습니다.');
    return card;
  }
  function appendYieldDifference(card, difference, unavailable) {
    if (!difference) {
      card.append(node('p', unavailable));
      return;
    }
    const points = n => (n > 0 ? '+' : '') + yieldNumber(n) + '%p';
    const { low, high } = difference;
    const range = low === high ? points(low) : points(low) + ' ~ ' + points(high);
    card.append(node('strong', '성공률 차이 (저널 사용 배정 − 평소 도구 배정) ' + range));
    if (low < 0 && high > 0)
      card.append(node('p', '미확인 결과에 따라 어느 쪽의 성공률이 더 높은지 달라질 수 있습니다.'));
    else if (low !== high && (low === 0 || high === 0))
      card.append(node('p', '미확인 결과에 따라 두 방식의 성공률이 같을 수도 있습니다.'));
  }
  function showDeadlineComparisons(report) {
    const {assigned} = report.all;
    const count = report.deadlineAssigned;
    el('deadline-coverage').textContent = '전체 배정 ' + assigned + '건 중 목표 시간을 미리 정한 배정 ' +
      count + '건 · 목표 시간 미지정 ' + (assigned - count) + '건.';
    const area = el('allocation-deadlines');
    if (!count) {
      area.append(node('p', '사전 배정표에 목표 시간이 없어 이 비율을 계산할 수 없습니다.'));
      return;
    }
    area.append(node('p', '같은 기사와 과제에 같은 목표 시간을 배정받은 서로 다른 참여자 집단을 비교합니다. 진행자 기준과 근거 위치·판정이 모두 일치하고 참여자 기기에 기록된 활동 시간이 목표 이하면 성공입니다. 목표 시간을 지나도 과제는 계속할 수 있습니다. 명부에는 배포본 ID가 없어 같은 과제와 목표의 여러 판본이 함께 집계될 수 있습니다.'),
      node('p', '각 방식에 원래 배정한 건수가 분모입니다. 최솟값은 확인된 성공만, 최댓값은 결과 미확인 건까지 성공으로 셉니다. 미회신, 채점 대기, 시간 일부 누락 등으로 성공 여부를 판단할 수 없는 건이 여기에 포함됩니다. 시간이 일부 빠졌어도 기록된 구간만으로 목표를 넘겼다면 시간 초과로 셉니다.'));
    for (const task of report.deadlineComparisons) {
      const card = yieldCardHeader(task, task.caseId + ' · ' + task.taskId + ' · 목표 ' + task.targetSeconds + '초');
      for (const method of ['manual', 'journal']) {
        const arm = task[method];
        if (!arm?.assigned) {
          card.append(node('p', labels[method] + ' · 이 목표로 배정한 과제 0건'));
          continue;
        }
        const range = yieldRange(arm.verified, arm.unknown, arm.assigned);
        card.append(node('p', labels[method] + ' · 시간 내 검증 성공률 ' + range + ' (배정 ' + arm.assigned + '건)'),
          node('p', '시간 내 성공 ' + arm.verified + '건 · 위치 또는 판정 불일치 ' + arm.failedQuality +
            '건 · 시간 초과 ' + arm.overTime + '건 · 중도 종료 ' + arm.withdrawn + '건 · 결과 미확인 ' + arm.unknown + '건'));
      }
      appendYieldDifference(card, task.difference, '같은 과제와 목표 시간을 두 방식 모두에 배정하면 성공률 차이를 계산할 수 있습니다.');
      if (task.difference && (task.difference.high < 0 || task.difference.low > 0))
        card.append(node('p', '목표 시간 내 성공률은 저널을 배정받은 집단에서 더 ' + (task.difference.high < 0 ? '낮습니다.' : '높습니다.')));
      area.append(card);
    }
  }
  function showAllocations(report) {
    el('allocation-counts').textContent = assignmentCounts(report.all) +
      '. 명부 밖 코드의 현업 기록 ' + report.outsideRoster + '건 · 등록한 기사를 찾을 수 없는 현업 기록 ' +
      report.unlinked + '건.';
    for (const arm of report.arms) {
      const card = node('article', '');
      card.append(node('h3', arm.caseId + ' · ' + arm.taskId + ' · ' + labels[arm.method]),
        node('p', arm.prompt), node('p', assignmentCounts(arm)),
        node('p', '같은 과제의 완료·중도 종료 ' + (arm.completed + arm.withdrawn) + '건 중 기록상 방식이 원래 배정과 다른 경우 ' +
          arm.crossover + '건'), node('p', '완료 응답 ' + arm.completed + '건 중 실제 사용이 원래 배정과 일치 ' +
          arm.selfSame + '건 · 불일치 ' + arm.selfDifferent + '건 · 미확인 ' + arm.selfUnknown + '건'),
        ...qualityLines(arm.outcomes));
      el('allocation-arms').append(card);
    }
    const yieldTargets = new Map();
    for (const comparison of report.assignmentComparisons) {
      const card = assignmentYieldCard(comparison);
      card.id = 'assigned-yield-' + (yieldTargets.size + 1);
      card.tabIndex = -1;
      yieldTargets.set(trialTarget(comparison), card.id);
      el('allocation-yield').append(card);
    }
    showDeadlineComparisons(report);
    showComparisons(report.groups, el('allocation-comparisons'), yieldTargets);
  }
  function stats() {
    const rows = selected(),
      dupe = repeatIds(),
      eligible = rows.filter((r) => !dupe.has(r.trial.id));
    const pending = eligible.filter(({ trial, locationGrade, verdictGrade }) =>
      trial.status === 'completed' && (!verdictGrade || (trial.found === 'found' && !locationGrade))).length;
    el('count').textContent =
      '불러온 ' +
      rows.length +
      '건 · 같은 참여 코드로 같은 사례나 기사를 다시 열어 요약에서 제외 ' +
      (rows.length - eligible.length) +
      '건 · 채점 대기 ' + pending + '건';
    el('save').disabled = loading || !rows.length;
    const hasAssignments = el('kind').value === 'editor' && assignments.length > 0;
    const toggle = el('toggle-results');
    toggle.disabled = loading || (!rows.length && !hasAssignments);
    toggle.textContent = showingResults ? '배정 가리고 채점하기' : '배정과 결과 보기';
    toggle.setAttribute('aria-expanded', String(showingResults));
    el('results').hidden = !showingResults;
    el('view-note').textContent = showingResults
      ? '배정과 소요 시간을 보는 중입니다. 채점을 계속하려면 배정을 다시 가리세요.'
      : '채점 중에는 참여 코드·배정 방식·소요 시간을 가립니다. 이미 본 배정은 화면을 다시 가려도 알 수 있습니다.';
    el('groups').replaceChildren();
    el('allocation-results').hidden = !showingResults || !hasAssignments;
    el('allocation-counts').textContent = '';
    el('allocation-arms').replaceChildren();
    el('allocation-yield').replaceChildren();
    el('deadline-coverage').textContent = '';
    el('allocation-deadlines').replaceChildren();
    el('allocation-comparisons').replaceChildren();
    if (!showingResults) {
      el('comparisons').replaceChildren();
      return;
    }
    const groups = c.group(eligible.map(applied));
    if (hasAssignments) showAllocations(c.allocationReport(assignments, rows.map(applied), dupe));
    showComparisons(groups, el('comparisons'));
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
          '기록상 방식과 본인 응답 일치 ' +
            g.asAssigned +
            '건 · 불일치 ' +
            g.differentMethod +
            '건 · 미확인 ' +
            g.unknownUse +
            '건'
        ),
        ...qualityLines(g),
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
      if (g.timed) d.append(node('p', '단계별 평균 · ' + kitCoverage([g], n => n.timed)));
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
    sel.disabled = disabled || showingResults;
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
    if (!showingResults) rows.sort((a, b) => blindRanks.get(a.trial.id) - blindRanks.get(b.trial.id));
    for (const [index, entry] of rows.entries()) {
      const t = entry.trial,
        d = node('article', '');
      const heading = showingResults ? t.participant + ' · ' + t.taskId + ' · 기록상 방식 ' + labels[t.method]
        : '답안 ' + (index + 1) + ' · ' + t.taskId;
      d.append(node('h3', heading), node('p', t.prompt));
      if (dupe.has(t.id)) {
        d.append(node('p', '같은 기사 사례에 반복 참여해 채점을 건너뜁니다. 연습·중도 종료를 포함해 시간과 품질 요약에서 제외했습니다.'));
        if (!showingResults) {
          el('entries').append(d);
          continue;
        }
      }
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
      t.journalUse || '',
      c.kitVersion(t.kitVersion)
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
    const next = new Map(records), conflicts = new Map();
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
            if (row[k] && prev[k] && row[k] !== prev[k]) {
              if (!conflicts.has(trial.id)) conflicts.set(trial.id, {trial, fields:new Set()});
              conflicts.get(trial.id).fields.add(k);
            }
            row[k] = prev[k] || row[k];
          }
        }
        next.set(trial.id, row);
      }
    }
    if (conflicts.size) {
      const error = Error('같은 기록의 채점 결과가 다릅니다. 해당 항목을 원자료와 대조한 뒤 사용할 채점본을 불러오세요.');
      error.gradeConflicts = [...conflicts.values()];
      throw error;
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
      if (!blindRanks.has(id)) blindRanks.set(id, Math.random());
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
      const draft = {kind:el('kind').value, keys, entries:[...records.values()], unexported:[...unexported],
        blindRanks:[...blindRanks]};
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
      // Older drafts have no display order. Import validation above generated fresh ranks for them.
      if (Array.isArray(draft.blindRanks)) for (const pair of draft.blindRanks) {
        if (Array.isArray(pair) && records.has(pair[0]) && Number.isFinite(pair[1]) && pair[1] >= 0 && pair[1] < 1)
          blindRanks.set(pair[0], pair[1]);
      }
      for (const kind of draft.unexported) unexported.add(kind);
      el('kind').value = draft.kind;
      showKeys();
      el('status').textContent = '이 탭에서 작업하던 집계를 복원했습니다.';
      persistDraft();
    } catch {
      anchors.clear();
      records.clear();
      blindRanks.clear();
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
    el('roster-file').disabled = on;
    el('choose-roster').disabled = on;
    el('imports').disabled = on;
    el('choose-imports').disabled = on;
    el('key-file').disabled = on;
    el('choose-key').disabled = on;
    el('kind').disabled = on;
    el('entries').inert = on;
    el('save').disabled = on || !selected().length;
    el('toggle-results').disabled = on || !(selected().length || (el('kind').value === 'editor' && assignments.length));
    if (on && showingResults) {
      showingResults = false;
      render();
    }
  }
  el('choose-imports').onclick = () => el('imports').click();
  el('choose-key').onclick = () => el('key-file').click();
  el('toggle-results').onclick = () => {
    if (el('toggle-results').disabled) return;
    showingResults = !showingResults;
    render();
  };
  const rosterKey = 'journal-field-assignments-v1/' + location.pathname;
  function restoreRoster() {
    try {
      const existing = sessionStorage.getItem(rosterKey);
      if (!existing) return;
      assignments = c.mergeAssignments([], [JSON.parse(existing)]);
      el('roster-status').textContent = '이 탭의 사전 배정표를 복원했습니다.';
    } catch {
      el('roster-status').textContent = '이 탭의 배정표를 복원할 수 없습니다. 별도로 보관한 명부를 불러오세요.';
    }
  }
  el('choose-roster').onclick = () => el('roster-file').click();
  el('roster-file').onchange = async e => {
    if (loading) return;
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    loadingState(true);
    try {
      const values = [];
      for (const file of files) values.push(JSON.parse(await file.text()));
      assignments = c.mergeAssignments(assignments, values);
      el('roster-status').textContent = '현장 사전 배정표를 불러왔습니다. 현업 참여에서 배정과 결과를 열어 확인하세요.';
      try {
        sessionStorage.setItem(rosterKey, JSON.stringify({format:c.assignmentFormat, assignments}));
      } catch {
        el('roster-status').textContent += ' 탭에 임시 저장할 수 없어 새로고침 후에는 명부를 다시 불러와야 합니다.';
      }
      render();
    } catch (err) {
      el('roster-status').textContent = err instanceof SyntaxError ? '사전 배정표의 JSON 형식을 확인하세요.' : err.message;
    } finally {
      loadingState(false);
    }
  };
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
      el('status').textContent = err instanceof SyntaxError ? '진행자 기준 파일의 JSON 형식을 확인하세요.' : err.message;
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
      el('status').textContent = '파일을 불러오지 못했습니다. ' +
        (err instanceof SyntaxError ? 'JSON 형식을 확인하세요.' : err.message);
      if (err.gradeConflicts) {
        const list = node('ul', '');
        // Use only answer text already visible during blind grading. File order can reveal the assignment.
        const rows = err.gradeConflicts.map(({trial, fields}) => {
          const li = node('li', '');
          const differing = [];
          if (fields.has('locationGrade')) differing.push('근거 위치');
          if (fields.has('verdictGrade')) differing.push('판정');
          const detail = trial.found === 'found' ? '제출한 위치 · ' + trial.locator : '제출한 이유 · ' + trial.reason;
          li.append(node('p', trial.prompt), node('p', detail), node('p', '채점 차이 · ' + differing.join(', ')));
          return li;
        });
        rows.sort((a, b) => a.textContent.localeCompare(b.textContent, 'ko'));
        for (const row of rows) list.append(row);
        el('status').append(list);
      }
    } finally {
      loadingState(false);
    }
  };
  el('save').onclick = () => {
    const dupe = repeatIds();
    const data = {
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
    downloadJson(data, 'field-grades-' + el('kind').value + '.json');
    unexported.delete(el('kind').value);
    persistDraft();
  };
  function downloadJson(data, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  el('save-roster').onclick = () => {
    if (showingResults && el('kind').value === 'editor' && assignments.length)
      downloadJson({format:c.assignmentFormat, assignments}, 'field-assignment-roster.json');
  };
  el('kind').onchange = () => { showingResults = false; render(); persistDraft(); };
  restoreDraft();
  restoreRoster();
  render();
})();

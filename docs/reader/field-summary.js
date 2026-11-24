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
  let runningReview = null;
  const reviewDisplays = new Map();
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
  function readGradingTime(value) {
    if (value === undefined) return undefined;
    if (!value || typeof value.id !== 'string' || !/^[0-9a-f]{32}$/.test(value.id) || !Number.isSafeInteger(value.ms) || value.ms < 0 ||
      !['paused', 'complete'].includes(value.status) || typeof value.partial !== 'boolean') {
      throw Error('진행자 채점 시간의 구간과 측정 상태를 확인하세요.');
    }
    return {id:value.id, ms:value.ms, status:value.status, partial:value.partial};
  }
  function clockId() {
    return [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join('');
  }
  function noteUnclockedWork(entry) {
    if (runningReview?.entry === entry) return;
    if (entry.gradingTime) {
      entry.gradingTime = {...entry.gradingTime, partial:true, status:'paused'};
    } else entry.unclockedGrade = true;
  }
  function stopReview(complete = false) {
    if (!runningReview) return;
    const {entry, start, checkpoint} = runningReview;
    clearInterval(checkpoint);
    runningReview = null;
    const elapsed = Math.max(0, Math.round(performance.now()) - start);
    entry.gradingTime = {...entry.gradingTime, ms:entry.gradingTime.ms + elapsed,
      status:complete ? 'complete' : 'paused'};
    unexported.add(entry.trial.kind);
    persistDraft();
    reviewDisplays.get(entry)?.();
  }
  function reviewControl(entry, card) {
    const details = node('details', '');
    details.append(node('summary', '진행자 채점 시간'));
    const status = node('p', '');
    status.setAttribute('role', 'status');
    details.append(status);
    const start = node('button', '측정 시작'), pause = node('button', '일시 정지'), finish = node('button', '채점 시간 확정');
    const missed = node('button', '빠진 시간 표시');
    function refresh() {
      const saved = entry.gradingTime, active = runningReview?.entry === entry;
      status.textContent = (active ? '측정 중' : !saved ? '미측정' : saved.status === 'complete' ? '측정 종료' : '측정 멈춤') +
        (saved?.partial ? ' · 일부 구간만 측정' : '') +
        (saved && showingResults ? ' · 기록한 진행자 활동 시간 ' + minimumSeconds(saved.ms) : '');
      start.textContent = saved ? '측정 재개' : '측정 시작';
      start.disabled = active;
      pause.disabled = !active;
      finish.disabled = !saved || saved.status === 'complete';
      missed.disabled = !saved || saved.partial;
    }
    if (!showingResults) {
      details.append(start, pause, finish, missed);
      for (const button of [start, pause, finish, missed]) button.type = 'button';
      const pauseOther = () => { if (runningReview && runningReview.entry !== entry) stopReview(); };
      card.addEventListener('pointerdown', pauseOther);
      card.addEventListener('focusin', pauseOther);
      start.onclick = () => {
        if (runningReview?.entry === entry) return;
        stopReview();
        const priorWork = !!(entry.unclockedGrade || entry.locationGrade || entry.reasonGrade || (!entry.basis && entry.verdictGrade));
        entry.gradingTime = entry.gradingTime ? {...entry.gradingTime, status:'paused'} :
          {id:clockId(), ms:0, status:'paused', partial:priorWork};
        runningReview = {entry, start:Math.round(performance.now()), checkpoint:setInterval(persistDraft, 15000)};
        unexported.add(entry.trial.kind);
        persistDraft();
        refresh();
      };
      pause.onclick = () => stopReview();
      finish.onclick = () => {
        if (runningReview?.entry === entry) return stopReview(true);
        entry.gradingTime = {...entry.gradingTime, status:'complete'};
        unexported.add(entry.trial.kind);
        persistDraft();
        refresh();
      };
      missed.onclick = () => {
        entry.gradingTime = {...entry.gradingTime, partial:true};
        unexported.add(entry.trial.kind);
        persistDraft();
        refresh();
      };
    }
    reviewDisplays.set(entry, refresh);
    refresh();
    return details;
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
  function resetReviewCoverage(entry) {
    if (entry.gradingTime) return {gradingTime:{...entry.gradingTime, status:'paused'}};
    if (entry.locationGrade || entry.reasonGrade || (!entry.basis && entry.verdictGrade)) return {unclockedGrade:true};
    return {};
  }
  function bind(entry, anchor) {
    if (!anchor) return entry;
    const same = sameBasis(anchor, entry.basis);
    return {
      ...entry,
      ...(!same ? resetReviewCoverage(entry) : {}),
      basis: anchor,
      verdictGrade:
        entry.trial.status === 'completed' ? (entry.trial.verdict === anchor.verdict ? 'yes' : 'no') : '',
      locationGrade: same ? entry.locationGrade : '',
      reasonGrade: same ? entry.reasonGrade : ''
    };
  }
  function applyActiveKey(entry) {
    const tasks = anchors.get(entry.trial.caseId);
    if (!tasks) return entry;
    const match = tasks.get(trialTarget(entry.trial));
    if (match) return bind(entry, match);
    return entry.basis ? { ...entry, ...resetReviewCoverage(entry), basis: null, verdictGrade: '', locationGrade: '', reasonGrade: '' } : entry;
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
    section.append(node('p', '활동 구간이 빠진 답안의 실제 시간에는 상한을 정할 수 없습니다. 완료 평균에서는 중도 종료 시간을 제외합니다.'));
    part.append(section);
    return part;
  }
  function returnedCostPanel(version, cost, withReason = false) {
    const {manual, journal, difference} = cost;
    const section = node('section', '');
    section.className = withReason ? 'returned-reason-cost' : 'returned-cost';
    section.append(node('h5', withReason ? '근거 위치·판정·판단 이유가 모두 맞은 1건당 투입 시간 · 참여자' :
      '회수한 기록 전체의 검증 성공 1건당 투입 시간 · 근거 위치와 판정 · 참여자'));
    for (const method of ['manual', 'journal']) {
      const arm = cost[method];
      if (!arm) {
        section.append(node('p', labels[method] + ' · 회수한 기록 0건'));
        continue;
      }
      section.append(node('p', labels[method] + ' · 완료 ' + arm.completed + '건, 중도 종료 ' + arm.withdrawn +
        '건 · 총 활동 시간 ' + (arm.partial ? '최소 ' : '') + minimumSeconds(arm.observedMs) +
        ' · 확인된 성공 ' + arm.verified + '건, 성공 여부 확인 대기 ' + arm.pending + '건'));
      if (arm.minMs === null) {
        section.append(node('p', '검증 성공이 0건이어서 성공 1건당 시간을 계산할 수 없습니다.'));
        continue;
      }
      // Round endpoints outward, including when the quotient is less than one millisecond.
      let range;
      if (arm.minMs === arm.maxMs) {
        range = arm.minMs > 0 && arm.minMs < 1 ? '1밀리초 미만' :
          (Number.isInteger(arm.minMs) ? '' : '약 ') +
          (arm.minMs / 1000).toLocaleString('ko-KR', {maximumFractionDigits:3}) + '초';
      } else if (arm.maxMs === null) {
        range = minimumSeconds(arm.minMs) + ' 이상 (빠진 활동 시간이 있어 상한 미확인)';
      } else {
        range = minimumSeconds(arm.minMs) + ' ~ ' + minimumSeconds(Math.ceil(arm.maxMs));
      }
      const condition = arm.verified ? '' : '채점 후 성공이 1건 이상이면 ';
      section.append(node('p', condition + '성공 1건당 ' + range +
        (arm.verified ? '' : '. 모두 실패하면 성공당 시간을 계산할 수 없습니다.')));
    }
    if (difference && (difference.low > 0 || difference.high < 0)) {
      const longer = difference.low > 0;
      const gap = longer ? difference.low : -difference.high;
      const exact = difference.low === difference.high;
      const amount = gap >= 1 ? minimumSeconds(gap) + (exact && Number.isInteger(gap) ? ' ' : ' 이상 ') : '';
      section.append(node('strong', (withReason ? '회수한 기록 전체에서 저널은 세 항목이 모두 맞은 1건당 ' :
        '회수한 기록 전체에서 저널은 검증 성공 1건당 ') + amount +
        (longer ? '더 걸렸습니다.' : '빨랐습니다.')));
    } else if (difference?.low === 0 && difference.high === 0) {
      section.append(node('p', '두 방식의 성공 1건당 투입 시간이 같습니다.'));
    } else if (manual && journal && version) {
      section.append(node('p', '어느 방식의 성공당 투입 시간이 더 짧은지 확정할 수 없습니다.'));
    }
    return section;
  }
  function personTimePanel(comparison) {
    const section = node('section', '');
    section.className = 'person-time';
    section.append(node('h5', '참여자와 진행자의 인력 투입 시간 · 세 항목이 모두 맞은 답안 1건당'));
    if (![comparison.manual, comparison.journal].some(arm => arm?.gradingMeasured)) {
      section.append(node('p', '진행자 채점 시간 미측정 · 합산 대기'));
      return section;
    }
    const costs = {};
    for (const method of ['manual', 'journal']) {
      const arm = comparison[method];
      if (!arm) continue;
      const partial = arm.partialCompleted + arm.partialWithdrawn;
      const n = arm.totalTimed + arm.timedWithdrawn + partial;
      section.append(node('p', labels[method] + ' · 회수 ' + n + '건 · 참여자 전체 시간 ' + (n - partial) + '/' + n +
        '건 · 진행자 전체 시간 ' + arm.gradingComplete + '/' + n + '건 · 세 항목 성공 ' + arm.verifiedWithReason +
        '건, 확인 대기 ' + arm.reasonOutcomePending + '건'));
      if (partial || arm.gradingComplete !== n || arm.reasonOutcomePending || !arm.verifiedWithReason) {
        section.append(node('p', '성공당 인력 시간 산출 대기'));
        continue;
      }
      const participant = arm.totalMs + arm.withdrawnMs;
      costs[method] = (participant + arm.gradingMs) / arm.verifiedWithReason;
      const amount = costs[method] > 0 && costs[method] < 50 ? '0.1초 미만' : seconds(costs[method], 1);
      section.append(node('p', '참여자 ' + minimumSeconds(participant) + ' + 진행자 ' + minimumSeconds(arm.gradingMs) +
        ' · 성공 1건당 ' + amount + '의 인력 시간'));
    }
    if (comparison.version && costs.manual !== undefined && costs.journal !== undefined) {
      const savedMs = costs.manual - costs.journal;
      section.append(node('strong', '저널의 성공당 인력 시간 ' + timeChangeText({savedMs,
        savedPct:costs.manual ? 100 * savedMs / costs.manual : null})));
    }
    return section;
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
    const resumed = (comparison.manual?.resumedWithoutMatchingKit || 0) + (comparison.journal?.resumedWithoutMatchingKit || 0);
    if (resumed) card.append(node('p', '시작한 배포본과 다른 버전이거나 버전이 확인되지 않는 화면에서 재개한 기록 ' + resumed + '건입니다. 활동 시간과 채점 결과는 보존했습니다.'));
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
    card.append(node('h5', '검증 성공 1건당 투입 시간 · 활동 시간이 온전히 남은 기록 · 참여자'));
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
      card.append(node('strong', '시간이 온전히 남은 기록에서 검증 성공 1건당 ' + timeChangeText(comparison.perVerified)));
    card.append(returnedCostPanel(comparison.version, comparison.returnedCost));
    if (comparison.returnedCostWithReason)
      card.append(returnedCostPanel(comparison.version, comparison.returnedCostWithReason, true));
    card.append(personTimePanel(comparison));
    return card;
  }
  function assignmentCounts(n) {
    return '배정 ' + n.assigned + '건 · 완료 ' + n.completed + '건 · 중도 종료 ' + n.withdrawn +
      '건 · 기사·과제 불일치 ' + n.wrongTask + '건 · 반복·배정 충돌 ' + n.excluded +
      '건 · 연결된 현업 기록 없음 ' + n.missing + '건';
  }
  function qualityLines({submitted=0, locationHits=0, locationGraded=0, verdictHits=0, verdictGraded=0,
    verified=0, verificationKnown=0, verifiedWithReason=0, reasonOutcomeKnown=0,
    verifiedReasonFailed=0, verifiedReasonPending=0, unsafe=0, unsafeTotal=0, referencePending=0} = {}) {
    return [
      node('p', '원자료 위치 재확인 성공률 ' + pct(locationHits, locationGraded) +
        ' · 채점 대기 ' + (submitted - locationGraded) + '건'),
      node('p', '판정 일치율 ' + pct(verdictHits, verdictGraded) +
        ' · 채점 대기 ' + (submitted - verdictGraded) + '건'),
      node('p', '근거 위치와 판정 모두 일치 ' + pct(verified, verificationKnown) +
        ' · 성공 여부 확인 대기 ' + (submitted - verificationKnown) + '건'),
      node('p', '근거 위치·판정·판단 이유 모두 일치 ' + pct(verifiedWithReason, reasonOutcomeKnown) +
        ' · 세 항목의 결과 확인 대기 ' + (submitted - reasonOutcomeKnown) + '건'),
      node('p', '위치와 판정이 맞은 ' + verified + '건 중 판단 이유 불일치 ' + verifiedReasonFailed +
        '건 · 이유 대조 전 ' + verifiedReasonPending + '건'),
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
  function deadlinePanel(result, includeReason) {
    const panel = node('section', '');
    panel.className = includeReason ? 'deadline-with-reason' : 'deadline-basic';
    panel.append(node('h5', includeReason ? '근거 위치·판정·판단 이유 일치' : '근거 위치·판정 일치'));
    for (const method of ['manual', 'journal']) {
      const arm = result[method];
      if (!arm.assigned) {
        panel.append(node('p', labels[method] + ' · 이 목표로 배정한 과제 0건'));
        continue;
      }
      const range = yieldRange(arm.verified, arm.unknown, arm.assigned);
      panel.append(node('p', labels[method] + ' · 시간 내 검증 성공률 ' + range + ' (배정 ' + arm.assigned + '건)'),
        node('p', '시간 내 성공 ' + arm.verified + '건 · 위치 또는 판정 불일치 ' + arm.failedQuality +
          '건' + (includeReason ? ' · 판단 이유 불일치 ' + arm.failedReason + '건' : '') + ' · 시간 초과 ' + arm.overTime +
          '건 · 중도 종료 ' + arm.withdrawn + '건 · 결과 미확인 ' + arm.unknown + '건'));
    }
    appendYieldDifference(panel, result.difference, '같은 과제와 목표 시간을 두 방식 모두에 배정하면 성공률 차이를 계산할 수 있습니다.');
    if (result.difference && (result.difference.high < 0 || result.difference.low > 0))
      panel.append(node('p', '목표 시간 내 성공률은 저널을 배정받은 집단에서 더 ' + (result.difference.high < 0 ? '낮습니다.' : '높습니다.')));
    return panel;
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
    area.append(node('p', '같은 기사와 과제에 같은 목표 시간을 배정받은 사람 전체가 각 방식의 분모입니다. 참여자가 목표 안에 제출한 답을 두 기준으로 봅니다. 두 번째 기준은 답에 적은 수치·대상·계산 등 판단 이유까지 진행자가 원자료와 대조해 일치로 채점해야 성공입니다. 시간은 참여자 기기에 기록된 활동 시간입니다.'),
      node('p', '최솟값은 확인된 성공만, 최댓값은 미확인 건까지 성공으로 셉니다. 미회신, 채점 대기, 시간 일부 누락으로 성공 여부가 달라질 수 있습니다. 기록된 시간만으로 목표를 넘겼으면 성공에서 제외합니다. 불일치와 시간 초과가 겹친 답안은 불일치로 한 번만 셉니다. 명부에는 배포본 ID가 없어 같은 과제와 목표의 여러 판본이 함께 집계될 수 있습니다.'));
    for (const task of report.deadlineComparisons) {
      const card = yieldCardHeader(task, task.caseId + ' · ' + task.taskId + ' · 목표 ' + task.targetSeconds + '초');
      const criteria = node('div', '');
      criteria.className = 'pair deadline-criteria';
      criteria.append(deadlinePanel(task, false), deadlinePanel(task.withReason, true));
      card.append(criteria);
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
  const reasonControls = new Map();
  const primaryControls = [];
  const continueGrading = node('button', '다음 미채점 위치·판정으로 이동');
  continueGrading.type = 'button';
  continueGrading.setAttribute('aria-controls', 'entries');
  function nextGradeField(entry) {
    if (entry.trial.status !== 'completed') return null;
    if (entry.trial.found === 'found' && !entry.locationGrade) return 'locationGrade';
    return entry.verdictGrade ? null : 'verdictGrade';
  }
  function focusNextGrade(after) {
    if (loading || showingResults) return;
    const start = after ? primaryControls.findIndex(control => control.select === after) + 1 : 0;
    for (let i = 0; i < primaryControls.length; i++) {
      const {entry, field, select} = primaryControls[(start + i) % primaryControls.length];
      if (nextGradeField(entry) === field) {
        select.focus();
        return;
      }
    }
  }
  const needsReason = e => e.trial.status === 'completed' && e.trial.found === 'found' &&
    e.locationGrade === 'yes' && e.verdictGrade === 'yes' && e.basis?.explanation.trim() && !e.reasonGrade;
  function stats() {
    const rows = selected(),
      dupe = repeatIds(),
      eligible = rows.filter((r) => !dupe.has(r.trial.id));
    const pending = eligible.filter(nextGradeField).length;
    el('count').textContent =
      '불러온 ' +
      rows.length +
      '건 · 같은 참여 코드로 같은 사례나 기사를 다시 열어 요약에서 제외 ' +
      (rows.length - eligible.length) +
      '건 · 위치·판정 채점 대기 ' + pending + '건';
    const nextPrimary = el('next-primary');
    nextPrimary.hidden = continueGrading.hidden = showingResults || !pending;
    nextPrimary.disabled = continueGrading.disabled = loading;
    nextPrimary.textContent = '다음 위치·판정 대조 (' + pending + '건 남음)';
    const awaitingReason = eligible.filter(needsReason).length;
    const nextReason = el('next-reason');
    nextReason.hidden = showingResults || !awaitingReason;
    nextReason.disabled = loading;
    nextReason.textContent = '다음 판단 이유 대조 (' + awaitingReason + '건 남음)';
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
    sel.setAttribute('aria-label', label);
    for (const [id, txt] of [
      ['', '채점 대기'],
      ['yes', '일치'],
      ['no', '불일치']
    ])
      sel.add(new Option(txt, id));
    const view = applied(entry);
    sel.value = disabled && field === 'locationGrade' ? 'no' : view[field];
    sel.disabled = disabled || showingResults;
    if (!sel.disabled && field !== 'reasonGrade') {
      primaryControls.push({entry, field, select:sel});
      sel.addEventListener('focus', () => wrap.after(continueGrading));
    }
    sel.onchange = () => {
      if (runningReview && runningReview.entry !== entry) stopReview();
      noteUnclockedWork(entry);
      entry[field] = sel.value;
      unexported.add(entry.trial.kind);
      persistDraft();
      stats();
      reviewDisplays.get(entry)?.();
    };
    wrap.append(sel);
    return wrap;
  }
  function render() {
    const rows = selected(),
      dupe = repeatIds();
    el('entries').replaceChildren();
    reasonControls.clear();
    primaryControls.length = 0;
    reviewDisplays.clear();
    stats();
    if (!showingResults) rows.sort((a, b) => blindRanks.get(a.trial.id) - blindRanks.get(b.trial.id));
    for (const [index, entry] of rows.entries()) {
      const t = entry.trial,
        d = node('article', '');
      const heading = showingResults ? t.participant + ' · ' + t.taskId + ' · 기록상 방식 ' + labels[t.method]
        : '답안 ' + (index + 1) + ' · ' + t.taskId;
      const title = node('h3', heading);
      title.id = 'field-answer-' + (index + 1);
      d.setAttribute('aria-labelledby', title.id);
      d.append(title, node('p', t.prompt));
      if (dupe.has(t.id)) {
        d.append(node('p', '같은 기사 사례에 반복 참여해 채점을 건너뜁니다. 연습·중도 종료를 포함해 시간과 품질 요약에서 제외했습니다.'));
        if (!showingResults) {
          el('entries').append(d);
          continue;
        }
      }
      if (t.status === 'withdrawn') {
        d.append(node('p', '중도 종료'));
        if (!dupe.has(t.id)) d.append(reviewControl(entry, d));
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
      if (!dupe.has(t.id)) d.append(reviewControl(entry, d));
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
      if (t.found === 'found' && view.verdictGrade === 'yes' && view.anchor?.explanation.trim()) {
        const details = node('details', '');
        details.append(node('summary', '판단 이유 대조 · ' + ({yes:'일치', no:'불일치'}[view.reasonGrade] || '채점 대기')),
          node('p', '참여자가 적은 이유 · ' + t.reason),
          node('p', '기준 설명 · ' + view.anchor.explanation),
          node('p', '과제에서 요구한 수치·대상·시점·계산을 확인하세요. 다른 풀이도 같은 결론을 근거로 뒷받침하면 일치로 기록하세요.'));
        const control = chooser('판단 이유', entry, 'reasonGrade');
        control.addEventListener('change', () => {
          details.firstChild.textContent = '판단 이유 대조 · ' + ({yes:'일치', no:'불일치'}[entry.reasonGrade] || '채점 대기');
        });
        reasonControls.set(entry, details);
        details.append(control);
        d.append(details);
      }
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
      c.kitVersion(t.kitVersion),
      Object.hasOwn(t, 'startedKitVersion') ? t.startedKitVersion : false
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
        if (item.unclockedGrade !== undefined && typeof item.unclockedGrade !== 'boolean')
          throw Error('채점 시간 누락 표시를 확인하세요.');
        let row = {
          trial,
          repeatExposure: item.repeatExposure === true,
          locationGrade: grade(item.locationGrade),
          verdictGrade: grade(item.verdictGrade),
          reasonGrade: grade(item.reasonGrade === undefined ? '' : item.reasonGrade),
          basis: item.basis ? basis(item.basis.caseId, item.basis.articleUrl, item.basis) : null,
          gradingTime: readGradingTime(item.gradingTime), unclockedGrade: item.unclockedGrade === true
        };
        if (row.unclockedGrade && row.gradingTime) row.gradingTime.partial = true;
        if (trial.status !== 'completed' || trial.found !== 'found' || !row.basis?.explanation.trim()) row.reasonGrade = '';
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
        if (prev) {
          if (prev.gradingTime && row.gradingTime &&
              JSON.stringify(prev.gradingTime) !== JSON.stringify(row.gradingTime)) {
            throw Error('같은 답안의 진행자 시간 기록이 서로 다릅니다. 별도의 집계 탭에서 사용할 측정본 하나를 여세요.');
          }
          const timed = row.gradingTime ? row : prev;
          const other = timed === row ? prev : row;
          row.gradingTime ??= prev.gradingTime;
          row.unclockedGrade ||= prev.unclockedGrade;
          if (row.gradingTime && !other.gradingTime &&
              (other.unclockedGrade || ['locationGrade', 'reasonGrade', ...(!other.basis ? ['verdictGrade'] : [])]
                .some(field => other[field] && !timed[field]))) {
            row.gradingTime = {...row.gradingTime, partial:true};
          }
        }
        if (prev?.repeatExposure) row.repeatExposure = true;
        if (prev && !sameBasis(row.basis, prev.basis)) {
          if (row.basis && prev.basis)
            throw Error('같은 기록을 다른 원자료 기준으로 채점했습니다. 사용할 집계본을 선택하세요.');
          if (prev.basis) {
            next.set(trial.id, { ...prev, repeatExposure: row.repeatExposure, gradingTime:row.gradingTime,
              unclockedGrade:row.unclockedGrade });
            continue;
          }
        } else if (prev) {
          for (const k of ['locationGrade', 'verdictGrade', 'reasonGrade']) {
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
    const clockOwners = new Set();
    for (const entry of next.values()) {
      if (entry.gradingTime) {
        if (clockOwners.has(entry.gradingTime.id)) throw Error('서로 다른 답안에서 같은 진행자 시간 기록을 사용했습니다.');
        clockOwners.add(entry.gradingTime.id);
      }
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
      // If the browser dies, the last observed checkpoint is a lower bound. A
      // normal pagehide stops the timer and replaces it with a paused record.
      const entries = [...records.values()].map(entry => {
        if (runningReview?.entry !== entry) return entry;
        return {...entry, gradingTime:{...entry.gradingTime, partial:true,
          ms:entry.gradingTime.ms + Math.max(0, Math.round(performance.now()) - runningReview.start)}};
      });
      const draft = {kind:el('kind').value, keys, entries, unexported:[...unexported],
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
    stopReview();
    if (!unexported.size) return;
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('pagehide', () => stopReview());
  document.addEventListener('visibilitychange', () => { if (runningReview) persistDraft(); });
  let loading = false;
  function loadingState(on) {
    if (on) stopReview();
    loading = on;
    el('next-primary').disabled = continueGrading.disabled = on;
    el('next-reason').disabled = on;
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
  function pickFile(id) { stopReview(); el(id).click(); }
  el('choose-imports').onclick = () => pickFile('imports');
  el('choose-key').onclick = () => pickFile('key-file');
  el('next-primary').onclick = () => focusNextGrade();
  continueGrading.onclick = () => focusNextGrade(continueGrading.previousElementSibling?.querySelector('select'));
  el('next-reason').onclick = () => {
    if (loading || showingResults) return;
    for (const [entry, details] of reasonControls) {
      if (!needsReason(entry)) continue;
      details.open = true;
      details.querySelector('select').focus();
      break;
    }
  };
  el('toggle-results').onclick = () => {
    if (el('toggle-results').disabled) return;
    stopReview();
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
  el('choose-roster').onclick = () => pickFile('roster-file');
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
      let reset = 0, resetReasons = 0;
      for (const [id, entry] of records) {
        const next = applyActiveKey(entry);
        if (entry.locationGrade && !next.locationGrade) reset++;
        if (entry.reasonGrade && !next.reasonGrade) resetReasons++;
        if (!sameBasis(entry.basis, next.basis)) unexported.add(entry.trial.kind);
        records.set(id, next);
      }
      showKeys();
      persistDraft();
      el('status').textContent =
        '일치하는 과제에 기준을 적용했습니다.' +
        (reset ? ' 근거 위치 ' + reset + '건을 다시 확인하세요.' : '') +
        (resetReasons ? ' 판단 이유 ' + resetReasons + '건을 새 기준 설명과 다시 대조하세요.' : '');
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
          if (fields.has('reasonGrade')) differing.push('판단 이유');
          const detail = trial.found === 'found' ? '제출한 위치 · ' + trial.locator : '제출한 이유 · ' + trial.reason;
          li.append(node('p', trial.prompt), node('p', detail), node('p', '채점 차이 · ' + differing.join(', ')));
          if (fields.has('reasonGrade') && trial.found === 'found') li.append(node('p', '제출한 이유 · ' + trial.reason));
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
    stopReview();
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
          ...(v.reasonGrade ? { reasonGrade: v.reasonGrade } : {}),
          ...(v.gradingTime ? { gradingTime:v.gradingTime } : {}),
          ...(v.unclockedGrade ? { unclockedGrade:true } : {}),
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
  el('kind').onchange = () => { stopReview(); showingResults = false; render(); persistDraft(); };
  restoreDraft();
  restoreRoster();
  render();
})();

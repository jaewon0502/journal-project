// Share only numeric aggregates for a task or counterbalanced editor comparison.
window.JournalFieldTimeReport = (() => {
  'use strict';
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
  function renderEditorCrossover(data, area) {
    const node = (tag, text) => {
      const el = area.ownerDocument.createElement(tag);
      el.textContent = text;
      return el;
    };
    area.append(node('h3', '같은 편집자의 시간과 검증 성공'));
    if (!data.pairedAssignments) {
      area.append(node('p', '두 기사에서 평소 도구와 저널을 한 번씩 쓰도록 배포본까지 사전 배정한 편집자가 없습니다.'));
      return;
    }
    area.append(node('p', '명부 ' + data.assignedEditors + '명 중 두 기사에 서로 다른 방식을 배정한 편집자 ' + data.pairedAssignments +
      '명 · 두 과제의 사용 방식·판본·시간·채점을 확인한 편집자 ' + data.completeEditors + '명 · 교차 배정 비교에 포함된 편집자 ' + data.comparedEditors + '명'));
    if (!data.comparedEditors) {
      area.append(node('p', '같은 두 과제에서 방식을 서로 바꾸어 배정하고, 양방향 배정 인원과 비교 가능한 응답 인원이 각각 같아야 결과를 볼 수 있습니다.'));
      return;
    }
    area.append(node('p', '비교한 편집자의 과제당 평균 시간 · 평소 도구 ' + seconds(data.manualMeanMs, 1) +
      ' · 저널 병행 ' + seconds(data.journalMeanMs, 1) + ' · ' + timeChangeText(data)),
    node('p', '저널에서 빨라진 편집자 ' + data.faster + '명 · 시간이 같았던 편집자 ' + data.sameTime + '명 · 느려진 편집자 ' + data.slower + '명'));
    if (data.faster) {
      area.append(node('p', '빨라진 ' + data.faster + '명 중 평소 도구에서는 근거 위치와 판정이 모두 맞았고 저널에서는 둘 중 하나 이상이 틀린 편집자 ' +
        data.fasterQuality.fewer + '명 · 성공 여부가 같았던 편집자 ' + data.fasterQuality.same + '명 · 저널에서만 성공한 편집자 ' + data.fasterQuality.more + '명'));
      const unsafe = data.fasterUnsafe;
      if (unsafe.eligible) area.append(node('p', '빨라진 사람 중 두 과제의 기준 판정이 모두 반박이거나 모두 근거 부족인 ' + unsafe.eligible +
        '명에서, 평소 도구에서는 사실로 채택하지 않았으나 저널에서는 채택한 편집자 ' + unsafe.more + '명'));
    }
    const reason = data.fasterReason;
    if (reason?.total) {
      area.append(node('h4', '빨라진 편집자가 판단 이유까지 맞혔는지'),
        node('p', '저널에서 빨라진 ' + reason.total + '명 중 평소 도구에서만 성공 ' + reason.manualOnly +
          '명 · 저널에서만 성공 ' + reason.journalOnly + '명 · 양쪽 성공 ' + reason.bothPassed +
          '명 · 양쪽 실패 ' + reason.bothFailed + '명'),
        node('p', '성공 여부 미확정 ' + reason.pending + '명 · 같은 과제의 기준 설명이 달라 대조 보류 ' + reason.changedStandards +
          '명. 성공은 근거 위치·판정·판단 이유를 모두 맞힌 경우입니다.'));
      if (reason.unbalanced) area.append(node('p', '빠른 편집자 중 ' + reason.unbalanced +
        '명은 어느 기사에 저널을 썼는지에 따라 인원이 달랐던 묶음에 속합니다. 기사 난이도가 결과에 영향을 줄 수 있습니다.'));
    } else if (data.faster) {
      area.append(node('p', '빨라진 ' + data.faster + '명의 판단 이유 비교 대기 · 이 자료에는 과제별 판단 이유를 채점할 기준 설명이 없습니다.'));
    }
    const work = data.successfulWork;
    area.append(node('h4', '두 방식에서 근거 위치·판정·판단 이유가 모두 맞았을 때'),
      node('p', '전체 비교 ' + data.comparedEditors + '명 중 양쪽 모두 성공 ' + work.bothPassed +
        '명 · 한쪽 이상 실패 확인 ' + work.failedPairs + '명 · 양쪽 성공 여부 미확정 ' + work.pendingPairs + '명'));
    if (work.changedStandards) area.append(node('p', '같은 과제에 서로 다른 기준 설명을 사용한 묶음의 성공자 ' +
      work.changedStandards + '명은 시간 비교에서 제외했습니다.'));
    if (work.time) {
      area.append(node('p', '양방향 배정이 균형을 이룬 성공자 ' + work.comparedEditors + '명에서 과제당 평균 · 평소 도구 ' +
        seconds(work.time.manualMeanMs, 1) + ' · 저널 병행 ' + seconds(work.time.journalMeanMs, 1) + ' · ' + timeChangeText(work.time)));
      area.append(node('p', '두 과제에서 모두 세 항목을 맞힌 편집자의 결과입니다. 실패하거나 이유 채점이 남은 편집자는 전체 비교에서 확인하세요.'));
    } else area.append(node('p', '성공자 시간 차이 미산출 · 같은 기준으로 두 과제 모두 성공한 편집자 중 기사 A에 저널을 쓴 사람과 기사 B에 저널을 쓴 사람이 같은 수로 있어야 합니다.'));
    if (work.time) {
      area.append(node('h4', '성공한 검증에서 시간을 쓴 단계'));
      if (work.phaseTimes) {
        area.append(node('p', '성공자 시간 비교 ' + work.comparedEditors + '명 중 두 과제 모두 세 단계의 시간이 있고 양방향 배정이 균형을 이룬 ' +
          work.phaseEditors + '명의 과제당 평균입니다.'));
        for (const [phase, label] of [['search','원자료 찾기'], ['locate','표·발언 위치 찾기'], ['decide','판정 기록']]) {
          const t = work.phaseTimes[phase];
          area.append(node('p', label + ' · 평소 도구 ' + seconds(t.manualMeanMs, 1) +
            ' · 저널 병행 ' + seconds(t.journalMeanMs, 1) + ' · ' + timeChangeText(t)));
        }
      } else area.append(node('p', '단계별 시간 미산출 · 두 방식의 단계별 기록이 있고 양방향 배정이 균형을 이루어야 합니다.'));
    }
    area.append(node('p', '각 편집자가 서로 다른 기사를 검토했습니다. 시간 차이에는 과제 난이도와 검토 순서의 영향도 들어갈 수 있습니다.'));
  }
  function reportPage(title) {
    const doc = document.implementation.createHTMLDocument(title);
    doc.documentElement.lang = 'ko';
    const append = (parent, tag, text) => {
      const element = doc.createElement(tag);
      element.textContent = text;
      parent.append(element);
      return element;
    };
    const charset = doc.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    doc.head.prepend(charset);
    const viewport = doc.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width,initial-scale=1';
    doc.head.append(viewport);
    append(doc.head, 'style', 'body{max-width:48rem;margin:2rem auto;padding:0 1rem;font:1rem/1.65 system-ui,sans-serif;color:#182820}h1,h2{line-height:1.3}h2{margin-top:1.6rem}p{margin:.7rem 0}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #bbc9bf;text-align:left;padding:.45rem}th{font-weight:600}strong{display:block;margin:.8rem 0}@media print{body{margin:0}section{break-inside:avoid}}');
    const main = append(doc.body, 'main', '');
    append(main, 'h1', title);
    return {doc, main, append};
  }
  function crossoverHtml(data, exampleTitle = '') {
    const {doc, main, append} = reportPage(exampleTitle || '교차 배정한 편집자의 검증 시간 비교');
    if (exampleTitle) append(main, 'p', '가상 편집자 4명의 모의 기록입니다.');
    const panel = doc.createElement('div');
    renderEditorCrossover(data, panel);
    for (const line of panel.children) {
      if (line.tagName === 'H3') append(main, 'h2', line.textContent);
      if (line.tagName === 'H4') append(main, 'h3', line.textContent);
      if (line.tagName === 'P') append(main, 'p', line.textContent);
    }
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }
  function html(comparison, scope, panels, changeText) {
    const title = (scope.practice ? '연습 기록' : '현업 참여 기록') + ' · 현장 검증 시간 비교표';
    const {doc, main, append} = reportPage(title);
    const grouping = scope.assigned ? '사전 배정표에 지정한 방식' : '회신에 기록된 방식';
    append(main, 'p', grouping + '으로 나눈 결과입니다. 집계 화면의 과제 ' + scope.task + ' · ' +
      (comparison.version ? '판본 ' + scope.edition : '배포본 미확인') + '.');
    append(main, 'p', '같은 과제를 검토한 참여자들의 회신을 비교합니다. 준비·모집 시간과 미회신자의 작업 시간은 집계에서 제외합니다.');
    append(main, 'h2', '참여자의 과제 완료 시간');
    const table = append(main, 'table', '');
    const head = table.createTHead().insertRow();
    for (const label of ['측정 항목', '평소 검증 도구', '저널 병행']) append(head, 'th', label).scope = 'col';
    const body = table.createTBody();
    const arms = [comparison.manual, comparison.journal];
    const row = (label, cell) => {
      const tr = body.insertRow();
      append(tr, 'th', label).scope = 'row';
      for (const arm of arms) append(tr, 'td', cell(arm));
    };
    const returns = arm => arm ? arm.totalTimed + arm.partialCompleted + arm.timedWithdrawn + arm.partialWithdrawn : 0;
    row('회수한 답안', arm => returns(arm) + '건');
    row('시간을 온전히 기록하고 완료한 답안', arm => (arm?.totalTimed ?? 0) + '건');
    function seconds(ms) {
      return ms > 0 && ms < 50 ? '0.1초 미만' : (ms / 1000).toLocaleString('ko-KR', {maximumFractionDigits:1}) + '초';
    }
    row('평균 완료 시간', arm => arm?.totalTimed ? seconds(arm.totalMs / arm.totalTimed) : '미산출');
    row('중앙값', arm => arm?.totalTimed ? seconds(arm.medianMs) : '미산출');
    function fraction(arm, field) {
      const completed = arm ? arm.totalTimed + arm.partialCompleted : 0;
      return completed ? arm[field] + '/' + completed + '건' : '완료 답안 없음';
    }
    row('근거 위치·판정·이유가 모두 맞은 답안 / 완료 답안', arm => fraction(arm,'verifiedWithReason'));
    row('세 항목 성공 여부 확인 대기 / 완료 답안', arm => fraction(arm,'reasonOutcomePending'));
    if (arms.some(arm => returns(arm) === 1)) {
      append(main, 'p', '회신이 한 건인 방식의 시간과 판정 결과는 해당 참여자 한 명의 기록입니다.');
    }
    append(main, 'p', comparison.savedMs !== null ? '활동 시간이 온전히 남은 완료 답안의 평균 · 저널 ' + changeText(comparison) :
      '같은 판본에서 두 방식의 온전한 완료 시간이 확인되어야 차이를 구할 수 있습니다.');
    // Rebuild only the numerical panels. No live answer cards, links or attributes enter the file.
    for (const panel of panels) {
      const section = append(main, 'section', '');
      for (const line of panel.children) {
        if (line.tagName === 'H5') append(section, 'h2', line.textContent);
        if (line.tagName === 'P' || line.tagName === 'STRONG') append(section, line.localName, line.textContent);
      }
    }
    append(main, 'p', '참여자와 진행자가 동시에 일한 시간도 각각 더합니다.');
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }
  return {html, seconds, timeChangeText, renderEditorCrossover, crossoverHtml};
})();

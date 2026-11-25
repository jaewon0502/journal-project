// One script-free report per task and observed edition. Use only numeric aggregates.
window.JournalFieldTimeReport = (() => {
  'use strict';
  function html(comparison, scope, panels, changeText) {
    const title = (scope.practice ? '연습 기록' : '현업 참여 기록') + ' · 현장 검증 시간 비교표';
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
  return {html};
})();

// Coordinator export. Write only the named aggregate fields to a script-free HTML file.
(function (root, make) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = make(require('./editor-study-cases.js'));
  else root.JournalStudyReport = make(root.JournalStudyCases);
})(globalThis, function (cases) {
  'use strict';
  const decimal = new Intl.NumberFormat('ko-KR', {maximumFractionDigits:2});
  const available = Number.isFinite;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const fmt = value => decimal.format(value);
  function measure(value, unit) {
    if (!available(value)) return '미산출';
    if (value !== 0 && Math.abs(value) < .01) return value > 0 ? '0.01' + unit + ' 미만' : '−0.01' + unit + ' 초과';
    return fmt(value) + unit;
  }
  function ratio(value, total) {
    if (!count(value) || !count(total) || value > total) return '미산출';
    return total ? fmt(value) + '/' + fmt(total) : '대상 없음';
  }
  function fractionAndRate(value, total) {
    const pair = ratio(value,total);
    return count(value) && count(total) && total > 0 && value <= total
      ? pair + ' (' + measure(100*value/total,'%') + ')' : pair;
  }
  function change(value, unit, positive, negative) {
    if (!available(value)) return '미산출';
    return value === 0 ? '변화 없음' : measure(Math.abs(value),unit) + (value > 0 ? ' ' + positive : ' ' + negative);
  }
  function row(label, a, b) {
    return '<tr><th scope="row">' + label + '</th><td>' + a + '</td><td>' + b + '</td></tr>';
  }
  function caseVerification(data, demo) {
    const title = '<h3>기사별 검토 시간과 검증 성공</h3>';
    if (data === undefined) return title + '<p>이 집계에는 기사별 시간과 검증 성공 건수가 기록되지 않았습니다.</p>';
    if (!data?.comparedCases) return title + '<p>네 사람의 검토 시간이 모두 기록된 균형 묶음이 있어야 기사를 비교할 수 있습니다.</p>';
    const lead = '비교한 기사 ' + measure(data.comparedCases,'개') + ' 중 저널 사용 시 평균 검토 시간이 짧아진 기사는 ' +
      measure(data.fasterCases,'개') + '입니다.' + (data.fasterCases
        ? ' 그중 판정과 대표 근거를 함께 맞힌 응답도 줄어든 기사는 <strong>' + ratio(data.fasterWithFewerVerified,data.fasterCases) + '개</strong>입니다.' : '');
    if (!demo || !Array.isArray(data.cases)) return title + '<p>' + lead + '</p>';
    function cell(arm) {
      return measure(arm.meanSeconds,'초') + '<br><small>성공 ' + ratio(arm.verified,arm.tasks) + '건</small>';
    }
    const rows = [];
    for (const id of cases.ids) {
      const item = data.cases.find(entry => entry.caseId === id);
      if (!item) continue;
      // Titles come from the published study cases. No free text from a submission enters the export.
      const label = cases.get(id,'A').title + (item.fasterWithFewerVerified === true ? '<br><small>시간 단축 · 성공 감소</small>' : '');
      rows.push(row(label,cell(item.manual),cell(item.journal)));
    }
    return title + '<p>' + lead + '</p><table><thead><tr><th scope="col">기사</th><th scope="col">원자료만</th>' +
      '<th scope="col">저널 병행</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
      '<p class="small">각 기사에서 두 방식에 배정된 편집자는 서로 다릅니다. 표에는 같은 시간 표본의 평균과 성공 건수를 표시합니다.</p>';
  }
  function verdictSourceAssociation(data) {
    const title = '<h3>같은 판정에 어떤 근거를 골랐나</h3>';
    if (data === undefined) return title + '<p>이 집계에는 판정과 대표 근거의 조합을 비교한 기록이 없습니다.</p>';
    if (data === null) return title + '<p>네 명이 네 과제를 모두 끝낸 묶음이 있어야 두 정당 표기의 응답을 비교할 수 있습니다.</p>';
    function valid(arm) {
      return count(arm?.differentCases) && arm.differentCases <= data.comparedCases &&
        count(arm.equalMarginalsWithGap) && arm.equalMarginalsWithGap <= arm.differentCases;
    }
    if (!count(data?.comparedCases) || data.comparedCases === 0 || !valid(data.manual) || !valid(data.journal)) {
      return title + '<p>기사 수와 방식별 건수를 확인할 수 없어 결과를 표시하지 않았습니다.</p>';
    }
    function cell(arm) {
      return ratio(arm.differentCases,data.comparedCases) + '개';
    }
    const rows = row('정당 표기에 따라 판정과 근거의 조합이 달랐던 기사',cell(data.manual),cell(data.journal)) +
      row('그중 판정 비율과 자료 선택 비율이 각각 같았던 기사',
        ratio(data.manual.equalMarginalsWithGap,data.comparedCases) + '개',ratio(data.journal.equalMarginalsWithGap,data.comparedCases) + '개');
    return title + '<table><thead><tr><th scope="col">비교한 기사 중 해당 건수</th><th scope="col">원자료만</th>' +
      '<th scope="col">저널 병행</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="small">두 줄 모두 비교한 기사 전체를 분모로 씁니다. 같은 기사에서 정당 표기만 바꿔 서로 다른 편집자에게 배정한 결과입니다.</p>';
  }
  function metrics(data, demo) {
    const time = data.time, gap = data.partyLabelAcceptanceGap, quality = data.verdictAndEvidence;
    const unsafe = data.unsupportedAcceptance;
    const joint = data.partyLabelGapAndQuality;
    const people = data.editors;
    const counts = '<p>등록 ' + measure(people.enrolled,'명') + ' 중 판정 비교 ' + measure(people.included,'명') +
      ' · ' + measure(data.includedTasks,'과제') + '. 시간 비교 ' + measure(time.editors,'명') + ' · ' + measure(time.tasks,'과제') + '.</p>';
    const headline = '<div class="highlights"><div>과제당 검토 시간<strong>' +
      change(time.reductionPct,'%','단축','증가') + '</strong></div><div>정당 표기 간 사실 채택률 격차<strong>' +
      change(gap.reductionPp,'%p','감소','증가') + '</strong></div></div>';
    function perSuccess(seconds, arm) {
      let sample = '해당 표본의 성공 건수 미기록';
      if (arm?.tasks === 0) sample = '시간 표본 없음';
      else if (count(arm?.tasks) && count(arm.verified)) sample = '성공 ' + ratio(arm.verified,arm.tasks) + '건';
      return measure(seconds,'초') + '<br><small>' + sample + '</small>';
    }
    const rows =
      row('과제당 평균 검토 시간', measure(time.manualMeanSeconds,'초'), measure(time.journalMeanSeconds,'초')) +
      row('검증 성공 한 건당 투입 시간', perSuccess(time.manualSecondsPerVerified,time.verifiedTrials?.manual),
        perSuccess(time.journalSecondsPerVerified,time.verifiedTrials?.journal)) +
      row('전체 판정 표본의 판정·대표 근거 동시 일치', fractionAndRate(quality.manual.verified, quality.manual.tasks),
        fractionAndRate(quality.journal.verified, quality.journal.tasks)) +
      row('반박·근거 부족 주장을 사실로 채택', fractionAndRate(unsafe.manual.accepted, unsafe.manual.eligible),
        fractionAndRate(unsafe.journal.accepted, unsafe.journal.eligible)) +
      row('정당 표기 간 사실 채택률 격차', measure(gap.manualPp,'%p'), measure(gap.journalPp,'%p'));
    const summary = '<table><thead><tr><th scope="col">측정 항목</th><th scope="col">원자료만</th>' +
      '<th scope="col">저널 병행</th></tr></thead><tbody>' + rows + '</tbody></table>';
    let jointText = '네 명이 네 과제를 모두 끝낸 묶음이 있어야 같은 기사의 격차와 판정 변화를 대조할 수 있습니다.';
    if (joint && count(joint.narrowed) && count(joint.cases)) {
      if (!joint.narrowed) jointText = '비교한 ' + measure(joint.cases,'건') + ' 중 정당 표기 간 격차가 줄어든 기사가 없습니다.';
      else {
        const unsafeText = joint.narrowedUnsafeEligible
          ? '그중 원자료가 반박하거나 근거가 부족한 ' + measure(joint.narrowedUnsafeEligible,'건') + '에서, 잘못된 사실 채택이 늘어난 기사는 <b>' +
            ratio(joint.narrowedWithMoreUnsafe,joint.narrowedUnsafeEligible) + '건</b>입니다. 두 표기 모두에서 늘어난 기사는 ' +
            measure(joint.narrowedWithMoreUnsafeBothLabels,'건') + '입니다.'
          : '그중 원자료가 반박하거나 근거가 부족한 기사는 없어 잘못된 사실 채택의 증가 여부를 비교할 대상이 없습니다.';
        jointText = '전체 ' + measure(joint.cases,'건') + ' 중 격차가 줄어든 기사는 <b>' + measure(joint.narrowed,'건') + '</b>입니다. ' +
          unsafeText + ' 격차가 줄어든 기사에서 판정과 근거를 함께 맞힌 응답이 감소한 사례는 <b>' +
          ratio(joint.narrowedWithFewerVerified,joint.narrowed) + '건</b>입니다.';
      }
    }
    const individual = data.individualCompletionTiming;
    let outside = '';
    if (individual?.outsideCompleteBlocks > 0) {
      const directions = individual.directions;
      outside = '<p>완성된 묶음에 들지 않았지만 네 과제를 마친 편집자 ' + measure(individual.outsideCompleteBlocks,'명') +
        '을 포함하면, 완주 ' + measure(individual.completedEditors,'명') + ' 중 시간이 단축된 사람 ' + measure(directions.faster,'명') +
        ', 증가한 사람 ' + measure(directions.slower,'명') + ', 같은 사람 ' + measure(directions.unchanged,'명') +
        ', 방향 미확인 ' + measure(directions.unknown,'명') + '입니다. 이 개인별 비교에는 기사와 정당 표기가 균등하게 배정되지 않을 수 있습니다.</p>';
    }
    return counts + headline + '<h3>격차가 줄어든 기사의 판정은 어떻게 달라졌나</h3><p>' + jointText +
      '</p><h3>방식별 시간과 판정</h3>' + summary + verdictSourceAssociation(data.partyLabelVerdictSourceAssociation) +
      caseVerification(time.caseVerification, demo) + outside;
  }
  function editionSection(title, editions, demo) {
    if (!Array.isArray(editions) || !editions.length) return '';
    return '<section><h2>' + title + '</h2>' + editions.map((entry,index) => {
      const stamp = typeof entry.kitVersion === 'string' && /^[a-f0-9]{64}$/.test(entry.kitVersion) ? entry.kitVersion : '';
      return '<details><summary>판본 ' + (index+1) + (stamp ? ' · <code>' + stamp.slice(0,12) + '</code>' : '') +
        '</summary>' + (stamp ? '<p class="small">배포본 식별값 <code>' + stamp + '</code></p>' : '') + metrics(entry, demo) + '</details>';
    }).join('') + '</section>';
  }
  function html(summary) {
    if (!summary || !['demo','editor'].includes(summary.kind)) throw new Error('결과표의 실측 또는 가상 구분을 확인하세요.');
    const demo = summary.kind === 'demo';
    const title = demo ? '가상 편집자 실험 결과표' : '편집자 실측 결과표';
    const lead = demo ? '가상 참여 기록으로 계산한 예시입니다.' : '현업 편집자로 등록한 참여자가 제공된 원자료로 가상 기사를 검토한 결과입니다.';
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">' +
      '<title>' + title + '</title><style>body{margin:0;background:#f5f6f2;color:#20312a;font:1rem/1.65 system-ui,sans-serif}' +
      'main{max-width:53rem;margin:auto;padding:clamp(1rem,4vw,3rem)}h1,h2,h3{line-height:1.3}h1{font-size:clamp(1.7rem,5vw,2.4rem)}' +
      'h2{font-size:1.35rem;margin-top:1.7rem}h3{font-size:1.05rem}section{background:white;padding:clamp(.75rem,3vw,1.6rem);margin:.9rem 0;border:1px solid #d8ddd5}' +
      '.highlights{display:flex;flex-wrap:wrap;gap:.8rem 3rem;padding:.7rem 0 1.1rem}.highlights strong{display:block;color:#234f39;font-size:1.4rem}' +
      'table{border-collapse:collapse;table-layout:fixed;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;border-bottom:1px solid #d2dbd2;padding:.5rem .35rem;overflow-wrap:anywhere}' +
      'th:first-child{width:48%}thead{background:#e6ede6}summary{cursor:pointer;font-weight:650}details{margin:.7rem 0}code{overflow-wrap:anywhere}.small{font-size:.9rem}' +
      '@media print{body{background:white}main{padding:0}section{break-inside:avoid}}</style></head><body><main><h1>' + title + '</h1><p>' + lead +
      ' 정당 표기는 기사에 붙인 실험 조건입니다.</p><section><h2>전체 결과</h2>' + metrics(summary.overall, demo) + '</section>' +
      editionSection('같은 판본으로 완료한 묶음',summary.observedEditions, demo) +
      editionSection('사전에 배정한 판본으로 완료한 묶음',summary.assignedMatchedEditions, demo) +
      '<p class="small">시간은 전체 시간을 기록한 묶음으로 계산합니다. 검증 성공은 판정과 대표 근거가 함께 맞은 과제입니다. ' +
      '정당 표기 격차는 동일 기사에서 두 표기의 사실 채택률 차이를 절댓값으로 구한 뒤 네 기사를 평균한 값입니다.</p></main></body></html>';
  }
  return Object.freeze({html});
});

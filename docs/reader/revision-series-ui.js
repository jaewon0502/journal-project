(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const input = byId('series-files');
  const clear = byId('series-clear');
  const example = byId('series-example');
  const partialExample = byId('series-partial-example');
  const exampleLabels = new Map([example, partialExample].map(button => [button, button.textContent]));
  const status = byId('series-status');
  const output = byId('output');
  let selection = 0, showingExample = null;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  const fileName = file => file.name.split(/[\\/]/).pop();
  const percent = rate => rate.denominator ? Number(rate.pct.toFixed(1)) + '%' : '산출 대기';
  const fraction = rate => rate.numerator + '/' + rate.denominator;
  const rateText = rate => percent(rate) + ' (' + fraction(rate) + ')';

  function metric(id, label, rate, articles, base, target) {
    const card = element('div', null, 'metric');
    card.id = id;
    card.append(element('p', label), element('strong', percent(rate)),
      element('small', fraction(rate) + '개 항목 · 분모에 포함된 기사 ' + articles + '건'),
      element('small', '두 사람 모두 원본을 ' + base + '로 채점한 항목 중 두 사람 모두 수정본을 ' + target + '로 채점한 비율'));
    return card;
  }

  function coverage(report) {
    const panel = element('section', null, 'panel');
    panel.id = 'series-coverage';
    panel.append(element('h3', '판정이 모인 범위'),
      element('p', '네 판정이 모두 있는 항목 ' + report.paired + '/' + report.total + '개 · 기사 ' + report.eligibleArticles + '/' + report.articleCount + '건'),
      element('p', '비교할 단계가 부족한 항목 ' + report.unpaired + '개 · 개별 판정 중 미평가 ' + report.missingScores + '건, 해당 없음 ' + report.naScores + '건'),
      element('p', '원본에서 두 사람 모두 중요한 왜곡으로 봤지만 수정본에서 한 명 이상 숫자 단계를 매기지 않은 항목 ' + report.pendingImportant + '개'),
      element('p', '개선·악화·유지 판단이 갈린 항목 ' + report.disagreed + '개 · 둘 다 유지로 봤지만 왜곡의 중요도를 다르게 본 항목 ' + report.stableSeverityDifferences + '개'));
    return panel;
  }

  function axisTable(dimensions) {
    const panel = element('section', null, 'panel');
    const table = element('table');
    table.id = 'series-dimensions';
    table.append(element('caption', '기준별 집계'));
    const header = table.createTHead().insertRow();
    for (const title of ['평가 기준', '공통 개선', '공통 악화', '네 판정 있음']) {
      const cell = element('th', title);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    for (const axis of dimensions) {
      const row = body.insertRow();
      const label = element('th', axis.title);
      label.scope = 'row';
      row.append(label, element('td', rateText(axis.improved)), element('td', rateText(axis.worsened)),
        element('td', axis.paired + '/' + axis.total + '개'));
    }
    panel.append(table);
    return panel;
  }
  function evidenceLink(entry, label, focus = '') {
    const link = element('a', entry.name + ' · ' + label, 'review-evidence');
    entry.reviewId ??= window.JournalRevisionSeries.reviewId(entry.record);
    link.href = 'article-compare.html#review=' + entry.reviewId +
      focus + (entry.libraryExample ? '&example=library' : '');
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', link.textContent + '의 원자료 대조 · 새 탭');
    return link;
  }

  const rounded = n => Number(n.toFixed(1));
  const level = value => Number.isInteger(value) ? value + '단계' : value === 'na' ? '해당 없음' : '미평가';

  function severityChange({paired, beforeImportant, afterImportant, deltaPoints, relativeReductionPct}) {
    if (!paired) return '함께 채점한 항목이 없어 산출 대기';
    const rate = count => rounded(100 * count / paired) + '% (' + count + '/' + paired + ')';
    const size = (value, unit) => rounded(Math.abs(value)) ? rounded(Math.abs(value)) + unit : '0.1' + unit + ' 미만';
    const change = deltaPoints === 0 ? '변화 없음' : size(deltaPoints, '%p') + (deltaPoints > 0 ? ' 증가' : ' 감소');
    let relative = '네 판정이 있는 항목 중 원본에서 두 사람 모두 중요하다고 본 항목이 0개여서 상대 감소율 산출 불가';
    if (relativeReductionPct !== null) {
      relative = relativeReductionPct === 0 ? '원본 대비 변화 0%' :
        '원본 대비 ' + size(relativeReductionPct, '%') + (relativeReductionPct > 0 ? ' 감소' : ' 증가');
    }
    return '원본 ' + rate(beforeImportant) + ' → 수정본 ' + rate(afterImportant) + ' · ' + change + ' · ' + relative;
  }

  function rangeText(range) {
    const {baseline, confirmed, unresolved, notApplicable, lowerPct, upperPct} = range;
    if (!baseline) return '원본을 두 사람 모두 2~3단계로 기록한 항목이 없어 산출할 수 없습니다.';
    if (baseline === notApplicable) return '원본 ' + baseline + '개 모두 수정 후 해당 없음으로 기록되어 개선 여부를 판단할 수 없습니다.';
    const counts = confirmed + '/' + baseline + '개';
    if (!unresolved) return '개선 확인 ' + counts + ' (' + rounded(lowerPct) + '%)';
    return rounded(lowerPct) + '~' + rounded(upperPct) + '% · 확인 ' + counts +
      ' · 미평가 점수를 채우면 최대 ' + (confirmed + unresolved) + '/' + baseline + '개';
  }

  function improvementRange(report, sources) {
    const range = report.improvementRange;
    const area = element('section');
    area.id = 'series-improvement-range';
    area.append(element('h4', '원본의 중요한 왜곡 전체에서 확인할 수 있는 개선'),
      element('p', rangeText(range)));
    if (!range.baseline) return area;
    area.append(element('p', '원본에서 두 편집자가 모두 2~3단계를 준 ' + range.baseline +
      '개 중 수정 후 둘 다 0~1단계인 항목을 셉니다. 수정 후 한 명 이상 2~3단계 ' + range.ruledOut +
      '개 · 추가 채점으로 개선을 확인할 수 있는 항목 ' + range.unresolved + '개 · 해당 없음으로 개선을 판단할 수 없는 항목 ' +
      range.notApplicable + '개.', 'note'));
    if (report.changedSources) area.append(element('p', '원자료가 같은 기사 ' + report.unchangedSources +
      '건의 개선 범위 · ' + rangeText(report.unchangedEvidenceRange), 'note'));
    if (!report.pendingImportant) return area;
    const details = element('details');
    details.id = 'series-improvement-pending';
    details.append(element('summary', '수정 후 미평가·해당 없음이 있는 원본 중요 항목 ' + report.pendingImportant + '개 확인'));
    const list = element('ul');
    for (const entry of sources.values()) {
      for (const {id, title} of report.dimensions) {
        const d = entry.record.dimensions.find(axis => axis.id === id);
        if (!window.JournalRevisionAgreement.summarizeScores([d]).pendingImportant) continue;
        const item = element('li');
        if (entry.record.version >= 2 && !entry.summaryOnlyExample) item.append(evidenceLink(entry, title, '&focus=bias-' + id));
        else item.append(element('strong', entry.name + ' · ' + title));
        item.append(element('p', '수정 후 첫 편집자 ' + level(d.first.after) + ' · 둘째 편집자 ' + level(d.second.after)));
        list.append(item);
      }
    }
    details.append(list);
    area.append(details);
    return area;
  }

  function severityPanel(report, sources, rates) {
    const panel = element('section');
    panel.id = 'series-severity';
    panel.append(element('h4', '같은 항목에서 본 중요한 왜곡'),
      element('p', '두 편집자가 원본과 수정본을 모두 채점한 ' + report.paired + '/' + report.total +
        '개 기사·항목을 비교했습니다. 중요한 왜곡은 2~3단계입니다.'));
    if (report.revised.rated) panel.append(element('p', '수정본에서 두 사람 모두 중요한 왜곡으로 평가한 항목 ' +
      report.revised.important + '/' + report.revised.rated + '개 (수정본에 두 사람 모두 점수를 매긴 항목 기준)'));
    if (report.revised.withoutBaseline) {
      const details = element('details');
      details.id = 'series-revised-unpaired';
      details.append(element('summary', '원본 평가가 부족한 수정본의 중요한 왜곡 ' + report.revised.withoutBaseline + '개'),
        element('p', '수정본에서는 두 사람 모두 2~3단계로 봤습니다. 원본의 근거를 확인해야 왜곡이 언제 생겼는지 판단할 수 있습니다.'));
      const list = element('ul');
      for (const entry of sources.values()) {
        for (const {id, title} of report.dimensions) {
          const d = entry.record.dimensions.find(axis => axis.id === id);
          if (!window.JournalRevisionAgreement.summarizeScores([d]).revised.withoutBaseline) continue;
          const item = element('li');
          if (entry.record.version >= 2 && !entry.summaryOnlyExample) item.append(evidenceLink(entry, title, '&focus=bias-' + id));
          else item.append(element('strong', entry.name + ' · ' + title));
          item.append(element('p', '첫 편집자 ' + level(d.first.before) + ' → ' + level(d.first.after) +
            ' · 둘째 편집자 ' + level(d.second.before) + ' → ' + level(d.second.after)));
          list.append(item);
        }
      }
      details.append(list);
      panel.append(details);
    }
    if (!report.paired) {
      panel.append(element('p', '비교할 수 있는 항목이 생기면 변화가 표시됩니다.'), rates, improvementRange(report, sources));
      return panel;
    }
    const {matrix, oppositeSteps, withinBandOppositeSteps} = report.severity;
    const result = element('p', '두 사람 모두 중요하다고 본 비율 · ');
    result.append(element('strong', severityChange(report.netSeverityChange)));
    result.id = 'series-severity-change';
    panel.append(result, rates, improvementRange(report, sources));
    if (report.changedSources) panel.append(element('p', '원자료가 같은 기사 ' + report.unchangedSources +
      '건만 보면 · ' + severityChange(report.unchangedEvidenceNet), 'note'));
    panel.append(element('p', '원본에서는 한 명만 중요하다고 봤고 수정본에서는 두 사람 모두 중요하다고 본 항목 ' +
      matrix[1][2] + '개 · 반대로 두 명에서 한 명이 된 항목 ' + matrix[2][1] + '개'),
      element('p', '한 편집자는 단계를 높이고 다른 편집자는 낮춘 항목 ' + oppositeSteps +
        '개 · 이 중 두 사람 모두 2단계 경계를 넘지 않은 항목 ' + withinBandOppositeSteps + '개'));
    const distribution = element('details');
    distribution.append(element('summary', '중요한 왜곡으로 본 편집자 수의 변화'));
    const table = element('table');
    table.append(element('caption', '각 칸은 해당 평가를 받은 기사·항목 수입니다.'));
    const header = table.createTHead().insertRow();
    for (const text of ['원본 판정', '수정본 0명', '수정본 1명', '수정본 2명']) {
      const cell = element('th', text);
      cell.scope = 'col';
      header.append(cell);
    }
    const body = table.createTBody();
    matrix.forEach((counts, index) => {
      const row = body.insertRow(), heading = element('th', '원본 ' + index + '명');
      heading.scope = 'row';
      row.append(heading, ...counts.map(n => element('td', n + '개')));
    });
    distribution.append(table);
    panel.append(distribution);

    const items = element('ul');
    let scoresOnly = 0;
    for (const article of report.articles) {
      const entry = sources.get(article.before.articleSha256);
      for (const {id, title} of report.dimensions) {
        const d = entry.record.dimensions.find(axis => axis.id === id);
        const scores = window.JournalRevisionAgreement.summarizeScores([d]);
        if (!(scores.disagreed || scores.stableSeverityDifferences || scores.severity.oppositeSteps)) continue;
        const item = element('li');
        if (entry.record.version >= 2 && !entry.summaryOnlyExample) item.append(evidenceLink(entry, title, '&focus=bias-' + id));
        else {
          item.append(element('strong', entry.name + ' · ' + title));
          scoresOnly++;
        }
        item.append(element('p', '첫 편집자 ' + d.first.before + ' → ' + d.first.after +
          '단계 · 둘째 편집자 ' + d.second.before + ' → ' + d.second.after + '단계'));
        items.append(item);
      }
    }
    if (items.children.length) {
      const details = element('details');
      details.id = 'series-bias-follow-up';
      details.append(element('summary', '중요도 판단이 갈렸거나 단계가 반대로 움직인 ' + items.children.length + '개 항목 대조'), items);
      if (scoresOnly) details.append(element('p', '원래 작업 파일로 연결할 수 없는 요약의 ' + scoresOnly + '개 항목은 전후 점수만 표시합니다.', 'note'));
      panel.append(details);
    }
    return panel;
  }

  function retentionPanel(report, sources) {
    const {facts} = report;
    const part = document.createDocumentFragment();
    if (facts.improvedArticles) {
      const noOriginal = report.articles.filter(article => article.improved.numerator && article.factTrace?.total === 0).length;
      const comparable = facts.retentionComparableArticles;
      if (comparable) part.append(element('p', '편향이 개선되고 원본 사실을 대조할 수 있는 기사 ' + comparable +
        '건 중 원본 사실의 전체 지지를 다시 확인해야 하는 기사 ' + facts.improvedWithUnconfirmedRetention + '건',
        facts.improvedWithUnconfirmedRetention ? 'warn' : 'note'));
      if (noOriginal) part.append(element('p', '편향이 개선된 기사 ' + noOriginal +
        '건은 원본에서 두 편집자가 구절 전체를 지지한 판정이 없어 유지 여부를 계산할 수 없습니다.', 'note'));
      if (facts.improvedWithoutTrace) part.append(element('p', '편향이 개선된 기사 중 구절 대응 기록이 없는 이전 요약 ' +
        facts.improvedWithoutTrace + '건은 원본 사실의 유지 여부를 집계할 수 없습니다.', 'note'));
      if (facts.improvedArticles > facts.improvedMissingFacts) {
        part.append(element('p', '사실 판정이 있는 편향 개선 기사 ' + (facts.improvedArticles - facts.improvedMissingFacts) +
          '건 중 사실 확인 대상 구절 수가 줄어든 기사 ' + facts.improvedWithFewerFactRows + '건'));
      }
    }
    const list = element('ul');
    for (const article of report.articles) {
      if (!article.facts) continue;
      const trace = article.factTrace;
      const before = article.facts.before.coverage.denominator, after = article.facts.after.coverage.denominator;
      const needsReview = trace && trace.unmatched + trace.changed > 0;
      if (!needsReview && !(before > after && article.improved.numerator)) continue;
      const entry = sources.get(article.before.articleSha256);
      const item = element('li');
      if (needsReview) {
        item.append(evidenceLink(entry, '원본 사실 ' + (trace.unmatched + trace.changed) + '개 다시 대조', '&focus=retention'));
      } else item.append(document.createTextNode(entry.name));
      if (before > after) item.append(document.createTextNode(' · 사실 확인 대상 ' + before + '개 → ' + after + '개'));
      list.append(item);
    }
    if (list.childElementCount) part.append(list, element('p',
      '표현을 고치거나 구절을 합쳐도 자동 대응이 어려울 수 있습니다. 원래 사실이 유지됐는지는 두 판본을 대조하세요.', 'note'));
    if (part.childElementCount) part.prepend(element('h4', '원본에서 확인한 사실이 수정본에도 남았는지 대조'));
    return part;
  }
  function auditCounts(audit) {
    const part = document.createDocumentFragment();
    const {core, flags} = audit;
    if (core.total) {
      const pct = Number((100 * core.retained / core.total).toFixed(1));
      part.append(element('p', '수정 후에도 근거로 확인된 원본 핵심 사실 ' + pct + '% (' + core.retained + '/' + core.total + '개)'));
      if (core.unmatched || core.changed) part.append(element('p', '수정본 대응 구절 미확인 ' + core.unmatched +
        '개 · 대응 구절은 있으나 전체 지지 미확인 ' + core.changed + '개', 'warn'));
    } else part.append(element('p', '두 편집자가 모두 핵심으로 표시하고 근거로 확인한 원본 구절이 없어 유지율을 계산할 수 없습니다.', 'note'));
    part.append(element('p', '수정본에서 충돌 표시가 있는 구절 ' + flags.total + '개 · 두 편집자가 모두 핵심으로 표시한 구절 ' + flags.core + '개'));
    if (flags.total) {
      const origins = element('ul');
      for (const [label, value] of [
        ['원본에도 충돌 표시가 있던 구절', flags.previouslyFlagged],
        ['원본에서는 두 편집자가 전체 내용을 확인한 구절', flags.previouslySupported],
        ['원본에 충돌 표시가 없고 전체 지지도 확인되지 않은 구절', flags.previouslyUnflagged],
        ['원본 대응 구절을 찾지 못한 경우', flags.unmatched]
      ]) origins.append(element('li', label + ' ' + value + '개'));
      part.append(origins);
    }
    return part;
  }

  function coreContextLink(article, entry) {
    const count = article.coreContextReview.unmatched.length;
    const label = '대응을 찾지 못한 원본 핵심 구절 ' + count + '개 대조';
    return entry.summaryOnlyExample ? element('span', entry.name + ' · ' + label) :
      evidenceLink(entry, label, '&focus=core-context');
  }

  function auditPanel(report, sources) {
    const {facts} = report;
    const panel = element('section');
    panel.id = 'series-core-audit';
    const audit = facts.audit;
    panel.append(element('h4', '편향이 개선된 기사에서 핵심 사실은 얼마나 유지됐나'),
      element('p', '편향이 한 항목 이상 개선된 ' + facts.improvedArticles + '건 중 핵심 표시와 판본 간 구절을 대조할 수 있는 기사 ' + audit.improvedArticles + '건'));
    if (facts.priorMatchArticles) {
      const label = facts.matchBasis === 'current' ? '현행 기준 보존율에서 제외한 이전 요약' : '이전 기준만으로 계산한 요약';
      panel.append(element('p', label + ' ' + facts.priorMatchArticles +
        '건. 익명 요약에는 수치가 가리키는 조사 대상·단위 등의 표제가 없어, 두 판본에서 같은 의미였는지 확인하려면 작업 파일과 대응표가 필요합니다.', 'warn'));
      if (facts.matchBasis === 'current' && facts.priorAudit.core.total) panel.append(element('p',
        '이전 기준으로 연결된 원본 핵심 사실 ' + facts.priorAudit.core.retained + '/' + facts.priorAudit.core.total + '개'));
    }
    if (audit.improvedArticles) {
      panel.append(auditCounts(audit), element('p', '유지율의 분모는 두 편집자가 원본에서 모두 핵심으로 표시하고 구절 전체를 근거로 확인한 사실입니다. 같은 문구와 문맥을 연결했을 때 수정본에서도 두 사람이 전체를 확인한 구절을 셉니다.', 'note'));
      if (facts.coreContext.total) {
        const context = element('section');
        context.id = 'series-core-context';
        context.append(element('h5', '핵심 사실 보존율에서 빠진 원본 구절'),
          element('p', '두 편집자가 모두 핵심으로 골랐으나 구절 전체를 지지한다고 판정하지 않은 원본 구절 ' +
            facts.coreContext.total + '개 중 수정본 대응을 찾지 못한 구절 ' + facts.coreContext.unmatched + '개'));
        if (facts.coreContext.unmatched) {
          const list = element('ul');
          for (const article of report.articles) {
            if (!article.improved.numerator || !article.coreContextReview?.unmatched.length || (facts.matchBasis === 'current' && article.matchVersion < 8)) continue;
            const item = element('li');
            item.append(coreContextLink(article, sources.get(article.before.articleSha256)));
            list.append(item);
          }
          context.append(list, element('p', '발언 사실만 확인한 인용이나 의견도 포함됩니다. 표현이나 앞뒤 문장이 달라져도 대응이 끊길 수 있으므로 두 판본을 직접 대조하세요.', 'note'));
        }
        panel.append(context);
      }
      if (audit.flags.total) panel.append(element('p', '충돌 표시는 한 명 이상이 원자료와 차이를 발견했다는 뜻입니다. 원문과 자료가 어떻게 달라졌는지는 아래 기사 링크에서 확인하세요.', 'note'));
    }
    if (audit.missingImprovedArticles) panel.append(element('p', '이전 형식으로 저장한 개선 기사 ' + audit.missingImprovedArticles +
      '건은 이 집계에서 빠졌습니다. 원래 작업 파일 4개와 대응표 2개를 다시 열어 요약을 저장하면 포함됩니다.', 'note'));
    return panel;
  }
  function factPanel(report, sources, builtIn) {
    const panel = element('section', null, 'panel');
    panel.id = 'series-facts';
    panel.append(element('h3', '편향 개선과 사실 확인'));
    if (builtIn === 'partial') {
      panel.append(element('p', '이 계산 예시에는 편향 점수만 담겨 있습니다.'));
      return panel;
    }
    const facts = report.facts;
    panel.append(element('p', '구절별 검토 상태가 담긴 기사 ' + facts.articleCount + '/' + report.articleCount + '건'));
    if (facts.missingArticles) panel.append(element('p', '이전 형식 요약 ' + facts.missingArticles +
      '건에는 구절별 사실 판정이 없습니다. 두 편집자의 작업 파일과 대응표를 다시 열어 기사별 요약을 저장하면 함께 집계할 수 있습니다.', 'note'));
    if (facts.improvedArticles) panel.append(auditPanel(report, sources));
    if (!facts.articleCount) {
      if (facts.improvedArticles) panel.append(retentionPanel(report, sources));
      return panel;
    }
    panel.append(element('p', '편향이 한 항목 이상 개선된 기사 ' + facts.improvedArticles + '건 중 사실 판정이 없는 이전 요약 ' +
      facts.improvedMissingFacts + '건'));
    const flagged = element('p', '편향 개선과 함께 수정본에 충돌 표시가 있는 기사 ' + facts.improvedWithRevisedFlags + '건');
    if (facts.improvedWithRevisedFlags) flagged.className = 'warn';
    panel.append(flagged);
    const flaggedArticles = report.articles.filter(article => article.facts?.after.flagged);
    if (flaggedArticles.length) {
      panel.append(element('h4', '수정본의 충돌 구절과 근거를 확인할 기사 ' + flaggedArticles.length + '건'));
      const list = element('ul');
      for (const article of flaggedArticles) {
        const entry = sources.get(article.before.articleSha256);
        const item = element('li');
        item.append(evidenceLink(entry, '수정본 충돌 표시 ' + article.facts.after.flagged + '개 구절'));
        list.append(item);
      }
      panel.append(list);
    }
    panel.append(element('p', '편향이 개선된 기사 중 수정본에 미결·판정 불일치·동일 판정 기록이 있는 기사 ' +
      facts.improvedWithOpenFacts + '건. 충돌 표시가 있는 기사와 겹칠 수 있습니다.', 'note'),
      retentionPanel(report, sources));
    if (panel.querySelector('.review-evidence')) panel.append(element('p', builtIn
      ? '연습 기사 링크를 누르면 발언록과 조사표를 새 탭에서 볼 수 있습니다.'
      : '기사 링크를 누른 뒤 그 기사의 작업 파일 4개와 대응표 2개를 여세요. 저장한 진행자용 대조 기록이 있으면 그 파일 하나로 이어서 볼 수 있습니다.', 'note'));
    panel.append(window.JournalRevisionFactsView(facts.before, facts.after));
    return panel;
  }

  function articleList(articles, sources) {
    const panel = element('section', null, 'panel');
    panel.id = 'series-articles';
    panel.append(element('h3', '기사별 집계'));
    for (const article of articles) {
      const item = element('details', null, 'case');
      const before = article.before.articleSha256;
      const after = article.after.articleSha256;
      item.append(element('summary', sources.get(before).name + ' · 공통 개선 ' + fraction(article.improved) + ' · 공통 악화 ' + fraction(article.worsened)),
        element('p', '원본 ' + before.slice(0, 12) + ' → 수정본 ' + after.slice(0, 12) +
          ' · 두 판본의 원자료 묶음 ' + (article.sourceChanged ? '다름' : '같음'), 'note'),
        element('p', '네 판정이 모두 있는 항목 ' + article.paired + '/' + article.total + '개 · 개선·악화·유지 판단이 갈린 항목 ' + article.disagreed + '개'),
        element('p', '원본의 중요한 왜곡 중 수정본에서 비교할 단계가 부족한 항목 ' + article.pendingImportant + '개'));
      if (article.facts) {
        const {before: original, after: revised} = article.facts;
        item.append(element('p', '두 편집자의 구절 전체 지지율 ' + rateText(original.support) + ' → ' + rateText(revised.support)),
          element('p', '수정본 공동 판정 범위 ' + rateText(revised.coverage) + ' · 한 명 이상 충돌 표시 ' + revised.flagged + '개 구절'),
          element('p', '사실 확인 대상 ' + original.coverage.denominator + '개 → ' + revised.coverage.denominator + '개'));
        if (article.matchVersion < 8 && article.factTrace) item.append(element('p',
          '이전 기준으로 저장한 구절 대응입니다. 수치의 조사 대상이나 단위가 유지됐는지 원래 작업 파일로 다시 확인할 수 있습니다.', 'note'));
        if (article.factAudit) item.append(auditCounts(article.factAudit));
        if (article.coreContextReview?.unmatched.length) item.append(coreContextLink(article, sources.get(before)));
        const trace = article.factTrace;
        if (!trace) item.append(element('p', '이전 요약에 구절 대응 기록이 없어 원본 사실의 유지 여부를 집계할 수 없습니다.', 'note'));
        else if (!trace.total) item.append(element('p', '원본에서 두 편집자가 구절 전체를 근거로 확인한 사실이 없습니다.', 'note'));
        else {
          item.append(element('p', '원본과 수정본에서 두 편집자가 모두 구절 전체를 지지한 사실 ' + trace.retained + '/' + trace.total + '개'));
          if (trace.unmatched + trace.changed) item.append(element('p', '수정본 대응 구절 미확인 ' + trace.unmatched +
            '개 · 대응 구절에서 전체 지지 미확인 ' + trace.changed + '개'));
        }
      } else if (!sources.get(before).summaryOnlyExample) item.append(element('p', '이전 요약에 사실 판정 자료가 없습니다.', 'note'));
      panel.append(item);
    }
    return panel;
  }

  function render(files, records, builtIn = false) {
    const report = window.JournalRevisionSeries.summarize(records);
    const sources = new Map();
    records.forEach((record, i) => {
      const id = record.before.articleSha256;
      const prior = sources.get(id);
      if (!prior || record.version > prior.record.version) sources.set(id, {
        name:fileName(files[i]), record, libraryExample:builtIn && files[i].evidenceExample === 'library',
        summaryOnlyExample:builtIn && files[i].evidenceExample !== 'library'
      });
    });
    byId('result-title').textContent = (report.demo ? '가상 예시 · ' : '') + '기사 ' + report.articleCount + '건의 수정 결과';
    const summary = element('section', null, 'panel');
    const grid = element('div', null, 'metrics');
    grid.append(metric('series-improved', '두 편집자 공통 개선율', report.improved, report.improvementEligibleArticles, '2~3단계', '0~1단계'),
      metric('series-worsened', '두 편집자 공통 악화율', report.worsened, report.worseningEligibleArticles, '0~1단계', '2~3단계'));
    summary.append(element('h3', '중요한 왜곡의 변화'),
      element('p', (builtIn ? '예시 파일 ' : '선택한 파일 ') + files.length + '개 · 고유 기사 ' + report.articleCount + '건 · 중복 제외 ' + report.duplicateCount + '개'),
      severityPanel(report, sources, grid));
    const historical = [...sources.values()].filter(entry => entry.record.version < 5 &&
      (entry.record.factMatches?.some(([, match]) => match !== null) || entry.record.dimensions.some(d =>
        d.id === 'standards' && [d.first, d.second].some(r => Number.isInteger(r.before) || Number.isInteger(r.after)))));
    if (builtIn !== 'partial' && historical.length) summary.append(element('p', '이전 기준으로 저장한 기사 ' + historical.length +
      '건의 검증 기준 점수 또는 구절 대응이 포함됐습니다. 양쪽 당사자의 근거와 “해당 사업”이 가리키는 대상을 현행 기준으로 대조하려면 원래 작업 파일을 다시 열어 요약을 저장하세요.', 'note'));
    const earlierCore = [...sources.values()].filter(({record}) => record.version < 7 &&
      record.factContext?.matches.some(([before]) => record.factContext.beforeCore[before] === 2 || record.facts.before[before].outcome === 'supported'));
    if (earlierCore.length) {
      const details = element('details', null, 'case');
      details.id = 'legacy-quote-check';
      details.append(element('summary', '이전 방식으로 원본 구절을 연결한 기사 ' + earlierCore.length + '건'),
        element('p', '이전 요약에서는 인용문에 발언자가 없어도 같은 문구를 연결했을 수 있습니다. 기사 파일을 열어 발언자가 유지됐는지 확인하세요.'));
      for (const entry of earlierCore) details.append(evidenceLink(entry, '인용 대응 다시 확인', '&focus=quote-check'));
      summary.append(details);
    }
    const numericChecks = [...sources.values()].filter(({record}) => record.version < 8 &&
      (record.factContext?.matches.length || record.factMatches?.some(([, after]) => after !== null)));
    if (numericChecks.length) {
      const details = element('details', null, 'case');
      details.id = 'legacy-numeric-check';
      details.append(element('summary', '수치 문맥을 다시 확인할 이전 요약 ' + numericChecks.length + '건'),
        element('p', '이전 요약은 조사 대상이나 단위가 바뀐 수치 문장을 연결했을 수 있습니다. 원래 작업 파일과 대응표로 다시 계산하면 현행 기준의 보존율을 확인할 수 있습니다.'));
      for (const entry of numericChecks) details.append(entry.summaryOnlyExample ? element('p', entry.name) :
        evidenceLink(entry, '수치 문맥 다시 확인', '&focus=numeric-check'));
      summary.append(details);
    }
    summary.append(element('p', '원본과 수정본에 등록된 원자료 묶음이 달라진 기사 ' + report.changedSources + '건', report.changedSources ? 'warn' : 'note'));
    if (report.changedSources) {
      summary.append(element('p', '원자료가 같은 기사 ' + report.unchangedSources + '건만 보면 공통 개선율은 ' + rateText(report.unchangedEvidenceImprovement) + '입니다.'));
    }
    output.replaceChildren(summary, factPanel(report, sources, builtIn), coverage(report), axisTable(report.dimensions), articleList(report.articles, sources));
    byId('result').hidden = false;
    return report;
  }

  async function readRecord(file) {
    let raw;
    try {
      raw = typeof file.text === 'function' ? await file.text() : await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    } catch {
      throw new Error(fileName(file) + ' 파일을 읽지 못했습니다.');
    }
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error(fileName(file) + ' 파일에서 JSON을 읽지 못했습니다.'); }
    if (data?.format === 'journal-retention-case') {
      throw new Error(fileName(file) + ' 파일은 진행자용 대조 기록입니다. 기사 평가 비교에서 다시 열고, 여기에는 ‘기사별 평가 요약 저장’으로 받은 파일을 선택하세요.');
    }
    return data;
  }

  function reset() {
    selection++;
    showingExample = null;
    for (const [button, label] of exampleLabels) {
      button.textContent = label;
      button.setAttribute('aria-expanded', 'false');
    }
    byId('result').hidden = true;
    byId('result-title').textContent = '집계 결과';
    output.replaceChildren();
    status.textContent = '';
    status.classList.remove('error');
    clear.disabled = true;
  }

  input.addEventListener('change', async () => {
    reset();
    const current = selection;
    const files = Array.from(input.files);
    if (!files.length) return;
    clear.disabled = false;
    status.textContent = '파일 ' + files.length + '개를 읽고 있습니다.';
    try {
      const records = await Promise.all(files.map(readRecord));
      if (current !== selection) return;
      const report = render(files, records);
      status.textContent = (report.demo ? '가상 예시 ' : '') + '기사 ' + report.articleCount + '건을 집계했습니다.';
    } catch (error) {
      if (current !== selection) return;
      input.value = '';
      status.classList.add('error');
      const invalidNames = (error.recordIndexes || []).map(i => fileName(files[i]));
      const names = invalidNames.length ? ' 해당 파일은 ' + invalidNames.join(', ') + '입니다.' : '';
      status.textContent = '집계할 수 없습니다. ' + error.message + names + ' 파일을 확인하고 다시 선택하세요.';
    }
  });

  for (const button of exampleLabels.keys()) {
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const close = showingExample === button;
      input.value = '';
      reset();
      if (close) return;
      const partial = button === partialExample;
      const samples = partial ? window.JournalPartialRevisionExample() : window.JournalRevisionSeriesExample;
      render(samples, samples.map(sample => sample.record), partial ? 'partial' : 'full');
      showingExample = button;
      button.textContent = partial ? '미완료 평가 예시 닫기' : '가상 예시 닫기';
      button.setAttribute('aria-expanded', 'true');
      clear.disabled = false;
      status.textContent = partial ? '가상 기사 2건의 수정본 점수 일부를 가린 계산 예시입니다.' : '가상 기사 2건을 채점한 모의 예시입니다.';
    });
  }

  clear.addEventListener('click', () => {
    input.value = '';
    reset();
    input.focus();
  });
})();

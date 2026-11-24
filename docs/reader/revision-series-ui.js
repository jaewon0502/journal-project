(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const input = byId('series-files');
  const clear = byId('series-clear');
  const example = byId('series-example');
  const exampleLabel = example.textContent;
  const status = byId('series-status');
  const output = byId('output');
  let selection = 0, showingExample = false;

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
  function factPanel(report, names) {
    const panel = element('section', null, 'panel');
    panel.id = 'series-facts';
    panel.append(element('h3', '편향 개선과 사실 확인'));
    const facts = report.facts;
    panel.append(element('p', '구절별 검토 상태가 담긴 기사 ' + facts.articleCount + '/' + report.articleCount + '건'));
    if (facts.missingArticles) panel.append(element('p', '이전 형식 요약 ' + facts.missingArticles +
      '건에는 구절별 사실 판정이 없습니다. 두 편집자의 작업 파일과 대응표를 다시 열어 기사별 요약을 저장하면 함께 집계할 수 있습니다.', 'note'));
    if (!facts.articleCount) return panel;
    panel.append(element('p', '편향이 한 항목 이상 개선된 기사 ' + facts.improvedArticles + '건 중 사실 판정이 없는 이전 요약 ' +
      facts.improvedMissingFacts + '건'));
    const flagged = element('p', '편향 개선과 함께 수정본에 충돌 표시가 있는 기사 ' + facts.improvedWithRevisedFlags + '건');
    if (facts.improvedWithRevisedFlags) flagged.className = 'warn';
    panel.append(flagged);
    if (facts.improvedWithRevisedFlags) {
      const list = element('ul');
      for (const article of report.articles) {
        if (article.improved.numerator && article.facts?.after.flagged) list.append(element('li',
          names.get(article.before.articleSha256) + ' · 수정본 충돌 표시 ' + article.facts.after.flagged + '개 구절'));
      }
      panel.append(list);
    }
    panel.append(element('p', '편향이 개선된 기사 중 수정본에 미결·판정 불일치·동일 판정 기록이 있는 기사 ' +
      facts.improvedWithOpenFacts + '건. 충돌 표시가 있는 기사와 겹칠 수 있습니다.', 'note'),
      window.JournalRevisionFactsView(facts.before, facts.after));
    return panel;
  }

  function articleList(articles, fileNames) {
    const panel = element('section', null, 'panel');
    panel.id = 'series-articles';
    panel.append(element('h3', '기사별 집계'));
    for (const article of articles) {
      const item = element('details', null, 'case');
      const before = article.before.articleSha256;
      const after = article.after.articleSha256;
      item.append(element('summary', fileNames.get(before) + ' · 공통 개선 ' + fraction(article.improved) + ' · 공통 악화 ' + fraction(article.worsened)),
        element('p', '원본 ' + before.slice(0, 12) + ' → 수정본 ' + after.slice(0, 12) +
          ' · 두 판본의 원자료 묶음 ' + (article.sourceChanged ? '다름' : '같음'), 'note'),
        element('p', '네 판정이 모두 있는 항목 ' + article.paired + '/' + article.total + '개 · 개선·악화·유지 판단이 갈린 항목 ' + article.disagreed + '개'),
        element('p', '원본의 중요한 왜곡 중 수정본에서 비교할 단계가 부족한 항목 ' + article.pendingImportant + '개'));
      if (article.facts) {
        const {before: original, after: revised} = article.facts;
        item.append(element('p', '두 편집자의 구절 전체 지지율 ' + rateText(original.support) + ' → ' + rateText(revised.support)),
          element('p', '수정본 공동 판정 범위 ' + rateText(revised.coverage) + ' · 한 명 이상 충돌 표시 ' + revised.flagged + '개 구절'));
      } else item.append(element('p', '이전 요약에 사실 판정 자료가 없습니다.', 'note'));
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
      if (prior == null || record.version > records[prior].version) sources.set(id, i);
    });
    const names = new Map(Array.from(sources, ([id, i]) => [id, fileName(files[i])]));
    byId('result-title').textContent = (report.demo ? '가상 예시 · ' : '') + '기사 ' + report.articleCount + '건의 수정 결과';
    const summary = element('section', null, 'panel');
    const grid = element('div', null, 'metrics');
    grid.append(metric('series-improved', '두 편집자 공통 개선율', report.improved, report.improvementEligibleArticles, '2~3단계', '0~1단계'),
      metric('series-worsened', '두 편집자 공통 악화율', report.worsened, report.worseningEligibleArticles, '0~1단계', '2~3단계'));
    summary.append(element('h3', '중요한 왜곡의 변화'),
      element('p', (builtIn ? '예시 파일 ' : '선택한 파일 ') + files.length + '개 · 고유 기사 ' + report.articleCount + '건 · 중복 제외 ' + report.duplicateCount + '개'),
      element('p', '두 편집자가 원본과 수정본에 모두 숫자 단계를 매긴 항목을 대상으로, 기사별 분자와 분모를 각각 더했습니다.', 'note'),
      grid);
    summary.append(element('p', '원본과 수정본에 등록된 원자료 묶음이 달라진 기사 ' + report.changedSources + '건', report.changedSources ? 'warn' : 'note'));
    if (report.changedSources) {
      summary.append(element('p', '원자료가 같은 기사 ' + report.unchangedSources + '건만 보면 공통 개선율은 ' + rateText(report.unchangedEvidenceImprovement) + '입니다.'));
    }
    output.replaceChildren(summary, factPanel(report, names), coverage(report), axisTable(report.dimensions), articleList(report.articles, names));
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
    try { return JSON.parse(raw); }
    catch { throw new Error(fileName(file) + ' 파일에서 JSON을 읽지 못했습니다.'); }
  }

  function reset() {
    selection++;
    showingExample = false;
    example.textContent = exampleLabel;
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

  example.addEventListener('click', () => {
    const close = showingExample;
    input.value = '';
    reset();
    if (close) return;
    const samples = window.JournalRevisionSeriesExample;
    render(samples, samples.map(sample => sample.record), true);
    showingExample = true;
    example.textContent = '가상 예시 닫기';
    clear.disabled = false;
    status.textContent = '가상 기사 2건을 채점한 모의 예시입니다.';
  });

  clear.addEventListener('click', () => {
    input.value = '';
    reset();
    input.focus();
  });
})();

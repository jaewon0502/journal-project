// Route table searches and flag count questions when the pasted table has no visible unit.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const finder = node ? require('./evidence-finder.js') : root.JournalEvidenceFinder;
  const trend = node ? require('./evidence-trend.js') : root.JournalEvidenceTrend;
  const columns = node ? require('./evidence-columns.js') : root.JournalEvidenceColumns;
  const periods = node ? require('./evidence-period.js') : root.JournalEvidencePeriod;
  const fiscal = node ? require('./evidence-fiscal.js') : root.JournalEvidenceFiscal;
  const transcript = node ? require('./evidence-transcript.js') : root.JournalEvidenceTranscript;
  const fiscalTable = node ? require('./evidence-fiscal-table.js') : root.JournalEvidenceFiscalTable;

  const measures = [
    {unit: '명', ask: /몇\s*(?:명|사람)|인원(?:수|은|이)?\s*(?:얼마|몇)/u,
      inSource: /(?:^|[\s\d천만억(（:：／/,])명(?:[)）\s,/.·]|당|$)|인원|인구|사람\s*수|명수/u},
    {unit: '가구', ask: /몇\s*(?:가구|세대)/u, inSource: /가구|세대\s*수|세대수/u},
    {unit: '시간', ask: /몇\s*시간/u, inSource: /시간|시수/u},
    {unit: '분', ask: /(?:시간|소요|걸린|걸리|걸렸).{0,18}몇\s*분|몇\s*분(?:간|이?\s*걸)/u,
      inSource: /(?:시간|소요)\s*[(（]\s*분|(?:단위\s*[:：]\s*|\d\s*)분(?:\s|간|씩|$)|분\s*\/\s*일/u},
    {unit: '거리', ask: /몇\s*(?:킬로미터|키로미터|미터|km\b)/iu,
      inSource: /(?:\d|단위|[(:（／/])\s*(?:[k㎞]?m\b|㎞|km\b|미터)|킬로미터|이동거리|거리\s*[(（]/iu},
    {unit: '중량', ask: /몇\s*(?:톤|킬로그램|그램|[km]?g\b|t\b)/iu,
      inSource: /(?:^|[\s\d(:／/·,\[|])(?:[십백천만억]\s*)?(?:톤|킬로그램|그램|tonnes?|tons?|[km]?g|t)(?=$|[\s)／/.,\]|]|당|씩)|톤수/iu},
    {unit: '%', ask: /몇\s*(?:퍼센트|프로|%)/u,
      inSource: /%|퍼센트|백분율|백명당/u},
    {unit: '일수', ask: /며칠|몇\s*일(?:간|이|을|인가|이나|$)/u,
      inSource: /일수|기간\s*[(（]\s*일|\d\s*일(?:간|\s*소요)|소요일/u},
    {unit: '건', ask: /몇\s*건/u, inSource: /(?:[\d천만억(（:：／/,]|단위\s*)\s*건(?:[)）\s,/.·]|당|$)|건수|횟수/u},
    {unit: '원', ask: /몇\s*원|금액[이은을]?\s*얼마/u, inSource: /(?:[\d천만억조(（:：／/,]|단위\s*)\s*원(?:[)）\s,/.·]|당|$)|금액|금전/u}
  ];

  function coverageNotice(text, query) {
    const measure = measures.find(item => item.ask.test(query));
    const asksReason = /(?:원인|이유|사유).{0,25}(?:무엇|뭐|가장|어떤|왜)|왜.{0,30}(?:했|하는|줄|늘|증가|감소)/u.test(query);
    if (!measure && !asksReason) return null;
    // Require visible tabular structure. Narrative can convey an amount without a unit label.
    const lines = text.normalize('NFKC').split(/\r\n|[\n\r\u2028\u2029]/u);
    const columns = lines.filter(line => /\d/u.test(line) && /[^\s](?:\t+| {2,}|\s*\|\s*)[^\s]/u.test(line));
    if (columns.length < 2) return null;
    if (measure && !measure.inSource.test(text.normalize('NFKC')))
      return '질문에서 묻는 단위 ‘' + measure.unit + '’에 해당하는 표기를 찾지 못했습니다. 원표의 단위와 주석을 확인하세요.';
    if (asksReason && !/원인|이유|사유|때문|응답\s*(?:내용|항목)|동기/u.test(text))
      return '질문은 이유를 묻고 있습니다. 붙여 넣은 표에서 이유를 설명하는 항목을 확인하지 못했습니다. 조사 문항이나 원문 해설을 확인하세요.';
    return null;
  }

  const dateHeading = /^(?:날짜|일자|date|(?:변경|발표|관측|측정|조사|기준|고시|공시|거래|결정|시행)일(?:자)?)$/iu;
  const number = '[+−-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  const unit = '(?:(?:%|퍼센트)\\s*(?:포인트|p)?|(?:[백천만억조]+\\s*)?(?:가구|달러|유로|엔|원|명|건|개|대|회|톤|kg|km|mm|점|도))';
  const measureHeading = new RegExp('^([가-힣A-Za-z][가-힣A-Za-z0-9 ]*?)(?:\\s*\\(\\s*(' + unit + ')\\s*\\))?$', 'iu');
  const numberCell = new RegExp('^(' + number + ')\\s*(' + unit + ')?$', 'iu');
  const printedNumber = new RegExp('(?<![\\d.,])(' + number + ')(?![\\d.,])', 'gu');
  const claimedQuantity = new RegExp('(?<![\\d.,])(' + number + ')\\s*(' + unit +
    ')(?=$|[\\s.,?!]|으로|로|인|이|였|은|는|을|를|에|가)', 'giu');
  const cleanUnit = s => s?.replace(/\s+/gu, '').toLowerCase().replace('퍼센트','%').replace('포인트','p');
  const decimal = s => s.replaceAll(',','').replace('−','-').replace(/^\+/u, '')
    .replace(/^(-?)0+(?=\d)/u,'$1').replace(/(\.\d*?)0+$/u,'$1').replace(/\.$/u,'').replace(/^-0$/u,'0');
  const dateQuestion = /날짜|언제|며칠|몇\s*월|몇\s*일|어느\s*날/u;
  const valueThenDate = /^\s*(?:(?:으로|로)\s*(?:바뀐|변경된|정한|결정된|관측된|측정된|발표된)|(?:이었|였)던|인|(?:이|가)\s*된|(?:을|를)\s*기록한|에\s*해당하는)?\s*(?:날짜|날(?:[은이가을에?]|\s|$)|일자|시점|때|며칠|언제)/u;

  function namesDatedMeasure(query, name) {
    // The heading grammar permits only letters, digits and spaces.
    const pattern = new RegExp('(?<![\\p{L}\\d])' + name.split(/\s+/u).join('\\s*') +
      '(?:에서는|에서|으로|[이가은는을를에의])?(?![\\p{L}\\d])', 'iu');
    const mention = pattern.exec(query);
    if (!mention) return false;
    const before = query.slice(0,mention.index).trimEnd();
    const modifier = /[가-힣A-Za-z]+$/u.exec(before)?.[0];
    if (modifier && !/\d+\s*(?:년|월|일)(?:의|에|에는)?$/u.test(before) &&
        !/^(?:원표에서|표에서|자료에서|원고에|통계에서|표의|원표의|이|해당|정한|변경된|기록한|관측한|공시된|발표된|측정한|그날)$/u.test(modifier)) return false;
    const rest = query.slice(0,mention.index) + ' ' + query.slice(mention.index + mention[0].length);
    return !/수도권|지역별|성별|연령별|도시별|가운데|한정|대상자|중에서/u.test(rest);
  }

  // A value printed on a change date describes the new state. A prior-value
  // question requires the earlier printed row as well, with its own date.
  const beforeChange = /(?:(?:변경|인상|인하|조정|개정|시행|상승|하락|결정|발표)(?:되기|하기|[이가]\s*(?:있기|이뤄지기|이루어지기))?|(?:올리|내리|바꾸|바뀌|오르|내려가)기)\s*(?:바로\s*)?(?:직전|이전|전)(?:에는|의|에|은|과|후)?(?!\p{L})/u;
  const earlierTime = /(?<!\p{L})(?:전날|전일|직전|전)(?:에는|의|에|은|과|후)?(?!\p{L})/u;

  function priorChangeRows(history, selected, heading, declaredUnit) {
    const gap = '질문에 적힌 변경일과 그보다 앞선 변경일을 원표에서 함께 확인하세요.';
    if (selected.length !== 1) return {passages:[], gap};
    if (history.length < 2) return {passages:[], gap:'발췌한 표에 이 변경일보다 앞선 행이 없습니다. ' + gap};
    const direction = Math.sign(history[1].date - history[0].date);
    if (!direction || history.some((row, i) => i && Math.sign(row.date - history[i - 1].date) !== direction))
      return {passages:[], gap:'날짜가 중복되거나 행 순서가 일정하지 않습니다. ' + gap};
    const current = selected[0];
    const index = history.findIndex(row => row.hit === current);
    const previous = history[index - direction]?.hit;
    if (!previous) return {passages:[], gap:'발췌한 표에 이 변경일보다 앞선 행이 없습니다. ' + gap};
    return {passages:[{paragraph:previous.paragraph, text:previous.text, matched:previous.matched,
      changeRows:{previous, current}, context:[previous.context[0], current]}],
      notice:'붙여 넣은 변경 이력에서 두 날짜를 찾았습니다. 사이에 생략된 변경이 있는지 원표에서 확인하세요.' +
        (declaredUnit ? '' : ' ‘' + heading + '’ 열에 단위가 없습니다. 원표에서 단위를 확인하세요.')};
  }

  // An intact dated series can be read in either direction. Keep the raw lines
  // and their order even when several observations print the same value.
  function datedRows(text, question) {
    const query = question.normalize('NFKC');
    const change = beforeChange.exec(query);
    const lookupQuery = change ? query.replace(change[0], ' ').trim() : query;
    if (earlierTime.test(lookupQuery)) return null;
    const asked = periods.requestedPeriod(lookupQuery);
    if ((!asked?.month && !dateQuestion.test(query)) || text.includes('\f') ||
        /대비|이상|이하|초과|미만|이전|이후|부터|까지|무렵|평균|최[고저]|보다|증감|등락|상승|하락|인상폭|인하폭/u.test(lookupQuery)) return null;
    const sourceLines = text.split(/\r\n|[\n\r\u2028\u2029]/u);
    const lines = sourceLines.slice(sourceLines.findIndex(line => line.trim()));
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    if (lines.length < (change ? 2 : 3)) return null;
    const delimiter = /[|｜]/u.test(lines[0]) ? /[|｜]/u : lines[0].includes('\t') ? /\t/u : /[ \u3000]{2,}/u;
    const cells = line => line.trim().replace(/^[|｜]|[|｜]$/gu,'').split(delimiter).map(s => s.trim());
    const [key, ...headings] = cells(lines[0]);
    if (!dateHeading.test(key?.replace(/\s+/gu,'')) || !headings.length) return null;
    const measures = headings.map(s => measureHeading.exec(s.normalize('NFKC')));
    if (!measures.every(Boolean)) return null;
    // For a question asking which day an event occurred in a given month,
    // a short name can locate the date in a single-series register. A
    // shortened name never establishes an absent row or a value lookup.
    const words = (query.match(/[가-힣A-Za-z]+/gu) || []).flatMap(word =>
      [word, word.replace(/(?:인가|으로|에서|[이가은는을를에의])$/u,'')]);
    const onlyDate = measures.length === 1 && asked?.month && !asked.day && /(?:바꾼|변경한|발표한|관측한|측정한)\s*날/u.test(query) &&
      !/지역|수도권|한정|가운데|에서/u.test(query);
    const matches = measures.map((m,i) => ({name:m[1].trim(), unit:cleanUnit(m[2]), i})).filter(m =>
      namesDatedMeasure(lookupQuery,m.name) || (onlyDate && !m.name.includes(' ') &&
        words.some(word => word.length >= 2 && m.name.endsWith(word))));
    if (matches.length !== 1) return null;
    const column = matches[0];
    const quantities = [...query.matchAll(claimedQuantity)];
    if (column.unit && quantities.some(q => cleanUnit(q[2]) !== column.unit)) return null;
    // With no declared unit, a question can explicitly ask for the raw figure
    // as printed. Only the number immediately tied to the requested date counts.
    const requestedValues = !column.unit && !quantities.length
      ? [...query.matchAll(printedNumber)].filter(q => valueThenDate.test(query.slice(q.index + q[0].length)))
      : quantities;
    const quantity = requestedValues[0];
    const reverse = requestedValues.length === 1 && valueThenDate.test(query.slice(quantity.index + quantity[0].length));
    if (!asked?.month && !reverse) return null;
    if (dateQuestion.test(query) && quantities.length && !reverse) return null;
    if (reverse && ((!asked && /(?:19|20)\d{2}|\d+\s*(?:년|월|일)/u.test(query)) ||
        /전년|지난|올해|작년|내년|최근|직전|이듬해|다음|최초|처음|마지막|가장|기간|동안|아니|아닌|아닐|않|제외|주말|평일|분기|반기|연휴|봄철|여름|가을|겨울/u.test(query))) return null;
    if (change && (!asked?.day || reverse || measures.length !== 1 || !/^변경일(?:자)?$/u.test(key.replace(/\s+/gu,''))))
      return {passages:[], gap:'변경 전 수치를 확인하려면 해당 날짜와 앞선 변경을 기록한 같은 지표의 변경 이력이 필요합니다.'};
    const selected = [], history = [];
    let splitDate;
    for (let i = 1; i < lines.length; i++) {
      const raw = cells(lines[i]);
      const row = raw.map(s => s.normalize('NFKC'));
      // Some HTML tables span a date heading across two cells. Only join an
      // explicit year and month-day pair consistently printed on every row.
      const split = row.length === measures.length + 2 && /^(?:19|20)\d{2}$/u.test(row[0]) &&
        /^\d{1,2}월\s*\d{1,2}일$/u.test(row[1]);
      if (i > 1 && split !== splitDate) return null;
      splitDate = split;
      const stamp = split ? row[0] + '년 ' + row[1] : row[0];
      const values = row.slice(split ? 2 : 1);
      const date = periods.dateCell(stamp);
      const data = values.map(value => numberCell.exec(value));
      if (!date || data.length !== measures.length || !data.every((v,c) =>
        v && (!v[2] || cleanUnit(v[2]) === cleanUnit(measures[c][2])))) return null;
      const within = !asked || (date.year === asked.year &&
        (!asked.month || date.month === asked.month) && (!asked.day || date.day === asked.day));
      const match = within && (!reverse || decimal(quantity[1]) === decimal(data[column.i][1]));
      if (change || match) {
        const index = (split ? 2 : 1) + column.i;
        const hit = {paragraph:i + 1, text:lines[i], matched:reverse ? [raw[index]] : raw.slice(0,split ? 2 : 1),
          datedCell:{heading:headings[column.i], column:index + 1, value:raw[index]},
          datedRowLabel:raw.slice(0, split ? 2 : 1).join(' '),
          context:[{paragraph:1, text:lines[0]}]};
        if (match) selected.push(hit);
        if (change) history.push({hit, date:Number(date.year) * 10000 + date.month * 100 + date.day});
      }
    }
    if (change) return priorChangeRows(history, selected, column.name, column.unit);
    if (selected.length) {
      const notices = [];
      if (!column.unit && (requestedValues.length || !dateQuestion.test(query)))
        notices.push('‘' + column.name + '’ 열에 단위가 없습니다. 원표에서 수치의 단위를 확인하세요.');
      if (selected.length > 3) notices.push('조건이 맞는 날짜 행 ' + selected.length + '개 중 처음 3개를 표시합니다.');
      return {passages:selected.slice(0,3), notice:notices.join(' ')};
    }
    // A change-date register cannot tell us the effective value on every
    // intervening day. Only signal an absent row when the event itself was asked.
    const event = /^(변경|발표|관측|측정|조사|고시|공시|거래|결정)일/u.exec(key.replace(/\s+/gu,''));
    if (!reverse && asked?.day && event && query.includes(event[1]) && !/당시|유효|적용|효력|이래|유지|전후|현재|당일까지/u.test(query))
      return {passages:[], gap:'붙여 넣은 표의 ‘' + key + '’ 열에 질문의 날짜가 없습니다. 원표에서 그 날짜의 행을 확인하세요.'};
    if (reverse) return {passages:[], gap:'붙여 넣은 표에서 질문의 기간과 수치가 함께 맞는 날짜 행을 찾지 못했습니다. 원표의 단위와 전체 기간을 확인하세요.'};
    return null;
  }

  const fiscalAmount = /\d[\d,.]*\s*[십백천만억조]*\s*원/u;
  function fiscalProse(text, query) {
    const stage = fiscal.request(query);
    // Preserve the table readers and ordinary navigation for layouts that may
    // express the stage in a header rather than beside each printed amount.
    if (!stage || /[\t|｜\f]|\S {2,}\S|^[ 　]*[（(]?단\s*위\s*[:：]/mu.test(text)) return null;
    const wantedYears = fiscal.years(query);
    const wantedProject = fiscal.project(query);
    const targets = new Map();
    const rows = text.split(/\r\n|[\n\r\u2028\u2029]/u).filter(line => line.trim());
    for (const [index, row] of rows.entries()) {
      if (!fiscalAmount.test(row)) continue;
      const scopes = new Map();
      for (const part of fiscal.clauses(row)) {
        if (part.stage !== stage || !fiscalAmount.test(part.text)) continue;
        if (wantedProject && part.project && wantedProject !== part.project) continue;
        if (wantedYears.size && part.years.size && ![...part.years].some(year => wantedYears.has(year))) continue;
        const projectMatched = Boolean(wantedProject && part.project === wantedProject);
        if (!scopes.has(projectMatched)) scopes.set(projectMatched, {evidence:[], coveredYears:new Set()});
        const scope = scopes.get(projectMatched);
        for (const year of part.years) if (wantedYears.has(year)) scope.coveredYears.add(year);
        scope.evidence.push(part.text);
      }
      for (const [projectMatched, {evidence, coveredYears}] of scopes) {
        const rank = 1 + Number(projectMatched) + coveredYears.size;
        const scoped = (!wantedProject || projectMatched) && wantedYears.size === coveredYears.size;
        if ((targets.get(index + 1)?.rank || 0) < rank) targets.set(index + 1, {rank, text:evidence.join(' '), stage:scoped ? stage : null});
      }
    }
    const fullScope = [...targets.values()].some(match => match.stage);
    return {targets, gap:fullScope ? null : fiscal.gap(stage)};
  }

  // PDF layout text can split a year and its subordinate headings over
  // several lines. Preserve its source row, without inferring a cell from spacing.
  function printedFiscalTable(text, query) {
    if (/[\t|｜]/u.test(text) || !/단위\s*[:：]/u.test(text)) return null;
    const ask = fiscalTable.rowQuestion(query);
    if (!ask) return null;
    const lines = text.split(/\r\n|[\n\r\u2028\u2029]/u).filter(line => line.trim());
    const captions = /^\s*(?:[\[〈<【]|표\s*\d)/u;
    const headers = [];
    const candidates = [];
    let block = null;
    const labels = {request:/요구|요청/u, proposal:/예산안|정부안/u, approved:/확정|본예산|의결/u, spent:/결산|집행|실제\s*지출/u, budget:/예산/u, difference:/증감|대비/u};
    for (const [i, line] of lines.entries()) {
      if (captions.test(line) || /\f|^\s*(?:주(?:석)?\s*\d*[:：]|자료\s*[:：]|출처\s*[:：])/u.test(line)) block = null;
      if (/^\s*[(（]?단위\s*[:：].*원/u.test(line)) {
        const caption = i > 0 && captions.test(lines[i - 1]) ? lines[i - 1].trim() : '';
        block = {caption, start:i, data:false, header:[], rows:[]};
        headers.push(block);
        continue;
      }
      if (!block) continue;
      const cells = line.trim().split(/\s{2,}/u);
      if (cells.length >= 3 && /[가-힣]/u.test(cells[0]) && cells.slice(1).every(cell =>
          /^(?:[+−△▲▼-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|[-—…])$/u.test(cell))) {
        block.data = true;
        block.rows.push({index:i,label:cells[0]});
      } else if (!block.data && i - block.start <= 12) {
        block.header.push({text:line,paragraph:i + 1});
      } else {
        block = null;
      }
    }
    for (const table of headers) {
      const heading = table.header.map(h => h.text).join(' ');
      if (!table.rows.length || !/구\s*분|항\s*목|사업명/u.test(heading) || !/예산|결산|집행/u.test(heading)) continue;
      for (const row of table.rows) {
        if (ask.matches(row.label)) candidates.push({table, heading, row});
      }
    }
    if (!candidates.length) return null;
    const matching = candidates.filter(({heading}) => heading.includes(ask.year) && labels[ask.stage]?.test(heading));
    if (matching.length !== 1 || candidates.length !== matching.length)
      return {gap:'붙여넣은 표에서 질문의 행과 회계연도·예산 단계를 함께 특정하기 어렵습니다. 원표 머리글을 확인하세요.', passages:[]};
    const {table, row} = matching[0];
    return {gap:'해당 행을 찾았습니다. 여러 줄 머리글에서 질문의 연도와 예산 단계가 겹치는 열을 특정하기 어렵습니다. 원표 머리글과 단위를 대조하세요.',
      passages:[{paragraph:row.index + 1, text:lines[row.index], matched:[row.label], context:[
        {paragraph:table.start + 1, text:lines[table.start]}, ...table.header],
        fiscalNavigation:{rowLabel:row.label, caption:table.caption, headingParagraph:table.header[0].paragraph}}]};
  }

  function search(documentText, query, {articleContext = ''} = {}) {
    const context = articleContext.trim();
    const attributed = transcript.lookup(documentText, query);
    if (attributed) {
      const notice = context && context !== query.trim()
        ? attributed.notice + ' 추가한 기사 문맥의 시점과 조건도 원문에서 대조하세요.' : attributed.notice;
      return {...attributed, notice, state:'ordinary', transcript:true, usedArticleContext:false, needsPublicationDate:false};
    }
    const table = trend.find(documentText, query, {articleContext});
    if (table.state === 'ordinary') {
      const separate = context && context !== query.trim();
      const statedYear = separate && /^((?:19|20)\d{2})\s*(?:회계\s*연도|년도|년)$/u.exec(context);
      const years = statedYear && fiscal.years(query);
      const yearOnly = statedYear && (!years.size || (years.size === 1 && years.has(statedYear[1])));
      const asked = yearOnly && !years.size ? context + ' ' + query : query;
      const result = fiscalTable.lookup(documentText, asked) || printedFiscalTable(documentText, asked);
      if (result) {
        let {passages, gap, notice} = result;
        if (separate && !yearOnly) {
          // The registered row may match the short query while the surrounding
          // article asks about only one region or program. Offer its location.
          passages = passages.map(p => {
            const cell = p.fiscalCell || p.fiscalNavigation;
            return {text:p.text, paragraph:p.paragraph, matched:[], context:p.context,
              fiscalNavigation:{rowLabel:cell.rowLabel, caption:cell.caption, reason:'context'}};
          });
          gap = [gap, '추가한 기사 문맥의 조건이 이 표에 적용되는지 원표에서 확인하세요.'].filter(Boolean).join(' ');
        } else if (yearOnly) {
          notice = '추가한 기사 문맥의 회계연도 ' + statedYear[1] + '년을 함께 사용했습니다.';
        }
        const fiscalNavigation = passages.some(p => p.fiscalNavigation);
        if (!passages.length && gap) passages = finder.find(documentText, query, {includeContext:true})
          .map(({paragraph, text, matched, context}) => ({paragraph, text, matched, context}));
        return {passages, gap, notice, state:'ordinary', usedArticleContext:Boolean(yearOnly), needsPublicationDate:false,
          fiscalTable:true, fiscalNavigation};
      }
    }
    const dated = table.state === 'ordinary' && (!context || context === query.trim()) && datedRows(documentText, query);
    let gap = dated ? dated.gap || null : coverageNotice(documentText, query);
    const yearMatrix = table.state === 'ordinary' ? columns.parseYearMatrix(documentText) : null;
    let passages = dated ? dated.passages : table.hits;
    if (!dated && table.state !== 'candidates') {
      // The cell resolver checks only the query. Additional article context
      // may restrict the population or period beyond what this row describes.
      const checkCell = yearMatrix && (!context || context === query.trim());
      const matrixCell = checkCell ? columns.findYearMatrixCell(yearMatrix, query) : null;
      const matrixNavigation = yearMatrix && !matrixCell ? columns.findYearMatrixRow(yearMatrix, query) : null;
      const budget = !gap && table.state === 'ordinary' && !yearMatrix && (!context || context === query.trim()) &&
        fiscalProse(documentText, query.normalize('NFKC'));
      if (budget?.gap) gap = budget.gap;
      passages = finder.find(documentText, query, {includeContext: true, matrixCell, matrixNavigation, fiscalTargets:budget?.targets});
    }
    return {passages, gap, state: table.state, usedArticleContext: table.usedArticleContext,
      needsPublicationDate: table.needsPublicationDate, reason: table.reason,
      ...(dated?.notice && {notice:dated.notice}), ...(yearMatrix && {yearMatrix})};
  }

  const api = {coverageNotice, search};
  if (node) module.exports = api;
  else root.JournalEvidenceSearch = api;
})(globalThis);

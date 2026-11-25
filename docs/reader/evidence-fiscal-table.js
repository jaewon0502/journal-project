// Locate a printed fiscal table cell using the named row, year, measure and original unit.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const fiscal = node ? require('./evidence-fiscal.js') : root.JournalEvidenceFiscal;
  const compact = value => value.normalize('NFKC').replace(/\s+/gu, '');
  const yearPrefix = /^((?:19|20)\d{2})(?:회계연도|년도|년)?/u;
  const yearOnly = /^((?:19|20)\d{2})(?:회계연도|년도|년)?$/u;
  const moneyNumber = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
  const moneyScale = '(?:(?:십|백|천)?[만억조]|[십백천])';
  const currency = new RegExp('^' + moneyScale + '?원$', 'u');
  const stub = /^(?:구분|항목|사업|사업명|세목|회계구분)$/u;
  const nonAmount = /(?:집행률|집행율|비중|비율|증감률|증감율|구성비|%|퍼센트)/u;
  const percent = /^(?:%|퍼센트)$/u;
  const rateBasis = '본예산|당초예산|예산현액|예산액|최종예산|추경예산';
  const rateTerms = new RegExp('(?:(' + rateBasis + ')(?:대비|기준|(?:을|를)?기준으로(?:한)?))?(?:예산)?집행[률율]', 'u');
  const rateSuffix = new RegExp('^(?:예산)?집행[률율]\\((' + rateBasis + ')(?:대비|기준)\\)$', 'u');
  const number = new RegExp('^([+−△▲▼-]?' + moneyNumber + ')(.*)$', 'u');
  const gaps = {
    layout:'표의 행과 열을 맞출 수 없습니다. 표 하나의 연도·단계 머리글과 금액 행을 함께 확인하세요.',
    scope:'질문의 항목과 범위가 일치하는 행을 찾지 못했습니다. 사업명·회계 구분과 추가 조건을 원표에서 확인하세요.',
    notes:'표 제목이나 주석이 금액의 범위 또는 단위를 제한할 수 있습니다. 원표에서 해당 행에 적용되는 설명을 확인하세요.',
    queryYear:'조회할 회계연도 하나를 특정할 수 없습니다. 기준 연도를 확인하세요.',
    queryStage:'어떤 예산 단계의 금액을 묻는지 특정할 수 없습니다. 요구액·정부안·확정 예산·결산액 등 필요한 단계를 확인하세요.',
    stageContext:'질문에서 언급한 자료의 단계와 확인할 금액의 단계가 다릅니다. 확인할 금액의 단계와 연도를 함께 지정하세요.',
    queryMeasure:'질문의 비율이나 복수 금액을 단일 금액 셀로 확인할 수 없습니다. 원표의 지표와 단위를 확인하세요.',
    year:'붙여 넣은 표에서 질문의 회계연도를 찾지 못했습니다. 해당 연도가 표시된 행 또는 열을 확인하세요.',
    stage:'질문의 회계연도에 해당 예산 단계의 열을 찾지 못했습니다. 그 단계의 금액이 표시된 원표를 확인하세요.',
    duplicateColumn:'같은 연도와 단계로 읽힐 수 있는 열이 여러 개입니다. 각 열의 상위 제목을 확인하세요.',
    duplicateRow:'같은 연도와 항목 이름을 가진 행이 여러 개입니다. 사업 코드나 회계 구분을 확인하세요.',
    blank:'해당 행과 열에 수치가 인쇄되지 않았습니다. 원표에서 빈칸이나 기호의 뜻을 확인하세요.',
    rateColumn:'요청한 연도와 기준의 집행률 열을 특정할 수 없습니다. 원표에 인쇄된 분모와 집행률 머리글을 확인하세요.',
    rateMeasure:'집행률 한 개를 확인하려면 연도, 항목과 기준을 지정하세요. 집행률 변화나 퍼센트포인트 차이는 비교할 두 값을 확인하세요.',
    rateUnits:'집행률 행과 열을 찾았지만 퍼센트 단위를 확인할 수 없습니다. 원표의 단위와 주석을 확인하세요.',
    nonCurrency:'해당 셀에는 금액 이외의 단위가 붙어 있습니다. 원표에서 금액 열을 확인하세요.'
  };
  const unresolved = kind => ({passages:[],gap:gaps[kind]});
  const headings = {
    request:/^(?:부처|기관)?(?:요구|요청)(?:액|안)$/u,
    proposal:/^(?:정부안|정부(?:제출|편성)안|국회제출안|(?:정부)?예산안)$/u,
    approved:/^(?:(?:국회|의회|본회의)(?:본회의)?)?(?:최종)?(?:확정(?:액|예산)|(?:의결|승인)(?:액|예산)|본예산)$/u,
    spent:/^(?:결산(?:액)?|(?:실제)?(?:집행|지출)(?:액|실적)|실제집행|실제지출)$/u,
    budget:/^(?:예산|예산액)$/u,
    difference:/^예산대비(?:증감액?|차액)?$/u
  };

  function rateHeading(raw, groupYear) {
    let s = compact(raw);
    const y = yearPrefix.exec(s);
    if (groupYear && y && y[1] !== groupYear) return null;
    if (y) s = s.slice(y[0].length);
    const year = y?.[1] || groupYear;
    if (/증감|변화|차이|%p|퍼센트포인트/iu.test(s)) return {year, stage:'other'};
    const unit = /\((%|퍼센트)\)$/u.exec(s)?.[1];
    if (unit) s = s.slice(0, -(unit.length + 2));
    // Publish only a printed rate. A formula or unknown qualifier could name another denominator.
    const suffix = rateSuffix.exec(s);
    const match = rateTerms.exec(s);
    return {year, stage:'executionRate', unit, basis:suffix?.[1] || match?.[1] || null,
      unclearRate:!suffix && match?.[0] !== s};
  }

  // Only formatting parentheses and the usual A/B/C column references are transparent.
  // A pending settlement, a percentage or a change since last year is a separate measure.
  function heading(raw, groupYear) {
    if (/집행[률율]/u.test(compact(raw))) return rateHeading(raw, groupYear);
    let s = raw.normalize('NFKC').trim();
    const parens = [...s.matchAll(/\(([^()]*)\)/gu)];
    let unit = null, formula = false;
    for (const m of parens) {
      const value = compact(m[1]);
      if (currency.test(value) && !unit) unit = m[1].trim();
      else if (/^[A-Z][-−][A-Z]$/u.test(value)) formula = true;
      else if (!/^[A-Z]$/u.test(value)) {
        if (nonAmount.test(s)) return {stage:'other'};
        return null;
      }
    }
    s = compact(s.replace(/\([^()]*\)/gu, ''));
    const y = yearPrefix.exec(s);
    if (groupYear && y && y[1] !== groupYear) return null;
    if (y) s = s.slice(y[0].length);
    if (/^(?:예산현액|당초예산|최종예산|추경예산|이월액|불용액)$/u.test(s)) return {stage:'other'};
    if (nonAmount.test(s) || /^(?:증감)?(?:전년(?:도)?대비|국회증감)(?:증감액?|차액|액)?$/u.test(s)) return {stage:'other'};
    const stage = Object.keys(headings).find(key => headings[key].test(s));
    return stage && (!formula || stage === 'difference') ? {year:y?.[1] || groupYear, stage, unit} : null;
  }

  function split(line) {
    if (line.includes('\t')) return {kind:'tab', cells:line.split('\t').map(s => s.trim())};
    if (/^\s*\|.*\|\s*$/u.test(line))
      return {kind:'pipe', cells:line.trim().slice(1,-1).split('|').map(s => s.trim())};
    return null;
  }

  // Match the whole question after removing the printed subject and fiscal wording.
  // Leftover names, dates and qualifiers can limit a total to a different population.
  const stageWording = {
    request:/(?:부처|기관)?(?:가|에서)?(?:요구|요청)(?:한|했던|액|안)/u,
    proposal:/(?:정부가국회에(?:제출한|낸)|정부가제출한|정부(?:제출|편성)안|정부안|국회제출안|(?:정부)?예산안)/u,
    approved:/(?:(?:국회|의회)(?:본회의)?|본회의)?(?:에서|가|는)?(?:최종)?(?:확정(?:예산|액|된|한)|의결(?:예산|액|한|된)|통과(?:한|된)|승인(?:한|된|액)|본예산)/u,
    spent:/(?:결산(?:기준|에서|액)?|실제로?(?:집행|지출|지급)(?:액|한)?|실제(?:집행|지출|지급)(?:액|한)?|(?:집행|지출)(?:실적|액|한))/u,
    budget:/예산(?:액)?/u,
    difference:/예산대비(?:증감액?|차액)/u,
    executionRate:rateTerms
  };
  const questionYear = /(?<!\d)((?:19|20)\d{2})\s*(?:회계\s*연도|년도|년)/gu;
  // Consume complete tokens once so a long failed match cannot backtrack across particles.
  const filler = /(?:예산서에서|결산서에서|원표에서|자료에서|기사에서|표에서|원표의|기사의|표의|얼마|였다는|이었다는|이었나|이었다|였다|인가요|인가|인지|이었|이에요|입니다|입니까|이라고|라고|이라는|라는|보도한|제시한|기재한|기록한|적은|쓴|였나|였던|맞는가|맞나요|맞습니까|맞나|(?:수치|금액|규모|주장|보도)(?:으로|[은는이가의를를에로])?|해당|이다|[?!.])/uy;
  function onlyFiller(value) {
    filler.lastIndex = 0;
    while (filler.lastIndex < value.length) if (!filler.exec(value)) return false;
    return true;
  }
  const moneyTerm = moneyNumber + '[ \\t]*' + moneyScale;
  const claimedAmount = new RegExp('(?<![\\d.,+−△▲▼-])[+−-]?(?:' + moneyTerm + '[ \\t]*){0,15}' +
    moneyNumber + '(?:[ \\t]*' + moneyScale + ')?[ \\t]*원','gu');
  const component = new RegExp('(' + moneyNumber + ')(?:[ \\t]*(' + moneyScale + '))?[ \\t]*','uy');
  const exponents = {십:1, 백:2, 천:3, 만:4, 억:8, 조:12};
  const exponent = scale => [...scale].reduce((power, c) => power + exponents[c], 0);
  // Keep character offsets when reading fullwidth numbers. Other compatibility
  // glyphs such as superscripts or circled digits have no monetary meaning here.
  const moneyGlyphs = text => text.replace(/[！-～]/gu, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/gu,' ');

  function integerWon(numberText, power) {
    if (numberText.length > 64) return null;
    const [whole, decimal = ''] = numberText.replace(/,/gu,'').split('.');
    const fraction = decimal.replace(/0+$/u,'');
    if (fraction.length > power) return null;
    return BigInt(whole + fraction) * 10n ** BigInt(power - fraction.length);
  }

  function claimedWon(amount) {
    const body = amount.replace(/^[+−-]/u,'').slice(0,-1).trimEnd();
    let total = 0n, lastPower = null;
    component.lastIndex = 0;
    while (component.lastIndex < body.length) {
      const match = component.exec(body);
      if (!match) return null;
      const power = exponent(match[2] || '');
      const value = integerWon(match[1], power);
      // Each successive amount must fit strictly below the preceding scale.
      // A decimal is unambiguous only on the final component.
      if (value === null || (lastPower !== null && (power >= lastPower || value >= 10n ** BigInt(lastPower))) ||
          (component.lastIndex < body.length && match[1].includes('.'))) return null;
      total += value;
      lastPower = power;
    }
    return /^[−-]/u.test(amount) ? -total : total;
  }

  function compareAmount(claim, parsed, unit, rowMatch) {
    if (!claim || !parsed.numeric || /^[△▲▼]/u.test(parsed.numeric) ||
        (claim.start < rowMatch.index + rowMatch[0].length && claim.end > rowMatch.index)) return null;
    const digits = parsed.numeric.replace(/^[+−-]/u,'');
    const printed = integerWon(digits, exponent(compact(unit).slice(0,-1)));
    if (printed === null) return null;
    const cell = /^[−-]/u.test(parsed.numeric) ? -printed : printed;
    return {claimText:claim.text, claimWon:claim.won.toString(), cellWon:cell.toString(), same:claim.won === cell};
  }
  const claimedRate = /[+−-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|퍼센트)/gu;
  function question(text) {
    const q = text.normalize('NFKC');
    if (q.includes('\u0000')) return null;
    if (!/예산|결산|총지출|총수입|일반회계|특별회계|기금|금액|사업비|재정수지|정부\s*안|요구액|확정액|집행|지출액/u.test(q) ||
        /의원|표결|몇\s*(?:명|표|건|일)|누가|누구|언제|날짜|이유|왜|이메일|연락처|명단/u.test(q)) return null;
    const terms = compact(q);
    // A review of an earlier stage can quote later (or prior) amounts. A stage
    // identifying the source must not override a different named amount.
    const contextStage = /(결산|정부안|예산안|본예산|확정예산|요구안)(?:보고서|자료|표|서)?(?:에서|에따르면)/gu;
    const mentions = [...terms.matchAll(contextStage)];
    const targetWords = terms.replace(contextStage,'');
    const explicitBudget = /(?<!확정|의결|본)예산액|(?<!확정|의결|본)예산(?=[은는이가을?]|$)/u.test(targetWords);
    const stageConflict = mentions.some(m => {
      const sourceStage = Object.keys(headings).find(key => headings[key].test(m[1]));
      if (explicitBudget && sourceStage !== 'budget') return true;
      return Object.entries(stageWording).some(([stage,words]) =>
        stage !== 'budget' && stage !== sourceStage && words.test(targetWords));
    });
    let stage = fiscal.request(q + ' 예산');
    const rate = rateTerms.exec(terms);
    if (rate) stage = 'executionRate';
    else if (stageWording.difference.test(terms)) stage = 'difference';
    else if (!stage && !fiscal.stages(q + ' 예산').size && /예산(?:액)?(?:[은는이가의을?]|$)/u.test(terms)) stage = 'budget';
    const years = [...q.matchAll(questionYear)];
    const amounts = [...q.matchAll(claimedAmount)];
    let moneyClaim = null, invalidCompound = false;
    if (amounts.length === 1) {
      const [match] = amounts;
      const won = claimedWon(match[0]);
      invalidCompound = won === null && /[십백천만억조][ \t]*\d/u.test(match[0]);
      // Obtain the original spelling from text, even when the project name was
      // compatibility-normalized to match a row. Never turn e.g. 10² into 102.
      const printed = text === q ? match : [...moneyGlyphs(text).matchAll(claimedAmount)].find(raw =>
        raw[0] === match[0] && text.slice(0,raw.index).normalize('NFKC').length === match.index);
      if (won !== null && printed) moneyClaim = {text:text.slice(printed.index,printed.index + printed[0].length),
        won, start:match.index, end:match.index + match[0].length};
    }
    const rateSupported = amounts.length === 0 && [...q.matchAll(claimedRate)].length <= 1 &&
      !/%\s*p|퍼센트\s*포인트|%\s*포인트|증감|증가|감소|상승|하락|차이|변화/iu.test(q);
    function remainder(value) {
      let rest = compact(value.replace(questionYear,'\u0000').replace(claimedAmount,'\u0000')
        .replace(/몇\s*(?:(?:십|백|천)?(?:만|억|조)|십|백|천)?\s*원/gu,'얼마'));
      if (rate) rest = rest.replace(claimedRate, '\u0000').replace(/몇(?:%|퍼센트)/gu,'얼마');
      if (stage) rest = rest.replace(new RegExp(stageWording[stage].source,'gu'), '\u0000');
      // An approval may name the object explicitly ('국회가 의결한 … 예산').
      if (stage === 'approved' && !stageConflict) rest = rest.replace(/예산(?:액)?/gu,'\u0000');
      // A particle can follow a printed row, monetary claim, year or stage once.
      // Free-standing words made of the same syllables can be place names.
      return rest.replace(/\u0000(?:(?:에서는|에서도|에는|에도|에서|으로|[은는가의를를에로]|이(?!었|라|다|에)))?/gu,'');
    }
    return {q, terms, stage, stageConflict, moneyClaim, basis:rate?.[1], year:years.length === 1 && years[0][1],
      supported:rate ? rateSupported : amounts.length <= 1 && !invalidCompound && !nonAmount.test(q), rest:remainder(q), remainder};
  }

  function rowQuestion(query) {
    if (typeof query !== 'string' || query.length > 1000) return null;
    const ask = question(query);
    // The flat-text fallback only identifies monetary rows, without a verified cell.
    return ask?.stage === 'executionRate' ? null : scoped(ask);
  }

  function scoped(ask) {
    if (!ask?.stage || ask.stageConflict || !ask.year || !ask.supported || onlyFiller(ask.rest)) return null;
    function matchingLabel(label, projectColumn = false) {
      if (typeof label !== 'string' || !/\p{L}/u.test(label)) return null;
      const words = label.normalize('NFKC').trim().split(/\s+/u);
      if (!ask.terms.includes(words.join(''))) return null;
      const name = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('\\s*');
      const suffix = projectColumn ? '(?:\\s*사업)?' : '';
      // Detect the printed name in the original words, before removing stage vocabulary.
      // In 연구원 the last syllable is part of the name. In 예산군립도서관 the
      // opening syllables are a place name. Neither side is a disposable keyword.
      const pattern = new RegExp('(?<![\\p{L}\\p{N}])' + name + suffix +
        '(?:에서는|에는|에도|에서|으로|[은는이가의를를에로])?(?![\\p{L}\\p{N}])','gu');
      for (const m of ask.q.matchAll(pattern)) {
        const outside = ask.q.slice(0,m.index) + '\u0000' + ask.q.slice(m.index + m[0].length);
        if (stageWording[ask.stage].test(compact(outside)) && onlyFiller(ask.remainder(outside))) return m;
      }
      return null;
    }
    return {year:ask.year, stage:ask.stage, matchingLabel, matches:(label, projectColumn) => !!matchingLabel(label, projectColumn)};
  }

  function legend(line) {
    const s = line.normalize('NFKC').trim().replace(/^\((.*)\)$/u,'$1').replace(/^\[(.*)\]$/u,'$1');
    const value = /^단\s*위\s*:\s*(.+)$/u.exec(s)?.[1]?.trim();
    if (!value) return null;
    if (currency.test(compact(value)) || percent.test(compact(value))) return {unit:value};
    const units = value.split(/[,·/]/u).map(compact);
    // A mixed legend alone does not assign its money unit to any one column.
    const mixed = units.every(u => currency.test(u) || /^(?:%p?|퍼센트(?:포인트)?)$/iu.test(u));
    return {options:mixed ? units : []};
  }

  function physicalRows(text) {
    const rows = [], pageStarts = new Set();
    for (const line of text.split(/\r\n|[\n\r\u2028\u2029]/u)) {
      if (line.includes('\f')) pageStarts.add(rows.length + 1);
      if (line.trim()) rows.push({text:line, paragraph:rows.length + 1});
    }
    return {rows, pageStarts};
  }

  // A report may print the same annual amount under several headings. Only a
  // breakdown by use can distinguish an individual purpose from the full year.
  function printedReserveUses(text, query) {
    if (!query.includes('예비비') || !/사용\s*명세별\s*집행\s*현황/u.test(text)) return null;
    const money = '(?:' + moneyNumber + '\\s*[조억만]\\s*)?' + moneyNumber + '\\s*[십백천만억조]?\\s*원';
    const use = '([가-힣A-Za-z0-9·][가-힣A-Za-z0-9· ]{1,44}?)에(?:서)?';
    const ends = '\\s*' + money + '(?:을|를)?\\s*(?:썼|쓰였|사용했|사용하였|집행했|집행하였|지출했|지출하였)[가-힣]*[.!?。]?';
    // A sentence may cite an earlier expenditure as an example for a separate policy position.
    const example = /^(.{1,180}?(?:썼던|사용했던|집행했던|지출했던))\s+(?:사례|전례|경험)\s*(?:등을|를|을)\s+(?:들어|들며|들면서)\s+(.+)$/u.exec(query.trim());
    const clause = example ? example[1] : query.trim();
    const scoped = new RegExp('^((?:19|20)\\d{2})\\s*(?:회계연도|년도|년)\\s+(?:' +
      use + '\\s+예비비(?:로)?|예비비\\s+(?:중\\s+)?' + use + ')' + ends + '$','u').exec(clause);
    if (!scoped) return null;
    const purpose = (scoped[2] || scoped[3]).trim();
    if (/(?:[0-9]{4}년|회계|제외|이외|외에|이월|불용|결정액)/u.test(purpose)) return null;
    const {rows, pageStarts} = physicalRows(text);
    const title = '[' + scoped[1] + '회계연도예비비사용명세별집행현황]';
    const matches = rows.filter(row => compact(row.text) === title);
    if (matches.length !== 1) return null;
    const [caption] = matches, unitRow = rows[caption.paragraph], header = rows[caption.paragraph + 1];
    if (!unitRow || !header || pageStarts.has(unitRow.paragraph) || pageStarts.has(header.paragraph)) return null;
    const unit = legend(unitRow.text)?.unit;
    if (!unit || !currency.test(compact(unit))) return null;
    const columns = header.text.trim().split(/\s{2,}|\t/u).map(compact);
    const labels = ['지출결정액','지출액','이월액','잔액'];
    if (columns.length !== 5 || columns[0] !== '사용명세' || !labels.every(label => columns.includes(label))) return null;
    const entries = [], context = [caption, unitRow, header];
    const amount = new RegExp('^(?:' + moneyNumber + '|\\(' + moneyNumber + '\\)|[-–—])$', 'u');
    let ended = false;
    for (const row of rows.slice(header.paragraph, header.paragraph + 70)) {
      if (pageStarts.has(row.paragraph)) break;
      const line = row.text.trim();
      if (/^자료\s*[:：]/u.test(line)) { ended = true; break; }
      context.push(row);
      // In a vertically merged account label pdftotext may insert one standalone syllable.
      if (/^[일반회계]$/u.test(line)) continue;
      const itemPrefix = /^(?:[일반회계]\s{2,})?[-–]\s+/u;
      const fields = line.replace(itemPrefix, '').split(/\s{2,}|\t/u);
      if (fields.length !== columns.length || !fields.slice(1).every(cell => amount.test(cell))) return null;
      entries.push({row,label:fields[0],fields,lineItem:itemPrefix.test(line)});
    }
    const totals = entries.filter(item => compact(item.label) === '합계');
    if (!ended || totals.length !== 1 || totals[0] !== entries.at(-1) || !entries.some(item => item.lineItem)) return null;
    const byPurpose = entries.filter(item => item.lineItem && compact(item.label) === compact(purpose));
    if (byPurpose.length > 1) return null;
    const selected = byPurpose[0] || totals[0];
    const rowLabel = selected === totals[0] ? '합계' : selected.label;
    const spentColumn = columns.indexOf('지출액');
    const reserveUse = {rowLabel, caption:caption.text.trim(), purpose, matchedPurpose:Boolean(byPurpose.length),
      spent:selected.fields[spentColumn], decided:selected.fields[columns.indexOf('지출결정액')], unit};
    if (!byPurpose.length) reserveUse.exampleUses = entries.filter(item => item.lineItem).slice(0, 2)
      .map(item => ({label:item.label, spent:item.fields[spentColumn]}));
    if (example) {
      // Select a single past claim automatically only when the rest is qualitative policy commentary.
      const rest = example[2];
      if (/[\d０-９]|예비비|예산|금액|지원금|지출|집행|썼|반박|부인|아니|없|않/u.test(rest) ||
          !/(?:강조|설명|주장|당부)(?:한다|했다|하였다)[.!?。]?$/u.test(rest)) {
        return {notice:'문장에 다른 판단이나 조건이 함께 있습니다. 대조할 지출 구절을 선택하세요.',
          reserveUseChoice:clause, passages:[]};
      }
      reserveUse.clause = clause;
    }
    return {notice:byPurpose.length ? '같은 이름의 용도 행을 찾았습니다. 지출결정액과 실제 지출액을 구분하세요.' :
      '요청한 용도와 이름이 같은 행을 찾지 못했습니다. 연간 합계가 그 용도에 쓰였는지는 결산 세부 내역에서 확인하세요.',
      passages:[{...selected.row,matched:[],context:context.filter(row => row !== selected.row),reserveUse}]};
  }

  // In an execution table the year can be centered vertically, even on a
  // continuation of another column. Use the complete printed group for navigation.
  function printedReserveRows(text, query) {
    if (!/예비비/u.test(query) || !/예비비\s*집행\s*실적\s*\]/u.test(text)) return null;
    const scope = /(?:일반|특별)\s*회계\s*예비비/u.exec(query)?.[0];
    const metrics = [...query.matchAll(/지출\s*결정액|지출액/gu)];
    if (!scope || !metrics.length) return null;
    if (metrics.length > 1) {
      const [first, next] = metrics;
      const between = query.slice(first.index + first[0].length, next.index);
      if (metrics.length !== 2 || compact(first[0]) === compact(next[0]) || !/^에서\s*(?:실제\s*)?$/u.test(between))
        return unresolved('queryMeasure');
      // '지출결정액에서 실제 지출액은 얼마인가' asks for the latter measure.
      query = query.slice(0, first.index) + query.slice(next.index);
    }
    const metric = metrics.at(-1)[0];
    // Only check the question's scope. A compound monetary amount occupies
    // one place in its grammar; its value must never select the row.
    const grammar = query.replace(metric, '지출액').replace(/\d[\d,]*\s*조\s*(?=\d[\d,]*\s*억\s*원)/gu, '')
      // An opening total ('예비비 …원 중 실제 지출액') is separate from the requested row.
      .replace(/(예비비)\s+(?:예산(?:액)?\s+)?\d[\d,.]*\s*[천만억조]?\s*원\s*중(?:에서)?\s+(?=(?:실제\s*)?지출액)/u, '$1 ');
    const ask = rowQuestion(grammar);
    if (!ask || !ask.matches(scope)) return metrics.length > 1 ? unresolved('queryMeasure') : null;
    const {rows, pageStarts} = physicalRows(text);
    const captions = rows.filter(row => /^\[\s*(?:최근\s*\d+\s*년\s*간\s*)?(?:일반|특별)\s*회계\s*예비비\s*집행\s*실적\s*\]$/u.test(row.text.trim()));
    if (!captions.length) return null;
    const matching = captions.filter(row => compact(row.text).includes(compact(scope)));
    if (!matching.length) return unresolved('scope');
    if (matching.length !== 1) return unresolved('duplicateRow');
    const caption = matching[0], unitRow = rows[caption.paragraph];
    const unit = unitRow && !pageStarts.has(unitRow.paragraph) && legend(unitRow.text)?.unit;
    if (!unit || !currency.test(compact(unit))) return unresolved('notes');
    const header = [caption, unitRow], groups = [], notes = [];
    const yearRow = /^((?:19|20)\d{2})(?:년)?(?:\s+|$)/u;
    const fiscalRow = /^(예산|지출결정액|지출액)\s+/u;
    const digits = /^(?:\(?\d[\d,.]*\)?|[-–—])(?:\s+(?:\(?\d[\d,.]*\)?|[-–—]))*$/u;
    for (let i = unitRow.paragraph; i < rows.length; i++) {
      const row = rows[i], line = row.text.trim();
      if (pageStarts.has(row.paragraph)) break;
      if (/^주\s*\d*\s*[:：]/u.test(line)) { notes.push(row); continue; }
      if (notes.length || /^(?:자료\s*[:：]|출처\s*[:：]|\[)/u.test(line)) break;
      const year = yearRow.exec(line), remainder = year ? line.slice(year[0].length) : line;
      const label = fiscalRow.exec(remainder);
      if (label?.[1] === '예산') groups.push({rows:[], years:[], labels:[], labelColumn:row.text.indexOf('예산')});
      const group = groups.at(-1);
      if (!group) {
        if (header.length >= 10 || year || !/[가-힣]/u.test(line)) return unresolved('layout');
        header.push(row);
        continue;
      }
      const values = label ? remainder.slice(label[0].length) : remainder;
      if (!digits.test(values) && !(year && !values)) return unresolved('layout');
      if (year && (label || row.text.indexOf(year[1]) < group.labelColumn)) group.years.push(year[1]);
      if (label) group.labels.push({name:label[1], row});
      group.rows.push(row);
    }
    const heading = compact(header.slice(2).map(row => row.text).join(' '));
    if (!heading.includes('구분') || !heading.includes(compact(scope).replace('예비비','')) || !heading.includes('예비비'))
      return unresolved('layout');
    const found = groups.filter(group => group.years.includes(ask.year));
    if (found.length !== 1) return unresolved(found.length ? 'duplicateRow' : 'year');
    const [group] = found;
    if (group.years.length !== 1 || group.labels.map(item => item.name).join('/') !== '예산/지출결정액/지출액')
      return unresolved('layout');
    const name = compact(metric), selected = group.labels.find(item => item.name === name).row;
    const applicableNotes = notes.filter(row => {
      const onlyYears = /^\s*주\s*\d*\s*[:：]\s*((?:(?:19|20)\d{2}년?\s*[·ㆍ,]\s*)*(?:19|20)\d{2}년)\s+(?:괄호|수치|금액)/u.exec(row.text);
      return !onlyYears || onlyYears[1].includes(ask.year);
    });
    return {notice:scope + ' 집행 실적표에서 ' + ask.year + '년 ‘' + name + '’ 행을 찾았습니다. 이 표의 단위는 ' + unit +
        '입니다. 금액은 원표에서 해당 열과 주석을 대조하세요.',
      passages:[{...selected, matched:[name], context:[...header, ...group.rows.filter(row => row !== selected), ...applicableNotes],
        fiscalNavigation:{rowLabel:ask.year + '년 ' + name, caption:caption.text.trim(), reserveGroup:true}}]};
  }

  // Captions can qualify every amount in a table. Accept plain fiscal descriptions
  // only. Never borrow the caption's year, reporting stage or unit for a cell.
  function isCaption(line) {
    const s = line.normalize('NFKC').trim();
    const marked = /^(?:\[표\s*\d+(?:[-.]\d+)*\]|〈표\s*\d+(?:[-.]\d+)*〉|<표\s*\d+(?:[-.]\d+)*>)\s*(.*)$/u.exec(s);
    const enclosed = /^\[([^\[\]]+)\]$|^〈([^〈〉]+)〉$|^<([^<>]+)>$/u.exec(s);
    let title = marked ? marked[1] : enclosed?.slice(1).find(Boolean);
    if (title === undefined) return false;
    title = compact(title).replace(/^표\d+(?:[-.]\d+)*/u,'');
    const token = /(?:(?:19|20)\d{2}(?:회계연도|년도|년)|총지출|총수입|재정총량|재정수지|회계연도|본예산|예산안|예산|결산|집행액|집행[률율]|집행|의결|확정|국회|정부안|부처|요구액|단계별|연도별|회계별|사업별|항목별|사업|회계|금액|심의|결과|편성|현황|내역|총괄|규모|비교|및|의|[·ㆍ,])/uy;
    while (token.lastIndex < title.length) if (!token.exec(title)) return false;
    return true;
  }

  function isAttribution(line) {
    const value = /^(?:자료|출처)\s*:\s*(.+)$/u.exec(line.normalize('NFKC').trim())?.[1];
    if (!value || /단위|잠정|미확정|제외|포함|조정|수정|정정|환산|누락|오류|주석|기준|별도/u.test(value)) return false;
    return /^[가-힣A-Za-z· ]{1,60}(?:부|처|청|회|단|원|센터|은행|공사|연구소|시청|도청|예산서|결산서|원표)$/u.test(value) ||
      /^https?:\/\/[^\s]+$/u.test(value);
  }

  function valueOf(raw) {
    if (!raw || /^[-—–…]$/u.test(raw)) return {missing:true};
    const normalized = raw.normalize('NFKC').trim();
    const parts = number.exec(normalized);
    if (!parts) return null;
    const unit = parts[2].trim();
    if (unit && !currency.test(compact(unit)) && !/^(?:%|%p|퍼센트)$/iu.test(unit)) return null;
    return {unit, numeric:moneyGlyphs(raw).trim() === normalized ? parts[1] : null};
  }

  function headerRows(rows, start) {
    const top = split(rows[start].text);
    if (!top) return null;
    const labels = top.cells.map(compact);
    const vertical = /^(?:회계)?(?:연도|년도)$/u.test(labels[0]) && /^(?:사업명?|항목|구분)$/u.test(labels[1]);
    const offset = vertical ? 2 : 1;
    const grouped = !vertical && yearOnly.test(labels[1]) && labels.slice(1).every(s => !s || yearOnly.test(s));
    if (!vertical && !stub.test(labels[0]) && !(grouped && (!labels[0] || labels[0] === '회계연도'))) return null;
    let leaf = top;
    if (grouped) {
      leaf = rows[start + 1] && split(rows[start + 1].text);
      if (!leaf || leaf.kind !== top.kind || leaf.cells.length !== labels.length ||
          (leaf.cells[0] && !stub.test(compact(leaf.cells[0])))) return null;
    }
    let groupYear;
    const columns = leaf.cells.slice(offset).map((raw, i) => {
      const index = i + offset;
      if (grouped && labels[index]) groupYear = yearOnly.exec(labels[index])[1];
      const parsed = heading(raw, groupYear);
      if (!parsed || (vertical && parsed.year)) return null;
      return {...parsed, raw, index};
    });
    if (!columns.length || !columns.every(Boolean)) return null;
    return {kind:top.kind, width:labels.length, vertical, offset, columns,
      projectColumn:/^사업명?$/u.test(labels[offset - 1]), last:start + Number(grouped)};
  }

  function lookup(text, query) {
    if (typeof text !== 'string' || typeof query !== 'string' || query.length > 1000 ||
        !/[\t|]/u.test(text)) return null;
    const ask = question(query);
    if (!ask) return null;
    // No item was named. Leave ordinary heading navigation available.
    if (ask.stage && onlyFiller(ask.rest)) return null;
    const lines = text.split(/\r\n|[\n\r\u2028\u2029]/u);
    const rows = lines.filter(line => line.trim()).map((line,i) => ({text:line, paragraph:i + 1}));
    // Other tables can use the same year and subject. Only intercept visibly fiscal headings.
    const hints = rows.filter(r => /[\t|]/u.test(r.text)).slice(0,2);
    const top = hints.length && split(hints[0].text);
    if (!top || !/^(?:구분|항목|사업명?|세목|회계구분|(?:회계)?(?:연도|년도)|)$/u.test(compact(top.cells[0]))) return null;
    const lower = hints[1] && split(hints[1].text);
    const possibleHeaders = lower && (!lower.cells[0] || stub.test(compact(lower.cells[0]))) ?
      [...top.cells.slice(1),...lower.cells.slice(1)] : top.cells.slice(1);
    if (!possibleHeaders.some(s => /예산|결산|정부\s*안|확정액|요구액|집행액|집행[률율]|지출액/u.test(s))) return null;
    if (text.includes('\f')) return unresolved('layout');
    if (ask.stageConflict) return unresolved('stageContext');
    if (!ask.stage) return unresolved('queryStage');
    if (!ask.year) return unresolved('queryYear');
    const isRate = ask.stage === 'executionRate';
    if (!ask.supported) return unresolved(isRate ? 'rateMeasure' : 'queryMeasure');
    const target = scoped(ask);
    if (!target) return unresolved('scope');
    let start = Number(isCaption(rows[0].text));
    const unitLine = rows[start] && legend(rows[start].text);
    if (unitLine) start++;
    if (rows[start] && !split(rows[start].text)) return unresolved('notes');
    const header = rows[start] && headerRows(rows,start);
    if (!header || rows.length <= header.last + 1) return unresolved('layout');
    const columns = header.columns;
    if (!header.vertical && !columns.some(c => c.year === ask.year)) return unresolved('year');
    const matchingStage = columns.filter(c => c.stage === ask.stage && (header.vertical || !c.year || c.year === ask.year));
    if (isRate && matchingStage.some(c => c.unclearRate)) return unresolved('rateColumn');
    const candidates = ask.basis ? matchingStage.filter(c => c.basis === ask.basis) : matchingStage;
    if (candidates.length > 1) return unresolved(isRate ? 'rateColumn' : 'duplicateColumn');
    if (!candidates.length || (!header.vertical && candidates[0].year !== ask.year)) return unresolved(isRate ? 'rateColumn' : 'stage');
    const [column] = candidates;
    let selected = null, yearPresent = !header.vertical;
    const footer = rows.at(-1);
    const end = rows.length - Number(isAttribution(footer.text));
    for (const row of rows.slice(header.last + 1,end)) {
      const data = split(row.text);
      if (!data) return unresolved('notes');
      if (data.kind !== header.kind || data.cells.length !== header.width) return unresolved('layout');
      const rowYear = header.vertical && yearOnly.exec(compact(data.cells[0]))?.[1];
      const rowLabel = data.cells[header.offset - 1];
      const values = data.cells.slice(header.offset).map(valueOf);
      if ((header.vertical && !rowYear) || !/\p{L}/u.test(rowLabel) || /[()\[\]*※]/u.test(rowLabel) ||
          !values.every(Boolean) || values.every(value => value.missing)) return unresolved('layout');
      if (header.vertical && rowYear !== ask.year) continue;
      yearPresent = true;
      const rowMatch = target.matchingLabel(rowLabel,header.projectColumn);
      if (!rowMatch) continue;
      if (selected) return unresolved('duplicateRow');
      const value = data.cells[column.index];
      const parsed = values[column.index - header.offset];
      if (parsed.missing) return unresolved('blank');
      const unitType = isRate ? percent : currency;
      if (parsed.unit && !unitType.test(compact(parsed.unit))) return unresolved(isRate ? 'rateUnits' : 'nonCurrency');
      const units = [unitLine?.unit,column.unit,parsed.unit].filter(Boolean);
      const unitKey = u => isRate && percent.test(compact(u)) ? '%' : compact(u);
      const hasUnit = units.length && units.every(u => unitType.test(compact(u)) && unitKey(u) === unitKey(units[0])) &&
        (!unitLine?.options || unitLine.options.some(u => unitKey(u) === unitKey(units[0])));
      const position = {heading:column.raw, value, column:column.index + 1, rowLabel,
        headerParagraph:rows[header.last].paragraph, year:ask.year, stage:ask.stage, ...(column.basis ? {basis:column.basis} : {})};
      const amountComparison = hasUnit && !isRate && compareAmount(ask.moneyClaim, parsed, units[0], rowMatch);
      selected = {...row, matched:[], context:rows.slice(0,header.last + 1),
        ...(hasUnit ? {fiscalCell:{...position,unit:units[0], ...(amountComparison && {amountComparison})}} : {fiscalNavigation:position})};
    }
    if (!selected) return unresolved(yearPresent ? 'scope' : 'year');
    const unitGap = isRate ? gaps.rateUnits : '해당 행과 열은 찾았지만 금액 단위를 특정할 수 없습니다. 원표의 단위와 주석을 확인하세요.';
    return {gap:selected.fiscalNavigation ? unitGap : null,
      passages:[selected]};
  }

  // The editor stores the raw headers and row separately from this specific, editable locator.
  // Re-read the cited column before using it. Titles and arbitrary page references do not bind a number.
  const cellLocator = /^(?:PDF [1-9]\d*쪽 · )?(?:((?:19|20)\d{2})년 · )?‘([^‘’\r\n]+)’ 행 · ‘([^‘’\r\n]+)’ 열 \(왼쪽에서 ([1-9]\d*)번째 열\) · 단위 ([^\r\n]+)$/u;
  const amountMeasures = {request:'부처 요구액', proposal:'정부안', approved:'국회 확정액',
    spent:'결산액', budget:'예산액', difference:'예산 대비 증감액'};
  function archivedTable(excerpt) {
    const rows = excerpt.split(/\r\n|[\n\r\u2028\u2029]/u);
    // citationRows marks the gap between the complete headers and the selected row.
    if (rows.at(-2) === '[…]') rows.splice(-2,1);
    return rows.join('\n');
  }
  function registeredCell(source) {
    if (typeof source?.locator !== 'string' || typeof source.excerpt !== 'string') return null;
    const position = cellLocator.exec(source.locator);
    if (!position) return null;
    const [, prefixYear, rowLabel, printed, column, unit] = position;
    const parsed = heading(printed, prefixYear);
    if (!parsed?.year || parsed.unclearRate) return null;
    const measure = parsed.stage === 'executionRate' && percent.test(compact(unit))
      ? (parsed.basis ? parsed.basis + ' 대비 ' : '') + '집행률'
      : currency.test(compact(unit)) && amountMeasures[parsed.stage];
    if (!measure) return null;
    const query = parsed.year + '년 ' + rowLabel + '의 ' + measure + '은 얼마인가?';
    const cell = lookup(archivedTable(source.excerpt),query)?.passages[0]?.fiscalCell;
    if (!cell || cell.rowLabel !== rowLabel || cell.heading !== printed ||
        cell.column !== Number(column) || cell.unit !== unit) return null;
    return cell;
  }
  function registeredRateCell(source) {
    const cell = registeredCell(source);
    if (cell?.stage !== 'executionRate') return null;
    const {rowLabel, heading, column, year, value, unit, basis} = cell;
    return {rowLabel, heading, column, year, value, unit, ...(basis && {basis})};
  }
  function registeredAmountQuestion(text) {
    const ask = rowQuestion(text);
    if (!ask) return null;
    return source => {
      // Older single-row excerpts and free-form sources still use the ordinary search.
      if (!cellLocator.test(source.locator) || !/[\n\r\u2028\u2029]/u.test(source.excerpt)) return null;
      const selected = registeredCell(source);
      if (!selected || ask.year !== selected.year || ask.stage !== selected.stage) return {status:'incompatible'};
      const requested = lookup(archivedTable(source.excerpt),text)?.passages[0]?.fiscalCell;
      return requested && requested.column === selected.column && requested.rowLabel === selected.rowLabel
        ? {status:'compatible', cell:selected} : {status:'incompatible'};
    };
  }

  function registeredRateQuestion(text) {
    if (typeof text !== 'string' || !/집행\s*[률율]/u.test(text)) return null;
    const ask = text.length <= 1000 && question(text);
    const target = scoped(ask);
    return source => {
      if (!target || ask.stage !== 'executionRate') return {status:'unknown'};
      const cell = registeredRateCell(source);
      if (!cell) return {status:'unknown'};
      if (cell.year !== ask.year || (ask.basis && cell.basis && cell.basis !== ask.basis))
        return {status:'incompatible'};
      // Reuse the full query so qualifiers or multiple eligible denominators stay unresolved.
      const requested = lookup(archivedTable(source.excerpt),text)?.passages[0]?.fiscalCell;
      if (!requested) return {status:'unknown'};
      if (cell.rowLabel !== requested.rowLabel || cell.column !== requested.column) return {status:'incompatible'};
      return {status:'compatible', value:cell.value, unit:cell.unit, ...(cell.basis && {basis:cell.basis})};
    };
  }
  const api = {lookup,rowQuestion,printedReserveRows,printedReserveUses,registeredCell,registeredAmountQuestion,registeredRateCell,registeredRateQuestion};
  if (node) module.exports = api;
  else root.JournalEvidenceFiscalTable = api;
})(globalThis);

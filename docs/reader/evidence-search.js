// Route table searches and flag count questions when the pasted table has no visible unit.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const finder = node ? require('./evidence-finder.js') : root.JournalEvidenceFinder;
  const trend = node ? require('./evidence-trend.js') : root.JournalEvidenceTrend;
  const columns = node ? require('./evidence-columns.js') : root.JournalEvidenceColumns;

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

  function search(documentText, query, {articleContext = ''} = {}) {
    const table = trend.find(documentText, query, {articleContext});
    const gap = coverageNotice(documentText, query);
    const yearMatrix = table.state === 'ordinary' ? columns.parseYearMatrix(documentText) : null;
    let passages = table.hits;
    if (table.state !== 'candidates') {
      // The cell resolver checks only the query. Additional article context
      // may restrict the population or period beyond what this row describes.
      const context = articleContext.trim();
      const checkCell = yearMatrix && (!context || context === query.trim());
      const matrixCell = checkCell ? columns.findYearMatrixCell(yearMatrix, query) : null;
      const matrixNavigation = yearMatrix && !matrixCell ? columns.findYearMatrixRow(yearMatrix, query) : null;
      passages = finder.find(documentText, query, {includeContext: true, matrixCell, matrixNavigation});
    }
    return {passages, gap, state: table.state, usedArticleContext: table.usedArticleContext,
      needsPublicationDate: table.needsPublicationDate, reason: table.reason, ...(yearMatrix && {yearMatrix})};
  }

  const api = {coverageNotice, search};
  if (node) module.exports = api;
  else root.JournalEvidenceSearch = api;
})(globalThis);

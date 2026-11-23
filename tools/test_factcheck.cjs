const {test} = require('node:test');
const assert = require('node:assert/strict');
const {prepare, decide, report} = require('../docs/reader/factcheck-engine.js');
const archived = require('../experiments/source-evidence-ai-review/data/cases.json');

const article = '의회는 심의안을 의결했다.';
const source = {id: 'minutes', title: '가상 회의록', url: 'https://council.example/minutes',
  version: '회의일 기준 확정본', locator: '안건 2', excerpt: '심의안 의결.'};
const sources = [source];
const decision = {status: 'fact', sourceIds: ['minutes'], acknowledged: true,
  reason: '안건 2의 의결 결과와 기사의 행위자·행위를 대조했다.'};

test('과거 연구의 한국어 문장 18개를 새 기사로 검토하면 저장 AI 판정이 승계되지 않는다', () => {
  assert.equal(archived.initial_sentences.length, 18);
  for (const item of archived.initial_sentences) {
    const result = report(item.text, [], []);
    assert.equal(result.complete, false, item.id);
    assert.equal(result.confirmedCount, 0);
    assert.equal(result.rows.length, 1, item.id);
    assert.equal(result.rows[0].text, item.text);
  }
});

test('검토한 문장만 재사용하고 원문·시점·위치·발췌·추가 반증이 바뀌면 다시 연다', () => {
  const [row] = prepare(article, sources, []).rows;
  const receipt = decide(row, decision, sources);
  const saved = JSON.parse(JSON.stringify([receipt]));
  assert.equal(report(article, sources, saved).confirmedCount, 1);
  assert.equal(report(article, sources, saved).pendingCount, 0);
  assert.equal(report('기사의 정정 전 내용이다.\n' + article, sources, saved).confirmedCount, 0);
  for (const key of ['url', 'version', 'locator', 'excerpt']) {
    const edited = {...source, [key]: key === 'url' ? 'https://council.example/revision' : '정정 내용'};
    assert.equal(report(article, [edited], saved).confirmedCount, 0, key);
  }
  assert.equal(report(article, [source, {...source, id: 'update', excerpt: '의결이 취소됐다.'}], saved).confirmedCount, 0);
});

test('근거 없는 확인, 존재하지 않는 근거, 확인 동의 없는 판정을 거부한다', () => {
  const [row] = prepare(article, sources, []).rows;
  for (const edit of [{sourceIds: []}, {sourceIds: ['missing']}, {acknowledged: false}]) {
    assert.throws(() => decide(row, {...decision, ...edit}, sources));
  }
});

test('정당 역할을 바꿔도 의혹은 사실로 승격되지 않고 발언 확인은 별도로 계산한다', () => {
  for (const actor of ['여당', '야당']) {
    const quote = actor + '은 “시장이 횡령했다”고 주장했다.';
    const transcript = [{...source, excerpt: quote}];
    const [row] = prepare(quote, transcript, []).rows;
    assert.throws(() => decide(row, decision, transcript));
    const record = decide(row, {...decision, status: 'attribution'}, transcript);
    const result = report(quote, transcript, [record]);
    assert.equal(result.confirmedCount, 0);
    assert.equal(result.attributedCount, 1);
  }
});

test('둘 중 한 절만 확인할 때 나머지와 원문을 보류 상태로 전달한다', () => {
  const line = '가 정당은 찬성했고 나 정당은 반대했다.';
  const [row] = prepare(line, sources, []).rows;
  const receipt = decide(row, {...decision, status: 'partial', factSpan: '가 정당은 찬성했고',
    reason: '나 정당의 표결표는 아직 확보하지 못했다.'}, sources);
  const result = report(line, sources, [receipt]);
  assert.equal(result.complete, false);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.confirmedCount, 0);
  assert.equal(result.partialCount, 1);
  assert.equal(result.rows[0].text, line);
  assert.ok(receipt.remainingSpans.join('').includes('나 정당은 반대했다'));
  for (const factSpan of [line, '원문에 없는 구절']) {
    assert.throws(() => decide(row, {...decision, status: 'partial', factSpan}, sources));
  }
});

test('공백·문단·소수점이 있는 기사의 모든 내용이 검토 행에 남는다', () => {
  const line = '표결 결과\r\n\r\n  찬성은 52.7%였다.\n“누구의 책임인가?”라고 물었다.  ';
  const result = prepare(line, [], []);
  assert.equal(result.article, line);
  let prior = 0;
  const spans = result.rows.flatMap(row => row.positions.map(p => ({...p, text: row.text})));
  for (const {start, end, text} of spans.sort((a, b) => a.start - b.start)) {
    assert.ok(start >= prior);
    assert.equal(line.slice(prior, start).trim(), '');
    assert.equal(line.slice(start, end), text);
    prior = end;
  }
  assert.equal(line.slice(prior).trim(), '');
  assert.ok(result.rows.some(row => row.text.includes('52.7%')));
});

test('연속된 동일 문장의 반복은 한 번 검토하고 원문의 두 위치를 모두 남긴다', () => {
  const repeated = article + ' ' + article;
  const first = prepare(repeated, sources, []);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].positions.length, 2);
  const receipt = decide(first.rows[0], decision, sources);
  const continued = report(repeated, sources, [receipt]);
  assert.equal(continued.pendingCount, 0);
  assert.equal(continued.confirmedCount, 1);
  assert.equal(continued.rows[0].positions.length, 2);
});

test('같은 항목에 상충하는 결정이 두 개 들어오면 마지막 항목을 임의 채택하지 않는다', () => {
  const [row] = prepare(article, sources, []).rows;
  const verified = decide(row, decision, sources);
  const conflict = decide(row, {...decision, status: 'contradicted', reason: '별도의 검토자는 이의를 제기했다.'}, sources);
  for (const records of [[verified, conflict], [conflict, verified]]) {
    assert.equal(report(article, sources, records).complete, false);
    assert.equal(report(article, sources, records).confirmedCount, 0);
  }
});

test('발언록은 뇌물 의혹의 사실 근거가 되지 않으며, 발언만 확인한 경우 계속 검토한다', () => {
  for (const text of ['가 정당은 “시장이 뇌물을 받았다”고 주장했다.', '나 정당에 의하면 시장이 돈을 빼돌렸다.']) {
    const src = [{...source, excerpt: text}];
    const [row] = prepare(text, src, []).rows;
    const said = {...decision, status: 'attribution'};
    assert.throws(() => decide(row, decision, src));
    assert.throws(() => decide(row, {...said, contentStatus: 'opinion', contentChecked: true, contentReason: '의견이라고 분류했다.'}, src));
    assert.throws(() => decide(row, {...said, contentStatus: 'supported', contentSourceIds: ['minutes'], contentChecked: true, contentReason: '같은 문서를 참조했다.'}, src));
    const result = report(text, src, [decide(row, said, src)]);
    assert.equal(result.complete, false);
    assert.equal(result.contentUnverifiedCount, 1);
    assert.equal(result.rows[0].needsReview, true);
    if (text.includes('뇌물')) assert.throws(() => decide(row, {...decision, status: 'partial', factSpan: '시장이 뇌물을 받았다'}, src));
  }
});

test('정책 비판과 확인 가능한 법적 절차는 보존하고, 부정어 삭제와 사실·평가 뒤바꾸기는 막는다', () => {
  const line = '시의회가 3억 원을 의결한 것은 무책임한 결정이다.';
  const [mixed] = prepare(line, sources, []).rows;
  const factSpan = '시의회가 3억 원을 의결한 것은', opinionSpan = '무책임한 결정이다.';
  const r = decide(mixed, {...decision, status: 'mixed', factSpan, opinionSpan}, sources);
  assert.equal(report(line, sources, [r]).mixedCount, 1);
  assert.throws(() => decide(mixed, {...decision, status: 'mixed', factSpan: opinionSpan, opinionSpan: factSpan}, sources));
  const [denial] = prepare('의회는 예산을 통과시키지 않았다.', sources, []).rows;
  assert.throws(() => decide(denial, {...decision, status: 'mixed', factSpan: '의회는 예산을 통과', opinionSpan: '시키지 않았다.'}, sources));
  for (const text of ['법원은 시장에게 횡령 혐의 무죄를 선고했다.', '의회는 「해솔 조례」를 가결했다.']) {
    assert.ok(prepare(text, sources, []).rows[0].allowedStatuses.includes('fact'));
  }
});

test('수치가 있는 미래 전망은 결과 확인으로 올리지 않고, 발언에 섞인 과거 사실을 의견으로 닫지 않는다', () => {
  const status = {status: 'attribution', contentStatus: 'opinion', contentChecked: true, contentReason: '내년의 전망을 확인했다.'};
  const refs = [source, {...source, id: 'forecast', url: 'https://stats.example/forecast', excerpt: '내년도 물가 전망치 5%'}];
  const text = '의원은 “내년 물가가 5% 오를 것”이라고 말했다.';
  const [row] = prepare(text, refs).rows;
  assert.equal(decide(row, {...decision, ...status}, refs).contentStatus, 'opinion');
  assert.throws(() => decide(row, {...decision, ...status, contentStatus: 'supported', contentSourceIds: ['forecast']}, refs));
  const [combined] = prepare('의원은 “지난달 물가는 2%였고 내년엔 5% 오를 것”이라고 말했다.', refs).rows;
  assert.throws(() => decide(combined, {...decision, ...status}, refs));
});

test('문서 식별 쿼리는 유지하며 전재·추적 주소·같은 발췌는 독립된 내용 근거에서 제외한다', () => {
  const text = '의원은 “예산이 늘었다”고 밝혔다.';
  const transcript = {...source, url: 'https://portal.example/view?docId=1', excerpt: '예산이 늘었다고 보았다.'};
  const audit = {...source, id: 'audit', url: 'https://portal.example/view?docId=2', excerpt: '결산표 · 예산 2억에서 3억으로 증가'};
  const status = {...decision, status: 'attribution', contentStatus: 'supported', contentSourceIds: ['audit'],
    contentChecked: true, contentReason: '해당 기간의 결산표와 대조했다.'};
  const check = second => {
    const refs = [transcript, second];
    const [row] = prepare(text, refs).rows;
    return decide(row, status, refs);
  };
  assert.equal(check(audit).contentStatus, 'supported');
  for (const changed of [{url: transcript.url + '&utm_source=news#p2'},
    {originUrl: transcript.url}, {excerpt: transcript.excerpt}]) assert.throws(() => check({...audit, ...changed}));
});

test('근거 목록만 확대하면 다시 확인할 초안을 유지하고 정정·문맥·참조 변경에는 자동 승인하지 않는다', () => {
  const [row] = prepare(article, sources).rows;
  const receipt = decide(row, decision, sources);
  const expanded = [...sources, {...source, id: 'correction', excerpt: '후속 회의록'}];
  const [reopened] = report(article, expanded, [receipt]).rows;
  assert.equal(reopened.status, 'pending');
  assert.equal(reopened.priorDecision.reason, receipt.reason);
  assert.equal(report(article, [{...source, version: '다른 판본'}], [receipt]).rows[0].priorDecision, null);
  const change = {...decision, status: 'contradicted', correction: '의회는 심의안을 보류했다.'};
  assert.throws(() => decide(row, change, sources));
  const corrected = decide(row, {...change, correctionChecked: true}, sources);
  assert.equal(report(article, sources, [corrected]).rows[0].receipt.correction, change.correction);
  assert.equal(report(article, sources, [corrected]).complete, false);
});

test('한 문장에 있는 기자의 독립 주장과 정치인의 인용은 각각 근거가 있어야 검토가 끝난다', () => {
  const text = '의회는 예산을 삭감했고 시장은 “무책임하다”고 말했다.';
  const refs = [{...source, excerpt: '무책임하다.'}];
  const [budget, speech] = prepare(text, refs).rows;
  assert.equal(budget.text, '의회는 예산을 삭감했고');
  assert.equal(speech.text, '시장은 “무책임하다”고 말했다.');
  const said = decide(speech, {...decision, status: 'attribution', contentStatus: 'opinion',
    contentChecked: true, contentReason: '시장이 내린 평가다.'}, refs);
  const result = report(text, refs, [said]);
  assert.equal(result.complete, false);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.confirmedCount, 0);
  assert.equal(result.rows[0].text + ' ' + result.rows[1].text, text);
  assert.equal(prepare('시장은 “의회는 예산을 삭감했고 주민은 반대했다”고 말했다.', refs).rows.length, 1);
});

test('닫는 따옴표가 빠져도 다음 줄의 독립 문장은 발언 행에 합쳐지지 않는다', () => {
  const text = '김 의원은 “시장이 예산을 숨겼다고 말했다.\n\n시 예산은 10억 원 늘었다.\n시장은 반박했다.';
  const rows = prepare(text, []).rows;
  assert.deepEqual(rows.map(row => row.text), ['김 의원은 “시장이 예산을 숨겼다고 말했다.', '시 예산은 10억 원 늘었다.', '시장은 반박했다.']);
  assert.ok(rows[1].allowedStatuses.includes('fact'));
  for (const row of rows) assert.equal(text.slice(row.positions[0].start, row.positions[0].end), row.text);
  assert.equal(prepare('시장은 “예산은 늘었다. 주민은 반대했다”고 말했다.', []).rows.length, 1);
});

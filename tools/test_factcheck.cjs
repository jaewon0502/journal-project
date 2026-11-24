const {test} = require('node:test');
const assert = require('node:assert/strict');
const {prepare, decide, report, sourceTarget} = require('../docs/reader/factcheck-engine.js');
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

test('정치·법률 용어와 기간에 붙은 조사 안의 글자는 사실 판정을 막지 않는다', () => {
  const factual = [
    '선관위는 정치적 중립 의무 위반 신고 5건을 접수했다.',
    '법원은 부당이득금 3억 원의 반환을 명령했다.',
    '올해 상반기만 접수 건수가 10건이었다.',
    '지난 분기만 접수 건수가 10건이었다.',
    '조사원은 시위대 12명을 면담했다.',
    '위원회는 실정법 2건을 검토했다.'
  ];
  for (const line of factual) {
    const refs = [{...source, excerpt:line}];
    const row = prepare(line, refs).rows[0];
    assert.equal(row.status, 'pending');
    assert.equal(report(line, refs, [decide(row, decision, refs)]).rows[0].status, 'fact', line);
  }
  for (const line of ['상반기만 3억 원을 투입한 사업은 시장의 치적이다.',
    '정치적 중립 위반 신고 5건을 묵살한 것은 기만이다.', '법원의 부당이득금 3억 원 반환 명령은 부당하다.',
    '기부금 3억 원을 받는 과정에서 대국민기만이 있었다.']) {
    const row = prepare(line, sources).rows[0];
    assert.ok(row.allowedStatuses.includes('mixed'), line);
    assert.throws(() => decide(row, decision, sources), /사실 범위/u, line);
  }
});

test('중립적 정치 용어가 있는 발언의 사실성을 별도 자료로 판단하고 종전의 잘못된 의견 처리를 다시 연다', () => {
  const line = '위원장은 “정치적 중립 서약서가 접수됐다”고 말했다.';
  const refs = [
    {id:'s', url:'https://assembly.example/minutes', version:'확정본', locator:'1문답', excerpt:'위원장에게 한 질문과 답변 전문.'},
    {id:'r', url:'https://council.example/report', version:'확정본', locator:'1행', excerpt:'담당 부서의 접수 현황이다.'}
  ];
  const row = prepare(line, refs).rows[0];
  const say = {status:'attribution', reason:'속기록의 화자를 확인했다.', sourceIds:['s'], acknowledged:true,
    contentChecked:true, contentReason:'발언의 범위를 확인했다.'};
  assert.throws(() => decide(row, {...say, contentStatus:'opinion'}, refs));
  for (const contentStatus of ['supported', 'contradicted']) {
    const saved = decide(row, {...say, contentStatus, contentSourceIds:['r']}, refs);
    assert.equal(report(line, refs, [saved]).rows[0].receipt.checksum, saved.checksum);
    assert.throws(() => decide(row, {...say, contentStatus, contentSourceIds:['s']}, refs), /다른 원자료/u);
  }
  // fd1e34f treated the last two syllables of 정치적 as the noun 치적.
  // Its previously accepted opinion receipt must now reopen for review.
  const oldOpinion = {...say, protocol:'journal-review/1', rowId:row.id, binding:row.binding, articleBinding:row.articleBinding,
    contentStatus:'opinion', recordedAt:'2026-11-25T00:00:00.000Z',
    references:'e8da7f10850bed786cafe9abd58a32829e937cccc111ba3e4b6388a1edc088d8',
    checksum:'48ec7326575f85dd59c14b5089678ee31fdfb6f064406aebb6a92e8a2a9f8769'};
  assert.equal(report(line, refs, [oldOpinion]).rows[0].status, 'pending');
  const oldSupport = {...oldOpinion, contentStatus:'supported', contentSourceIds:['r'],
    references:'9cf4c54753a6c80a138294070b2c925c1376bdd9e8febfcca82fab8629d4ed65',
    checksum:'4e28d0b58c7f6afef223661eb058d8dfc7717c3d918767ea44bdd92752d84c15'};
  assert.equal(report(line, refs, [oldSupport]).rows[0].receipt.checksum, oldSupport.checksum);
});

test('인용한 화자의 가치 판단에는 의견을, 법원이 내린 판단에 대한 보도에는 독립 자료를 쓸 수 있다', () => {
  const refs = [source, {...source, id:'court', url:'https://court.example/ruling', excerpt:'해고의 효력에 대한 재판부 판결문.'}];
  const attributed = {...decision, status:'attribution', contentChecked:true, contentReason:'속기록의 발언 범위를 확인했다.'};
  for (const quote of ['이 결정은 부당하다', '최대의 치적이다', '이 설명은 기만입니다', '무책임하다']) {
    const [row] = prepare('위원장은 “' + quote + '”라고 말했다.', refs).rows;
    assert.equal(decide(row, {...attributed, contentStatus:'opinion'}, refs).contentStatus, 'opinion');
    for (const contentStatus of ['supported', 'contradicted']) {
      assert.throws(() => decide(row, {...attributed, contentStatus, contentSourceIds:['court']}, refs), /가치 판단/, quote);
    }
  }
  const [row] = prepare('위원장은 “법원은 해고가 부당하다고 판결했다”고 말했다.', refs).rows;
  assert.throws(() => decide(row, {...attributed, contentStatus:'opinion'}, refs));
  assert.equal(decide(row, {...attributed, contentStatus:'supported', contentSourceIds:['court']}, refs).contentStatus, 'supported');
  const [action] = prepare('위원장은 “피고가 서류를 바꿔 피해자를 기만했다”고 말했다.', refs).rows;
  assert.equal(decide(action, {...attributed, contentStatus:'supported', contentSourceIds:['court']}, refs).contentStatus, 'supported');
  const [title] = prepare('위원장은 “치적”이라는 제목의 책 3권을 출간했다고 말했다.', refs).rows;
  assert.equal(decide(title, {...attributed, contentStatus:'supported', contentSourceIds:['court']}, refs).contentStatus, 'supported');
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

test('같은 뷰어의 문서 주소를 구분하고 페이지·서명·추적값이 다른 같은 문서는 독립 근거에서 제외한다', () => {
  const article = '의원은 “집행액은 20억 원이었다”고 말했다.';
  const base = 'https://archive.example/reader';
  function inspect(left, right, state) {
    const refs = [{...source, url:base + left, excerpt:article}, {...source, id:'audit', url:base + right, excerpt:'결산표에 같은 연도 지출은 10억 원이다.'}];
    const row = prepare(article, refs).rows[0];
    return decide(row, {...decision, status:'attribution', contentStatus:state, contentChecked:true,
      contentReason:'원자료에서 같은 기간의 같은 예산 항목을 대조했다.', contentSourceIds:['audit']}, refs);
  }
  for (const state of ['supported','contradicted']) {
    for (const route of ['#/docs/', '#!/docs/', '#!doc/', '#file=', '#docId=']) {
      assert.equal(inspect(route + 'A', route + 'B', state).contentStatus, state);
    }
    for (const [left, right] of [
      ['#/docs/A?zoom=90&token=1', '#!/docs/A?utm_source=archive#fig2'],
      ['#/reader?doc=A&page=1', '#/reader?zoom=120&doc=A'],
      ['#' + new URLSearchParams({file:'A', zoom:'100', access_token:'fixture'}), '#file=A&page=3'],
      ['?docId=A&signature=1#heading', '?utm_medium=view&docId=A&signature=2#summary:~:text=word'],
      ['#page=2', '#section-10'], ['#utm_source=view', '#chapter']
    ]) assert.throws(() => inspect(left, right, state), /다른 원자료/);
  }
});

test('서명과 열람 쪽이 바뀐 PDF는 직접 주소와 뷰어에서 같은 원자료로 대조한다', () => {
  const article = '의원은 “집행액은 20억 원이었다”고 말했다.';
  const judgment = {...decision, status:'attribution', contentStatus:'contradicted', contentChecked:true,
    contentReason:'같은 연도와 사업을 대조했다.', contentSourceIds:['audit']};
  const direct = (id, provider, token) => {
    const url = new URL('https://archive.example/minutes.pdf');
    url.searchParams.set('docId', id);
    for (const name of ['Algorithm','Credential','Date','Expires','SignedHeaders','Signature']) {
      url.searchParams.set('X-' + provider + '-' + name, name + '-' + token);
    }
    url.hash = 'page=' + token;
    return url.href;
  };
  const view = (file, where, extra = {}) => 'https://archive.example/reader' + where +
    new URLSearchParams({file, ...extra}).toString();
  function capture(left, right) {
    const refs = [{...source, url:left, excerpt:article}, {...source, id:'audit', url:right, excerpt:'같은 연도 집행액은 10억 원이다.'}];
    for (const ref of refs) assert.equal(sourceTarget(ref).href, ref.url, '열기 링크는 원래 서명과 쪽번호 유지');
    const saved = decide(prepare(article, refs).rows[0], judgment, refs);
    return report(article, refs, [saved]);
  }
  const original = direct('A','Amz',1), otherPage = direct('A','Goog',2), independent = direct('B','Goog',3);
  for (const [first, second] of [
    [original, otherPage], [original, view(otherPage, '?')], [view(original, '#'), view(otherPage, '?')],
    [view(original, '#', {page:'1'}), view(otherPage, '#', {page:'2'})],
    [view(view(original, '?'), '#'), view(view(otherPage, '#'), '?')],
    [view(original, '#/reader?', {edition:'spring'}), view(otherPage, '#/reader?', {edition:'spring'})]
  ]) assert.throws(() => capture(first, second), /다른 원자료/);
  assert.equal(capture(view(original, '?'), view(independent, '#')).contentContradictedCount, 1);
  assert.equal(capture(view(original, '?', {edition:'A'}), view(otherPage, '?', {edition:'B'})).contentContradictedCount, 1);
  assert.equal(capture(original, original.replace('docId=A','docId=A&versionId=new')).contentContradictedCount, 1);
});

test('이전 버전에서 같은 서명 PDF의 다른 쪽을 독립 반증으로 저장한 판정을 다시 연다', () => {
  const article = '의원은 “집행액은 20억 원이었다”고 말했다.';
  const refs = ['first', 'second'].map((token, i) => ({
    id:i ? 'audit' : 'minutes', url:'https://archive.example/minutes.pdf?docId=A&X-Amz-Signature=' + token + '#page=' + (i + 1),
    version:'확정본', locator:(i + 1) + '쪽', excerpt:i ? '같은 연도 지출은 10억 원이다.' : article
  }));
  // Captured with the previous engine, including its verified receipt checksum.
  const saved = {
    protocol:'journal-review/1', rowId:'unit-0',
    articleBinding:'a8958025b6999a121525ee48258a3b8b504278f65eb96835e1708bce1ddbdfdb',
    binding:'29e55df8a8981709fba7251e567b436586e88997b70fcf0f6206aca64bfd08a4',
    references:'f70d96ea33675aeecd503c5fd6c9105ab66e9e072e3ede9abc8d8468ec4e81ec',
    recordedAt:'2026-11-24T17:55:05.182Z', status:'attribution', sourceIds:['minutes'], reason:'회의 발언을 확인했다.',
    acknowledged:true, contentStatus:'contradicted', contentChecked:true, contentReason:'같은 사업과 회계연도를 대조했다.',
    contentSourceIds:['audit'], contentClaim:'집행액은 20억 원이었다',
    checksum:'d0eb4bd1348bd376c07b6eeac8ccd29846c80d9a00fc21d6a20fe83d51d4a5e9'
  };
  const [row] = report(article, refs, [saved]).rows;
  assert.equal(row.binding, saved.binding);
  assert.equal(row.status, 'pending');
  assert.equal(row.receipt, null);
  assert.equal(row.priorDecision, null);
});

test('전재 경로를 잇는 중간 자료가 들어오면 기존 내용 확인도 다시 연다', () => {
  const article = '대변인은 “예산이 늘었다”고 밝혔다.';
  const speech = {...source, id: 'speech', url: 'https://press.example/brief', excerpt: '대변인 발언 원문'};
  const copy = {...source, id: 'copy', url: 'https://news.example/story',
    originUrl: 'https://wire.example/dispatch?id=10', excerpt: '인상된 예산을 브리핑했다고 전했다.'};
  const wire = {...source, id: 'wire', url: 'https://wire.example/dispatch?id=10&utm_source=news',
    originUrl: speech.url + '#quote', excerpt: '보도 자료를 재인용한 통신 기사.'};
  const independent = {...source, id: 'audit', url: 'https://wire.example/dispatch?id=11', excerpt: '결산서의 연도별 예산표'};
  const judgment = {...decision, status: 'attribution', sourceIds: ['speech'], contentStatus: 'supported',
    contentSourceIds: ['copy'], contentReason: '실적과 대조했다.', contentChecked: true};
  const before = [speech, copy];
  const saved = decide(prepare(article, before).rows[0], judgment, before);
  for (const sources of [[wire, independent, ...before], [...before, independent, wire]]) {
    const [row] = report(article, sources, [saved]).rows;
    assert.equal(row.receipt, null);
    assert.equal(row.priorDecision, null, '같은 발언을 돌려 인용한 근거는 재승인 후보로도 쓰지 않는다');
    assert.throws(() => decide(row, judgment, sources), /다른 원자료/);
    assert.throws(() => decide(row, {...judgment, contentSourceIds: ['copy', 'audit']}, sources), /다른 원자료/);
    assert.equal(decide(row, {...judgment, contentSourceIds: ['audit']}, sources).contentStatus, 'supported');
  }
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

const transcript = [{id: 'minutes', title: '가상 회의록', url: 'https://council.example/minutes', version: '확정본', locator: '발언 1', excerpt: '무책임하다.'}];
const said = (row, extra = {}) => decide(row, {status: 'attribution', sourceIds: ['minutes'], acknowledged: true,
  reason: '회의록의 발언자와 발언을 대조했다.', contentStatus: 'opinion', contentChecked: true, contentReason: '발언자의 평가다.', ...extra}, transcript);

test('귀속이 정확한 인용 내용에 직접 반증이 있으면 두 결론과 각 근거를 보존한다', () => {
  const quote = '지난해 실제 집행액은 20억 원이었다';
  const reportLine = '위원장은 “' + quote + '”고 말했다.';
  const speech = {...source, id:'speech', url:'https://assembly.example/transcript', excerpt: reportLine};
  const audit = {...source, id:'audit', url:'https://audit.example/accounts', excerpt:'전년도 결산표, 실제 집행액 10억 원.'};
  const refs = [speech, audit];
  const say = {status:'attribution', sourceIds:['speech'], acknowledged:true, reason:'원발언의 화자와 인용을 대조했다.',
    contentStatus:'contradicted', contentReason:'같은 기간 결산표의 실제 집행액 10억 원은 발언의 20억 원과 양립할 수 없다.',
    contentChecked:true, contentSourceIds:['audit']};
  for (const line of [reportLine, '위원장은 ‘' + quote + '’라고 말했다.', "위원장은 '" + quote + "'라고 말했다.",
    '위원장은 지난해 실제 집행액이 20억 원이었다고 말했다.']) {
    const [row] = prepare(line, refs).rows, receipt = decide(row, say, refs);
    const restored = report(line, refs, [JSON.parse(JSON.stringify(receipt))]);
    assert.equal(receipt.contentClaim, line.includes(quote) ? quote : line);
    assert.deepEqual(restored.rows[0].receipt, receipt);
    assert.deepEqual([restored.attributedCount, restored.contentContradictedCount, restored.contradictedCount,
      restored.confirmedCount, restored.contentSupportedCount, restored.pendingCount], [1, 1, 0, 0, 0, 0]);
    for (const edit of [{acknowledged:false}, {contentChecked:false}, {contentSourceIds:['speech']},
      {sourceIds:[]}, {contentReason:''}, {contentSourceIds:[]}]) {
      assert.throws(() => decide(row, {...say, ...edit}, refs));
    }
    const connected = [...refs, {...audit, id:'bridge', url:speech.url, originUrl:audit.url}];
    assert.equal(report(line, connected, [receipt]).contentContradictedCount, 0);
    assert.throws(() => decide(prepare(line, connected).rows[0], say, connected), /다른 원자료/);
  }
  for (const text of ['위원장은 “내년 집행액이 두 배가 될 것”이라고 말했다.', '위원장은 “무책임하다”고 말했다.',
    '위원장은 ‘내년 물가는 5%일 것이다’라고 말했다.', '위원장은 “10억 원을 집행했고 30억 원을 새로 의결했다”고 말했다.',
    '위원장은 ‘집행액은 20억 원’이며 ‘참여자는 80명’이라고 말했다.', '위원장은 「예산안」을 폐기했다고 밝혔다.',
    '의원은 “집행액이 20억 원이었다”고 말한 적이 없다고 밝혔다.', '의원은 “집행액은 20억 원이었다”라고 말하지 않았다.',
    '의원은 “집행액은 20억 원이었나요?”라고 물었다.', '의원은 “집행액은 20억 원이었나요”라고 말했다.',
    '의원은 “내년에 예산을 20억 원으로 편성하겠다”고 말했다.', '의원은 “예산이 20억 원이면 공사를 시작하겠다”고 약속했다.',
    '의원은 “집행액은 20억 원, 참여자는 100명이었다”고 말했다.', '의원은 “예산은 20억 원에 참여자는 100명이었다”고 말했다.',
    '의원은 내년에 예산 20억 원을 마련하겠다고 밝혔다.']) {
    const [r] = prepare(text, refs).rows;
    assert.throws(() => decide(r, say, refs), undefined, text);
    assert.equal(decide(r, {...say, contentStatus:'unverified'}, refs).contentStatus, 'unverified', text);
  }
  // A negative statement about the amount is itself checkable. Its full scope
  // keeps the negation; decimal and thousands separators are not claim breaks.
  const negative = '실제 집행액은 1,230.5억 원이 아니었다';
  assert.equal(decide(prepare('의원은 “' + negative + '”고 말했다.', refs).rows[0], say, refs).contentClaim, negative);
  for (const text of ['의원은 “집행액이 20억 원이었다”고 말한 적이 없다고 밝혔다.', '의원은 “집행액은 20억 원이었다”라고 말하지 않았다.',
    '의원은 “집행액은 20억 원이었나요?”라고 물었다.', '의원은 “내년에 예산을 20억 원으로 편성하겠다”고 말했다.']) {
    assert.throws(() => decide(prepare(text, refs).rows[0], {...say, contentStatus:'supported'}, refs), /내용 미확인/, text);
  }
});

test('간접 인용 속 두 절은 나누지 않아 화자의 주장을 발언 기록만으로 사실 처리할 수 없다', () => {
  for (const text of ['김 의원은 시장이 예산을 은폐했고 의회가 이를 묵인했다고 주장했다.',
    "김 의원은 '시장이 예산을 은폐했고 의회가 이를 묵인했다'고 주장했다.",
    '야당은 시장이 3억 원을 횡령했고 측근이 이를 도왔다고 주장했다.']) {
    const rows = prepare(text, transcript).rows;
    assert.equal(rows.length, 1, text);
    assert.deepEqual(rows[0].allowedStatuses, ['attribution', 'partial', 'held', 'contradicted']);
    assert.throws(() => decide(rows[0], {...decision, sourceIds: ['minutes']}, transcript));
  }
});

test('반박 발언·금액 단문·구어체·이미 확정된 미래 기간의 예산은 같은 주장으로 지지와 반증을 모두 검토한다', () => {
  const articles = ['의원은 “지난해 집행액은 20억 원이었다”고 반박했다.', '의원은 “지난해 집행액은 20억 원”이라고 밝혔다.',
    '의원은 “지난해 집행액은 20억 원이었어요”라고 말했다.', '의원은 “내년 사업 예산은 이미 20억 원으로 확정됐다”고 밝혔다.'];
  const refs = [{id:'speech', url:'https://assembly.example/hearing', version:'1', locator:'1문답', excerpt:articles.join(' ')},
    {id:'other', url:'https://budget.example/ledger', version:'1', locator:'확정표', excerpt:'지난해 집행액과 내년도 의결 예산은 각각 10억 원이다.'}];
  const decision = {status:'attribution', sourceIds:['speech'], acknowledged:true, reason:'녹취의 화자와 발언을 확인했다.',
    contentChecked:true, contentReason:'발언 당시 결산·의결표에 같은 항목이 10억 원이다.', contentStatus:'contradicted', contentSourceIds:['other']};
  // Captured from 7a3cb04 for these exact sources and review texts, including
  // the entire affirmative quote. These legacy checksums must reopen unchanged.
  const oldChecksums = ['14afa3f927d8915edc8886931656ea0dcfef4497443ee54359a64cf2a8701597',
    '6d89077fdce208a5e866867cd5f18d50ec9529fbae017f205b36029eeb078f0c',
    '2264ec29b4cdc0e283210ab22d7a8b4b4bf962d0220d59c20c39a8c5df839727',
    'e224edce9d9dae1fab0066ac490ce0af3be1a6b7c5bafc29058447715982ad5d'];
  for (const [i, article] of articles.entries()) {
    const [row] = prepare(article, refs).rows;
    const contentClaim = article.match(/“(.+)”/u)[1];
    const old = {...decision, protocol:'journal-review/1', rowId:row.id, binding:row.binding, articleBinding:row.articleBinding,
      references:'7ab765cf5285bd25e2756259bfeee901283e2bf086d1328ac02622f116d2e4f3', recordedAt:'2026-11-23T00:00:00.000Z',
      contentClaim, checksum:oldChecksums[i]};
    const reopened = report(article, refs, [old]);
    assert.equal(reopened.contentContradictedCount, 1, article);
    assert.equal(reopened.rows[0].receipt.checksum, old.checksum);
    assert.equal(decide(row, decision, refs).contentClaim, contentClaim);
    const agreeing = [refs[0], {...refs[1], excerpt:'지난해 집행액과 내년도 의결 예산은 각각 20억 원이다.'}];
    const support = decide(prepare(article, agreeing).rows[0], {...decision, contentStatus:'supported',
      contentReason:'발언 당시 결산·의결표의 금액이 일치한다.'}, agreeing);
    assert.equal(report(article, agreeing, [support]).contentSupportedCount, 1, article);
  }
  for (const article of ['의원은 “집행액은 20억 원”은 아니라고 반박했다.', '의원은 “내년 실제 집행액은 20억 원”이라고 밝혔다.',
    '의원은 “내년 예산을 20억 원으로 확정하겠다”고 말했다.', '의원은 “지난해 집행액은 20억 원이었어요?”라고 물었다.',
    '의원은 “2024년 집행액은 20억 원이었을 것으로 추정된다”고 말했다.']) {
    const [row] = prepare(article, refs).rows;
    for (const contentStatus of ['supported', 'contradicted']) assert.throws(() => decide(row, {...decision, contentStatus}, refs), undefined, article);
    assert.equal(decide(row, {...decision, contentStatus:'unverified'}, refs).contentStatus, 'unverified');
  }
  for (const article of ['의원은 “집행액은 20억 원이 아니다”라고 반박했다.', '의원은 집행액이 20억 원은 아니라고 반박했다.']) {
    const actual = [{...refs[0], excerpt:article}, {...refs[1], excerpt:'당시 확정 결산표의 집행액은 20억 원이다.'}];
    const [row] = prepare(article, actual).rows;
    const saved = decide(row, {...decision, contentReason:'확정 결산표에 기재된 집행액은 20억 원이다.'}, actual);
    assert.match(saved.contentClaim, /아니/u, article);
    assert.equal(report(article, actual, [saved]).contentContradictedCount, 1);
  }
  const recorded = '의원은 “2024년 결산표에 집행액이 20억 원으로 기재돼 있다”고 설명했다.';
  const source = {...refs[1], excerpt:'2024년 확정 결산표의 집행액은 10억 원이다.'};
  const actual = [{...refs[0], excerpt:recorded}, source];
  assert.equal(decide(prepare(recorded, actual).rows[0], decision, actual).contentClaim, '2024년 결산표에 집행액이 20억 원으로 기재돼 있다');
});

test('따옴표 밖 서술에 사실이 있으면 발언을 의견으로 닫아도 그 사실을 확인한 것으로 세지 않는다', () => {
  // A connective before a direct quotation gives the narrator clause its own row.
  for (const text of ['의회는 지난달 예산 3억 원을 삭감했는데 시장은 “무책임하다”고 말했다.',
    '의회가 예산 3억 원을 삭감하자 시장은 “무책임하다”고 비판했다.',
    '의회가 지난달 예산 3억 원을 삭감한 뒤 시장은 “무책임하다”고 말했다.']) {
    const [narrator, speech] = prepare(text, transcript).rows;
    assert.ok(narrator.allowedStatuses.includes('fact'), text);
    assert.match(speech.text, /^시장은 “무책임하다”/);
    assert.equal(report(text, transcript, [said(speech)]).complete, false);
  }
  const embedded = '시장은 의회가 예산 3억 원을 삭감한 데 대해 “무책임하다”고 말했다.';
  const [row] = prepare(embedded, transcript).rows;
  assert.throws(() => said(row), /사실·의혹/);
  // The reporting verb and a date only frame the speech.
  for (const text of ['의원은 “무책임하다”라며 반대했다.', '김 의원은 3일 기자회견에서 “무책임하다”고 비판했다.']) {
    const [only] = prepare(text, transcript).rows;
    assert.equal(said(only).contentStatus, 'opinion', text);
  }
});

test('인용이 끝나며 문장도 끝나면 다음 서술 문장은 별도 행이 된다', () => {
  const text = '김 의원은 기자회견을 열었다. “이번 결정은 무책임하다.” 의회는 지난달 예산 3억 원을 삭감했다.';
  const rows = prepare(text, transcript).rows;
  assert.deepEqual(rows.map(r => r.text), ['김 의원은 기자회견을 열었다.', '“이번 결정은 무책임하다.”', '의회는 지난달 예산 3억 원을 삭감했다.']);
  assert.ok(rows[2].allowedStatuses.includes('fact'));
  assert.equal(prepare('그는 “괜찮다!” 라고 했다.', []).rows.length, 1);
  assert.equal(prepare('시장은 “괜찮다.”고 말했다. 의회는 예산을 삭감했다.', []).rows.length, 2);
  // A straight opening quote closed by a curly one still closes the quotation.
  assert.equal(prepare('시장은 "무책임하다”고 말했다. 의회는 예산 3억 원을 삭감했다.', []).rows.length, 2);
});

test('평가어를 덧붙여도 의혹 제기는 사실 구절로 바뀌지 않고, 따옴표 친 법안 이름은 발언이 아니다', () => {
  const [row] = prepare('시장이 3억 원을 횡령했다는 의혹이 제기된 것은 참담한 일이다.', transcript).rows;
  assert.deepEqual(row.allowedStatuses, ['attribution', 'partial', 'held', 'contradicted']);
  assert.ok(prepare('법원은 시장의 횡령 혐의에 무죄를 선고했다.', []).rows[0].allowedStatuses.includes('fact'));
  for (const text of ['국회는 “노란봉투법”을 가결했다.', '국회는 "노란봉투법"을 가결했다.']) {
    assert.ok(prepare(text, []).rows[0].allowedStatuses.includes('fact'), text);
  }
  for (const text of ['그는 “개혁”이라고 말했다.', '시장은 “무책임하다”고 말했다.', '단체는 “시장은 사퇴하라”는 성명을 냈다.']) {
    assert.deepEqual(prepare(text, []).rows[0].allowedStatuses, ['attribution', 'partial', 'held', 'contradicted'], text);
  }
});

test('발언자 뒤의 날짜는 발언 내용이 아니고, 모바일 주소는 같은 문서다', () => {
  const [row] = prepare('김 의원은 3일 시장의 결정이 무책임하다고 비판했다.', transcript).rows;
  assert.equal(said(row).contentStatus, 'opinion');
  const [cut] = prepare('김 의원은 시장이 예산 3억 원을 삭감했다고 비판했다.', transcript).rows;
  assert.throws(() => said(cut));
  const refs = [{id: 'web', title: '연설', url: 'https://www.news.example/view/1', version: '1', locator: '1문단', excerpt: '예산을 삭감했다.'},
    {id: 'mobile', title: '연설 모바일', url: 'https://m.news.example/view/1', version: '1', locator: '1문단', excerpt: '예산 삭감 기록'}];
  const [speech] = prepare('김 의원은 시장이 예산을 삭감했다고 말했다.', refs).rows;
  assert.throws(() => decide(speech, {status: 'attribution', sourceIds: ['web'], acknowledged: true, reason: '발언 대조',
    contentStatus: 'supported', contentChecked: true, contentReason: '내용 대조', contentSourceIds: ['mobile']}, refs), /다른 원자료/);
});

test('대조 후보는 조사가 붙은 낱말도 같은 낱말로 찾는다', () => {
  const refs = [{id: 'plan', title: '집행 계획', url: 'https://city.example/plan', version: '1', locator: '표 1', excerpt: '주거 예산 집행 실적'}];
  for (const text of ['시는 주거 예산으로 집행했다.', '시는 주거 예산에서는 줄였다.', '시는 주거 예산에는 손대지 않았다.']) {
    assert.match(prepare(text, refs).rows[0].sourceMatches[0].reason, /예산/, text);
  }
});

const rowTexts = text => prepare(text, transcript).rows.map(r => r.text);
const opinionClosed = text => { const rows = prepare(text, transcript).rows; try { said(rows.at(-1)); return true; } catch { return false; } };

test('반박 인용이 붙어도 간접 인용 속 의혹은 사실 행으로 떨어지지 않는다', () => {
  for (const text of ['야당은 시장이 3억 원을 횡령했고 측근이 이를 도왔다고 주장했지만 시장은 “사실무근”이라고 반박했다.',
    '김 의원은 시장이 예산을 은폐했고 의회가 이를 묵인했다고 주장했고, 시장은 “사실무근”이라고 반박했다.',
    '김 의원은 시장은 예산을 은폐했고 의회는 이를 묵인했다고 주장했다.']) {
    const rows = prepare(text, transcript).rows;
    assert.ok(rows.every(row => !row.allowedStatuses.includes('fact')), text);
  }
});

test('서술 사실과 다른 화자의 발언은 나누고, 한 화자의 문장은 쪼개지 않는다', () => {
  for (const text of ['시의회는 예산 3억 원을 삭감했고 시장은 이에 유감이라고 밝혔다.', '정부는 지원금을 30% 인상했지만 야당은 부족하다고 지적했다.',
    '시는 예산 3억 원을 집행했으나 의회는 절차가 부당했다고 주장했다.', '의회는 예산 3억 원을 삭감했고 시장은 ‘무책임하다’고 말했다.']) {
    const rows = prepare(text, transcript).rows;
    assert.equal(rows.length, 2, text);
    assert.ok(rows[0].allowedStatuses.includes('fact'), text);
  }
  for (const text of ['김 의원은 예산이 삭감되자 지역 주민들이 피해를 입게 됐다며 “대책이 필요하다”고 말했다.',
    '김 의원은 시장과 면담한 뒤 취재진이 묻자 “사퇴는 없다”고 답했다.', '김 의원은 어제 시장과 통화했는데 시장이 “사과하겠다”고 말했다고 전했다.',
    '경찰은 압수수색을 한 뒤 김 의원이 “정치 탄압”이라고 반발했다고 밝혔다.', '시공사는 하자 보수 기간이 끝났다며 “책임이 없다”고 밝혔다.',
    '입주민들은 아파트 하자 보수 업체가 “책임을 피한다”고 주장했다.']) {
    assert.equal(rowTexts(text).length, 1, text);
  }
});

test('인용 뒤에 화자만 밝히는 문장과 인용에 붙은 말은 인용과 한 행으로 남는다', () => {
  for (const text of ['“이번 결정은 무책임하다.” 김 의원은 3일 기자회견에서 이같이 말했다.', '“이번 결정은 무책임하다.” 김 의원의 말이다.',
    '“이게 맞습니까?” 김 의원이 물었다.', '김 의원은 “이번 결정은 무책임하다!” 하며 목소리를 높였다.',
    '시민들 사이에서는 “이게 맞나?” 하는 의문이 나온다.', '참가자들은 “예산 삭감 철회하라!” “시장은 사퇴하라!” 등의 구호를 외쳤다.']) {
    assert.equal(rowTexts(text).length, 1, text);
  }
  assert.ok(opinionClosed('“이번 결정은 무책임하다.” 김 의원은 3일 기자회견에서 이같이 말했다.'));
});

test('발언 꼬리의 입장 동사는 사실이 아니지만, 따옴표 밖 사건과 기간은 사실로 남는다', () => {
  for (const text of ['김 의원은 “무책임한 정책”이라며 예산안 처리에 반대했다.', '김 의원은 “졸속 행정”이라며 시의 계획에 강하게 반대했다.']) {
    assert.ok(opinionClosed(text), text);
  }
  for (const text of ['시장은 “무책임하다”는 비판을 의식하며 예산을 삭감했다.', '시장은 “무책임하다”는 비판을 받고 예산을 삭감했다.',
    '김 의원은 3일 만에 입장을 바꿔 시장의 결정이 무책임하다고 비판했다.', '김 의원은 10일 넘게 침묵하다가 시장의 결정이 무책임하다고 비판했다.']) {
    assert.equal(opinionClosed(text), false, text);
  }
});

test('평가·수치·사건·의혹을 담은 인용은 이름이 아니라 발언으로 남는다', () => {
  for (const text of ['야당은 “포퓰리즘 정책”을 문제 삼았다.', '여당 의원들의 “무책임한 졸속 처리”가 도마에 올랐다.',
    '김 의원의 “예산 삭감은 부당”이 논란이 됐다.', '야당은 “10조 원 퍼주기”를 문제 삼았다.', '김 의원은 “시장의 3억 원 횡령”을 거론했다.']) {
    assert.equal(prepare(text, transcript).rows[0].allowedStatuses[0], 'attribution', text);
  }
});

test('수사기관 발표로 전하는 문장은 통째로 남아 뒤쪽 절도 사실로 닫을 수 없다', () => {
  for (const text of ['검찰에 따르면 시장은 업자에게 3억 원을 받았는데 측근이 이를 전달했다.', '공소장에 따르면 시장은 업자에게 3억 원을 요구한 뒤 측근이 이를 전달받았다.',
    '시장은 업자에게 3억 원을 받았고, 측근은 이를 차명계좌로 옮겼다고 검찰은 밝혔다.', '김씨는 3일 오후 시청에 침입했고, 직원들이 이를 제지하자 흉기를 휘둘렀다고 경찰은 밝혔다.',
    '시장은 “사과하겠다”고 말한 뒤 의원들이 반발하자 “오해”라고 해명했다.']) {
    const rows = prepare(text, transcript).rows;
    assert.equal(rows.length, 1, text);
    assert.ok(!rows[0].allowedStatuses.includes('fact'), text);
  }
});

test('과거형 연결어와 수식어가 있어도 서술 사실과 발언을 나누고, 인용 뒤 화자 문장은 붙여 둔다', () => {
  for (const text of ['같은 날 의회는 예산 3억 원을 삭감했고 시장은 “무책임하다”고 말했다.', '의회는 예산 3억 원을 추가 삭감했고 시장은 “무책임하다”고 말했다.',
    '의회는 예산 3억 원을 삭감했고 시장이 “무책임하다”고 반발했다.', '국회는 노란봉투법을 통과시켰고 야당은 “날치기 처리”라고 반발했다.',
    '국회는 내년부터 시행되는 종부세 개편안을 의결했고 야당은 “부자 감세”라고 비판했다.']) {
    const rows = prepare(text, transcript).rows;
    assert.equal(rows.length, 2, text);
    assert.ok(rows[0].allowedStatuses.includes('fact'), text);
  }
  for (const text of ['“예산 삭감은 부당합니다.” 김 의원은 3일 SNS에 이 같은 글을 올렸다.', '“예산 삭감은 부당합니다.” 김 의원이 3일 기자회견에서 한 말이다.', '그는 “왜 안 되나?” 물었다.']) {
    assert.equal(rowTexts(text).length, 1, text);
  }
  for (const text of ['“등록금 동결은 불가능하다.” 등록금은 올해 5% 인상됐다.', '“예산을 반드시 지키겠다.” 하지만 예산은 결국 그렇게 삭감됐다.',
    '“예산을 지키겠다.” 하는 수 없이 의회는 예산 3억 원을 삭감했다.']) {
    const rows = prepare(text, transcript).rows;
    assert.equal(rows.length, 2, text);
    assert.ok(rows[1].allowedStatuses.includes('fact'), text);
  }
  assert.ok(prepare('“노란봉투법”은 지난달 국회를 통과했다.', []).rows[0].allowedStatuses.includes('fact'));
});

test('PDF 파일 순번만 연결하고 인쇄 쪽·웹 문서·모의 출처를 구별한다', () => {
  const src = {id:'s',title:'예산안',url:'https://office.example/download.do?fid=87#old',locator:'인쇄 16쪽, 표 2, 전국 2023년 행',
    excerpt:'확정 총액',version:'2025년도'};
  assert.equal(sourceTarget(src).page,null);
  const exact = sourceTarget({...src,pdfPage:'34'});
  assert.equal(exact.page,'34'); assert.equal(exact.href,'https://office.example/download.do?fid=87#page=34');
  assert.deepEqual(sourceTarget({...src,url:'https://office.example/note.html#table-9'}),
    {page:null,href:'https://office.example/note.html#table-9'});
  const pdf = {...src,url:'https://office.example/BUDGET.PDF?rev=1#page=9&zoom=125'};
  assert.equal(sourceTarget(pdf).page,'9');
  assert.equal(sourceTarget({...pdf,pdfPage:'34'}).href,'https://office.example/BUDGET.PDF?rev=1#page=34&zoom=125');
  assert.equal(sourceTarget({...pdf,url:'https://office.example/BUDGET.PDF#nameddest=table2&page=4'}).page,null);
  assert.equal(sourceTarget({...src,url:'https://example.invalid/report.pdf',pdfPage:'2'}),null);
  assert.equal(sourceTarget({...src,originUrl:'https://stage.invalid/demo'}),null);
  for (const value of ['0','2.5','+7','4-5','NaN','9007199254740992',{},2])
    assert.throws(() => prepare('확정했다.',[{...src,pdfPage:value}]),/쪽번호/);
  assert.throws(() => prepare('확정했다.',[{...src,url:'https://office.example/report.xlsx',pdfPage:'34'}]),/PDF 파일/);
});

function compareSources(claim, packets) {
  const refs = packets.map(([id, title, version, locator, excerpt]) =>
    ({id, title, version, locator, excerpt, url: 'https://records.example/' + id}));
  const [row] = prepare(claim, refs).rows;
  assert.equal(row.status, 'pending');
  assert.equal(row.receipt, null);
  return row.sourceMatches.map(match => match.id);
}

test('예정 물량과 실제 처리 물량은 같은 사업이라도 다른 기록을 먼저 제시한다', () => {
  const refs = [
    ['a', '매화항 준설 계획', '확정본', '준설 예정 물량', '매화항 준설 물량은 18만 톤으로 계획했다.'],
    ['b', '매화항 준설 결과', '검수본', '검수 수량', '매화항에서 준설한 실제 물량은 12만 톤이었다.']
  ];
  assert.equal(compareSources('매화항의 준설 계획에 담긴 예정 물량은 18만 톤이었다.', refs)[0], 'a');
  assert.equal(compareSources('매화항의 실제 준설 물량은 18만 톤이었다.', refs)[0], 'b');
});

test('같은 제목이어도 질문과 다른 대상이나 다른 연도의 확정본이 앞서지 않는다', () => {
  const refs = [
    ['a', '적송구 관측 결과', '초안', '2023년 조도', '적송구 야간 조도 조사에서 2023년에는 7럭스를 관측했다.'],
    ['b', '적송구 관측 결과', '최종', '2022년 조도', '적송구 야간 조도 조사에서 2022년에 관측한 평균은 12럭스였다.'],
    ['c', '단풍구 관측 결과', '최종', '2023년 조도', '단풍구 야간 조도 조사에서 2023년에 관측한 평균은 12럭스였다.']
  ];
  assert.equal(compareSources('2023년 적송구의 야간 조도 조사에서 관측한 평균은 12럭스였다.', refs)[0], 'a');
});

test('요구 단계 문서와 배정 단계 문서의 수치 차이는 자료 우선순위와 판정을 구분한다', () => {
  const refs = [
    ['a', '장비 구매 요구서', '초안', '요구액', '검사 장비 구매 요구액은 62억 원이다.'],
    ['b', '장비 구매 배정표', '확정본', '구매비', '올해 확정된 검사 장비 구매비는 49억 원이다.']
  ];
  assert.equal(compareSources('검사 장비 구매를 위해 요구한 예산은 62억 원이다.', refs)[0], 'a');
  assert.equal(compareSources('확정된 검사 장비 구매 예산은 62억 원이다.', refs)[0], 'b');
});

test('같은 제목·위치라도 명시한 판본과 분기를 따라가며 발행 연도를 적용 기간으로 읽지 않는다', () => {
  const refs = [
    ['a', '급수량 집계표', '2025년 발행 잠정본', '표 3', '2024년 2분기 급수량은 15만 톤이었다.'],
    ['b', '급수량 집계표', '2025년 발행 확정본', '표 3', '2024년 2분기에 실제 집계된 급수량은 10만 톤이었다.'],
    ['c', '급수량 집계표', '2024년 확정본', '표 3', '2024년 1분기 급수량은 15만 톤이었다.']
  ];
  assert.equal(compareSources('2024년 2분기 급수량 잠정 집계는 15만 톤이었다.', refs)[0], 'a');
  assert.equal(compareSources('2024년 2분기 급수량 확정 집계는 15만 톤이었다.', refs)[0], 'b');
});

test('발언의 원문을 찾는 행에서는 같은 문구를 되풀이한 사업 안내와 원발언을 구별한다', () => {
  const refs = [
    ['a', '사업 안내', '최종본', '공급량 결과', '농업용수 공급량이 절반으로 줄었다. 농업용수 사업에 관한 설명이다.'],
    ['b', '간담회 녹취록', '속기본', '답변 2', '담당자 발언 원문. 농업용수 공급량이 절반으로 줄었다.']
  ];
  assert.equal(compareSources('담당자는 “농업용수 공급량이 절반으로 줄었다”고 밝혔다.', refs)[0], 'b');
});

test('서로 다른 시설을 다룬 자료의 확정 표기나 같은 숫자로 해당 시설의 초안이 밀리지 않는다', () => {
  const refs = [
    ['a', '청명터널 배수 설비', '초안', '사업비', '청명터널의 배수 설비 예산은 8억 원으로 제출했다.'],
    ['b', '석류터널 배수 설비', '확정본', '사업비', '석류터널의 배수 설비 확정 예산은 5억 원이었다.']
  ];
  assert.equal(compareSources('청명터널의 배수 설비 확정 예산은 5억 원이었다.', refs)[0], 'a');
});

test('고정 표현인 자료·연도만 겹치면 후보 표시를 생략하고 기간 중간 해를 범위 밖으로 밀지 않는다', () => {
  const refs = [
    ['a', '동물 구조 내역', '점검본', '구조 현황', '2022년부터 2024년까지 산양 구조 자료이며 개체 수를 따로 집계했다.'],
    ['b', '항만 공사 실적', '확정본', '표 2', '2023년 자료를 토대로 올해 준설 깊이를 확정했다.']
  ];
  assert.deepEqual(compareSources('2023년 산양 구조 자료의 개체 수를 집계했다.', refs), ['a']);
});

test('자료에 등장하는 두 기준을 명시해 비교하면 특정 판본을 일괄 우대하지 않는다', () => {
  const refs = [
    ['a', '잠정 확정치 비교표', '작업본', '정정 이력', '용수량 집계의 잠정치와 확정치를 비교해 차이가 난 이유를 정리했다.'],
    ['b', '정오표', '확정본', '변경 사항', '최종 수치 한 건을 공고했다. 당시 잠정치는 제공하지 않는다.']
  ];
  assert.equal(compareSources('용수량 집계의 잠정치와 확정치를 비교했다.', refs)[0], 'a');
});

function candidateRow(claim, excerpts) {
  const records = excerpts.map((excerpt, i) => ({...source, id: 'x' + i, title:'배관 교체 기록',
    locator:'공사 이력', excerpt, url:'https://archive.example/pipe/' + i}));
  return prepare(claim, records).rows[0];
}

test('공사 자체에만 겹치는 후보는 유지하되 후속 결과의 측정값이 없으면 확인할 지표를 알린다', () => {
  const q = '배관 교체 이후 월간 누수량은 전년보다 절반 줄었다.';
  const notes = ['배관 교체 계획은 길이 2km였다.', '공사 완료 후 실제 교체한 배관은 1.8km다.'];
  const r = candidateRow(q, notes);
  assert.match(r.sourceCaution, /누수량/);
  assert.ok(r.sourceIds.length);
  assert.deepEqual(r.sourceIds, r.sourceMatches.map(x => x.id));
  assert.equal(r.status, 'pending');
  assert.equal(r.receipt, null);
  for (const measurement of ['월간 누수량은 같은 기간에 증가했다.', '월간 누수량은 측정할 수 없었다.', '누수량은 전년과 동일하다.']) {
    assert.equal(candidateRow(q, [...notes, measurement]).sourceCaution, null);
  }
});

test('시점을 모른다는 문장만 보류하고 이미 확정한 시점, 다른 불확실성, 발언의 귀속은 보존한다', () => {
  const refs = ['배관 교체 수량은 계획과 분기 말 검수 결과가 서로 다르다.'];
  for (const q of ['배관 교체 수량의 기준 시점은 불분명하다.', '배관 교체 수량이 어느 기간 기준인지 알 수 없다.']) {
    assert.match(candidateRow(q, refs).sourceCaution, /시점|기간/);
  }
  for (const q of ['배관 교체 시점은 5월로 분명하다.', '배관 교체 시점은 당초 불분명했지만 5월로 확인됐다.',
      '배관 교체 시점은 분명하지만 지출 경로는 불분명하다.', '조합장은 “배관 교체 시점은 불분명하다”고 밝혔다.']) {
    assert.equal(candidateRow(q, refs).sourceCaution, null, q);
  }
});

test('한 보고서의 예산 편성표와 집행 실적표는 해당 표의 위치와 발췌를 기준으로 구별한다', () => {
  const packets = [
    ['b', '회계감사팀 · 수리시설 예산안 분석', '발간본', '수리시설 특별회계 집행 실적', '특별회계 수리시설 예산과 실제 지출액을 비교했다.'],
    ['a', '회계감사팀 · 수리시설 예산안 분석', '발간본', '수리시설 예산안 · 전년 예산 대비 증감률', '수리시설 편성액과 전년 예산의 차이는 7.4%다.']
  ];
  assert.equal(compareSources('제출안의 특별회계 수리시설 예산은 지난 회계연도보다 7.4% 많았다.', packets)[0], 'a');
  assert.equal(compareSources('특별회계 수리시설 예산의 실제 집행액은 전년보다 적었다.', packets)[0], 'b');
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {lookup} = require('../docs/reader/evidence-transcript.js');
const {search} = require('../docs/reader/evidence-search.js');

const claim = '김도현 장관은 “청년수당을 전면 중단하겠다”고 말했다.';
const question = '◯박서윤 위원  김도현 장관님, “청년수당을 전면 중단하겠다”고 말씀하셨습니까?';
const answer = '◯김도현 장관  그런 뜻이 아닙니다. 소득 기준을 초과한 신청자에 한해 지급을 보류합니다.';
const next = '◯위원장 이정수  다음 질의를 받겠습니다.';

test('질문에서 인용문을 되풀이해도 대상 화자의 실제 답변과 직전 질문을 구분한다', () => {
  const {passages, notice} = lookup([question, answer, next].join('\n'), claim);
  assert.equal(passages.length, 1);
  const [p] = passages;
  assert.equal(p.paragraph, 2);
  assert.equal(p.text, answer);
  assert.deepEqual(p.speaker, {label:'김도현 장관', paragraph:2, text:answer, match:'adjacent-reply', exactQuote:false, excerpt:answer});
  assert.deepEqual(p.context, [{paragraph:1, text:question}]);
  assert.match(notice, /발언 위치/);
});

test('역순 직함을 확인하고 다른 국장의 재인용은 직전 문맥에 남긴다', () => {
  const q = '교육국장 강민호는 “방과후 교실을 전면 폐쇄하겠다”고 말했다.';
  const source = ['○위원장 신영희  안건을 상정합니다.',
    '○복지국장 이유진  교육국장께서 “방과후 교실을 전면 폐쇄하겠다”고 말씀하셨습니다.',
    '○교육국장 강민호  아닙니다. 공사 중인 두 교실만 한 달간 닫습니다.', next];
  const [p] = lookup(source.join('\r\n'), q).passages;
  assert.equal(p.paragraph,3);
  assert.equal(p.speaker.label,'교육국장 강민호');
  assert.deepEqual(p.context.map(r => r.paragraph),[2]);
  assert.equal(p.speaker.excerpt,source[2]);
});

test('화자 표지부터 선택된 본문 줄까지 빈 줄·들여쓰기·구두점을 보존하고 다른 주제의 발언을 건너뛴다', () => {
  const source = [question,'◯김도현 장관: 공사 예산은 다음 달 심의합니다.',next,'◯김도현 장관:','  보고드리겠습니다.','','  청년수당을 전면 중단하겠다는 주장은 사실과 다릅니다.','  신청 소득 기준만 조정합니다.'];
  const {passages} = lookup(source.join('\r\n'),claim);
  assert.deepEqual(passages.map(p => p.paragraph),[6]);
  assert.deepEqual(passages[0].speaker, {label:'김도현 장관',paragraph:4,text:source[3],match:'same-turn',exactQuote:true,excerpt:source.slice(3,7).join('\n')});
  assert.deepEqual(passages[0].context.map(r=>r.paragraph), [4,5,7]);
});

test('관련 구절이 여러 화자 차례에 있으면 각 발언을 반환한다', () => {
  const direct = '◯장관 김도현  청년수당을 전면 중단하겠다고 말한 적이 없습니다.';
  const source = [question, answer, next, direct];
  assert.deepEqual(lookup(source.join('\n'),claim).passages.map(p => p.paragraph),[4,2]);
});

test('페이지·중간 화자·알 수 없는 발언 표지·정회·새 안건·표를 넘어 질문에 대답했다고 연결하지 않는다', () => {
  for (const boundary of ['\f','(15시 10분 정회)','의사일정 제2항을 상정합니다.','2. 다른 안건',
    '◯조정자  다시 정리하겠습니다.',next,'부서\t담당자']) {
    assert.deepEqual(lookup([question,boundary,answer,next].join('\n'),claim).passages,[],boundary);
  }
  const source = [question, '계속해서 전혀 다른 예산 이야기를 드리겠습니다.', answer, next];
  assert.deepEqual(lookup(source.join('\n'),claim).passages,[]);
});

test('다른 사람·인용 안 호칭·서로 다른 직책·불분명한 주제는 대상 발언을 만들어내지 않는다', () => {
  for (const lines of [
    [question.replace('김도현 장관님','최수현 장관님'),answer,next],
    ['◯박서윤 위원  “김도현 장관님, 청년수당을 전면 중단하겠다”고 읽었습니다.',answer,next],
    [question,answer.replace('김도현 장관','김도현 의원'),next],
    [question.replace('김도현 장관님','장관님'),answer,'◯최수현 장관  다음 답변입니다.'],
    [question,answer.replace('그런 뜻이 아닙니다.','지역 의료 예산은 충분합니다.'),next],
    [next,answer,next],
  ]) assert.deepEqual(lookup(lines.join('\n'),claim).passages,[],lines.join('\n'));
});

test('일반 서술문·표·다른 사람의 말을 인용한 조사문 등은 일반 검색에 맡긴다', () => {
  for (const source of ['김도현 장관의 기자회견.\n청년수당을 전면 중단하겠다.','성명\t직책\n김도현\t장관'])
    assert.equal(lookup(source,claim),null);
  for (const query of ['청년수당을 전면 중단한다.', '박서윤 위원은 “김도현 장관은 ‘청년수당을 전면 중단하겠다’고 말했다”고 설명했다.',
    '김도현 장관은 “청년수당을 전면 중단하겠다”고 말했다는 주장이 있다.'])
    assert.equal(lookup([question,answer].join('\n'),query),null);
});

test('대상 화자 한 명만 발췌한 회의록에서도 직접 발언과 타인이 되풀이한 인용을 구분한다', () => {
  const line = '○김도현 장관  청년수당을 전면 중단하겠다는 설명은 잘못됐습니다.';
  assert.equal(lookup(line,claim).passages[0].speaker.excerpt,line);
  assert.deepEqual(lookup(question,claim).passages,[]);
  assert.equal(lookup('○ 물가 자료\n○ 지출 계획\n○ 청년수당을 전면 중단하겠다.',claim),null);
});

test('호칭 없는 질문의 핵심 명사를 다음 발언자가 명시적으로 부정하면 당사자 답변으로 찾아간다', () => {
  const lines = ['○오지영 위원  어제 그 동네에서 휴업 통보가 있었습니까?', '○교육국장 김경우  휴업이 아니고 개교일 조정이었습니다.'];
  const q = '김경우 교육국장은 “어제 그 동네에서 휴업 통보가 있었습니까?”라고 말했다.';
  const [p] = lookup(lines.join('\n'),q).passages;
  assert.equal(p.paragraph,2);
  assert.equal(p.speaker.match,'adjacent-reply');
  assert.equal(p.context[0].text,lines[0]);
  for (const changed of [
    [lines[0],lines[1].replace('휴업이','휴가가')],
    [lines[0].replace('어제','조은별 시장님, 어제'),lines[1]],
    [lines[0],next,lines[1]],
    [lines[0].replace('있었습니까?','있었습니다.'),lines[1]],
  ]) assert.deepEqual(lookup(changed.join('\n'),q).passages,[],changed.join('\n'));
});

test('짧은 기사 주제구의 근거가 있는 질의·응답만 인용 위치로 안내한다', () => {
  const q = '정은영 국장은 버스 요금에 관해 “시범 기간 동안 따로 계산합니다”라고 답했다.';
  const source = ['○김서연 위원  버스하고 지하철의 요금을 하나로 계산하는 겁니까?', '○국장 정은영  아닙니다. 시범 기간 동안 따로 계산합니다.'];
  const [p] = lookup(source.join('\n'),q).passages;
  assert.equal(p.speaker.match,'same-turn');
  assert.equal(p.context[0].text,source[0]);
  assert.deepEqual(lookup(source.join('\n'),q.replace('버스','항공')).passages,[]);
  for (const framing of ['시장이 버스 요금','김영수가 버스 요금','김영수 위원은 버스 요금'])
    assert.equal(lookup(source.join('\n'),q.replace('버스 요금',framing)),null);
});

test('지원하지 않는 화자 표지 또는 한 줄 중간에서 페이지가 넘어가면 앞 화자의 발언으로 인용하지 않는다', () => {
  const attribution = '○김도현 장관  다른 주제를 설명하겠습니다.';
  for (const change of ['●박서윤 위원','진행자: 아래 자료를 봐주세요.','다음 안건은 이렇습니다.','텍스트\f새 페이지']) {
    const source = [attribution,change,'  청년수당을 전면 중단하겠다.'];
    assert.deepEqual(lookup(source.join('\n'),claim).passages,[],change);
  }
});

test('한 줄에 두 화자가 섞이거나 콜론으로 화자가 바뀌면 원래 화자의 발언으로 저장하지 않는다', () => {
  const second = '청년수당을 전면 중단하겠다.';
  for (const source of [
    ['○김도현 장관 답변은 이렇습니다. ◯박서윤 위원 ' + second],
    ['○김도현 장관 답변은 이렇습니다.', '다음입니다. ○박서윤 위원 ' + second],
    ['○김도현 장관 답변은 이렇습니다.', '박서윤 위원: ' + second],
    ['○김도현 장관 답변은 이렇습니다.', '위원 박서윤：' + second],
    ['○김도현 장관 답변은 이렇습니다.','위원 박서윤:','  ' + second],
  ]) assert.deepEqual(lookup(source.join('\n'),claim).passages,[],source.join('\n'));
});

test('PDF 인용이 세 줄에 걸치면 해당 화자 표지부터 인용 끝 문단까지 그대로 남긴다', () => {
  const q = '윤지혜 시장은 “연령별 이용자 분포를 확인하고 성인과 아동의 표본을 별도로 보고해야 합니다”라고 답했다.';
  const source = ['○고은정 의원  이용자별 결과를 어떻게 확인합니까?', '○윤지혜 시장  네. 연령별 이용자 분포를',
    '', '   확인하고 성인과 아동의 표본을', '  별도로 보고해야 합니다.','내일 자료를 보내겠습니다.'];
  const [p] = lookup(source.join('\r\n'),q).passages;
  assert.equal(p.paragraph,4);
  assert.equal(p.text,source[4]);
  assert.equal(p.speaker.match,'same-turn');
  assert.equal(p.speaker.excerpt,source.slice(1,5).join('\n'));
  for (const boundary of ['○고은정 의원 다음 발언입니다.', '(산회)', '위원 고은정:', '○다른 발언자']) {
    const interrupted = [...source.slice(0,4),boundary,...source.slice(4)];
    for (const item of lookup(interrupted.join('\n'),q).passages)
      assert.ok(!item.speaker.excerpt.includes('별도로 보고'),boundary);
  }
});

test('같은 화자의 정확한 인용을 먼저 놓고 같은 수준에 속한 발언끼리는 문서 순서를 지킨다', () => {
  const q = '김도현 장관은 “청년수당 지급 시점을 내달로 미루겠습니다”고 말했다.';
  const related = '◯김도현 장관  청년수당 지급 계획을 점검하겠습니다.';
  const exact = '◯김도현 장관  청년수당 지급 시점을 내달로 미루겠습니다.';
  const secondRelated = '◯김도현 장관  청년수당 지급 시점은 위원회에서 논의했습니다.';
  const source = [related,next,exact,next,secondRelated,next,exact];
  assert.deepEqual(lookup(source.join('\n'),q).passages.map(p => p.paragraph),[3,7,1,5]);
});

test('같은 화자·주제라도 소수점·부호·범위·숫자 경계가 다르면 정확한 인용으로 올리지 않는다', () => {
  for (const [wrong, right] of [['15%','1.5%'],['1.5%','15%'],['+3.1%','−3.1%'],['−3.1%','+3.1%'],
    ['1~5%','15%'],['1 5%','15%'],['1/5%','15%'],['11명','1명']]) {
    const line = n => '○교통국장 차예진  교통 지표를 ' + n + '로 조정하기로 했습니다.';
    const q = '교통국장 차예진은 “교통 지표를 ' + right + '로 조정하기로 했습니다”라고 밝혔다.';
    const result = lookup([line(wrong),next,line(right)].join('\n'),q);
    assert.deepEqual(result.passages.map(p=>[p.paragraph,p.speaker.exactQuote]),[[3,true],[1,false]],right);
  }
  const source = '○교통국장 차예진  교통 지표를 1,500명으로 조정했습니다.';
  const q = '차예진 교통국장은 “교통 지표를 1500명으로 조정했습니다”라고 말했다.';
  assert.equal(lookup(source,q).passages[0].speaker.exactQuote,true);
});

test('화자 표지의 동그라미가 빠져도 다음 발언이나 답변을 앞사람에게 돌리지 않는다', () => {
  const opening = '○김도현 장관  현행 제도를 유지합니다.';
  const phrase = '청년수당을 전면 중단하겠다.';
  for (const boundary of ['박서윤 위원  ', '위원 박서윤  ', '  ― 박서윤 위원 ', '박서윤 위원\n  ']) {
    const result = search([opening, boundary + phrase, next].join('\n'),claim);
    assert.equal(result.transcript,true);
    assert.deepEqual(result.passages,[],boundary);
    assert.deepEqual(search([question, boundary + '다음입니다.', answer].join('\n'),claim).passages,[],boundary);
  }
  const ours = '  박서윤 위원 의견을 들었습니다. 청년수당을 전면 중단하겠다.';
  assert.equal(search([opening,ours].join('\n'),claim).passages[0].speaker.excerpt,opening + '\n' + ours);
  const later = '○김도현 장관  ' + phrase;
  assert.equal(search([opening,'박서윤 위원  ' + phrase,later].join('\n'),claim).passages[0].speaker.excerpt,later);
});

test('전주시의회 발췌에서 답변자 표지만 지워도 위원이 기획실장의 답변을 했다는 정확 인용은 만들지 않는다', () => {
  const real = require('../experiments/evidence-retrieval-transfer/transcript-speakers/cases.json').cases[0].text;
  const q = '신치범 위원은 “출장이 아니고 업무보고에 지장이 없는 분들을 오게하고”라고 말했다.';
  for (const source of [real, real.replace('○기획실장','기획실장')]) {
    const result = search(source,q);
    assert.equal(result.transcript,true);
    for (const hit of result.passages) {
      assert.equal(hit.speaker.exactQuote,false);
      assert.ok(!hit.speaker.excerpt.includes('기획실장'));
    }
  }
});

test('대상 화자가 인용한 타인의 발언이나 성명서는 직접 인용 근거에서 제외한다', () => {
  const phrase = '청년수당을 전면 중단하겠다';
  const opening = '○김도현 장관  ';
  for (const body of [
    '박서윤 위원이 “' + phrase + '”라고 말했습니다.',
    '위원 박서윤은 앞서 이렇게 말했습니다. "' + phrase + '."',
    '“' + phrase + '”라고 박서윤 위원이 말했습니다.',
    '야당 의원 성명에 적힌\n  “' + phrase + '”\n  라는 말은 제 입장이 아닙니다.',
    '보도자료에는 실린 「청년수당을\n전면 중단하겠다」라는 문구를 보셨습니까?',
  ]) {
    const result = search([opening + body,next].join('\n'),claim);
    assert.equal(result.transcript,true);
    assert.deepEqual(result.passages,[],body);
    assert.match(result.notice,/다른 사람이나 문서를 인용/u);
  }
  const direct = opening + '“' + phrase + '”라고 제가 말씀드렸습니다.';
  for (const source of [direct, opening + '김도현 장관은 “' + phrase + '”라고 서명했습니다.',
    opening + '박서윤 위원이 “금액을 줄이자”고 말했습니다. 저는 ' + phrase + '.']) {
    const [hit] = search(source,claim).passages;
    assert.equal(hit.speaker.exactQuote,true);
    assert.equal(hit.speaker.excerpt,source);
  }
  const other = opening + '박서윤 위원이 “' + phrase + '”라고 말했습니다.';
  const hits = search([other,next,direct].join('\n'),claim).passages;
  assert.deepEqual(hits.map(p => p.speaker.excerpt),[direct]);
});

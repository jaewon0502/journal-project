const {test} = require('node:test');
const assert = require('node:assert/strict');
const {lookup} = require('../docs/reader/evidence-fiscal-table.js');

const horizontal = [
  '단위: 조 원',
  '구분\t2023년 결산(A)\t2024년 예산(B)\t2024년 결산(C)\t2024년 예산 대비(C-B)\t전년 대비(C-A)',
  '총지출\t610.7\t656.6\t638.0\t-18.6\t27.3',
  '특별회계\t51\t55\t53\t-2\t2'
];
const query = '2024년 총지출 결산액은 656.6조 원인가?';
const vertical = [
  '회계연도\t사업명\t부처 요구액(억 원)\t정부안(억 원)\t국회 확정액(억 원)\t실제 집행액(억 원)',
  '2024\t별빛 주거 지원\t15\t14\t14\t13',
  '2025\t달빛 주거 지원\t19\t18\t17\t16',
  '2025\t별빛 주거 지원\t15\t13\t12\t11'
];
const asText = lines => lines.join('\r\n');
function cell(lines,question) {
  const result = lookup(asText(lines),question);
  assert.equal(result?.gap,null,question);
  assert.equal(result.passages.length,1);
  return result.passages[0];
}
function unresolved(lines,question) {
  const result = lookup(asText(lines),question);
  assert.ok(result?.gap,question);
  assert.deepEqual(result.passages,[],question);
}

test('report the table value even when the question quotes a neighboring number', () => {
  const lines = [...horizontal];
  lines[2] += '  ';
  const hit = cell(['',...lines,''],query);
  assert.equal(hit.text,lines[2]);
  assert.equal(hit.paragraph,3);
  assert.deepEqual(hit.context.map(r => [r.paragraph,r.text]),[[1,lines[0]],[2,lines[1]]]);
  assert.deepEqual(hit.matched,[]);
  assert.deepEqual(hit.fiscalCell,{rowLabel:'총지출',heading:'2024년 결산(C)',year:'2024',stage:'spent',
    column:4,headerParagraph:2,value:'638.0',unit:'조 원',
    amountComparison:{claimText:'656.6조 원',claimWon:'656600000000000',cellWon:'638000000000000',same:false}});
  for (const [year,stage,amount] of [['2023','결산액','610.7'],['2024','예산','656.6'],
    ['2024','예산 대비 증감액','-18.6']])
    assert.equal(cell(lines,year + '년 총지출의 ' + stage + '은 얼마인가?').fiscalCell.value,amount);
  assert.equal(cell(lines,'2024년 특별회계의 결산액은 얼마였나?').fiscalCell.value,'53');
  unresolved(lines,'2024년 총지출의 국회 확정액은 얼마인가?');
  unresolved(lines,'2024년 총지출의 전년 대비 증감액은 얼마인가?');
  unresolved([lines[0],lines[1].replace('2024년 예산 대비','예산 대비'),...lines.slice(2)],
    '2024년 총지출의 예산 대비 증감액은 얼마인가?');
});

test('same suffix, a different project or another fiscal year does not establish the requested amount', () => {
  for (const [stage,amount,col] of [['부처 요구액','15',3],['정부안','13',4],['국회 확정액','12',5],['실제 집행액','11',6]]) {
    const {paragraph,fiscalCell} = cell(vertical,'2025회계연도 별빛 주거 지원 사업의 ' + stage + '은 17억 원인가?');
    assert.equal(paragraph,4);
    assert.equal(fiscalCell.value,amount);
    assert.equal(fiscalCell.column,col);
    assert.equal(fiscalCell.unit,'억 원');
  }
  for (const scope of ['2023년 별빛 주거 지원','2025년 주거 지원','2025년 서울 별빛 주거 지원',
    '2025년 별빛 주거 지원과 달빛 주거 지원','2025년 별빛 주거 지원의 청년 대상'])
    unresolved(vertical,scope + ' 사업의 정부안은 얼마인가?');
  unresolved([...vertical,vertical[3]],'2025년 별빛 주거 지원 사업의 정부안은 얼마인가?');
});

test('proposal and final appropriation with lettered headings survive column reordering', () => {
  const lines = ['(단위: 억원)','구분\t2024년 확정예산(C)\t전년대비(C-A)\t2023년 본예산(A)\t국회증감(C-B)\t2024년 예산안(B)',
    '총수입\t70\t30\t40\t-8\t78','총지출\t63\t23\t40\t-2\t65'];
  assert.equal(cell(lines,'2024년도 총수입의 정부안은 얼마인가?').fiscalCell.value,'78');
  const final = cell(lines,'국회가 확정한 2024년도 총지출은 65억 원인가?').fiscalCell;
  assert.equal(final.heading,'2024년 확정예산(C)');
  assert.equal(final.value,'63');
  unresolved(lines,'2023년 총수입의 정부안은 얼마인가?');
});

test('align explicitly delimited year groups across the two original header rows', () => {
  const lines = ['단위: 억 원','구분\t2023년\t\t2024년\t',
    '\t예산\t결산(A)\t예산\t결산(B)','총지출\t14\t13\t18\t16'];
  const hit = cell(lines,query);
  assert.deepEqual(hit.context.map(r=>r.text),lines.slice(0,3));
  assert.equal(hit.fiscalCell.heading,'결산(B)');
  assert.equal(hit.fiscalCell.column,5);
  assert.equal(hit.fiscalCell.headerParagraph,3);
  assert.equal(hit.fiscalCell.value,'16');
  unresolved([lines[0],lines[1].trimEnd(),...lines.slice(2)],query);
  unresolved([lines[0],lines[1].replace('2023년','회계 A'),...lines.slice(2)],query);
});

test('empty cells keep their physical positions and cannot supply amounts', () => {
  const lines = ['단위: 만원','| 구분 | 2024년 예산 | 2024년 결산 |', '| 총지출 |    | 1,250.00 |'];
  const hit = cell(lines,query);
  assert.equal(hit.text,lines[2]);
  assert.equal(hit.fiscalCell.value,'1,250.00');
  assert.equal(hit.fiscalCell.column,3);
  for (const absent of ['', '—','-','…']) unresolved([...lines.slice(0,2),'| 총지출 | 1,250 | ' + absent + ' |'],query);
  unresolved([...lines.slice(0,2),'| 총지출 | 1,250 |'],query);
  unresolved([lines[0],lines[1].replace('2024년 예산','2024년 결산'),lines[2]],query);
});

test('unknown, absent and contradictory monetary units allow only positional navigation', () => {
  const base = horizontal.slice(1);
  for (const lines of [base,['단위: 조원, %, %p',...base],['단위: 달러',...base],
    ['단위: 만원',base[0].replace('2024년 결산(C)','2024년 결산(C)(억원)'),...base.slice(1)]]) {
    const result = lookup(asText(lines),query);
    assert.match(result.gap,/단위/u);
    assert.equal(result.passages.length,1);
    const [hit] = result.passages;
    assert.equal(hit.text,horizontal[2]);
    assert.equal(hit.fiscalNavigation.value,'638.0');
    assert.equal(hit.fiscalNavigation.column,4);
    assert.ok(!('unit' in hit.fiscalNavigation));
    assert.ok(!('fiscalCell' in hit));
  }
  const inCell = cell([base[0],base[1].replace('638.0','638.0 억 원')],query);
  assert.equal(inCell.fiscalCell.value,'638.0 억 원');
  assert.equal(inCell.fiscalCell.unit,'억 원');
  unresolved([horizontal[0],base[0],base[1].replace('638.0','97.2%')],query);
});

test('invalid or multiple tables, notes, shifted cells and overlapping stages abstain', () => {
  const original = horizontal[1];
  for (const lines of [[...horizontal,'주: 특별회계의 단위는 억 원'], [...horizontal,...horizontal],
    [...horizontal.slice(0,2),'재정 상황\t\t\t\t\t',...horizontal.slice(2)],
    [...horizontal,'\f다음 페이지'],[horizontal[0],original.replace('2024년 예산(B)',''),...horizontal.slice(2)],
    [horizontal[0],original.replace('2024년 예산(B)','2024년 잠정 결산(B)'),...horizontal.slice(2)]])
    unresolved(lines,query);
});

test('subgroups, conditions, rates and comparisons cannot be inferred from an amount', () => {
  for (const q of ['2024년 6월 총지출의 결산액은 얼마인가?', '2024년 총지출 결산액은 몇 퍼센트인가?',
    '2024년 총지출과 특별회계의 결산액은 얼마인가?', '2024년 중앙정부 총지출의 결산액은 얼마인가?',
    '2024년 총지출 예산과 결산액은 각각 얼마인가?', '2024년 총지출의 1인당 결산액은 얼마인가?',
    '2023년부터 2024년까지 총지출 결산액은?', '총지출 결산액은 얼마인가?'])
    unresolved(horizontal,q);
  for (const q of ['2024년도 본예산은 얼마인가?', '국회가 의결한 날짜는 언제인가?',
    '2024년 예산안 표결에 찬성한 의원은 몇 명인가?', '2024년 학생 수는 몇 명인가?'])
    assert.equal(lookup(asText(horizontal),q),null,q);
  assert.equal(lookup('2024년 총지출 결산은 638조 원이다.',query),null);
  assert.equal(lookup('연도\t학생 수(명)\n2024\t145',query),null);
});

test('keep the original title, ledger and paragraph numbers across blank lines and an attribution', () => {
  const lines = ['','[표 2] 2024회계연도 총지출 결산','',horizontal[0],'',horizontal[1],
    '',horizontal[2],'',horizontal[3],'','자료: 기획재정부',''];
  const hit = cell(lines,'2024년 특별회계의 결산액은 몇 조 원인가?');
  assert.equal(hit.paragraph,5);
  assert.equal(hit.fiscalCell.headerParagraph,3);
  assert.deepEqual(hit.context.map(c=>c.text),[lines[1],horizontal[0],horizontal[1]]);
  assert.equal(hit.text,horizontal[3]);
  for (const caption of ['[표 2] 서울시 일반회계 결산','[2024년 상반기 집행액]', '[표 2] 집행액 (잠정)'])
    assert.match(lookup(asText([caption,...horizontal]),query).gap,/주석/u);
  for (const note of ['주: 특별회계의 단위는 억 원', '자료: 잠정 기준 기획재정부', '출처: 단위 변경 후 기획재정부'])
    assert.match(lookup(asText([...horizontal,note]),query).gap,/주석/u);
});

test('an explicitly labeled monetary column can resolve a listed unit in a mixed legend', () => {
  const source = ['단위: 조원, %, %p','구분\t2024년 결산(조 원)\t2024년 집행률(%)','총지출\t638.0\t97.2'];
  assert.equal(cell(source,query).fiscalCell.unit,'조 원');
  for (const line of ['단위: 억원, %','단위: 조원 또는 비공개 기준']) {
    const result = lookup(asText([line,...source.slice(1)]),query);
    assert.ok(result.gap);
    assert.ok(result.passages[0].fiscalNavigation);
    assert.ok(!result.passages[0].fiscalCell);
  }
});

test('suggest the source check that corresponds to the missing or ambiguous key', () => {
  const src = asText(horizontal);
  assert.match(lookup(src,'2021년 총지출 결산액은 얼마인가?').gap,/회계연도를 찾지 못/u);
  assert.match(lookup(src,'2024년 총지출의 정부안은 얼마인가?').gap,/단계의 열을 찾지 못/u);
  assert.match(lookup(src,'2024년 총지출은 얼마인가?').gap,/어떤 예산 단계/u);
  assert.match(lookup(src,'총지출의 결산액은 얼마인가?').gap,/조회할 회계연도/u);
  assert.match(lookup(src,'2024년 다른회계의 결산액은 얼마인가?').gap,/일치하는 행/u);
  assert.match(lookup(src.replace('2024년 예산(B)','2024년 결산(D)'),query).gap,/열이 여러/u);
  assert.match(lookup(src+'\r\n'+horizontal[2],query).gap,/행이 여러/u);
  assert.match(lookup(src.replace('638.0','—'),query).gap,/빈칸/u);
});

test('the raw row navigation API checks the full subject independently of table parsing', () => {
  const {rowQuestion} = require('../docs/reader/evidence-fiscal-table.js');
  const ask = rowQuestion('국회가 의결한 2025년 서울시 총지출은 391억 원인가?');
  assert.equal(ask.stage,'approved');
  assert.equal(ask.year,'2025');
  assert.equal(ask.matches('총지출'),false);
  assert.equal(ask.matches('서울시 총지출'),true);
  for (const q of ['2024년 총지출은 얼마인가?','2024년 예산안은 얼마인가?','총지출 결산액은 얼마인가?'])
    assert.equal(rowQuestion(q),null);
});

test('the stage naming a source cannot replace the stage of a question about another amount', () => {
  for (const q of ['2024년 결산에서 총지출 예산액은 얼마인가?', '정부안에서 2024년 총지출 확정액은 얼마인가?',
    '2024년 결산 보고서에서 총지출의 국회 의결액은 얼마인가?']) {
    const result = lookup(asText(horizontal),q);
    assert.match(result.gap,/단계/u);
    assert.deepEqual(result.passages,[]);
  }
  assert.equal(cell(horizontal,'2024년 결산에서 총지출 결산액은 얼마인가?').fiscalCell.value,'638.0');
  assert.equal(cell(vertical,'2025년 국회가 의결한 별빛 주거 지원 사업 예산은 얼마인가?').fiscalCell.value,'12');
});

test('a complete large project ledger can identify its final row', () => {
  const rows = Array.from({length:5000},(_,i) => '2025\t시설 ' + i + '\t25\t24\t23\t22');
  const hit = cell([vertical[0],...rows],'2025년 시설 4999 사업의 국회 확정액은 얼마인가?');
  assert.equal(hit.paragraph,5001);
  assert.equal(hit.fiscalCell.value,'23');
});

test('row names retain their boundaries before removing stage vocabulary and Korean particles', () => {
  const lines = ['단위: 억원','항목\t2024년 예산\t2024년 결산','교육\t12\t10',
    '연구\t12\t11','군립도서관\t20\t19'];
  for (const subject of ['교육원','연구원','예산군립도서관']) {
    unresolved(lines,'2024년 ' + subject + ' 결산액은 얼마인가?');
    unresolved(lines,'2024년 ' + subject + ' 예산은 얼마인가?');
  }
  const withTown = [...lines,'예산군립도서관\t8\t7'];
  assert.equal(cell(withTown,'2024년 예산군립도서관의 예산은 얼마인가?').fiscalCell.value,'8');
  assert.equal(cell(withTown,'2024년 군립도서관의 결산액은 얼마인가?').fiscalCell.value,'19');
});

test('fiscal vocabulary inside the project name or an ordinary data row does not identify a requested stage', () => {
  const source = ['단위: 억원','구분\t2024년 예산\t2024년 결산','결산기금\t15\t13'];
  unresolved(source,'2024년 결산기금은 얼마인가?');
  assert.equal(cell(source,'2024년 결산기금의 결산액은 얼마인가?').fiscalCell.value,'13');
  assert.equal(lookup('연도\t법안 제목\n2024\t예산안 심의',query),null);
});

test('a separate place name cannot be consumed as a sequence of Korean particles', () => {
  for (const place of ['가나','나로','이의'])
    unresolved(horizontal,'2024년 ' + place + ' 총지출의 결산액은 얼마인가요?');
  assert.equal(cell(horizontal,'2024년 총지출의 결산액은 얼마인가요?').fiscalCell.value,'638.0');
  assert.equal(cell(horizontal,'특별회계에서 2024년 결산액은 78.6조 원이었다.').fiscalCell.value,'53');
});

test('집행률은 원고 수치와 다른 행에 같은 값이 있어도 해당 연도·항목의 원문 퍼센트 셀을 고른다', () => {
  const {search} = require('../docs/reader/evidence-search.js');
  const lines = ['단위: 조원, %, %p','구분\t2024년 결산(조 원)\t2024년 집행률(%)\t2023년 집행률(%)',
    '일반회계\t500.0\t94.8\t97.2','총지출\t638.0\t97.2\t94.8'];
  for (const q of ['2024년 총지출의 집행률은 94.8%인가?', '2024년 총지출의 예산 집행률은 94.8퍼센트였다.',
    '2024년 총지출의 집행율은 몇 퍼센트인가?']) {
    const result = search(asText(lines), q);
    assert.equal(result.gap, null, q);
    assert.equal(result.passages.length, 1);
    const [hit] = result.passages;
    assert.equal(hit.text, lines[3]);
    assert.deepEqual(hit.context.map(r => r.text), lines.slice(0,2));
    assert.deepEqual(hit.fiscalCell, {heading:'2024년 집행률(%)', value:'97.2', column:3, rowLabel:'총지출',
      headerParagraph:2, year:'2024', stage:'executionRate', unit:'%'});
    assert.deepEqual(hit.matched, []);
  }
  assert.equal(cell(lines,'2024년 총지출의 결산액은 얼마인가?').fiscalCell.value,'638.0');
  for (const q of ['2024년 일반회계와 총지출의 집행률은 얼마인가?', '2024년 총지출의 전년 대비 집행률은 얼마인가?',
    '2024년 총지출의 집행률은 2.4%p 하락했나?', '2024년 총지출의 집행률이 94.8%에서 97.2%로 올랐나?',
    '2024년 청년 대상 총지출의 집행률은 얼마인가?', '2024년 총지출의 예산현액 대비 집행률은 얼마인가?'])
    unresolved(lines, q);
});

test('인쇄된 분모가 다르면 같은 금액·연도에서도 별도 집행률을 찾고 분모 없는 질문은 보류한다', () => {
  const lines = ['회계연도\t사업명\t본예산(억원)\t예산현액(억원)\t집행액(억원)\t본예산 대비 집행률(%)\t집행률(예산현액 기준)(%)',
    '2024\t별빛 돌봄\t100\t120\t90\t90.0\t75.0',
    '2025\t별빛 돌봄\t120\t160\t120\t100.0\t75.0'];
  for (const [phrase, basis, value, column] of [['본예산 대비','본예산','90.0',6],['예산현액을 기준으로 한','예산현액','75.0',7]]) {
    const hit = cell(lines,'2024년 별빛 돌봄 사업의 '+phrase+' 집행률은 100%인가?');
    assert.deepEqual([hit.paragraph,hit.fiscalCell.basis,hit.fiscalCell.value,hit.fiscalCell.column],[2,basis,value,column]);
  }
  const ask = '2024년 별빛 돌봄 사업의 집행률은 얼마인가?';
  for (const sheet of [lines,[lines[0].replace('본예산 대비 집행률','잠정 집행률'),...lines.slice(1)]])
    assert.match(lookup(asText(sheet),ask).gap, /분모/u);
  unresolved(lines, '2024년 별빛 돌봄 사업의 최종예산 대비 집행률은 얼마인가?');
  unresolved([...lines,lines[1]], '2024년 별빛 돌봄 사업의 본예산 대비 집행률은 얼마인가?');
});

test('집행률의 단위는 원표에서 확인하고 금액·퍼센트포인트·혼합 단위·산식으로 추정하지 않는다', () => {
  const q = '2024년 총지출의 집행률은 얼마인가?';
  const plain = ['구분\t2024년 집행률','총지출\t91.5'];
  assert.equal(cell(['단위: %',...plain],q).fiscalCell.unit,'%');
  assert.equal(cell([plain[0],'총지출\t91.5퍼센트'],q).fiscalCell.unit,'퍼센트');
  for (const lines of [plain,['단위: 조원, %',...plain],['단위: 억원',...plain],
    [plain[0], '총지출\t91.5%p'],[plain[0],'총지출\t91.5억원'],
    [plain[0].replace('집행률','집행률(%p)'),plain[1]], [plain[0].replace('집행률','집행률(A/B)(%)'),plain[1]],
    [plain[0],'총지출\t—'],[plain[0].replace('집행률','예산(억원)\t2024년 결산(억원)'),'총지출\t100\t91.5']]) {
    const result = lookup(asText(lines),q);
    assert.ok(result?.gap);
    assert.ok(result.passages.every(p => !p.fiscalCell));
  }
  const grouped = ['항목\t2023년\t\t2024년\t','\t결산(조원)\t집행률(%)\t결산(조원)\t집행률(%)','총지출\t19\t95\t18\t90'];
  assert.equal(cell(grouped,q).fiscalCell.value,'90');
});

test('연도·항목·단계로 찾은 결산 셀에서만 기사 복합 금액과 표의 단위를 원 단위로 대조한다', () => {
  const {search} = require('../docs/reader/evidence-search.js');
  const lines = ['단위: 백만 원','구분\t2023년 결산\t2024년 예산\t2024년 결산',
    '시설 지원\t12\t12\t120', '시설 정비\t120\t120\t12'];
  const check = (amount, expected, same) => {
    const result = search(asText(lines), '2024년 시설 지원 결산액은 ' + amount + '인가?');
    assert.equal(result.gap,null,amount);
    const [hit] = result.passages;
    assert.deepEqual([hit.paragraph,hit.text,hit.fiscalCell.heading,hit.fiscalCell.column,hit.fiscalCell.value,hit.fiscalCell.unit],
      [3,lines[2],'2024년 결산',4,'120','백만 원']);
    assert.deepEqual(hit.fiscalCell.amountComparison, {claimText:amount,claimWon:expected,cellWon:'120000000',same});
  };
  for (const amount of ['1억 2천만 원','1억2천만원','1.20억 원','120백만 원','120,000,000원','１억　２천만 원']) {
    check(amount, '120000000',true);
  }
  check('12백만 원','12000000',false);
  check('−1억 2천만 원','-120000000',false);
  check('1억 2천만 1원','120000001',false);
});

test('정수 원화의 소수 배율·음수·큰 값은 반올림하지 않고 원표의 인쇄값을 남긴다', () => {
  for (const [claimText,unit,printed,won] of [
    ['0.12조 원','억원','1,200','120000000000'], ['1,200억원','조 원','0.1200','120000000000'],
    ['+1.50억 원','천 원','150,000.00','150000000'], ['-1억 2천만 원','백만 원','−120.0','-120000000'],
    ['123,456조 7,891억 2천만 301원','원','123456789120000301','123456789120000301'],
    ['0.000001백만 원','원','1','1'], ['-0원','천 원','0','0']]) {
    const hit = cell(['단위: '+unit,'구분\t2024년 결산','총지출\t'+printed], '2024년 총지출 결산액은 '+claimText+'인가?');
    assert.equal(hit.fiscalCell.value,printed);
    assert.deepEqual(hit.fiscalCell.amountComparison,{claimText,claimWon:won,cellWon:won,same:true});
  }
});

test('모호한 금액·부호·주석이나 항목 이름 속 금액을 원화 비교값으로 쓰지 않는다', () => {
  const header = '항목\t2024년 결산';
  const rows = ['단위: 백만 원',header,'시설 지원\t120'];
  const question = amount => '2024년 시설 지원 결산액은 '+amount+'인가?';
  function noComparison(lines, q) {
    const result = lookup(asText(lines),q);
    assert.ok(!result?.passages.some(hit => hit.fiscalCell?.amountComparison),q);
  }
  for (const ambiguous of ['120백만 원 이상','약 120백만 원','120백만 원 안팎','120~130백만 원','120백만 원에서 130백만 원',
    '1억 120백만 원','2천만 1억 원','1억 2억 원','1.5억 2천만 원','1억 원, 2천만 원','120백만 달러',
    '1억 달러 2천만 원','△120백만 원','− 120백만 원','1,20백만 원','.5억 원','5억원금','10²백만 원','1.25원','얼마','120백만']) {
    noComparison(rows,question(ambiguous));
  }
  for (const lines of [[header,rows[2]],['단위: 백만 원, 달러',header,rows[2]], [...rows,'주: 연간 누계 제외'],
    ['단위: 원',header,'시설 지원\t1.25'], ['단위: 백만 원',header,'시설 지원\t△120'],
    ['단위: 백만 원',header,'시설 지원\t12⁰'], ['단위: 원',header,'시설 지원\t'+'1'.repeat(101)]]) {
    noComparison(lines,question('1억 2천만 원'));
  }
  const named = cell(['단위: 백만 원',header,'1억 원 지원\t120'],'2024년 1억 원 지원의 결산액은 얼마인가?');
  assert.equal(named.fiscalCell.value,'120');
  assert.equal(named.fiscalCell.amountComparison,undefined);
  const normalizedName = cell(['단위: 백만 원',header,'㈜중앙\t120'],'2024년 ㈜중앙 결산액은 １억　２천만 원인가?');
  assert.deepEqual(normalizedName.fiscalCell.amountComparison,
    {claimText:'１억　２천만 원',claimWon:'120000000',cellWon:'120000000',same:true});
  unresolved(rows,question('2천만 1억 원'));
});

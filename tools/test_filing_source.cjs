const {test} = require('node:test');
const assert = require('node:assert/strict');
const {filingSourceCaution, prepare} = require('../docs/reader/factcheck-engine.js');
const cases = require('../docs/reader/editor-study-cases.js');

const filing = cases.get('filing', 'A');
const [finalLedger, preliminary, schedule] = filing.sources;
const neutral = {title:'자료 목록', version:'6월 14일자', locator:'첫 행'};

test('최종 정산 자료의 기한 후 제출은 사전 접수와 공개 예정일을 각각 구별한다', () => {
  for (const variant of ['A','B']) {
    const {article,sources} = cases.get('filing',variant);
    const [final,early,publish] = sources.map(s => filingSourceCaution(article,s));
    assert.equal(final,null);
    assert.match(early,/사전 검토.+최종 접수일/);
    assert.match(publish,/공개 일정.+실제 접수일/);
    assert.deepEqual(prepare(article,sources,[]).rows[0].sourceIds,['doc-1','doc-2','doc-3']);
  }
  assert.match(filingSourceCaution(filing.article,preliminary),/사전 검토/);
  assert.match(filingSourceCaution('연구팀은 보고서를 7일에 냈다.',schedule),/공개 일정/);
  assert.equal(filingSourceCaution(filing.article,finalLedger),null);
});

test('발췌문에 명시된 사전 접수와 미래 또는 부정된 최종 접수를 구별한다', () => {
  const claim = '연구팀은 최종 보고서를 제출했다.';
  for (const ending of [
    '최종 보고서는 별도로 제출한다.', '최종 자료는 아직 접수하지 않았다.',
    '최종 자료는 6월 18일 접수할 예정이다.', '최종 접수는 완료되지 않았다.',
    '최종 접수일 6월 12일은 예정일이다.', '최종 접수 완료 여부는 확인 중이다.',
    '최종 자료는 6월 12일 접수됐다는 주장을 부인했다.'
  ]) {
    const source = {...neutral, excerpt:'사전 검토용 요약본을 6월 8일에 접수했다. ' + ending};
    assert.match(filingSourceCaution(claim, source),/사전 검토/);
  }
  assert.match(filingSourceCaution(claim,{...neutral,excerpt:'보고서의 공개 예정일은 7월 20일이다.'}),/공개 일정/);
  assert.match(filingSourceCaution(claim,{...neutral,excerpt:'보고서는 7월 20일에 공개될 예정이다.'}),/공개 일정/);
  assert.match(filingSourceCaution(claim,{...neutral,title:'사전 검토본',excerpt:'연구팀이 6월 8일에 냈다.'}),/사전 검토/);
  assert.equal(filingSourceCaution(claim,{...neutral,excerpt:'검토 위원 명단이 수록되어 있다.'}),null);
  assert.equal(filingSourceCaution(claim,{...neutral,title:'사전 검토 접수표 아님',excerpt:'보고서 제출'}),null);
  assert.equal(filingSourceCaution(claim,{...neutral,version:'공개 일정 없음',excerpt:'기록 확인'}),null);
});

test('함께 적힌 최종 접수의 실제 기록은 사전 제출·공개 일정이 함께 있어도 안내를 내지 않는다', () => {
  for (const entry of [
    '최종 보고서는 6월 12일 접수됐다.', '실제 제출 및 접수 6월 12일.',
    '최종 자료 접수일: 6월 12일.', '최종 자료를 정식으로 제출하였다.',
    '최종 자료도 6월 12일에 냈다.', '최종 보고서 접수일(확정): 6월 12일.',
    '최종 서류도 함께 제출한 사실을 확인했다.', '최종 접수일: 2026. 6. 12.'
  ]) {
    const source = {...neutral,title:'사전 검토 접수표와 자료 공개 일정',excerpt:'사전 검토용 파일은 8일에 접수했다. ' + entry};
    assert.equal(filingSourceCaution(filing.article,source),null,entry);
  }
  const shared = {...neutral,title:'사전 접수와 최종 접수대장',excerpt:'사전 검토용 접수는 6월 8일. 접수일 6월 12일.'};
  assert.equal(filingSourceCaution(filing.article,shared),null);
});

test('사전 제출·공개·예측·의견·발언에 관한 기사에는 최종 접수일을 요구하지 않는다', () => {
  for (const article of [
    '의원모임은 사전 검토용 요약본을 기한보다 늦게 제출했다.',
    '모의 검토단은 예비 접수 기한 안에 서류를 제출했다.',
    '위원회는 6월 자료 공개일을 14일로 정했다.',
    '위원회는 최종 자료를 내달 제출할 예정이다.',
    '위원회는 최종 자료를 제출해야 한다.',
    '시장에게 공개 일정을 물었다. 연구팀은 최종 자료를 제출했다.',
    '대변인은 “최종 자료를 제출했다”고 밝혔다.',
    '졸속 대응 끝에 최종 자료를 제출했다.',
    '세무서가 신청서를 접수하지 않았다.',
    '제출 기한이 늦어져 최종 자료를 내면 좋겠다.',
    ...['transit','repair','permits'].map(id => cases.get(id,'A').article)
  ]) assert.equal(filingSourceCaution(article,preliminary),null,article);
});

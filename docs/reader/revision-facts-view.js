/* Use the same labels and denominators for one article and a collection. */
globalThis.JournalRevisionFactsView = function (before, after) {
  'use strict';
  const text = (tag, value) => {
    const node = document.createElement(tag);
    node.textContent = value;
    return node;
  };
  const rate = value => (value.denominator ? Number(value.pct.toFixed(1)) + '%' : '산출 대기') +
    ' (' + value.numerator + '/' + value.denominator + ')';
  function table(title, measures) {
    const node = document.createElement('table');
    node.append(text('caption', title));
    const head = node.createTHead().insertRow();
    for (const name of ['판정 기준', '수정 전', '수정 후']) {
      const cell = text('th', name);
      cell.scope = 'col';
      head.append(cell);
    }
    const body = node.createTBody();
    for (const [key, label] of measures) {
      const row = body.insertRow();
      row.dataset.factRow = key;
      const cell = text('th', label);
      cell.scope = 'row';
      row.append(cell);
      for (const result of [before, after]) {
        row.append(text('td', key === 'support' || key === 'coverage' ? rate(result[key]) : result[key] + '개'));
      }
    }
    return node;
  }
  const part = document.createDocumentFragment();
  part.append(table('두 편집자의 사실 판정', [
    ['support', '두 편집자의 구절 전체 지지율'], ['coverage', '같은 범위에서 공동 판정한 비율'],
    ['articleFlagged', '한 명 이상 기사 서술과 원자료의 충돌 표시'], ['quoteFlagged', '한 명 이상 인용 속 사실 주장에 반증 표시']
  ]));
  const note = text('p', '지지율의 분모는 두 사람이 각각 검토해 구절 전체를 지지하거나 기사 서술을 반박하는 데 동의한 구절입니다. 선택한 원자료는 서로 다를 수 있습니다. 공동 판정 비율에는 같은 범위의 일부 사실을 지지하거나 인용 속 주장을 반박한 구절도 들어갑니다. 두 사람이 따로 의견으로 판단한 구절만 분모에서 뺍니다. 한 구절에 기사 서술과 인용 속 주장 충돌이 모두 표시될 수 있습니다.');
  note.className = 'note';
  const details = document.createElement('details');
  details.className = 'case';
  details.append(text('summary', '판정 종류별 구절 수'), table('각 구절은 한 종류에 집계', [
    ['supported', '구절 전체를 뒷받침함'], ['limited', '일부 사실 또는 발언 사실만 지지'],
    ['contradicted', '기사 서술을 원자료가 반박'], ['quotedConflict', '발언은 확인됐고 인용 속 주장은 반박됨'],
    ['disputed', '판정 또는 확인 범위가 다름'], ['pending', '한 명 이상 미결'], ['shared', '동일한 판정 기록'],
    ['excluded', '두 사람 모두 의견으로 분류'], ['total', '전체 구절']
  ]));
  part.append(note, details);
  return part;
};

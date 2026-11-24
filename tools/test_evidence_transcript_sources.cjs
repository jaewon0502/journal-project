const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const {search} = require('../docs/reader/evidence-search.js');
const file = require.resolve('../experiments/evidence-retrieval-transfer/transcript-speakers/cases.json');
const bytes = readFileSync(file);
const benchmark = JSON.parse(bytes);

test('독립적으로 고정한 두 회의록과 질문을 그대로 사용한다', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    '7868364e31dff74767334aa20bf0cdd7355cd0370dcc3a8b33d920e9fd474624');
});

for (const item of benchmark.cases) {
  test(item.title + '에서 답변자와 질의 문맥을 함께 찾는다', () => {
    const result = search(item.text, item.query);
    const lines = item.text.split('\n');
    assert.equal(result.transcript, true);
    const [hit] = result.passages;
    assert.ok(hit);
    assert.equal(hit.paragraph, item.expectedParagraph);
    assert.equal(hit.text, lines[item.expectedParagraph - 1]);
    assert.equal(hit.speaker.label, item.expectedLabel);
    assert.equal(hit.speaker.excerpt, lines[item.expectedParagraph - 1]);
    assert.ok(hit.context.some(row => row.paragraph === item.expectedContextParagraph &&
      row.text === lines[item.expectedContextParagraph - 1]));
  });
}

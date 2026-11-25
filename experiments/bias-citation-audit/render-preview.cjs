const assert = require('node:assert/strict');
const workspace = require('../../docs/reader/workspace-snapshot.js');

function html(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function wording(work) {
  const view = workspace.read(work);
  const {rating} = view.assessment.bias.items.find(item => item.id === 'wording');
  const source = view.sources.find(item => item.id === rating.sourceId);
  return {rating, source};
}

function article({title, pair, verification}) {
  // Each editor used the same exact survey passage across editions in these two exercises.
  // Print a shared selection once only if all displayed citations match exactly.
  const groups = new Map();
  for (const editor of pair) {
    const before = wording(editor.before), after = wording(editor.after);
    assert.equal(workspace.sourceIdentity(before.source), workspace.sourceIdentity(after.source));
    assert.equal(before.rating.sourceQuote, after.rating.sourceQuote);
    const key = JSON.stringify([before.rating.quote, after.rating.quote, workspace.sourceIdentity(before.source),
      before.rating.sourceQuote, before.rating.level, after.rating.level]);
    const group = groups.get(key) || {before, after, editors:[]};
    const index = editor.ordered[0].name.match(/-editor-(\d+)-/u)[1];
    group.editors.push(Number(index));
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => Math.min(...a.editors) - Math.min(...b.editors));
  const citations = ordered.map(({before, after, editors}) => {
    const label = editors.length === 2 ? '두 편집자 공통' : '편집자 ' + editors[0];
    return '<div class="reading"><h3>' + label + ' <small>원본 ' + before.rating.level + '점 → 수정본 ' + after.rating.level + '점</small></h3>' +
      '<dl><dt>원본 기사</dt><dd>' + html(before.rating.quote) + '</dd><dt>수정 기사</dt><dd>' + html(after.rating.quote) + '</dd></dl>' +
      '<figure><figcaption>' + html(before.source.title) + ' · ' + html(before.source.locator) + '</figcaption>' +
      '<blockquote>' + html(before.rating.sourceQuote) + '</blockquote></figure></div>';
  }).join('\n');
  const state = verification.aligned === 1 ? '일치' : '다름';
  return '<section class="case"><header><h2>' + html(title) + '</h2><p>인용 근거 ' + state + '</p></header>' +
    '<div class="readings">' + citations + '</div></section>';
}

function metric(count, outOf, label) {
  return '<div><dt>' + label + '</dt><dd>' + count + '<span>/' + outOf + '</span></dd></div>';
}

module.exports = function renderPreview(results, improvement, totals) {
  const numbers = metric(improvement.numerator, improvement.denominator, '점수상 공동 개선') +
    metric(totals.aligned, totals.improved, '인용 근거 일치') + metric(totals.different, totals.improved, '인용 근거 다름');
  return '<!doctype html>\n<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>두 가상 기사의 편향 점수와 인용 근거</title>\n<style>\n' + css + '\n</style>\n' +
    '<main><header class="intro"><p class="eyebrow">가상 기사 편집 실습</p><h1>두 편집자는 같은 근거를 보고 점수를 낮췄을까?</h1>' +
    '<p>두 기사에서 편집자 두 명이 ‘표현과 발언 귀속’ 점수를 낮췄습니다. 각자 표시한 기사 문장과 설문 응답을 함께 읽어 보세요.</p></header>' +
    '<dl class="metrics">' + numbers + '</dl>\n' + results.map(article).join('\n') +
    '<footer>기사와 설문 응답, 편집자 판단은 모두 이 실습을 위해 작성했습니다. 집계 단위는 기사별 평가 항목이며 두 기사에서 한 항목씩 평가했습니다.</footer></main></html>\n';
};

const css = [
  '*{box-sizing:border-box}html{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#f9f8f3;color:#202923;word-break:keep-all;overflow-wrap:anywhere}',
  'body{margin:0}main{max-width:62rem;margin:auto;padding:clamp(1.1rem,5vw,4rem)}h1,h2,h3,p,dl,dd,figure,blockquote{margin:0}',
  '.intro{border-top:4px solid #205847;padding-top:1rem}.eyebrow{color:#205847;font-size:.9rem;font-weight:700}.intro h1{font-size:clamp(2rem,4.3vw,3.4rem);letter-spacing:-.05em;line-height:1.22;margin:.65rem 0 1rem}.intro>p:last-child{line-height:1.65;color:#48574f}',
  '.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;border-block:1px solid #b8c2b7;padding:1rem 0;margin:1.5rem 0 2.25rem}.metrics dt{font-size:.875rem;font-weight:650}.metrics dd{color:#205847;font-size:clamp(2.1rem,5vw,3.05rem);font-weight:750;letter-spacing:-.05em;line-height:1.15}.metrics dd span{font-size:.68em;color:#526157;font-weight:450}',
  '.case+ .case{margin-top:2.2rem}.case>header{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;flex-wrap:wrap;margin-bottom:.7rem}.case h2{font-size:clamp(1.3rem,3vw,1.65rem);letter-spacing:-.035em}.case header p{font-size:.9rem;font-weight:650;color:#45564b}',
  '.readings{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:1rem}.reading{padding:1rem 1.25rem;background:#fff;border:1px solid #cdd4c9;border-radius:.35rem}.reading h3{font-size:1.02rem;display:flex;align-items:baseline;flex-wrap:wrap;gap:.35rem .8rem}.reading h3 small{font-size:.79rem;color:#4c5952;font-weight:500}',
  '.reading dl{margin:1.05rem 0;display:grid;grid-template-columns:auto 1fr;gap:.45rem .75rem;font-size:1rem;line-height:1.6}.reading dt{color:#536157;font-size:.84rem;padding-top:.14em}.reading figure{border-top:1px solid #dbe0d9;padding-top:.7rem}.reading figcaption{font-size:.79rem;color:#48574d;font-weight:650}.reading blockquote{margin:.35rem 0 .1rem;padding-left:.75rem;border-inline-start:3px solid #739381;line-height:1.6}',
  'footer{font-size:.82rem;line-height:1.6;margin-top:2rem;border-top:1px solid #b8c2b7;padding-top:1rem;color:#4c5b51}@media(max-width:32rem){.metrics{gap:.6rem}.metrics dt{font-size:.8rem}.reading{padding:.85rem}.reading dl{grid-template-columns:1fr;gap:.1rem}.reading dd+dt{margin-top:.4rem}}',
  '@media print{html{background:white}.reading{break-inside:avoid}.case>header{break-after:avoid}main{max-width:none;padding:.4cm}}'
].join('\n');

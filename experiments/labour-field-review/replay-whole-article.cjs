'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const gold = require('./transfer-gold.json');

const baseline = '90ce80cf7c606d3a248851c3528e76aedcd98173';
const root = path.resolve(__dirname, '../..');
const articleHash = '1391873f8c2aa7ff850085af6cd5a0fb298063c9cda7534e5c3b72b00715ed16';
const originalHtmlHash = '61ced30e4b71af42445a519f8fa1858d3bb7283baf084211808f9b8f6ccd8ac1';
const sentenceHashes = {
  'labour-growth':'105ff86e8b62f72f029d18a862fabebefd58a7b6db45d4418361603455437888',
  'labour-rate':'4068576ed0a1857eaf497e0846f37d772f809122e1bf09406a04e77b4bacb596',
  'labour-period':'4d4fe521a5f2969f7720bf047183433805227bd7d148309ddacf807bad5fa986'
};
const hash = value => createHash('sha256').update(value).digest('hex');

function searchTools(revision) {
  const read = name => revision
    ? execFileSync('git', ['show', revision + ':docs/reader/' + name], {cwd:root, encoding:'utf8'})
    : readFileSync(path.join(root, 'docs/reader', name), 'utf8');
  const window = new JSDOM(read('factcheck.html'), {runScripts:'outside-only'}).window;
  window.TextEncoder = TextEncoder;
  // Load the reader's own script order, including any search dependencies.
  for (const script of window.document.querySelectorAll('script[src]')) {
    const name = script.getAttribute('src');
    assert.equal(path.basename(name), name);
    window.eval(read(name));
    if (window.JournalEvidenceSearch && window.JournalFactcheck) break;
  }
  assert.ok(window.JournalEvidenceSearch && window.JournalFactcheck);
  return window;
}

function articleFrom(bytes) {
  const window = new JSDOM(bytes).window;
  try {
    const document = window.document;
    const title = document.querySelector('meta[property="og:title"]').content;
    const publication = document.querySelector('meta[property="article:published_time"]').content;
    const body = document.querySelector('.text_area');
    for (const br of body.querySelectorAll('br')) br.replaceWith('\n');
    const paragraphs = body.textContent.split(/\n/u).map(line => line.trim()).filter(Boolean);
    const url = document.querySelector('link[rel=canonical]').getAttribute('href');
    assert.equal(paragraphs.length, 14);
    assert.equal(hash(JSON.stringify([url, publication, title, ...paragraphs])), articleHash,
      'SBS 기사 주소, 발행일, 제목 또는 본문이 재시험에 사용한 판본과 다릅니다.');
    return {title, publication, text:[title, ...paragraphs].join('\n')};
  } finally { window.close(); }
}

function physicalPages(text) {
  const pages = [null];
  let page = 1;
  for (const line of text.split(/\r\n|[\n\r\u2028\u2029]/u)) {
    page += line.split('\f').length - 1;
    if (line.trim()) pages.push(page);
  }
  return pages;
}

function run(revision, article, source, pages) {
  const window = searchTools(revision);
  try {
    const rows = window.JournalFactcheck.report(article.text, []).rows;
    return gold.tasks.map(task => {
      const selected = rows.filter(row => row.text.includes(task.query));
      assert.equal(selected.length, 1);
      const row = selected[0];
      assert.equal(hash(row.text), sentenceHashes[task.id]);
      function attempt(articleContext) {
        const lookup = window.JournalEvidenceSearch.search(source, row.text, {articleContext});
        const top = Array.from(lookup.passages.slice(0, 3), p => ({page:pages[p.paragraph], row:p.paragraph}));
        const rank = top.findIndex(p => task.targets[p.page]?.includes(p.row)) + 1;
        const candidate = rank ? lookup.passages[rank - 1] : null;
        const missingYears = candidate?.yearCoverage?.missingYears ?? [];
        const tableYears = candidate?.years ?? [];
        const history = task.id === 'labour-period';
        const recentOnly = history && rank && lookup.state === 'partial-series' && lookup.needsPublicationDate === true &&
          missingYears.includes(2000) && [2022,2023,2024].every(year => tableYears.includes(year));
        // Row 822 supports the recent series. It cannot establish the comparison with 2000.
        return {state:lookup.state, top, directRank:!history && rank ? rank : null,
          partialRank:recentOnly ? rank : null, tableYears, missingYears,
          checkPublicationDate:lookup.needsPublicationDate === true};
      }
      return {task:task.id, articleRow:rows.indexOf(row) + 1, sentenceSha256:hash(row.text),
        sentenceOnly:attempt(''), withHeadline:attempt(article.title)};
    });
  } finally { window.close(); }
}

const args = process.argv.slice(2);
if (!(args.length === 2 || (args.length === 3 && args[2] === '--json'))) {
  console.error('사용법: node replay-whole-article.cjs SBS-저장본.html 고용동향-layout.txt [--json]');
  process.exit(2);
}
const html = readFileSync(args[0]), layout = readFileSync(args[1]);
assert.equal(hash(readFileSync(require.resolve('./transfer-gold.json'))), require('./transfer-retry.json').originalGoldSha256);
assert.equal(hash(layout), gold.textSha256, '고정한 공식 PDF의 layout 추출문이 아닙니다.');
const article = articleFrom(html), source = layout.toString('utf8'), pages = physicalPages(source);
const before = run(baseline, article, source, pages), after = run(null, article, source, pages);
if (args[2] === '--json') {
  console.log(JSON.stringify({htmlSha256:hash(html), originalHtmlSha256:originalHtmlHash, articleSha256:articleHash, layoutSha256:gold.textSha256, published:article.publication,
    baselineCommit:baseline, baseline:before, workingTree:after}, null, 2));
} else {
  const labels = {'labour-growth':'취업자 증가', 'labour-rate':'고용률', 'labour-period':'역사 비교 포함'};
  function result(r) {
    if (r.directRank) return '직접 ' + r.directRank + '위';
    return r.partialRank ? '부분 ' + r.partialRank + '위' : '상위 3개 미적중';
  }
  for (const [mode, label] of [['sentenceOnly','완전한 문장 단독'], ['withHeadline','같은 문장에 기사 제목 추가']]) {
    console.log(label);
    console.table(after.map((row, i) => ({
      '구간':row.articleRow, '주장':labels[row.task], '90ce80c':result(before[i][mode]), '작업 트리':result(row[mode]),
      '첫 후보 (PDF쪽/행)':row[mode].top.length ? row[mode].top[0].page + '/' + row[mode].top[0].row : '없음',
      '빠진 연도':row[mode].missingYears.join(', ') || '—', '발행일 대조':row[mode].checkPublicationDate ? '필요' : '—'
    })));
  }
}

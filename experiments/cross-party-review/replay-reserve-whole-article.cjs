// Read the supplied newspaper HTML locally; print only edition checks and lookup coordinates.
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const factcheck = require('../../docs/reader/factcheck-engine.js');
const {search} = require(process.argv[4] ? path.resolve(process.argv[4]) : '../../docs/reader/evidence-search.js');
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = 'https://www.hankookilbo.com/news/article/A2024120214070004656';
const document = new JSDOM(readFileSync(process.argv[2], 'utf8')).window.document;
const edition = [...document.querySelectorAll('script[type="application/ld+json"]')]
  .map(element => JSON.parse(element.textContent)).find(data => data['@type'] === 'NewsArticle' && data.url === canonical);
if (!edition || edition.datePublished !== '2024-12-02T18:00:00+09:00') throw new Error('보도 원문과 발행일을 확인하세요.');
for (const br of document.querySelectorAll('#article-view-content > h2 br')) br.replaceWith('\n');
const parts = [...document.querySelectorAll('#article-view-content > h2.sub-tit-ll, #article-view-content > p.editor-p, #article-view-content > .editor-img-box .caption p')];
const article = [edition.headline, ...parts.map(part => part.textContent.trim())].join('\n');
const layout = readFileSync(process.argv[3], 'utf8');
if (digest(article) !== 'ae9a15f20236133475a817459cc81906efca361082f1625bcbef97a85c9ec351' ||
    digest(layout) !== 'ef15991254435a89993415a2670371c6a9c759f8e71b77e268ace43bb334218b') throw new Error('기사와 결산 자료의 판본을 확인하세요.');
const rows = factcheck.prepare(article, []).rows;
const index = rows.findIndex(row => digest(row.text) === 'ef4b01ae029942dd16102f3fccb049e0da9a8e1c4f7740cfca6c6a5a31149709');
if (index === -1) throw new Error('검토할 기사 문장이 현재 분할 결과에 없습니다.');
const {passages} = search(layout, rows[index].text), use = passages[0]?.reserveUse;
console.log(JSON.stringify({articleHash:digest(article), segments:rows.length, selected:index+1,
  firstThree:passages.slice(0,3).map(hit => hit.paragraph), selectedPurpose:use?.matchedPurpose ?? null,
  spent:use?.spent ?? null, decision:use?.decided ?? null, clauseShown:Boolean(use?.clause)},null,2));

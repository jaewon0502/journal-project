'use strict';

const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const trendPath = require.resolve('../../docs/reader/evidence-trend.js');
const ordinaryPath = require.resolve('../../docs/reader/evidence-finder.js');
const trend = require(trendPath);
const ordinary = require(ordinaryPath);
const workspace = require('./blind-workspace.json');
const gold = require('./transfer-gold.json');
const retry = require('./transfer-retry.json');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (!process.argv[2]) {
  console.error('사용법: node replay-trend.cjs 고용동향-layout.txt');
  process.exit(1);
}
const text = fs.readFileSync(process.argv[2], 'utf8');
assert.equal(digest(text), gold.textSha256);
assert.equal(digest(fs.readFileSync(path.join(__dirname,'transfer-gold.json'))), retry.originalGoldSha256);
assert.equal(digest(fs.readFileSync(path.join(__dirname,'transfer-retry.json'))),
  '285f7ebee74b258c5dc13aeff5f800ccb9cd6530f4e980c2982a0a566c5539f3');
const pages = [null];
let physicalPage = 1;
for (const line of text.split(/\r\n|[\n\r\u2028\u2029]/u)) {
  physicalPage += line.split('\f').length - 1;
  if (line.trim()) pages.push(physicalPage);
}

function search(query, articleContext) {
  const result = trend.find(text, query, {articleContext});
  const hits = result.state === 'ordinary' ? ordinary.find(text, query, {includeContext: true}) : result.hits;
  return {...result, hits};
}

function grade(task, result) {
  const rank = result.hits.findIndex(({paragraph}) => task.targets[pages[paragraph]]?.includes(paragraph)) + 1;
  return {taskId: task.id, state: result.state, reason: result.reason || null,
    usedArticleContext: result.usedArticleContext, needsPublicationDate: result.needsPublicationDate,
    centreRank: rank || null,
    candidates: result.hits.map(({paragraph, context}) => ({
      page: pages[paragraph], paragraph, context: context.map(row=>row.paragraph)
    }))};
}

const original = [], withContext = [];
for (const task of gold.tasks) {
  assert.ok(workspace.article.split('\n').includes(task.query));
  original.push(grade(task, search(task.query, '')));
  const context = retry.tasks.find(r=>r.id===task.id);
  if (context) withContext.push(grade(task, search(task.query, context.query)));
}
const summary = cases => ({
  attempted: cases.length,
  top1: cases.filter(row => row.centreRank === 1).length,
  top3: cases.filter(row => row.centreRank !== null).length,
  needsContext: cases.filter(row => row.state === 'needs-context').length,
  needsPublicationDate: cases.filter(row => row.needsPublicationDate).length
});
console.log(JSON.stringify({
  scope: '개발에 노출된 한 기사와 공식 원자료 1건. 검색 후보를 평가하며 실제 편집시간·정치 편향은 미측정.',
  trendSha256: digest(fs.readFileSync(trendPath)), ordinarySha256: digest(fs.readFileSync(ordinaryPath)),
  textSha256: gold.textSha256, original: {summary: summary(original), cases: original},
  contextualRetry: {summary: summary(withContext), cases: withContext},
  uniqueCorrectRetryCentres: new Set(withContext.filter(r=>r.centreRank).map(r=>r.candidates[r.centreRank-1].paragraph)).size,
},null,2));

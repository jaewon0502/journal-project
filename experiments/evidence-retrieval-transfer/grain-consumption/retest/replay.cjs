const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const sha = data => createHash('sha256').update(data).digest('hex');
const [readerDir, sourceDir, freezeFile] = process.argv.slice(2);
if (!freezeFile) throw Error('Usage: node replay.cjs READER_DIRECTORY SOURCE_DIRECTORY FROZEN_MANIFEST > run.json');
const read = file => fs.readFileSync(file);
const freezeBytes = read(freezeFile);
const freezeSha = '85dabc74dd8d67837ce73e535e5c7be31d2acb412299038ebfa37bc99b480642';
const sourceSha = 'b9ca682b5988b8b2639ad32cd20ba21ddb81c12a058776994e055543f27e4d70';
assert.equal(sha(freezeBytes), freezeSha, 'Frozen manifest changed');
const freeze = JSON.parse(freezeBytes);
const firstObservationSha = '27b76bf19a3b1ee1a5e3a413710e095bee1a4378775b4200b1e2b8151d7f6fe8';
assert.equal(sha(read(path.join(path.dirname(freezeFile), 'observed.json'))), firstObservationSha, 'First-pass observation changed');
const readerHash = createHash('sha256');
for (const name of fs.readdirSync(readerDir).filter(name => /\.(html|js|css)$/.test(name)).sort()) {
  readerHash.update(name + '\0' + sha(read(path.join(readerDir, name))) + '\n');
}
const readerSha256 = readerHash.digest('hex');
const pdfFile = path.resolve(sourceDir, 'report.pdf');
const sourceFile = path.resolve(sourceDir, 'report.journal-source.json');
assert.equal(sha(read(pdfFile)), freeze.source.pdfSha256, 'PDF changed');
assert.equal(sha(read(path.join(sourceDir, 'report.txt'))), freeze.source.pdftotextLayoutSha256, 'Layout changed');
assert.equal(sha(read(sourceFile)), sourceSha, 'Search document changed');
const source = JSON.parse(read(sourceFile));
assert.equal(source.pdfSha256, freeze.source.pdfSha256);
assert.equal(source.pages.length, freeze.source.physicalPages);
const rows = source.pages.flatMap((text, i) => text.split(/\r?\n/).filter(line => line.trim()).map(line => ({page:i+1, text:line})));
const normalize = text => text.trim().replace(/\s+/gu, ' ');
function quotedRows(excerpt) {
  const lines = new Set(excerpt.split(/\r?\n/).map(normalize).filter(Boolean));
  return rows.flatMap((row, i) => lines.has(normalize(row.text)) ? [i+1] : []);
}
function qualifies(test, rowNumbers) {
  return (test.directRows || []).some(row => rowNumbers.includes(row)) ||
    (test.allowGroupedRows || []).some(group => group.every(row => rowNumbers.includes(row)));
}
async function replay(browser, test, width) {
  const context = await browser.newContext({offline:true, viewport:{width,height:825}});
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(String(err)));
    page.on('dialog', dialog => dialog.accept());
    page.setDefaultTimeout(8000);
    await page.goto(pathToFileURL(path.resolve(readerDir,'factcheck.html')).href);
    const field = id => page.locator('#' + id);
    await field('article').fill(test.query);
    await page.getByRole('button', {name:'검토 목록 만들기'}).click();
    await page.getByRole('button', {name:'1번 문장 검토 열기',exact:true}).click();
    await field('go-find').click();
    assert.equal(await field('document-query').inputValue(), test.query);
    assert.equal(await field('search-context').inputValue(), '');
    await page.locator('#document-file-options > summary').click();
    await field('document-file').setInputFiles(sourceFile);
    await page.waitForFunction(() => document.querySelector('#document-file-status').textContent.includes('PDF 21쪽'));
    await field('document-pdf').setInputFiles(pdfFile);
    await page.waitForFunction(() => document.querySelector('#document-file-status').textContent.includes('연결 완료'));
    await field('find-passages').click();
    const status = await field('finder-status').innerText();
    const cards = page.locator('#finder-results .source');
    const results = [];
    for (const card of (await cards.all()).slice(0,3)) {
      const quote = await card.locator('blockquote').first().textContent();
      const heading = await card.locator('strong').first().textContent();
      const href = await card.locator('a[href*="#page="]').first().getAttribute('href');
      const pageNumber = Number(new URL(href).hash.match(/^#page=(\d+)$/)[1]);
      const quoted = quotedRows(quote).filter(row => rows[row-1].page === pageNumber);
      const headingRow = Number(heading.match(/(\d+)문단/u)?.[1] || 0);
      if (headingRow) assert.equal(rows[headingRow-1].page, pageNumber);
      results.push({visibleBeforeExpanding:await card.isVisible(), page:pageNumber, quoteRows:quoted,
        qualifies:qualifies(test,quoted)});
    }
    const viewportFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const visibleTypedCell = await field('finder-results').locator('p:visible').allTextContents()
      .then(lines => lines.some(line => /원문 표기|원표 표기/.test(line)));
    const before = {excerpt:await field('source-excerpt').inputValue(), verdict:await field('verdict').inputValue()};
    assert.deepEqual(before, {excerpt:'',verdict:''});
    let firstSelection = null;
    if (results.length) {
      const card = cards.first();
      if (!results[0].visibleBeforeExpanding) await page.locator('#finder-results > details:not([open]) > summary').first().click();
      const link = card.locator('a[href*="#page="]').first();
      const blobSha = await link.evaluate(async anchor => {
        const bytes = await (await fetch(anchor.href.split('#')[0])).arrayBuffer();
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2,'0')).join('');
      });
      assert.equal(blobSha, freeze.source.pdfSha256);
      await card.getByRole('button',{name:/발췌/}).first().click();
      const quote = await field('source-excerpt').inputValue();
      const quoteRows = quotedRows(quote);
      const proposal = await field('source-pdf-proposal-text').innerText();
      const pdfPage = results[0].page;
      assert.match(proposal, new RegExp('PDF '+pdfPage+'쪽'));
      assert.ok(quoteRows.length, 'Selected quote must occur in the locked source');
      firstSelection = {pdfPage, quoteRows, qualifies:qualifies(test,quoteRows), quoteSha256:sha(quote)};
    }
    const verdictAfter = await field('verdict').inputValue();
    assert.equal(verdictAfter, '');
    assert.deepEqual(errors, []);
    return {id:test.id, width, status, initialCandidates:results, firstSelection, visibleTypedCell, viewportFits, excerptBeforeSelectionEmpty:true, verdictBeforeAndAfterEmpty:true};
  } finally {await context.close();}
}
async function main() {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({channel:process.env.CHROME_CHANNEL || 'chrome',headless:true});
  try {
    const runs = [];
    for (const width of [320,1280]) for (const test of freeze.cases) runs.push(await replay(browser,test,width));
    const inputs = {freezeSha256:freezeSha, firstObservationSha256:firstObservationSha, pdfSha256:source.pdfSha256, sourceJsonSha256:sourceSha, layoutSha256:freeze.source.pdftotextLayoutSha256};
    console.log(JSON.stringify({browser:browser.version(),readerSha256,inputs,runs},null,2));
  } finally {await browser.close();}
}
main().catch(err => {console.error(err); process.exitCode=1;});

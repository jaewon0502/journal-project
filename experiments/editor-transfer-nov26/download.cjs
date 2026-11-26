// Write the public articles and official records to a new temporary directory, never into the repository.
'use strict';
const {execFile} = require('node:child_process');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');
const run = promisify(execFile);
const urls = {...require('./editions.cjs').urls, ...require('./prose/editions.cjs').urls, ...require('./diplomacy/editions.cjs').urls};
async function download() {
  const folder = await mkdtemp(path.join(tmpdir(), 'journal-transfer-'));
  const results = await Promise.allSettled(Object.entries(urls).map(([id, url]) =>
    run('curl', ['--fail', '--location', '--silent', '--show-error', '--max-time', '30', '--retry', '1',
      '--output', path.join(folder, id + (new URL(url).pathname.endsWith('.pdf') ? '.pdf' : '.html')), url])));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) {
    await rm(folder, {recursive:true, force:true});
    throw failed.reason;
  }
  console.log(folder);
}
download().catch(error => {console.error(error.message); process.exitCode = 1;});

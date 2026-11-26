// Keep copyrighted page HTML local. Print just the replay input directory on success.
'use strict';
const {execFile} = require('node:child_process');
const {mkdtemp} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {promisify} = require('node:util');
const {url} = require('./pages.cjs');

async function download() {
  const folder = await mkdtemp(path.join(tmpdir(), 'journal-editor-holdout-'));
  const curl = promisify(execFile);
  await Promise.all(Object.entries(url).map(([id, address]) =>
    curl('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '35',
      '--retry', '2', '--output', path.join(folder, id + '.html'), address])));
  console.log(folder);
}

download().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

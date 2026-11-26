// Extract the article and contemporary source texts. Keep all downloaded text outside Git.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {JSDOM} = require('jsdom');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
function clean(node) {
  const copy = node.cloneNode(true);
  for (const br of copy.querySelectorAll('br')) br.replaceWith(' ');
  return copy.textContent.replace(/\s+/gu, ' ').trim();
}
const paragraphs = (doc, selector) => [...doc.querySelectorAll(selector)].map(clean).filter(Boolean);
const url = {
  ko:'https://gonggam.korea.kr/newsContentView.es?mid=a12605000000&section_id=NCCD_CULTURE_TOTAL&news_id=f547fd9c-62f7-4f67-9c34-e2d1ccbaf293',
  en:'https://keyt.com/news/national-world/cnn-other/2024/06/18/voyager-1-sends-back-science-data-from-more-than-15-billion-miles-away-after-nasa-fix/',
  nobel:'https://www.nobelprize.org/prizes/literature/2024/press-release/',
  interview:'https://www.nobelprize.org/prizes/literature/2024/han/interview/',
  nasa:'https://science.nasa.gov/missions/voyager-program/voyager-1/voyager-1-returning-science-data-from-all-four-instruments/'
};
function load(folder) {
  function page(key) {
    return new JSDOM(fs.readFileSync(path.join(folder, key + '.html')), {url:url[key]}).window.document;
  }
  const ko = page('ko'), en = page('en');
  const koBody = ko.querySelector('#showCont');
  for (const br of koBody.querySelectorAll('br')) br.replaceWith('\n');
  const articles = {
    ko:[clean(ko.querySelector('.view-title h1, .view-title h2, .view-title h3, .view-title p')), ...koBody.textContent.split('\n').map(t => t.replace(/\s+/gu, ' ').trim()).filter(Boolean)],
    en:[clean(en.querySelector('.entry__header h1')), ...paragraphs(en,'.entry__content > p, .entry__content > h2, .entry__content > h3').filter(t => !t.startsWith('By Ashley Strickland') && !t.startsWith('The-CNN-Wire'))]
  };
  const primary = (doc, root) => paragraphs(doc, ['h2','h3','h4','p'].map(t => root + ' > ' + t).join(', '));
  const release = primary(page('nobel'),'article.page-content');
  const phone = primary(page('interview'),'article.page-content');
  const june = primary(page('nasa'),'.entry-content');
  function between(rows, from, to) {
    const a = rows.findIndex(t => t.startsWith(from)), b = rows.findIndex(t => t.startsWith(to));
    if (a === -1 || b < a) throw Error('Source section boundaries changed');
    return rows.slice(a,b + 1);
  }
  const sources = {
    nobel:between(release, 'The Permanent Secretary', '“for her intense'),
    interview:between(phone, 'First reactions. Telephone interview', 'HK: Take care. Bye.'),
    nasa:between(june, 'The spacecraft has resumed', 'Voyager 1 is more than')
  };
  return {articles,sources};
}
module.exports={load,sha,url};

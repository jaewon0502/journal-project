// The timed answer receives only the public document address and the editor's locator.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && !!module.exports;
  const engine = node ? require('./factcheck-engine.js') : root.JournalFactcheck;
  const marker = 'Journal 근거 위치';
  function fromSource(source) {
    if (typeof source?.url !== 'string' || typeof source.locator !== 'string' || !source.locator.trim())
      throw Error('등록한 원자료의 주소와 확인 위치를 확인하세요.');
    let target;
    try { target = engine.sourceTarget(source); }
    catch (err) {
      if (err instanceof TypeError) throw Error('원자료의 웹 주소를 확인하세요.');
      throw err;
    }
    if (!target) throw Error('실제 원자료의 웹 주소가 필요합니다.');
    const page = target.page || target.localPage;
    let locator = source.locator.trim();
    if (page) {
      const named = engine.pdfPageInLocator(locator,page);
      if (named === false) throw Error('확인 위치와 PDF 쪽번호가 다릅니다. 원자료에서 다시 대조하세요.');
      if (named === null) locator += ' · PDF ' + page + '쪽';
    }
    return {documentUrl:target.href, locator};
  }
  function encode(location) {
    return [marker, location.documentUrl, location.locator].join('\n');
  }
  function decode(text) {
    const [label, url, ...rows] = text.replace(/\r\n?/gu,'\n').trim().split('\n');
    if (label !== marker || !url || !rows.length) throw Error('팩트체크 화면에서 복사한 근거 위치를 붙여 넣으세요.');
    return fromSource({url,locator:rows.join('\n')});
  }
  function registered(work) {
    if (work?.format !== 'journal-local-factcheck-v1' || work.demo !== false || Object.hasOwn(work, 'blindReview') ||
        typeof work.article !== 'string' || !work.article.trim() || work.articleDraft !== work.article ||
        !Array.isArray(work.sources) || work.sources.some(engine.isMock))
      throw Error('실제 기사를 검토하면서 저장한 자신의 팩트체크 작업 파일을 선택하세요.');
    const result = [];
    for (const source of work.sources) {
      try {
        if (!source || !['id','version','excerpt'].every(k => typeof source[k] === 'string' && source[k].trim())) continue;
        engine.validatePdfBinding(source.pdfSha256,source.pdfPage);
        const location = fromSource(source);
        result.push({location, label:[source.title,source.version].filter(v => typeof v === 'string' && v.trim()).join(' · ') || '원자료'});
      } catch { /* Malformed or simulated sources cannot fill a field observation. */ }
    }
    if (!result.length) throw Error('이 파일에 가져올 수 있는 실제 원자료 위치가 없습니다.');
    return result;
  }
  const api = Object.freeze({fromSource, encode, decode, registered});
  if (node) module.exports = api;
  else root.JournalFieldCitation = api;
})(globalThis);

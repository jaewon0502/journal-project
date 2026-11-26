// Extract text and publisher-supplied metadata from a locally saved HTML page.
// Never attach imported nodes to the live document or resolve URLs against a local file.
(function (root) {
  'use strict';

  function unique(values) {
    const distinct = [...new Set(values.filter(Boolean))];
    return distinct.length === 1 ? distinct[0] : '';
  }

  function explicitDate(value) {
    const date = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/iu.exec(value);
    if (!date) return false;
    const day = new Date(date[1] + '-' + date[2] + '-' + date[3] + 'T00:00:00Z');
    return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10);
  }

  function webUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/u.test(url.protocol) && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function articleBody(fragment) {
    for (const selector of ['[itemprop~="articleBody"]', '.entry-content, .entry__content', 'article', 'main, [role="main"]']) {
      const areas = [...fragment.querySelectorAll(selector)].filter(el => el.querySelector('p, blockquote, li, br'));
      // Nested containers represent the same article. Multiple unrelated articles
      // cannot safely share one title and publication date.
      const outermost = areas.filter(area => !area.parentElement?.closest(selector));
      if (outermost.length === 1) return outermost[0];
      if (outermost.length > 1) break;
    }
    throw Error('웹문서에서 단일 기사 본문을 구별하지 못했습니다. 원문에서 확인할 대목을 붙여넣으세요.');
  }

  function parse(raw) {
    const template = document.createElement('template');
    template.innerHTML = raw;
    const fragment = template.content;
    // HTML fragment parsing flattens head/body. Only direct page-level tags
    // qualify as document metadata; ignore card, image and sidebar metadata.
    const top = [...fragment.children];
    function metadata(selector, attribute) {
      return top.filter(el => el.matches(selector)).map(el => (el.getAttribute(attribute) || '').trim()).filter(Boolean);
    }
    const addresses = [...metadata('link[rel~="canonical" i]', 'href'), ...metadata('meta[property="og:url" i]', 'content')];
    const normalized = addresses.map(webUrl);
    const url = normalized.every(Boolean) ? unique(normalized) : '';
    const title = unique(metadata('meta[property="og:title" i]', 'content')) ||
      unique(top.filter(el => el.matches('title')).map(el => el.textContent.trim()));

    for (const el of fragment.querySelectorAll('script, style, noscript, template, iframe, object, embed, svg, math, nav, aside, footer, form, [hidden], [aria-hidden="true" i]')) el.remove();
    const body = articleBody(fragment);
    for (const el of body.querySelectorAll('article')) el.remove();
    function dateField(property, item) {
      const tags = metadata('meta[property="article:' + property + '" i],meta[itemprop~="' + item + '"]', 'content');
      for (const el of body.querySelectorAll('time[itemprop~="' + item + '"],meta[itemprop~="' + item + '"]')) {
        const value = (el.getAttribute('datetime') || el.getAttribute('content') || '').trim();
        if (value) tags.push(value);
      }
      const value = unique(tags);
      return {value:explicitDate(value) ? value : '', uncertain:tags.length > 0 && !explicitDate(value)};
    }
    const published = dateField('published_time', 'datePublished');
    const modified = dateField('modified_time', 'dateModified');
    const tables = body.querySelectorAll('table').length;
    for (const table of body.querySelectorAll('table')) table.remove();
    const lines = [];
    let text = '';
    const flush = () => {
      const line = text.replace(/\s+/gu, ' ').trim();
      if (line) lines.push(line);
      text = '';
    };
    function read(element) {
      for (const child of element.childNodes) {
        if (child.nodeType === 3) { text += child.data; continue; }
        if (child.nodeType !== 1) continue;
        const block = child.matches('p, div, section, header, h1, h2, h3, h4, h5, h6, blockquote, li, ul, ol, br, figure, figcaption, pre, dl, dt, dd');
        if (block) flush();
        read(child);
        if (block) flush();
      }
    }
    read(body);
    flush();
    if (!lines.length) throw Error('웹문서에서 검색할 본문 단락을 찾지 못했습니다. 원문을 직접 확인하세요.');
    return {text:lines.join('\n'), document:null, web:{title, url, published:published.value, modified:modified.value,
      dateUncertain:published.uncertain || modified.uncertain, urlUncertain:addresses.length > 0 && !url, tables}};
  }

  root.JournalWebDocument = Object.freeze({parse});
})(globalThis);

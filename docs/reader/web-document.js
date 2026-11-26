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

  function articleSchema(fragment, url) {
    if (!url) return [];
    const page = url.split('#')[0];
    const matched = [];
    for (const script of fragment.querySelectorAll('script[type="application/ld+json" i]')) {
      let data;
      try { data = JSON.parse(script.textContent); } catch { continue; }
      for (const rootNode of [].concat(data)) {
        for (const item of [rootNode, ...([].concat(rootNode?.['@graph'] || []))]) {
          if (!item || ![].concat(item['@type']).some(type =>
            ['Article', 'NewsArticle', 'ReportageNewsArticle', 'AnalysisNewsArticle', 'BlogPosting', 'ScholarlyArticle'].includes(type))) continue;
          const identity = item.mainEntityOfPage;
          const pageId = typeof identity === 'string' ? identity : identity?.['@id'];
          const explicit = [pageId, item.url].filter(Boolean);
          if (!explicit.length && item['@id']) explicit.push(item['@id']);
          if (explicit.length && explicit.every(value => typeof value === 'string' && webUrl(value).split('#')[0] === page)) matched.push(item);
        }
      }
    }
    return matched;
  }

  function consistentDate(tags) {
    if (!tags.length) return {value:'', uncertain:false};
    const dates = tags.map(value => value.replace(/^(\d{4}-\d{2}-\d{2})Z$/iu, '$1'));
    if (!dates.every(explicitDate)) return {value:'', uncertain:true};
    if (new Set(dates).size === 1) return {value:dates[0], uncertain:false};
    // Alternate offsets can denote exactly the same instant. Only compare
    // instants that contain an explicit zone, never a browser-local time.
    if (dates.every(value => value.includes('T') && /(?:Z|[+-]\d{2}:\d{2})$/iu.test(value)) &&
        new Set(dates.map(value => new Date(value).getTime())).size === 1)
      return {value:dates[0], uncertain:false};
    const day = unique(dates.map(value => value.slice(0,10)));
    return {value:day, uncertain:true};
  }

  function articleBody(fragment, title) {
    const scope = fragment.querySelectorAll('main, [role="main"]');
    const root = scope.length === 1 ? scope[0] : fragment;
    const articles = [...root.querySelectorAll('article')].filter(el => !el.parentElement?.closest('article'));
    function hasBody(el) {
      return !!el.querySelector('p, blockquote, li, br');
    }
    for (const article of articles) for (const nested of article.querySelectorAll('article')) nested.remove();
    const candidates = articles.filter(hasBody);
    const normalize = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
    let area = root;
    if (candidates.length === 1) {
      area = candidates[0];
      const otherHeadline = [...root.querySelectorAll('h1')].some(h =>
        !area.contains(h) && title && normalize(h.textContent) === normalize(title));
      if (otherHeadline && [...root.querySelectorAll('p')].some(p => !area.contains(p) && !p.closest('header')))
        throw Error('웹문서에서 단일 기사 본문을 구별하지 못했습니다. 원문에서 확인할 대목을 붙여넣으세요.');
    } else if (candidates.length > 1) {
      const identified = candidates.filter(a => [...a.querySelectorAll('h1')].some(h =>
        title && normalize(h.textContent) === normalize(title)));
      if (identified.length !== 1) throw Error('웹문서에서 단일 기사 본문을 구별하지 못했습니다. 원문에서 확인할 대목을 붙여넣으세요.');
      area = identified[0];
    } else if (articles.length || area === fragment) {
      // Some publishers use schema.org articleBody instead of an article/main
      // element. Require a single such body and its page-identifying headline.
      const bodies = [...root.querySelectorAll('[itemprop~="articleBody"]')].filter(hasBody);
      const owner = bodies.length === 1 && bodies[0].parentElement;
      const headings = owner ? owner.querySelectorAll('h1') : [];
      if (articles.length || !title || headings.length !== 1 || normalize(headings[0].textContent) !== normalize(title))
        throw Error('웹문서에서 단일 기사 본문을 구별하지 못했습니다. 원문에서 확인할 대목을 붙여넣으세요.');
      area = bodies[0];
    }
    for (const selector of ['[itemprop~="articleBody"]', '.entry-content, .entry__content']) {
      if (area.matches?.(selector)) return area;
      const inner = [...area.querySelectorAll(selector)].filter(hasBody);
      if (inner.length === 1) return inner[0];
    }
    return area;
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

    const schema = articleSchema(fragment, url);
    for (const el of fragment.querySelectorAll('script, style, noscript, template, iframe, object, embed, svg, math, nav, aside, footer, form, [hidden], [aria-hidden="true" i]')) el.remove();
    const body = articleBody(fragment, title);
    function dateField(property, item) {
      const tags = metadata('meta[property="article:' + property + '" i],meta[itemprop~="' + item + '"]', 'content');
      for (const el of body.querySelectorAll('time[itemprop~="' + item + '"],meta[itemprop~="' + item + '"]')) {
        const value = (el.getAttribute('datetime') || el.getAttribute('content') || '').trim();
        if (value) tags.push(value);
      }
      tags.push(...schema.map(item => item[property === 'published_time' ? 'datePublished' : 'dateModified'])
        .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()));
      if (property === 'published_time') {
        for (const time of body.querySelectorAll('header time.post-date[datetime],header time.published[datetime]')) {
          if (time.closest('header').querySelector('h1') && !time.matches('[itemprop~="dateModified"],.updated'))
            tags.push(time.getAttribute('datetime').trim());
        }
      }
      return consistentDate(tags);
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

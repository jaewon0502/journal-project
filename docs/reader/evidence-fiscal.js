// A stage is a search constraint. It says nothing about whether an amount is correct.
(function (root) {
  'use strict';

  const money = /예산|회계|결산|총지출|세출|사업비|구매비|요구액|확정액|편성액|집행액|지출액|[\d천만억조]\s*원/u;
  // A fine or a damages award may also have a confirmed amount and an execution date.
  const nonBudget = /배상금|손해배상|벌금|사형|형집행|판결|형사소송|민사소송/u;
  const budgetDomain = /예산|재정|세출|결산|사업비/u;
  const proposal = /정부\s*안|정부\s*(?:제출|편성)안|국회\s*제출안|제출안/u;
  const requested = /(?:요구|요청)(?:액|서|안|하[였는]|했|한|해|받은)|부처\s*요구/u;
  const approval = /확정\s*(?:액|예산)|본예산(?!안)|(?:국회|본회의|의회).{0,45}?(?:의결|가결|통과|승인|확정)|(?:의결|가결|통과|확정)(?:된|한|했|됐|되었|하였|액)|예산(?:안|액)?(?:을|를|이|가)?\s*확정/u;
  const spending = /집행액|지출액|결산|실(?:제|제로)\s*(?:집행|지출|지급)|(?:집행|지출|지급)(?:한|했|됐|되었|하였)|집행\s*실적/u;
  const uncertain = /(?:할|될)\s*(?:예정|계획|전망|가능|것)|(?:[하지되]\s*)?지\s*(?:않|못)|하지\s*못|되지\s*못|여부|예정|전망|목표|예측|보류|부결|무산|계획|기대|전(?:에|이다|$)|아직|예상|미공개|미발표/u;
  const stageWords = {
    request: /요구|요청/u,
    proposal: /정부\s*안|제출안|예산안/u,
    approved: /의결|가결|통과|확정|승인|본예산/u,
    spent: /집행|지출|지급|결산/u
  };
  const labels = {request:'부처·기관 요구액', proposal:'정부 제출안', approved:'의회 의결·확정 예산', spent:'결산·실제 집행액'};

  // Strip forward-looking and negated mentions before testing the clause. A
  // nearby real budget submission may still be usable in that same clause.
  function stated(text, stage) {
    const mentions = new RegExp(stageWords[stage].source, 'gu');
    let found = false;
    for (const match of text.matchAll(mentions)) {
      const before = text.slice(Math.max(0, match.index - 10), match.index);
      const end = match.index + match[0].length;
      const after = text.slice(end, end + 12);
      const tail = after.split(/[,;.!?]|\s(?:이후|뒤|반면|다만|그러나|하지만)\s/u)[0];
      // An explicit denial applies to the amount even when the same clause
      // previously called it a '본예산' or '결산액'.
      if (/(?:미|미리\s*|예상\s*|예정\s*|잠정\s*)$/u.test(before) || uncertain.test(tail)) return false;
      found = true;
    }
    return found;
  }
  function stages(value) {
    const text = String(value || '').normalize('NFKC');
    const result = new Set();
    if (!money.test(text) || (nonBudget.test(text) && !budgetDomain.test(text))) return result;
    // Contrastive clauses can report a proposal and its later adoption together.
    for (const clause of text.split(/[;!?\n]|[.](?!\d)|[,](?!\d)|(?:였|했|됐|했었|이었)지만\s*|반면|그러나/gu)) {
      if (!clause.trim()) continue;
      const asks = requested.test(clause) && stated(clause, 'request');
      const governmental = proposal.test(clause);
      const adoptionMention = approval.test(clause);
      // A cabinet adoption or committee resolution can precede the final vote.
      const intermediate = /(?:상임위|위원회|예결위|소위|국무회의|정부가|정부는).{0,22}(?:의결|통과|확정)/u.test(clause) &&
        !/(?:본회의|지방의회|국회가|국회는).{0,32}(?:통과|확정|의결)/u.test(clause);
      const adopted = adoptionMention && !intermediate && stated(clause, 'approved') &&
        !/본예산안|잠정\s*확정/u.test(clause);
      if (asks) result.add('request');
      if (adopted) result.add('approved');
      if ((governmental || (/예산안/u.test(clause) && !asks && !adoptionMention && !intermediate && !/수정안|의원안|표결|부결/u.test(clause))) &&
          stated(clause, 'proposal')) result.add('proposal');
      if (spending.test(clause) && stated(clause, 'spent')) result.add('spent');
    }
    return result;
  }
  function request(text) {
    // Questions about votes, publication dates and personnel also mention budget stages.
    if (/몇\s*(?:명|표|건|일)|어느\s*(?:날|의원)|(?:의결|제출|발표|확정)(?:일|\s*날짜)|언제|누가/u.test(text)) return null;
    const found = stages(text);
    return found.size === 1 ? found.values().next().value : null;
  }
  // Prefer a stated fiscal year over an adoption or publication date.
  function years(text) {
    const named = text.match(/(?<!\d)(?:19|20)\d{2}(?=\s*(?:회계\s*연도|년도))/gu);
    const other = /(?<!\d)(?:19|20)\d{2}(?=\s*년)|올해|금년|당해연도|지난해|작년|전년도?|내년|차년도|다음\s*해/gu;
    return new Set((named || text.match(other) || []).map(year => year.replace(/금년|당해연도/u, '올해')
      .replace(/작년|전년도?/u, '지난해').replace(/차년도|다음\s*해/u, '내년')));
  }

  function project(text) {
    // Common suffixes such as '주거 지원' occur in otherwise different program names.
    const words = /(?<![가-힣A-Za-z0-9-])((?:[가-힣A-Za-z0-9-]{1,32}\s+){1,5})사업(?:[은는이가의을에]|\s|$)/u.exec(text)?.[1].trim().split(/\s+/u);
    if (words) {
      const boundary = words.findLastIndex(word => /^(?:(?:19|20)\d{2}(?:회계연도|년도|년)|올해|지난해|작년|내년|해당|대한|위한|그|이)$/u.test(word) ||
        /(?:에서|으로|관한|제안한|발의한|추진한|시행한|\S[은는을를의])$/u.test(word));
      const name = words.slice(boundary + 1).join('');
      if (name) return name;
    }
    // A fiscal total can identify its spending authority or line item without
    // calling it a 사업. A bare '정부안' denotes a stage, not an authority here.
    const authority = /중앙정부|지방정부|시[·ㆍ・]?도교육청|[가-힣]{2,8}교육청|지방자치단체/u.exec(text)?.[0];
    const item = /의료비|교육비|인건비|운영비|연구비|시설비|홍보비|재료비|복지비|교통비|총수입|세입/u.exec(text)?.[0];
    return [authority?.replace(/[·ㆍ・]/gu, ''), item].filter(Boolean).join(' ') || null;
  }
  // Within a sentence, a second printed amount can carry forward the project,
  // year or stage. Never carry a stage into an unqualified narrative assertion.
  const nextAmount = /^\s*(?:(?:(?:19|20)\d{2}\s*(?:회계연도|년도|년)|올해|금년|지난해|작년|전년도|내년)(?:에는|은|는|에)?\s+)?[+−-]?\d[\d,.]*\s*[십백천만억조]*\s*원(?:이다|이었다|이었다고|이었음|입니다|이었습니다)?\s*$/u;
  function clauses(text) {
    const result = [];
    for (const sentence of text.normalize('NFKC').split(/[!?。\n\r]|\.(?!\d)/u)) {
      let name = null, period = new Set(), stage = null;
      for (const part of sentence.split(/[,，](?!\d)|[;；]|(?<=이고|이며|[었였했]으며|[었였했]고|지만)\s+|\s+반면(?:에)?\s+/u)) {
        const clause = part.trim();
        if (!clause) continue;
        const named = project(clause), dated = years(clause), explicit = stages(clause);
        if (named && name && named !== name) stage = null;
        if (named) name = named;
        if (dated.size) period = dated;
        if (explicit.size === 1) stage = explicit.values().next().value;
        else if (explicit.size || !nextAmount.test(clause)) stage = null;
        result.push({text:clause, project:name, years:period, stage});
      }
    }
    return result;
  }
  function gap(stage) {
    return '질문의 사업·기간에 해당하는 ' + labels[stage] + ' 근거를 특정하기 어렵습니다. 그 단계의 원문과 금액을 확인하세요.';
  }

  const api = {stages, request, years, project, clauses, gap, label: stage => labels[stage]};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JournalEvidenceFiscal = api;
})(globalThis);

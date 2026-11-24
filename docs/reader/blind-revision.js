/* Prepare independent work files and match returned work to the coordinator's private key, offline. */
(function (root) {
  'use strict';
  const useNode = typeof module === 'object' && !!module.exports;
  const workspace = useNode ? require('./workspace-snapshot.js') : root.JournalWorkspaceSnapshot;
  const format = 'journal-blind-revision-key-v1';
  const roles = ['before', 'after'];
  const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

  function cryptoProvider() {
    const provider = useNode ? require('node:crypto').webcrypto : root.crypto;
    if (!provider?.getRandomValues || !provider.subtle) {
      throw new Error('파일 짝을 확인하려면 Web Crypto를 지원하는 브라우저에서 이 페이지를 여세요.');
    }
    return provider;
  }

  async function digest(value) {
    // JSON string encoding preserves the exact article, even isolated UTF-16 surrogates from imported JSON.
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return hex(new Uint8Array(await cryptoProvider().subtle.digest('SHA-256', bytes)));
  }

  async function fingerprints(work) {
    const identities = workspace.sourceIdentities(work.sources);
    const [articleSha256, sourcesSha256] = await Promise.all([digest(work.article), digest(identities)]);
    return {articleSha256, sourcesSha256};
  }

  async function prepare(before, after) {
    const original = workspace.independentInput(before);
    const revision = workspace.independentInput(after);
    if (original.article === revision.article) throw new Error('기사 원문이 같습니다. 수정 전과 수정 후 작업 파일을 하나씩 선택하세요.');
    if (original.demo !== revision.demo) throw new Error('연습 기록끼리 또는 실제 기사 작업 파일끼리 선택하세요.');

    // The assignment bit stays private. The public pair ID uses separate random bytes.
    const random = cryptoProvider().getRandomValues(new Uint8Array(17));
    const pairId = hex(random.subarray(0, 16));
    const packets = {A: null, B: null};
    const key = {format, pairId, demo: original.demo, mapping: {}};
    for (const [index, packet] of [original, revision].entries()) {
      const slot = index === (random[16] & 1) ? 'A' : 'B';
      packet.sources.forEach((source, i) => { source.id = 'source-' + (i + 1); });
      packet.blindReview = {pairId, slot};
      packets[slot] = packet;
      key.mapping[roles[index]] = {slot, ...await fingerprints(packet)};
    }
    return {packets, key};
  }

  function validKey(key) {
    if (key?.format !== format || typeof key.demo !== 'boolean') return false;
    const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
    for (const role of roles) {
      const side = key.mapping?.[role];
      if (!workspace.blindTag({pairId: key.pairId, slot: side?.slot}) ||
          !validDigest(side.articleSha256) || !validDigest(side.sourcesSha256)) return false;
    }
    const {before, after} = key.mapping;
    return before.slot !== after.slot && before.articleSha256 !== after.articleSha256;
  }

  async function resolve(key, one, two) {
    if (!validKey(key)) throw new Error('배포할 때 따로 보관한 진행자용 대응표 파일을 확인하세요.');
    const bySlot = new Map();
    for (const work of [one, two]) {
      const tag = workspace.blindTag(work?.blindReview);
      if (!tag) throw new Error('블라인드 배정 표시를 확인할 수 없습니다. 배포한 A·B 파일에서 저장한 작업 파일을 선택하세요.');
      if (tag.pairId !== key.pairId) throw new Error('대응표와 다른 묶음입니다. 같은 배포에서 회수한 작업 파일을 선택하세요.');
      if (bySlot.has(tag.slot)) throw new Error('같은 배정의 작업 파일을 두 번 선택했습니다. A와 B를 하나씩 선택하세요.');
      bySlot.set(tag.slot, work);
    }
    const result = {before: null, after: null, sourceChanged: false};
    for (const role of roles) {
      const side = key.mapping[role];
      const work = bySlot.get(side.slot);
      const snapshot = workspace.read(work);
      if (snapshot.demo !== key.demo) throw new Error('배포 당시의 연습·실제 기사 구분과 다릅니다. 회수한 작업 파일을 확인하세요.');
      const current = await fingerprints(work);
      if (side.articleSha256 !== current.articleSha256) {
        throw new Error('배포한 기사 원문과 다릅니다. 배정된 기사 본문을 그대로 평가한 작업 파일을 선택하세요.');
      }
      if (side.sourcesSha256 !== current.sourcesSha256) result.sourceChanged = true;
      result[role] = work;
    }
    return result;
  }

  async function resolveBundle(items) {
    if (!Array.isArray(items) || items.length !== 6) {
      throw new Error('두 편집자의 작업 파일 네 개와 진행자용 대응표 두 개를 선택하세요. 모두 여섯 개가 필요합니다.');
    }
    const keys = [];
    const files = new Map();
    for (const item of items) {
      const data = item?.data;
      if (data?.format === format) {
        if (!validKey(data)) throw new Error('진행자용 대응표를 확인하세요. 선택한 파일 · ' + item.name);
        if (files.has(data.pairId)) throw new Error('같은 배포 묶음의 대응표가 두 개입니다. 편집자별 대응표를 하나씩 선택하세요.');
        keys.push(data);
        files.set(data.pairId, new Map());
      }
    }
    if (keys.length !== 2) throw new Error('서로 다른 두 편집자에게 배포한 진행자용 대응표가 하나씩 필요합니다.');
    for (const item of items) {
      const data = item?.data;
      if (data?.format === format) continue;
      const tag = workspace.blindTag(data?.blindReview);
      if (data?.format !== workspace.schema || !tag) {
        throw new Error('A·B로 배정한 작업 파일을 선택하세요. 확인할 파일 · ' + (item?.name || '이름 없음'));
      }
      const group = files.get(tag.pairId);
      if (!group) throw new Error('선택한 대응표와 다른 묶음의 작업 파일입니다. 확인할 파일 · ' + item.name);
      if (group.has(tag.slot)) {
        throw new Error('같은 묶음의 ' + tag.slot + ' 파일을 두 번 선택했습니다. A와 B를 하나씩 선택하세요.');
      }
      group.set(tag.slot, item);
    }
    keys.sort((a, b) => a.pairId.localeCompare(b.pairId));
    const [first, second] = keys;
    if (first.demo !== second.demo) throw new Error('연습 기록끼리 또는 실제 기사 기록끼리 선택하세요.');
    for (const role of roles) {
      const side = role === 'before' ? '원본' : '수정본';
      if (first.mapping[role].articleSha256 !== second.mapping[role].articleSha256) {
        throw new Error('두 편집자에게 배포한 ' + side + '의 기사 원문이 다릅니다. 같은 기사의 파일을 선택하세요.');
      }
      if (first.mapping[role].sourcesSha256 !== second.mapping[role].sourcesSha256) {
        throw new Error('두 편집자에게 배포한 ' + side + '의 원자료 묶음이 다릅니다. 같은 자료로 평가한 파일을 선택하세요.');
      }
    }
    return Promise.all(keys.map(async key => {
      // Four distinct work files tagged A/B across these two keys fill all four slots.
      const group = files.get(key.pairId);
      const ordered = roles.map(role => group.get(key.mapping[role].slot));
      const code = key.pairId.slice(0, 8);
      try {
        const result = await resolve(key, ordered[0].data, ordered[1].data);
        if (result.sourceChanged) throw new Error('배포 후 등록된 원자료가 달라졌습니다. 배포 당시 자료로 평가한 파일을 선택하세요.');
        return {...result, key, ordered, code};
      } catch (error) {
        throw new Error('묶음 ' + code + ' · ' + error.message);
      }
    }));
  }

  const api = Object.freeze({prepare, resolve, resolveBundle});
  if (useNode) module.exports = api;
  else root.JournalBlindRevision = api;
})(globalThis);

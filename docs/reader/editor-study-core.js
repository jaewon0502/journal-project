/* Descriptive analysis of the four-case editor study. No ratings or durations are inferred. */
(function (root, makeStudy) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = makeStudy(require('./editor-study-cases.js'));
  } else {
    root.JournalEditorStudy = makeStudy(root.JournalStudyCases);
  }
})(globalThis, function (cases) {
  'use strict';
  const protocol = 'journal-editor-study-v1';
  const methods = ['manual', 'journal'];
  const stages = Object.freeze(['select', 'locate', 'decide']);
  const verdicts = ['supported', 'contradicted', 'insufficient', 'opinion'];
  const slots = 4;
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  if (!cases || !Array.isArray(cases.ids) || cases.ids.length !== slots || new Set(cases.ids).size !== slots) {
    throw new Error('연구에 사용할 네 가지 기사 세트를 확인하세요.');
  }

  function checkOrdinal(ordinal) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > Number.MAX_SAFE_INTEGER - slots) {
      throw new Error('배정 번호는 1 이상의 안전한 정수여야 합니다.');
    }
  }

  function plan(ordinal) {
    checkOrdinal(ordinal);
    const editor = (ordinal - 1) % slots;
    const rotation = Math.floor((ordinal - 1) / slots) % slots;
    // Two orthogonal Latin squares of order four. Rotate periods between blocks.
    const columnPermutation = [0, 2, 3, 1];
    return cases.ids.map((_, index) => {
      const column = (index + rotation) % slots;
      const condition = editor ^ columnPermutation[column];
      return {
        position: index + 1,
        caseId: cases.ids[editor ^ column],
        method: methods[condition >> 1],
        variant: condition % 2 === 0 ? 'A' : 'B',
      };
    });
  }

  function createRecord(participantId, ordinal, kind, editorAttested) {
    checkOrdinal(ordinal);
    if (typeof participantId !== 'string' || !idPattern.test(participantId)) {
      throw new Error('참가자 코드는 영문·숫자로 시작하는 1~64자의 코드로 입력하세요. 하이픈과 밑줄을 사용할 수 있습니다.');
    }
    if (!['editor', 'demo'].includes(kind) || editorAttested !== (kind === 'editor')) {
      throw new Error('실측에는 현업 편집자 본인의 확인이 필요합니다. 예시 기록은 별도로 등록하세요.');
    }
    return {protocol, participantId, ordinal, kind, editorAttested, trials: []};
  }

  function checkedPhases(ms, elapsedMs) {
    if (ms === null) return null; // Participant missed a transition or interrupted the split timer.
    if (typeof ms !== 'object' || Array.isArray(ms) || Object.keys(ms).length !== stages.length ||
        !stages.every(stage => Object.hasOwn(ms, stage) && Number.isSafeInteger(ms[stage]) && ms[stage] >= 0) ||
        stages.reduce((sum, stage) => sum + ms[stage], 0) !== elapsedMs) {
      throw new Error('세 단계의 시간과 전체 검토 시간 합계를 확인하세요.');
    }
    return Object.fromEntries(stages.map(stage => [stage, ms[stage]]));
  }

  function checkedTrial(expected, observation, fromFile) {
    if (!observation || typeof observation !== 'object') throw new Error('누락된 회차 기록입니다.');
    for (const key of ['position', 'caseId', 'method', 'variant']) {
      if ((fromFile || Object.hasOwn(observation, key)) && observation[key] !== expected[key]) {
        throw new Error('사전에 배정한 기사, 정당, 방식 또는 순서와 일치하지 않습니다.');
      }
    }
    const {elapsedMs, verdict, sourceIds, reason} = observation;
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs <= 0) throw new Error('측정 시간은 양의 밀리초 값이어야 합니다.');
    if (!verdicts.includes(verdict)) throw new Error('판정 범주를 확인하세요.');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 4000) {
      throw new Error('판단 이유를 1~4,000자 이내로 입력하세요.');
    }
    const journalUsed = observation.journalUsed === undefined && !fromFile ? false : observation.journalUsed;
    if (journalUsed !== (expected.method === 'journal')) throw new Error('배정된 방식으로 진행한 검토만 기록할 수 있습니다.');
    const item = cases.get(expected.caseId, expected.variant);
    if (!Array.isArray(sourceIds) || sourceIds.length > 1 ||
        !sourceIds.every(id => item.sources.some(source => source.id === id))) {
      throw new Error('제공된 자료 중 대표 근거 하나 또는 근거 없음을 선택하세요.');
    }
    const trial = {...expected, elapsedMs, verdict, reason: reason.trim(), sourceIds: [...sourceIds], journalUsed};
    if (Object.hasOwn(observation, 'phaseMs')) trial.phaseMs = checkedPhases(observation.phaseMs, elapsedMs);
    return trial;
  }

  function validateRecord(input) {
    if (!input || input.protocol !== protocol || !Array.isArray(input.trials) || input.trials.length > slots) {
      throw new Error('이 연구 버전의 참가자 기록이 필요합니다.');
    }
    const result = createRecord(input.participantId, input.ordinal, input.kind, input.editorAttested);
    const assignments = plan(result.ordinal);
    result.trials = Array.from(input.trials, (observation, index) => checkedTrial(assignments[index], observation, true));
    if (Object.hasOwn(input, 'withdrawn')) {
      if (typeof input.withdrawn !== 'boolean' || (input.withdrawn && result.trials.length === slots))
        throw new Error('중단 여부와 제출한 과제 수를 확인하세요.');
      if (input.withdrawn) result.withdrawn = true;
    }
    return result;
  }

  function addTrial(input, observation) {
    const record = validateRecord(input);
    if (record.withdrawn) throw new Error('참여 중단이 확인된 기록에는 과제를 추가할 수 없습니다.');
    if (record.trials.length >= slots) throw new Error('네 회차를 모두 마친 참가자입니다.');
    const expected = plan(record.ordinal)[record.trials.length];
    record.trials.push(checkedTrial(expected, observation, false));
    return record;
  }

  function mergeRecords(existing, incoming) {
    if (!Array.isArray(existing) || !Array.isArray(incoming)) throw new Error('참가자 기록 목록 형식을 확인하세요.');
    const byId = new Map();
    const bySlot = new Map();
    for (const input of [...existing, ...incoming]) {
      const record = validateRecord(input);
      const id = record.kind + '/' + record.participantId;
      const slot = record.kind + '/' + record.ordinal;
      const previous = byId.get(id);
      if ((previous && previous.ordinal !== record.ordinal) || (bySlot.has(slot) && bySlot.get(slot) !== id)) {
        throw new Error('참가자 코드 또는 배정 번호가 겹칩니다. 배정 명부와 원래 파일을 확인하세요.');
      }
      if (previous) {
        const common = Math.min(previous.trials.length, record.trials.length);
        if ((previous.withdrawn && record.trials.length > previous.trials.length) ||
            (record.withdrawn && previous.trials.length > record.trials.length)) {
          throw new Error('중단 확인 뒤에 제출된 회차가 있습니다. 같은 배정의 원본 파일을 확인하세요.');
        }
        const longer = record.trials.length > previous.trials.length ? record : previous;
        const trials = [...longer.trials];
        for (let i = 0; i < common; i++) {
          const {phaseMs: priorPhases, ...prior} = previous.trials[i];
          const {phaseMs: nextPhases, ...next} = record.trials[i];
          if (JSON.stringify(prior) !== JSON.stringify(next) ||
              (priorPhases !== undefined && nextPhases !== undefined && JSON.stringify(priorPhases) !== JSON.stringify(nextPhases))) {
            throw new Error('같은 참가자·회차에 서로 다른 기록이 있습니다. 원본을 확인하세요.');
          }
          // A v1 export from an earlier viewer may omit the optional phase field.
          if (priorPhases !== undefined) trials[i] = previous.trials[i];
          else if (nextPhases !== undefined) trials[i] = record.trials[i];
        }
        const merged = {...longer, trials};
        if (previous.withdrawn || record.withdrawn) merged.withdrawn = true;
        byId.set(id, merged);
      } else {
        byId.set(id, record);
      }
      bySlot.set(slot, id);
    }
    return [...byId.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.ordinal - b.ordinal);
  }

  function blockRoster(records) {
    const grouped = new Map();
    for (const record of records) {
      const block = Math.floor((record.ordinal - 1) / slots) + 1;
      if (!grouped.has(block)) grouped.set(block, new Map());
      grouped.get(block).set(record.ordinal, record);
    }
    return [...grouped].map(([block, members]) => {
      const missingOrdinals = [], unfinishedOrdinals = [], withdrawnOrdinals = [];
      let completed = 0;
      for (let i = 1; i <= slots; i++) {
        const ordinal = (block - 1) * slots + i;
        if (!members.has(ordinal)) missingOrdinals.push(ordinal);
        else if (members.get(ordinal).trials.length < slots) {
          unfinishedOrdinals.push(ordinal);
          if (members.get(ordinal).withdrawn) withdrawnOrdinals.push(ordinal);
        }
        else completed++;
      }
      return {block, enrolled: members.size, completed, included: completed === slots, missingOrdinals, unfinishedOrdinals, withdrawnOrdinals};
    });
  }

  function timeStats(records, stage) {
    let manualSeconds = 0, journalSeconds = 0;
    const editorPairs = [];
    for (const record of records) {
      const seconds = {};
      for (const method of methods) {
        const trials = record.trials.filter(t => t.method === method);
        const totalMs = trials.reduce((sum, t) => sum + (stage ? t.phaseMs[stage] : t.elapsedMs), 0);
        seconds[method] = totalMs / (1000 * trials.length);
      }
      manualSeconds += seconds.manual / records.length;
      journalSeconds += seconds.journal / records.length;
      editorPairs.push({participantId: record.participantId, manualSeconds: seconds.manual, journalSeconds: seconds.journal,
        savedSeconds: seconds.manual - seconds.journal});
    }
    const savedSeconds = manualSeconds - journalSeconds;
    const savings = editorPairs.map(pair => pair.savedSeconds).sort((a, b) => a - b);
    const medianSavedSeconds = (savings[Math.floor((savings.length - 1) / 2)] + savings[Math.floor(savings.length / 2)]) / 2;
    const fasterEditors = savings.filter(seconds => seconds > 0).length;
    const slowerEditors = savings.filter(seconds => seconds < 0).length;
    return {manualSeconds, journalSeconds, savedSeconds, reductionPct: manualSeconds ? 100 * savedSeconds / manualSeconds : null,
      editorPairs, medianSavedSeconds, fasterEditors, slowerEditors, unchangedEditors:savings.length - fasterEditors - slowerEditors};
  }

  function phaseStats(sample) {
    // Only whole already-eligible 4-person blocks retain the case/order/party balance.
    const incomplete = new Set(sample.filter(record => record.trials.some(t => !t.phaseMs))
      .map(record => Math.floor((record.ordinal - 1) / slots)));
    const eligible = sample.filter(record => !incomplete.has(Math.floor((record.ordinal - 1) / slots)));
    return {
      availableTrials: sample.reduce((n, r) => n + r.trials.filter(t => t.phaseMs).length, 0),
      included: eligible.length, trialCount: eligible.length * slots, completeBlocks: eligible.length / slots,
      byStage: eligible.length ? Object.fromEntries(stages.map(stage => [stage, timeStats(eligible, stage)])) : null
    };
  }

  function emptyCells() {
    const cell = () => ({counts:{supported:0, contradicted:0, insufficient:0, opinion:0}, total:0});
    return {A:cell(), B:cell()};
  }

  function caseCells() {
    return new Map(cases.ids.map(id => [id, {manual:emptyCells(), journal:emptyCells()}]));
  }

  function pooledBias(items, excluded) {
    const gaps = {manual:0, journal:0};
    const distributionGaps = {manual:0, journal:0};
    const caseRates = [];
    for (const [caseId, item] of items) {
      const row = {caseId};
      for (const method of methods) {
        const cells = {};
        for (const variant of ['A','B']) {
          const all = item[method][variant], omit = excluded?.get(caseId)[method][variant];
          const total = all.total - (omit?.total ?? 0);
          const counts = Object.fromEntries(verdicts.map(v => [v, all.counts[v] - (omit?.counts[v] ?? 0)]));
          cells[variant] = {counts, endorsed:counts.supported, total, endorsedPct:100 * counts.supported / total};
        }
        cells.signedGapPp = cells.A.endorsedPct - cells.B.endorsedPct;
        gaps[method] += Math.abs(cells.signedGapPp) / items.size;
        // Half the absolute differences avoids counting a move between two verdicts twice.
        cells.distributionGapPp = 50 * verdicts.reduce((sum, v) =>
          sum + Math.abs(cells.A.counts[v] / cells.A.total - cells.B.counts[v] / cells.B.total), 0);
        distributionGaps[method] += cells.distributionGapPp / items.size;
        row[method] = cells;
      }
      caseRates.push(row);
    }
    const reductionPp = gaps.manual - gaps.journal;
    return {manualGapPp:gaps.manual, journalGapPp:gaps.journal, reductionPp,
      distribution:{manualGapPp:distributionGaps.manual, journalGapPp:distributionGaps.journal,
        reductionPp:distributionGaps.manual - distributionGaps.journal},
      reductionPct:gaps.manual > 0 ? 100 * reductionPp / gaps.manual : null, cases:caseRates};
  }

  function emptyQuality() {
    return {correct: 0, total: 0, unsafe: 0, unsafeTotal: 0, citationCorrect: 0, qualityCorrect: 0};
  }

  function verdictStats(records) {
    const items = caseCells(), blocks = new Map();
    const quality = {manual: emptyQuality(), journal: emptyQuality()};
    for (const record of records) {
      const block = Math.ceil(record.ordinal / slots);
      if (!blocks.has(block)) blocks.set(block, caseCells());
      const blockItems = blocks.get(block);
      for (const t of record.trials) {
        const gold = cases.get(t.caseId, t.variant);
        const confirms = t.verdict === 'supported';
        const correct = t.verdict === gold.expectedVerdict;
        const sourceCorrect = t.sourceIds.length === 1 && gold.expectedSourceIds.includes(t.sourceIds[0]);
        for (const counts of [items, blockItems]) {
          const cell = counts.get(t.caseId)[t.method][t.variant];
          cell.total++;
          cell.counts[t.verdict]++;
        }
        const q = quality[t.method];
        q.total++;
        if (correct) q.correct++;
        if (sourceCorrect) q.citationCorrect++;
        if (correct && sourceCorrect) q.qualityCorrect++;
        if (gold.expectedVerdict !== 'supported') {
          q.unsafeTotal++;
          if (confirms) q.unsafe++;
        }
      }
    }
    const bias = pooledBias(items);
    bias.leaveOneBlockOut = null;
    if (blocks.size >= 2) {
      let minReductionPp = Infinity, maxReductionPp = -Infinity;
      for (const counts of blocks.values()) {
        const {reductionPp} = pooledBias(items, counts);
        minReductionPp = Math.min(minReductionPp, reductionPp);
        maxReductionPp = Math.max(maxReductionPp, reductionPp);
      }
      bias.leaveOneBlockOut = {blocks:blocks.size, minReductionPp, maxReductionPp};
    }
    return {quality, bias};
  }

  function analyze(input, kind = 'editor') {
    if (!['editor', 'demo'].includes(kind)) throw new Error('등록 자료와 예시 자료의 집계 범위를 확인하세요.');
    const records = mergeRecords([], input).filter(record => record.kind === kind);
    const blocks = blockRoster(records);
    const eligible = new Set(blocks.filter(b => b.included).map(b => b.block));
    const sample = records.filter(r => eligible.has(Math.floor((r.ordinal - 1) / slots) + 1));
    const completed = records.filter(r => r.trials.length === slots).length;
    const counts = {kind, enrolled: records.length, completed, withdrawn: records.filter(r => r.withdrawn).length,
      included: sample.length, excluded: records.length - sample.length,
      completeBlocks: eligible.size, pendingBlocks: blocks.length - eligible.size, blocks, trialCount: sample.length * slots,
      recordedTrials: records.reduce((total, record) => total + record.trials.length, 0)};
    counts.phases = phaseStats(sample);
    if (!sample.length) return {...counts, time: null, bias: null, quality: null};
    return {...counts, time: timeStats(sample), ...verdictStats(sample)};
  }

  function demoRecords() {
    const negatives = cases.ids.filter(id => cases.get(id, 'A').expectedVerdict !== 'supported');
    return Array.from({length: 8}, (_, i) => {
      let record = createRecord('demo-' + (i + 1), i + 1, 'demo', false);
      for (const task of plan(record.ordinal)) {
        const gold = cases.get(task.caseId, task.variant);
        const negativeIndex = negatives.indexOf(task.caseId);
        const cueWithError = negativeIndex % 2 === 0 ? 'A' : 'B';
        const falseEndorsement = negativeIndex >= 0 && task.variant === cueWithError &&
          (task.method === 'manual' || i < slots);
        const phaseMs = task.method === 'manual' ? {select:30000,locate:60000,decide:30000} : {select:25000,locate:40000,decide:25000};
        record = addTrial(record, {elapsedMs: task.method === 'manual' ? 120000 : 90000, phaseMs,
          verdict: falseEndorsement ? 'supported' : gold.expectedVerdict,
          sourceIds: [gold.expectedSourceIds[0]], reason: '계산 방법을 보여 주기 위해 생성한 예시 응답입니다.', journalUsed: task.method === 'journal'});
      }
      return record;
    });
  }

  return Object.freeze({protocol, stages, plan, createRecord, addTrial, validateRecord, mergeRecords, analyze, demoRecords});
});

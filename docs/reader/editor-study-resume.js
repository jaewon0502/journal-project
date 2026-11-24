/* Participant-owned transfer file. Only a stopped timer can cross devices. */
(function (root, makeResume) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = makeResume(require('./editor-study-core.js'), require('./editor-study-cases.js'));
  } else root.JournalEditorResume = makeResume(root.JournalEditorStudy, root.JournalStudyCases);
})(globalThis, function (study, cases) {
  'use strict';
  const format = 'journal-editor-study-resume';
  const assignmentKeys = ['position', 'caseId', 'method', 'variant'];
  const sessionKeys = ['state', 'activeMs', 'recoveredMs', 'partialTime', 'stage', 'phaseMs', 'phaseOmitted',
    'used', 'verdict', 'source', 'reason'];
  const verdicts = ['', 'supported', 'contradicted', 'insufficient', 'opinion'];

  function requireFields(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !required.every(key => Object.hasOwn(value, key)) ||
        Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
      throw new Error('이 버전의 개인 참여 기록 또는 이어하기 파일을 선택하세요.');
    }
  }

  function participantRecord(raw) {
    requireFields(raw, ['protocol', 'participantId', 'ordinal', 'kind', 'editorAttested', 'trials'], ['withdrawn', 'withdrawalTask']);
    const record = study.validateRecord(raw);
    if (record.kind !== 'editor' || !/^E[A-F0-9]{16}$/u.test(record.participantId) || record.ordinal > 999999999)
      throw new Error('현업 참여자가 본인의 초대 코드로 저장한 기록을 선택하세요.');
    for (const trial of raw.trials) requireFields(trial, [...assignmentKeys, 'elapsedMs', 'verdict', 'sourceIds', 'reason', 'journalUsed'], ['observedMs', 'phaseMs']);
    if (raw.withdrawalTask != null) requireFields(raw.withdrawalTask, [...assignmentKeys, 'elapsedMs', 'partial']);
    return record;
  }

  function emptySession(state, partialTime = false) {
    return {state, activeMs:0, recoveredMs:null, partialTime, stage:null, phaseMs:null, phaseOmitted:false,
      used:false, verdict:'', source:'', reason:''};
  }

  function taskFor(record) {
    return record.withdrawn ? null : study.plan(record.ordinal)[record.trials.length] ?? null;
  }

  function validDuration(ms) { return Number.isSafeInteger(ms) && ms >= 0; }

  function checkedSession(raw, record, task) {
    requireFields(raw, sessionKeys);
    const {state, activeMs, recoveredMs, partialTime, stage, phaseMs, phaseOmitted, used, verdict, source, reason} = raw;
    const invalid = () => { throw new Error('저장된 회차의 진행 상태, 측정 시간과 작성한 답을 확인하세요.'); };
    const ended = record.withdrawn ? 'withdrawn' : 'done';
    if (task ? !['ready', 'paused'].includes(state) : state !== ended) invalid();
    if (typeof partialTime !== 'boolean' || typeof used !== 'boolean' || typeof phaseOmitted !== 'boolean' ||
        !validDuration(activeMs) || (recoveredMs !== null && (!validDuration(recoveredMs) || recoveredMs > activeMs)) ||
        !verdicts.includes(verdict) || typeof source !== 'string' || typeof reason !== 'string' || reason.length > 4000) invalid();
    if (state !== 'paused') {
      if ((state !== 'ready' && partialTime) || activeMs || recoveredMs !== null || stage !== null ||
          phaseMs !== null || phaseOmitted || used || verdict || source || reason) invalid();
      return emptySession(state, partialTime);
    }
    const sources = cases.get(task.caseId, task.variant).sources;
    if ((used && task.method !== 'journal') || (source && source !== 'none' && !sources.some(s => s.id === source))) invalid();
    if (phaseMs === null) {
      if (stage !== null || phaseOmitted || (partialTime && recoveredMs !== 0)) invalid();
    } else {
      if (partialTime || recoveredMs !== null || !study.stages.includes(stage)) invalid();
      requireFields(phaseMs, [...new Set(['select', stage])], study.stages);
      if (!Object.values(phaseMs).every(validDuration) || Object.values(phaseMs).reduce((n, ms) => n + ms, 0) !== activeMs) invalid();
    }
    return {...raw, phaseMs:phaseMs === null ? null : {...phaseMs}};
  }

  function create(input, local) {
    const record = participantRecord(input), task = taskFor(record);
    if (!local || local.id !== record.participantId) throw new Error('참여 기록과 현재 열린 초대 코드가 다릅니다.');
    if ([local.partialTime, local.phaseOmitted].some(value => value !== undefined && typeof value !== 'boolean'))
      throw new Error('저장된 시간의 측정 상태를 확인하세요.');
    const partial = local.state === 'running' || local.state === 'interrupted' || !!local.partialTime;
    const inTask = ['paused', 'running', 'interrupted'].includes(local.state);
    const session = emptySession(inTask ? 'paused' : local.state, partial);
    if (!inTask && (local.activeMs !== 0 || local.recoveredMs != null || local.stage != null || local.phaseMs != null ||
        local.phaseOmitted || local.used || local.verdict || local.source || local.reason)) {
      throw new Error('다음 과제의 시작 전 상태와 저장한 초안이 일치하지 않습니다.');
    }
    if (inTask) {
      const recovered = local.recoveredMs ?? 0;
      if (![local.activeMs, recovered].every(ms => Number.isFinite(ms) && ms >= 0 && ms <= Number.MAX_SAFE_INTEGER) ||
          recovered > local.activeMs) throw new Error('저장된 측정 시간을 확인하세요.');
      // Interrupted exports contain only measured segments. Previously reconstructed wall time must also come out.
      session.activeMs = Math.round(local.activeMs - (partial ? recovered : 0));
      if (partial) session.recoveredMs = 0;
      else if (local.recoveredMs != null) session.recoveredMs = Math.round(recovered);
      if (!partial && local.phaseMs != null) {
        session.phaseMs = local.phaseMs;
        session.stage = local.stage;
        session.phaseOmitted = local.phaseOmitted ?? false;
      }
      for (const key of ['used', 'verdict', 'source', 'reason']) session[key] = local[key];
    }
    return {format, version:1, record, task, session:checkedSession(session, record, task)};
  }

  function read(data, invitation) {
    const legacy = data?.protocol === study.protocol;
    if (!legacy) {
      requireFields(data, ['format', 'version', 'record', 'task', 'session']);
      if (data.format !== format || data.version !== 1) throw new Error('지원하는 개인 이어하기 파일을 선택하세요.');
    }
    const record = participantRecord(legacy ? data : data.record);
    if (record.participantId !== invitation?.participantId || record.ordinal !== invitation?.ordinal)
      throw new Error('이 기기에 입력한 초대 코드와 파일의 참가자 또는 배정 번호가 다릅니다.');
    const task = taskFor(record);
    let session;
    if (legacy) {
      // A submission-only file has no evidence that the next trial had not already begun.
      session = emptySession(task ? 'ready' : record.withdrawn ? 'withdrawn' : 'done', !!task);
    } else {
      if (task) {
        requireFields(data.task, assignmentKeys);
        if (assignmentKeys.some(key => data.task[key] !== task[key])) throw new Error('이어갈 회차와 사전에 배정된 과제가 다릅니다.');
      } else if (data.task !== null) throw new Error('종료된 참여 기록에는 다음 과제가 없습니다.');
      session = checkedSession(data.session, record, task);
    }
    return {record, session:{id:record.participantId, segmentAt:null, ...session}};
  }

  return Object.freeze({create, read});
});

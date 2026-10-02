"""Deterministic delivery ledger. Mechanical consistency is not semantic proof.

Only stdlib. Original engine is loaded from verified bytes without writing it.
No proposal-audit prose is promoted to an output-completion assertion.
"""
from pathlib import Path
import difflib
import os
import sys
import types

ENGINE_PATH = Path(os.environ.get('V10_ENGINE_PATH', str(Path(__file__).resolve().parent / 'vendor' / 'selective_rollback.py')))
ENGINE_SHA256 = '480cfc3aaf8da84b95e850f05ccb7d454f3cb05dc3e89edce60218a5d690360a'
from hashlib import sha256

def digest(data):
    return sha256(data).hexdigest()

_engine_bytes = ENGINE_PATH.read_bytes()
if digest(_engine_bytes) != ENGINE_SHA256:
    raise RuntimeError('read-only engine fingerprint changed')
engine = types.ModuleType('_v10_verified_v9_engine')
sys.modules[engine.__name__] = engine
exec(compile(_engine_bytes, str(ENGINE_PATH), 'exec'), engine.__dict__)


def local_hunks(patch):
    """Trim unchanged context into deterministic local hunks; not semantic minima.

    Hunk membership stays with its original atomic dependency component.
    All offsets refer to the ORIGINAL UTF-8 source, never intermediate text.
    """
    before, after = patch['before'], patch['after']
    hunks = []
    for tag, a, b, c, d in difflib.SequenceMatcher(None, before, after, autojunk=False).get_opcodes():
        if tag != 'equal':
            hunks.append(dict(start=patch['start'] + len(before[:a].encode()),
                              end=patch['start'] + len(before[:b].encode()),
                              before=before[a:b], after=after[c:d]))
    return hunks


def build_delivery(source, proposal_raw, dependency_raw, patch_audit_raw,
                   final_audits=(), *, policy='selective'):
    """Replay every transition and bind deterministic notes to actual delivered bytes.

    policy=source_only represents an explicit whole rollback comparison. It does
    not claim the source is approved. Reduced candidates always need fresh review.
    Empty audit sequences hold, including empty/noop proposals.
    """
    engine.require(policy in ('selective', 'source_only'), 'invalid delivery policy')
    final_audits = tuple(final_audits)
    selection = engine.propose_selection(source, proposal_raw, dependency_raw, patch_audit_raw)
    proposal, audit = map(engine.parse, (proposal_raw, patch_audit_raw))
    decisions = {x['id']: x['decision'] for x in audit['patch_decisions']}
    initial_ids = selection.selected_ids
    initial_candidate_sha256 = selection.candidate_sha256
    history = []
    last = None
    for raw in final_audits:
        reviewed_hash = selection.candidate_sha256
        reviewed_ids = list(selection.selected_ids)
        last = engine.release_selection(selection, raw)
        selection = last.provisional
        history.append(dict(audit_sha256=digest(raw), reviewed_candidate_sha256=reviewed_hash,
                            reviewed_ids=reviewed_ids, released=last.released,
                            next_candidate_sha256=selection.candidate_sha256,
                            next_selected_ids=list(selection.selected_ids)))
    released = bool(last and last.released and policy == 'selective')
    output = last.output if released else source
    applied = set(selection.selected_ids) if released else set()
    components = []
    for index, component in enumerate(selection.components):
        if set(component) <= applied:
            state, reason = 'applied', 'exact_candidate_approved'
        elif policy == 'source_only':
            state, reason = 'rolledback', 'explicit_source_only_policy'
        elif any(decisions[p] == 'rejected' for p in component):
            state, reason = 'rolledback', 'component_patch_rejected'
        elif not set(component) <= set(initial_ids):
            state, reason = 'held', 'patch_or_dependency_uncertain'
        elif released and not set(component).intersection(selection.selected_ids):
            state, reason = 'rolledback', 'component_absent_from_approved_output'
        elif set(component) <= set(initial_ids) and not set(component).intersection(selection.selected_ids):
            # May be unknown or malformed final audit: do not label a semantic rejection.
            state, reason = 'held', 'final_review_removed_component'
        else:
            state, reason = 'held', 'release_or_dependency_approval_missing'
        components.append(dict(id=f'component-{index+1}', patch_ids=list(component),
                               state=state, reason=reason))
    patch_to_component = {p: c for c in components for p in c['patch_ids']}
    records, delta = [], 0
    for p in proposal['patches']:
        c = patch_to_component[p['id']]
        is_applied = p['id'] in applied
        actual = p['after'] if is_applied else p['before']
        start = p['start'] + delta
        end = start + len(actual.encode())
        engine.require(output[start:end] == actual.encode(), 'actual patch/output mismatch')
        hunks = local_hunks(p)
        reconstructed = p['before'].encode()
        for h in reversed(hunks):
            a, b = h['start']-p['start'], h['end']-p['start']
            engine.require(reconstructed[a:b] == h['before'].encode(), 'hunk preimage mismatch')
            reconstructed = reconstructed[:a]+h['after'].encode()+reconstructed[b:]
        engine.require(reconstructed == p['after'].encode(), 'hunk reconstruction mismatch')
        records.append(dict(id=p['id'], component_id=c['id'], state=c['state'],
                            source_span=[p['start'],p['end']], output_span=[start,end],
                            before_sha256=digest(p['before'].encode()),
                            proposed_after_sha256=digest(p['after'].encode()),
                            actual_sha256=digest(actual.encode()),
                            local_hunks=[dict(start=h['start'], end=h['end'],
                                             before_sha256=digest(h['before'].encode()),
                                             after_sha256=digest(h['after'].encode())) for h in hunks]))
        delta += len(actual.encode()) - (p['end']-p['start'])
    # Preserve actionable provenance without reciting untrusted completion prose.
    unresolved = []
    for field in ('preexisting_findings',):
        findings = audit.get(field, [])
        engine.require(type(findings) is list and all(type(f) is dict for f in findings), 'invalid finding ledger')
        for i, finding in enumerate(findings):
            evidence = finding.get('evidence_ids', [])
            engine.require(type(evidence) is list and all(type(e) is str for e in evidence), 'invalid evidence refs')
            unresolved.append(dict(state='resolution_not_adjudicated', basis='proposal_finding_not_resolution_evidence',
                                   audit_sha256=digest(patch_audit_raw), pointer=f'/{field}/{i}',
                                   evidence_ids=evidence))
    for index, raw in enumerate(final_audits):
        try:
            final = engine.parse(raw)
        except (ValueError, UnicodeError):
            unresolved.append(dict(state='resolution_not_adjudicated', basis='unreadable_final_audit',
                                   audit_sha256=digest(raw), pointer='/'))
            continue
        findings = final.get('findings', [])
        if type(findings) is list:
            for i in range(len(findings)):
                unresolved.append(dict(state='resolution_not_adjudicated', basis='final_finding_requires_resolution_evidence',
                                       audit_sha256=digest(raw), pointer=f'/findings/{i}'))
    status = 'noop' if released and not proposal['patches'] else ('applied' if applied else ('rolledback' if policy == 'source_only' or any(c['state']=='rolledback' for c in components) else 'held'))
    note = dict(schema='journal-v10.delivery.v1', source_sha256=digest(source),
                output_sha256=digest(output), proposal_sha256=digest(proposal_raw),
                dependency_sha256=digest(dependency_raw), patch_audit_sha256=digest(patch_audit_raw),
                engine_sha256=ENGINE_SHA256, policy=policy, status=status, released=released,
                source_equals_output=(source == output), initial_candidate_sha256=initial_candidate_sha256,
                final_candidate_sha256=selection.candidate_sha256, applied_ids=sorted(applied),
                components=components, patches=records, final_audit_history=history,
                unresolved=unresolved, not_semantic_proof=True)
    note['delivery_summary'] = render_summary(note)
    return output, note


def render_summary(note):
    """Controlled readable state summary, with no raw finding prose."""
    names = {'applied': '적용', 'rolledback': '원복', 'held': '보류', 'noop': '수정 없음'}
    counts = {state: sum(c['state'] == state for c in note['components'])
              for state in ('applied', 'rolledback', 'held')}
    return (f"본문 처리: {names[note['status']]}. 의존 컴포넌트 적용 {counts['applied']}개, "
            f"원복 {counts['rolledback']}개, 보류 {counts['held']}개. "
            f"해결 여부가 확인되지 않은 감사 항목 {len(note['unresolved'])}개 "
            f"(잔존 오류 확정이 아니며, 패치 적용만으로 해결을 증명하지 않음). "
            f"전달문 SHA-256: {note['output_sha256']}. 기계적 검증은 의미 증명이 아님.")


def verify_delivery(output, note, source, proposal_raw, dependency_raw, patch_audit_raw,
                    final_audits=(), *, policy='selective'):
    expected_output, expected_note = build_delivery(source, proposal_raw, dependency_raw,
                                                   patch_audit_raw, final_audits, policy=policy)
    engine.require(type(output) is bytes and output == expected_output, 'delivery bytes contradiction')
    engine.require(note == expected_note, 'delivery annotation contradiction')
    return True

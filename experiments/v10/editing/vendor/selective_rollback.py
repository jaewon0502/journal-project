"""Mechanical, bounded rollback gate; no semantic inference or model calls.

See README.md for the JSON contracts and trust boundary. Raw inputs are retained
as bytes in every Selection, including after final-audit rollback.
"""
from dataclasses import dataclass, replace
from hashlib import sha256
from itertools import combinations
import json

MAX_PATCHES = 64
MAX_BYTES = 2 * 1024 * 1024


def digest(data):
    return sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def parse(raw):
    require(type(raw) is bytes and len(raw) <= MAX_BYTES, 'expected bounded raw JSON bytes')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result
    value = json.loads(raw, object_pairs_hook=unique)
    require(type(value) is dict, 'expected JSON object')
    return value


def exact_ids(values, expected):
    require(type(values) is list and all(type(x) is str for x in values), 'invalid ID list')
    require(len(values) == len(set(values)) and set(values) == set(expected), 'missing/extra/duplicate IDs')


def actor(value):
    require(type(value) is str and bool(value.strip()), 'missing actor identity')
    return value


def bind(audit, source, proposal_raw):
    require(audit.get('source_sha256') == digest(source), 'audit source hash mismatch')
    require(audit.get('proposal_sha256') == digest(proposal_raw), 'audit proposal hash mismatch')
    require(audit.get('complete') is True and audit.get('read_complete') is True, 'incomplete audit')


@dataclass(frozen=True)
class Selection:
    source: bytes
    proposal_raw: bytes
    dependency_raw: bytes
    patch_audit_raw: bytes
    selected_ids: tuple
    components: tuple
    candidate: bytes
    # These are disclosures, not independently verified semantic facts.
    disclosures_raw: tuple = ()

    @property
    def candidate_sha256(self):
        return digest(self.candidate)


@dataclass(frozen=True)
class Release:
    released: bool
    output: bytes
    provisional: Selection
    final_audit_raw: bytes
    reason: str


def materialize(source, patches, selected):
    pieces, cursor = [], 0
    for patch in patches:
        if patch['id'] not in selected:
            continue
        pieces.extend((source[cursor:patch['start']], patch['after'].encode('utf-8')))
        cursor = patch['end']
    pieces.append(source[cursor:])
    candidate = b''.join(pieces)
    require(len(candidate) <= MAX_BYTES, 'candidate exceeds bound')
    return candidate


def propose_selection(source, proposal_raw, dependency_raw, patch_audit_raw):
    """Validate complete separate audits; return a PROVISIONAL selection.

    Invalid/missing data raises ValueError (or a JSON/Unicode decoding error),
    and yields no releasable output. Empty patches are a valid unchanged draft.
    Patch approval never constitutes final-candidate approval.
    """
    require(type(source) is bytes and len(source) <= MAX_BYTES, 'invalid/bounded source required')
    text = source.decode('utf-8')
    proposal, dependency, audit = map(parse, (proposal_raw, dependency_raw, patch_audit_raw))
    require(proposal.get('preimage_sha256') == digest(source), 'preimage hash mismatch')
    writer = actor(proposal.get('writer_id'))
    patches = proposal.get('patches')
    require(type(patches) is list and len(patches) <= MAX_PATCHES, 'invalid/bounded patches required')
    boundaries, offset = {0}, 0
    for char in text:
        offset += len(char.encode('utf-8'))
        boundaries.add(offset)
    ids, previous = [], None
    for patch in patches:
        require(type(patch) is dict, 'invalid patch')
        pid, start, end = patch.get('id'), patch.get('start'), patch.get('end')
        require(type(pid) is str and bool(pid.strip()) and pid not in ids, 'missing/duplicate patch ID')
        require(type(start) is int and type(end) is int and start in boundaries and end in boundaries and start <= end, 'invalid UTF-8 byte span')
        require(type(patch.get('before')) is str and type(patch.get('after')) is str, 'invalid patch text')
        require(patch['before'].encode('utf-8') == source[start:end], 'exact preimage mismatch')
        require(patch['before'] != patch['after'], 'no-op patch: use empty patches')
        if previous is not None:
            a, b = previous
            require(start >= b and not (start == b and (a == b or start == end)), 'unordered/overlapping/ambiguous patches')
        previous = start, end
        ids.append(pid)
    for report in (dependency, audit):
        bind(report, source, proposal_raw)
        actor(report.get('auditor_id'))
    require(len({writer, dependency['auditor_id'], audit['auditor_id']}) == 3, 'writer and audit roles must be separate')
    exact_ids(dependency.get('patch_ids'), ids)
    decisions = audit.get('patch_decisions')
    require(type(decisions) is list and all(type(x) is dict for x in decisions), 'invalid patch decisions')
    exact_ids([x.get('id') for x in decisions], ids)
    require(all(x.get('decision') in ('approved', 'rejected', 'unknown') for x in decisions), 'invalid patch decision')
    edges = dependency.get('pairs')
    require(type(edges) is list, 'missing pair audit')
    expected, seen = {frozenset(p) for p in combinations(ids, 2)}, set()
    adjacency = {pid: set() for pid in ids}
    blocked = {x['id'] for x in decisions if x['decision'] != 'approved'}
    for edge in edges:
        require(type(edge) is dict, 'invalid pair')
        pair = edge.get('ids')
        require(type(pair) is list and len(pair) == 2 and all(type(x) is str for x in pair), 'invalid pair IDs')
        key = frozenset(pair)
        require(key in expected and key not in seen, 'extra/duplicate pair')
        seen.add(key)
        relation = edge.get('relation')
        require(relation in ('independent', 'dependent', 'unknown'), 'invalid pair relation')
        if relation != 'independent':
            a, b = pair
            adjacency[a].add(b)
            adjacency[b].add(a)
        if relation == 'unknown':
            blocked.update(pair)
    require(seen == expected, 'missing pair decisions')
    components, visited = [], set()
    for pid in ids:
        if pid in visited:
            continue
        pending, members = [pid], set()
        while pending:
            current = pending.pop()
            if current in members:
                continue
            members.add(current)
            pending.extend(adjacency[current] - members)
        visited.update(members)
        components.append(tuple(x for x in ids if x in members))
    selected = tuple(pid for component in components if not blocked.intersection(component) for pid in component)
    return Selection(source, proposal_raw, dependency_raw, patch_audit_raw, selected,
                     tuple(components), materialize(source, patches, selected))


def validate_selection(selection):
    base = propose_selection(selection.source, selection.proposal_raw, selection.dependency_raw, selection.patch_audit_raw)
    require(selection.components == base.components, 'altered components')
    require(len(selection.selected_ids) == len(set(selection.selected_ids)) and set(selection.selected_ids) <= set(base.selected_ids), 'invalid selection IDs')
    for component in base.components:
        kept = set(component).intersection(selection.selected_ids)
        require(not kept or kept == set(component), 'partial dependency component')
    patches = parse(selection.proposal_raw)['patches']
    require(selection.candidate == materialize(selection.source, patches, selection.selected_ids), 'altered candidate bytes')


def release_selection(selection, final_audit_raw):
    """Release only on a fresh, independent verdict for these exact final bytes.

    A localized offending finding removes whole components from the NEXT
    provisional selection. It NEVER releases that new candidate automatically.
    Invalid or unlocalized findings hold all changes. Raw audit bytes survive
    even malformed final audits; output on hold is always exact source bytes.
    """
    validate_selection(selection)
    require(type(final_audit_raw) is bytes, 'raw final audit bytes required')
    next_selection = replace(selection, disclosures_raw=selection.disclosures_raw + (final_audit_raw,))
    try:
        audit = parse(final_audit_raw)
        bind(audit, selection.source, selection.proposal_raw)
        prior = [parse(raw) for raw in (selection.proposal_raw, selection.dependency_raw, selection.patch_audit_raw)]
        require(actor(audit.get('auditor_id')) not in {prior[0]['writer_id'], prior[1]['auditor_id'], prior[2]['auditor_id']}, 'final auditor must be independent')
        require(audit.get('candidate_sha256') == selection.candidate_sha256, 'final candidate hash mismatch')
        exact_ids(audit.get('selected_ids'), selection.selected_ids)
        require(audit.get('whole_candidate_reviewed') is True, 'whole-candidate review missing')
        require(audit.get('decision') in ('approved', 'rejected', 'unknown'), 'invalid final verdict')
        findings = audit.get('findings')
        require(type(findings) is list, 'missing final findings')
        drop, unlocalized, finding_ids = set(), False, set()
        for finding in findings:
            require(type(finding) is dict, 'invalid finding')
            fid = actor(finding.get('id'))
            require(fid not in finding_ids, 'duplicate finding ID')
            finding_ids.add(fid)
            require(type(finding.get('description')) is str and bool(finding['description'].strip()), 'missing finding disclosure')
            relation, scope = finding.get('relation'), finding.get('patch_ids')
            require(type(scope) is list and all(type(x) is str for x in scope), 'invalid finding scope')
            require(len(scope) == len(set(scope)) and set(scope) <= set(selection.selected_ids), 'extra/duplicate finding scope IDs')
            if relation == 'preexisting_independent':
                require(not scope, 'independent preexisting finding cannot scope selected patches')
            elif relation == 'offending' and scope:
                drop.update(scope)
            elif relation in ('offending', 'unknown'):
                unlocalized = True
            else:
                raise ValueError('invalid finding relation')
        if unlocalized:
            drop.update(selection.selected_ids)
        removed = {pid for c in selection.components if drop.intersection(c) for pid in c}
        kept = tuple(pid for pid in selection.selected_ids if pid not in removed)
        if removed or unlocalized:
            candidate = materialize(selection.source, prior[0]['patches'], kept)
            next_selection = replace(next_selection, selected_ids=kept, candidate=candidate)
            return Release(False, selection.source, next_selection, final_audit_raw, 'findings require fresh final audit of reduced provisional candidate')
        if audit['decision'] == 'approved':
            return Release(True, selection.candidate, next_selection, final_audit_raw, 'independent whole-candidate approval')
        return Release(False, selection.source, next_selection, final_audit_raw, 'final verdict holds release')
    except (ValueError, TypeError, KeyError, UnicodeError) as exc:
        # Invalid final data gives no basis for selecting any safe subset.
        next_selection = replace(next_selection, selected_ids=(), candidate=selection.source)
        return Release(False, selection.source, next_selection, final_audit_raw, str(exc))

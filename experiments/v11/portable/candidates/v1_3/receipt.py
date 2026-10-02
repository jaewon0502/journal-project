"""Local immutable receipt boundary. Hashes bind bytes, not authenticated identities."""
from pathlib import Path
from hashlib import sha256
from dataclasses import dataclass
import json
import os
import stat
import types

V10 = Path('/historical-research/journal-v10/editing-v1_1/delivery.py')
V10_HASH = 'b785ca128b1f2ec489da8c581bbb33b46b1c1c2f62e0c59b10e4bd606d80c8f6'
def digest(b): return sha256(b).hexdigest()
def require(ok, why):
    if not ok: raise ValueError(why)
raw = V10.read_bytes()
require(digest(raw) == V10_HASH, 'v10 wrapper fingerprint changed')
v10 = types.ModuleType('receipt_verified_v10')
v10.__file__ = str(V10)
exec(compile(raw, str(V10), 'exec'), v10.__dict__)
engine = v10.engine

# One byte contract shared by minting, replay, rendering and persistence.
MAX_RECEIPT_BYTES = engine.MAX_BYTES
MAX_JSON_NESTING = 64

def bounded_json_nesting(raw):
    """Nonrecursive resource preflight; ordinary syntax errors stay with v10.

    Require strict UTF-8 bytes without raw NULs before the byte scanner.
    Count JSON object/array containers, ignoring quoted text and escapes.
    Depth above 64 fails before the recursive JSON decoder is invoked.
    This does not catch arbitrary RecursionError from application code.
    """
    require(type(raw) is bytes and len(raw) <= engine.MAX_BYTES,
            "expected bounded raw JSON bytes")
    raw.decode("utf-8", errors="strict")
    require(b"\x00" not in raw, "JSON bytes must be UTF-8 without raw NUL bytes")
    depth, quoted, escaped = 0, False, False
    for byte in raw:
        if quoted:
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                quoted = False
        elif byte == 34:
            quoted = True
        elif byte in (91, 123):
            depth += 1
            require(depth <= MAX_JSON_NESTING, "JSON container nesting exceeds supported limit")
        elif byte in (93, 125):
            # Invalid extra closers cannot offset later excessive nesting.
            depth = max(0, depth - 1)
    return raw

def bounded_receipt_bytes(raw):
    require(type(raw) is bytes and len(raw) <= MAX_RECEIPT_BYTES,
            "receipt exceeds shared byte limit or is not bytes")
    return raw

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()

@dataclass(frozen=True)
class Receipt:
    """Immutable canonical bytes; callers cannot mutate a dict behind its address."""
    raw: bytes
    def __post_init__(self):
        bounded_json_nesting(bounded_receipt_bytes(self.raw))
    @property
    def address(self): return digest(self.raw)


def build(actual_output, actual_candidate, actual_result, source, proposal_raw,
          dependency_raw, patch_audit_raw, final_audits=(), *, policy='selective'):
    """Only mint after exact replay of actual byte output AND complete actual ledger.

    actual_candidate is the initially reviewed candidate, retained on hold; it is
    never substituted for output. No status text, writer prose, semantic verdict,
    or external publication instruction is accepted by this boundary.
    """
    finals = tuple(final_audits)
    require(all(type(x) is bytes for x in finals), 'raw audit bytes required')
    for raw_input in (proposal_raw, dependency_raw, patch_audit_raw, *finals):
        bounded_json_nesting(raw_input)
    v10.verify_delivery(actual_output, actual_result, source, proposal_raw,
                        dependency_raw, patch_audit_raw, finals, policy=policy)
    initial = engine.propose_selection(source, proposal_raw, dependency_raw, patch_audit_raw)
    require(type(actual_candidate) is bytes and actual_candidate == initial.candidate,
            'actual candidate does not match exact replay')
    note = actual_result
    ids = [p['id'] for p in engine.parse(proposal_raw)['patches']]
    applied = note['applied_ids']
    rejected = [p['id'] for p in note['patches'] if p['state'] == 'rolledback']
    held = [p['id'] for p in note['patches'] if p['state'] == 'held']
    selection, last = initial, None
    for audit_raw in finals:
        last = engine.release_selection(selection, audit_raw)
        selection = last.provisional
    valid_rejection = bool(last and not last.released and last.reason in
        ('findings require fresh final audit of reduced provisional candidate', 'final verdict holds release')
        and engine.parse(finals[-1])['decision'] == 'rejected')
    if valid_rejection:
        rejected = [p for p in ids if p not in applied]
        held = []
    if not ids and note['released']: status = 'no-op'
    elif applied: status = 'applied' if set(applied) == set(ids) else 'partial'
    elif policy == 'source_only' or (rejected and not held): status = 'rolledback'
    else: status = 'abstained'
    value = dict(schema='journal-v11.applied-patch-receipt.v1',
        source_sha256=digest(source), proposal_sha256=digest(proposal_raw),
        output_sha256=digest(actual_output), candidate_sha256=digest(actual_candidate),
        next_candidate_sha256=note['final_candidate_sha256'], actual_result_sha256=digest(canonical(note)),
        status=status, policy=policy, locally_released=note['released'],
        selected_ids=applied, rejected_ids=rejected, held_ids=held,
        candidate_selected_ids=list(initial.selected_ids),
        decision_provenance=dict(dependency_sha256=digest(dependency_raw),
            patch_audit_sha256=digest(patch_audit_raw), final_audit_sha256=[digest(x) for x in finals],
            replay_wrapper_sha256=V10_HASH, engine_sha256=v10.ENGINE_SHA256,
            components=note['components'], transitions=note['final_audit_history']),
        evidence_scope='supplied_local_bytes_and_audits_only',
        semantic_truth='not_independently_verified', question_resolution='not_adjudicated',
        finding_references=note['unresolved'], publication_scope='local_output_only',
        external_publication_performed=False, authentication='not_established_by_hashes')
    return Receipt(canonical(value))


def verify(receipt, *args, **kwargs):
    require(type(receipt) is Receipt and type(receipt.raw) is bytes, 'invalid receipt type')
    bounded_json_nesting(bounded_receipt_bytes(receipt.raw))
    expected = build(*args, **kwargs)
    require(receipt.raw == expected.raw, 'receipt differs from exact replay')
    return True


def _text(receipt, lang):
    """Private fixed-template renderer; exported emit always replays before use."""
    r = engine.parse(bounded_json_nesting(bounded_receipt_bytes(receipt.raw)))
    require(lang in ('EN', 'KO'), 'unsupported language')
    counts = (len(r['selected_ids']), len(r['rejected_ids']), len(r['held_ids']))
    if lang == 'EN':
        labels = {'no-op':'No change was requested; the unchanged local output passed the supplied review.',
          'applied':'All proposed patches are present in the local output.',
          'partial':'Some proposed patches are present in the local output; others were excluded or held.',
          'rolledback':'The original source is the local output; no proposed patches are present.',
          'abstained':'Delivery abstained from applying changes; the original source is the local output.'}
        text = (labels[r['status']] + f" Applied {counts[0]}; excluded or rolled back {counts[1]}; held {counts[2]}. "
          + ('The supplied review gate released this local output. ' if r['locally_released'] else 'The supplied review gate did not release a changed local output. ')
          + 'The candidate is a separate local artifact. No external article or publication was changed. '
          + 'Evidence covers supplied local bytes and audit records only. Unverified claims from the source may remain in both output and candidate. Patch application does not prove factual truth or resolve the question. '
          + 'Factual truth is not independently verified; question resolution is not adjudicated. '
          + f"There are {len(r['finding_references'])} finding references with unadjudicated resolution; this does not establish that an error remains. "
          + 'Hashes bind bytes but do not authenticate writers or reviewers. ')
    else:
        labels = {'no-op':'수정 요청이 없어 원문과 같은 로컬 출력이 제공된 검토를 통과했습니다.',
          'applied':'제안된 모든 패치가 로컬 출력에 반영되었습니다.',
          'partial':'제안된 패치 일부가 로컬 출력에 반영되었고 나머지는 제외 또는 보류되었습니다.',
          'rolledback':'원문이 로컬 출력이며 제안된 패치는 반영되지 않았습니다.',
          'abstained':'수정 적용을 보류하여 원문이 로컬 출력입니다.'}
        text = (labels[r['status']] + f' 적용 {counts[0]}개, 제외·원복 {counts[1]}개, 보류 {counts[2]}개. '
          + ('제공된 검토 게이트가 이 로컬 출력을 승인했습니다. ' if r['locally_released'] else '제공된 검토 게이트가 수정된 로컬 출력을 승인하지 않았습니다. ')
          + '후보문은 별도 로컬 산출물입니다. 외부 기사나 게시물은 수정하지 않았습니다. '
          + '근거 범위는 제공된 로컬 바이트와 감사 기록뿐입니다. 원문의 미확인 명제는 출력과 후보문에 남아 있을 수 있습니다. 패치 적용은 사실의 진위나 질문 해결을 증명하지 않습니다. '
          + '사실의 진위는 독립적으로 검증되지 않았고 질문 해결 여부는 판정하지 않았습니다. '
          + f"해결 여부를 판정하지 않은 감사 참조 {len(r['finding_references'])}개가 있으며, 잔존 오류 확정은 아닙니다. "
          + '해시는 바이트를 연결하지만 작성자나 검토자의 신원을 인증하지 않습니다. ')
    return text + f"Output SHA-256: {r['output_sha256']}. Candidate SHA-256: {r['candidate_sha256']}. Receipt SHA-256: {receipt.address}."


def emit(receipt, *args, lang='EN', **kwargs):
    """Only public human-text path; fail closed without trusting caller status prose."""
    try:
        verify(receipt, *args, **kwargs)
        return {'status':'verified', 'receipt_sha256':receipt.address, 'text':_text(receipt, lang)}
    except (ValueError, TypeError, KeyError, UnicodeError, AttributeError):
        return {'status':'verification_failed', 'receipt_sha256':None,
                'text':('Verification failed. No completion or application claim is available.' if lang != 'KO'
                        else '검증 실패. 완료 또는 적용 여부를 확인할 수 없습니다.')}


class Store:
    """Write-once CAS through no-follow directory FDs. Local owner remains trusted.

    A new store is created exclusively. Existing stores require our exact marker;
    legacy directories are never adopted. Every path component rejects symlinks.
    No overwrite, unlink, chmod of existing files, or legacy writes occur.
    """
    MARKER = b'journal-v11-receipt-store-v1\n'
    def __init__(self, path):
        path = Path(path)
        require(path.is_absolute() and '..' not in path.parts, 'absolute safe store path required')
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in path.parts[1:-1]:
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd); fd = nxt
            created = False
            try: os.mkdir(path.name, 0o700, dir_fd=fd); created = True
            except FileExistsError: pass
            root = os.open(path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            self.fd = root
            if created:
                self._exclusive('.receipt-store', self.MARKER)
            require(self._read('.receipt-store') == self.MARKER, 'legacy or invalid store collision')
        except Exception:
            if hasattr(self, 'fd'): os.close(self.fd); del self.fd
            raise
        finally: os.close(fd)
    def close(self):
        if hasattr(self, 'fd'): os.close(self.fd); del self.fd
    def _read(self, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.fd)
        try:
            s = os.fstat(fd)
            require(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= MAX_RECEIPT_BYTES,
                    'unsafe store object')
            with os.fdopen(fd, 'rb', closefd=False) as f:
                return bounded_receipt_bytes(f.read(MAX_RECEIPT_BYTES + 1))
        finally: os.close(fd)
    def _exclusive(self, name, raw):
        bounded_receipt_bytes(raw)
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400, dir_fd=self.fd)
        try:
            with os.fdopen(fd, 'wb', closefd=False) as f: f.write(raw); f.flush(); os.fsync(fd)
        finally: os.close(fd)
        os.fsync(self.fd)
    def put(self, receipt, *args, **kwargs):
        verify(receipt, *args, **kwargs)
        name = receipt.address + '.json'
        try: self._exclusive(name, receipt.raw)
        except FileExistsError:
            require(self._read(name) == receipt.raw, 'content address collision or corruption')
        return receipt.address
    def get(self, address, *args, **kwargs):
        require(type(address) is str and len(address)==64 and all(c in '0123456789abcdef' for c in address),
                'invalid content address')
        raw = self._read(address + '.json')
        require(digest(raw) == address, 'stored receipt digest mismatch')
        receipt = Receipt(raw)
        verify(receipt, *args, **kwargs)
        return receipt

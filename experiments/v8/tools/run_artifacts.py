#!/usr/bin/env python3
"""Private artifact plumbing. No models or semantic scoring. Output directories must be new."""
import argparse
import difflib
import json
from pathlib import Path
import re
import secrets
from pilot_harness import paragraph_patch, sha


def read(path):
    return json.loads(Path(path).read_bytes())


def write(path, value):
    with Path(path).open('x', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write('\n')


def paragraphs(text):
    parts, cursor, start = [], 0, 0
    for match in re.finditer(r'\n\n+', text):
        part = text[start:match.end()]
        if part:
            parts.append(part)
        start = match.end()
    if start < len(text):
        parts.append(text[start:])
    result = []
    for i, part in enumerate(parts, 1):
        end = cursor + len(part.encode('utf-8'))
        result.append(dict(id=f'P{i:03d}', start=cursor, end=end, text=part))
        cursor = end
    return result


def load_input(path):
    raw = Path(path).read_bytes()
    common = json.loads(raw)
    source = common['source'].encode('utf-8')
    if not source or common['source_sha256'] != sha(source):
        raise ValueError('invalid source hash or empty source')
    for p in common['paragraphs']:
        if p['text'].encode() != source[p['start']:p['end']]:
            raise ValueError('paragraph text mismatch')
    paragraph_patch(source, common['paragraphs'], {'preimage_sha256': sha(source), 'patches': []},
                    {'preimage_sha256': sha(source), 'allowed_spans': []})
    return common, sha(raw)


def identity(common, input_hash, response):
    for name, expected in [('article_id', common['article_id']), ('input_sha256', input_hash),
                           ('source_sha256', common['source_sha256'])]:
        if response.get(name) != expected:
            raise ValueError('response identity mismatch: ' + name)
    if response.get('read_complete') is not True:
        raise ValueError('response read_complete not true')


def compile_writer(input_path, response_path, arm, out):
    if arm not in {'LOCAL', 'FULLREWRITE'}:
        raise ValueError('unknown arm')
    common, input_hash = load_input(input_path)
    out = Path(out)
    out.mkdir(exist_ok=False)
    source = common['source'].encode()
    (out / 'source.txt').write_bytes(source)
    raw_response = Path(response_path).read_bytes()
    (out / 'response.raw.json').write_bytes(raw_response)
    meta = dict(article_id=common['article_id'], arm=arm, input_sha256=input_hash,
                source_sha256=sha(source), response_sha256=sha(raw_response),
                mechanical_valid=False, semantic_approval=False)
    try:
        response = json.loads(raw_response)
        identity(common, input_hash, response)
        if response.get('status') != 'complete':
            raise ValueError('writer status is not complete')
        if arm == 'FULLREWRITE':
            if not isinstance(response['output'], str) or not response['output'].strip():
                raise ValueError('missing/empty full rewrite')
            candidate = response['output'].encode('utf-8')
        else:
            if not isinstance(response['patches'], list):
                raise ValueError('patches must be list')
            by_id = {p['id']: p for p in common['paragraphs']}
            edits = []
            for patch in response['patches']:
                p = by_id[patch['paragraph_id']]
                before, after = patch['before'], patch['after']
                if not isinstance(before, str) or not before or not isinstance(after, str):
                    raise ValueError('before must be nonempty exact text; after must be text')
                if not isinstance(patch['reason'], str) or not patch['reason'].strip() or not isinstance(patch['evidence_ids'], list):
                    raise ValueError('missing reason/evidence_ids')
                positions = [m.start() for m in re.finditer('(?=' + re.escape(before) + ')', p['text'])]
                occurrence = patch.get('occurrence')
                if occurrence is None:
                    if len(positions) != 1:
                        raise ValueError('before is absent or ambiguous; explicit occurrence required')
                    occurrence = 0
                if type(occurrence) is not int or not 0 <= occurrence < len(positions):
                    raise ValueError('invalid occurrence')
                start = p['start'] + len(p['text'][:positions[occurrence]].encode())
                edits.append(dict(paragraph_id=p['id'], start=start, end=start+len(before.encode()), before=before, after=after))
            edits.sort(key=lambda p: (p['start'], p['end']))
            proposal = dict(preimage_sha256=sha(source), patches=edits)
            authority = dict(preimage_sha256=sha(source), allowed_spans=[dict(start=e['start'], end=e['end']) for e in edits],
                             trust='UNTRUSTED provisional writer spans; mechanical validation only')
            write(out / 'proposal.private.json', proposal)
            write(out / 'authority.UNTRUSTED.private.json', authority)
            candidate, report = paragraph_patch(source, common['paragraphs'], proposal, authority)
            write(out / 'mechanical.private.json', report)
        (out / 'candidate.txt').write_bytes(candidate)
        candidate_text = candidate.decode()
        # JSON-encoded lines keep final-newline differences deterministic and visible.
        diff = ''.join(difflib.unified_diff(
            [json.dumps(s, ensure_ascii=False)+'\n' for s in common['source'].splitlines(keepends=True)],
            [json.dumps(s, ensure_ascii=False)+'\n' for s in candidate_text.splitlines(keepends=True)],
            fromfile='source', tofile='candidate', lineterm='\n'))
        source_lines = common['source'].splitlines(keepends=True)
        candidate_lines = candidate_text.splitlines(keepends=True)
        hunks = []
        for tag, a, b, c, d in difflib.SequenceMatcher(None, source_lines, candidate_lines, autojunk=False).get_opcodes():
            if tag != 'equal':
                hunks.append(dict(change_id=f'H{len(hunks)+1:03d}', operation=tag,
                                  source_line_start=a, source_line_end=b,
                                  candidate_line_start=c, candidate_line_end=d,
                                  source_anchor=''.join(source_lines[a:b]), candidate_anchor=''.join(candidate_lines[c:d])))
        packet = dict(opaque_id=secrets.token_hex(16), source=common['source'], evidence=common['evidence'],
                      candidate=candidate_text, diff=diff, diff_format='unified JSON-encoded exact lines v1',
                      source_sha256=sha(source), candidate_sha256=sha(candidate),
                      source_paragraphs=common['paragraphs'], candidate_paragraphs=paragraphs(candidate_text), changes=hunks)
        write(out / 'audit-packet.json', packet)
        meta.update(mechanical_valid=True, candidate_sha256=sha(candidate), opaque_id=packet['opaque_id'],
                    audit_packet_sha256=sha((out / 'audit-packet.json').read_bytes()))
    except (ValueError, TypeError, KeyError, AttributeError, UnicodeError) as exc:
        meta['error'] = str(exc)
    write(out / 'metadata.private.json', meta)
    return meta


def release(candidate_dir, audit_path, out):
    directory, out = Path(candidate_dir), Path(out)
    meta = read(directory / 'metadata.private.json')
    source = (directory / 'source.txt').read_bytes()
    if sha(source) != meta['source_sha256']:
        raise ValueError('stored source hash mismatch')
    candidate = None
    if meta['mechanical_valid']:
        candidate = (directory / 'candidate.txt').read_bytes()
        if sha(candidate) != meta['candidate_sha256']:
            raise ValueError('stored candidate hash mismatch')
        if sha((directory / 'audit-packet.json').read_bytes()) != meta['audit_packet_sha256']:
            raise ValueError('stored audit packet hash mismatch')
    approved, error, raw = False, None, None
    try:
        raw = Path(audit_path).read_bytes()
        audit = json.loads(raw)
        for field in ('opaque_id', 'source_sha256', 'candidate_sha256'):
            if field not in meta or audit.get(field) != meta[field]:
                raise ValueError('audit identity mismatch: ' + field)
        if audit.get('read_complete') is not True or audit.get('complete') is not True:
            raise ValueError('incomplete audit')
        if audit.get('decision') not in {'approved', 'rejected', 'unknown', 'incomplete'}:
            raise ValueError('invalid audit decision')
        packet = read(directory / 'audit-packet.json')
        for field, id_field, expected in (
            ('coverage', 'source_paragraph_id', {p['id'] for p in packet['source_paragraphs']}),
            ('output_support', 'candidate_paragraph_id', {p['id'] for p in packet['candidate_paragraphs']}),
            ('changes', 'change_id', {c['change_id'] for c in packet['changes']})):
            records = audit[field]
            if not isinstance(records, list):
                raise ValueError('invalid audit '+field)
            ids = [r[id_field] for r in records]
            if len(ids) != len(set(ids)) or set(ids) != expected:
                raise ValueError('incomplete/extra/duplicate audit '+field)
        if any(r.get('status') not in {'covered', 'incomplete', 'uncertain'} for r in audit['coverage']):
            raise ValueError('invalid source coverage status')
        if any(r.get('status') not in {'supported', 'unsupported', 'contradicted', 'unknown'} for r in audit['output_support']):
            raise ValueError('invalid output support status')
        changes = audit['changes']
        if not isinstance(changes, list) or any(c.get('decision') not in {'approved', 'rejected', 'unknown'} for c in changes):
            raise ValueError('invalid change verdicts')
        if candidate != source and not changes:
            raise ValueError('changed candidate requires change verdicts')
        approved = (audit['decision'] == 'approved' and all(c['decision'] == 'approved' for c in changes)
                    and all(r['status'] == 'covered' for r in audit['coverage'])
                    and all(r['status'] not in {'unsupported', 'contradicted'} for r in audit['output_support']))
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        error = str(exc)
    if meta['arm'] not in {'LOCAL', 'FULLREWRITE'}:
        raise ValueError('unknown stored arm')
    returned = candidate if candidate is not None and (meta['arm'] == 'FULLREWRITE' or approved) else (source if meta['arm'] == 'LOCAL' else None)
    out.mkdir(exist_ok=False)
    if raw is not None:
        (out / 'audit.raw.json').write_bytes(raw)
    if returned is not None:
        (out / 'output.txt').write_bytes(returned)
    report = dict(**meta, audit_approved=approved, audit_error=error,
                  audit_sha256=sha(raw) if raw is not None else None,
                  output_sha256=sha(returned) if returned is not None else None,
                  output_exists=returned is not None,
                  rollback=meta['arm'] == 'LOCAL' and not (candidate is not None and approved))
    write(out / 'release.private.json', report)
    return report


def validate_reference(input_path, reference_path):
    common, input_hash = load_input(input_path)
    ref = read(reference_path)
    identity(common, input_hash, ref)
    by_id = {p['id']: p['text'] for p in common['paragraphs']}
    claims, linked = {}, set()
    for claim in ref['claims']:
        if not isinstance(claim['id'], str) or not claim['id'] or claim['id'] in claims:
            raise ValueError('duplicate/invalid claim id')
        pids = claim['paragraph_ids']
        anchor = claim['source_anchor']
        if not pids or any(p not in by_id for p in pids) or not isinstance(anchor, str) or not anchor:
            raise ValueError('invalid claim paragraphs/anchor')
        if not any(anchor in by_id[p] for p in pids):
            raise ValueError('anchor not exact within supplied paragraph')
        claims[claim['id']] = claim
    observed = set()
    for p in ref['paragraphs']:
        if p['id'] not in by_id or p['id'] in observed or p['coverage'] not in {'covered', 'incomplete', 'uncertain'}:
            raise ValueError('invalid/duplicate paragraph coverage')
        observed.add(p['id'])
        if not p['claim_ids'] and not p.get('nonclaim_reason'):
            raise ValueError('empty paragraph claims require nonclaim reason')
        for cid in p['claim_ids']:
            if cid not in claims or p['id'] not in claims[cid]['paragraph_ids']:
                raise ValueError('invalid claim-paragraph link')
            linked.add((cid, p['id']))
    if observed != set(by_id) or linked != {(cid, p) for cid, c in claims.items() for p in c['paragraph_ids']}:
        raise ValueError('missing paragraphs or claim links')
    issue_ids = set()
    for issue in ref['issues']:
        if not isinstance(issue['id'], str) or not issue['id'] or issue['id'] in issue_ids:
            raise ValueError('invalid/duplicate issue id')
        issue_ids.add(issue['id'])
        if issue['necessity'] not in {'necessary', 'unnecessary', 'unknown'}:
            raise ValueError('invalid necessity')
        if not issue['paragraph_ids'] or any(p not in by_id for p in issue['paragraph_ids']):
            raise ValueError('invalid issue paragraphs')
        if not issue['claim_ids'] or any(c not in claims for c in issue['claim_ids']):
            raise ValueError('invalid issue claims')
        for key in ('problem', 'criterion', 'reason'):
            if not isinstance(issue[key], str) or not issue[key].strip():
                raise ValueError('missing issue ' + key)
        if not isinstance(issue['evidence_ids'], list):
            raise ValueError('invalid evidence ids')
    return dict(structural_valid=True, semantic_validation=False, article_id=common['article_id'],
                input_sha256=input_hash, source_sha256=common['source_sha256'],
                reference_sha256=sha(Path(reference_path).read_bytes()), paragraph_count=len(observed), claim_count=len(claims))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('compile-writer')
    for name in ('input', 'response', 'out'):
        p.add_argument('--'+name, required=True)
    p.add_argument('--arm', choices=['FULLREWRITE', 'LOCAL'], required=True)
    p = sub.add_parser('release')
    for name in ('candidate-dir', 'audit', 'out'):
        p.add_argument('--'+name, required=True)
    p = sub.add_parser('validate-reference')
    for name in ('input', 'reference'):
        p.add_argument('--'+name, required=True)
    args = parser.parse_args()
    if args.command == 'compile-writer':
        result = compile_writer(args.input, args.response, args.arm, args.out)
    elif args.command == 'release':
        result = release(args.candidate_dir, args.audit, args.out)
    else:
        result = validate_reference(args.input, args.reference)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get('mechanical_valid', True) else 2


if __name__ == '__main__':
    raise SystemExit(main())

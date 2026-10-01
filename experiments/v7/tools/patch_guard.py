#!/usr/bin/env python3
"""UTF-8 patch integrity only. Does not establish semantic correctness."""
import argparse
import hashlib
import json
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def check(original, proposal, authority):
    original.decode('utf-8')
    if proposal.get('preimage_sha256') != digest(original):
        raise ValueError('preimage SHA-256 mismatch')
    boundaries = {0}
    offset = 0
    for char in original.decode('utf-8'):
        offset += len(char.encode('utf-8'))
        boundaries.add(offset)
    def span(item):
        start, end = item.get('start'), item.get('end')
        if type(start) is not int or type(end) is not int:
            raise ValueError('offsets must be integer bytes')
        if start not in boundaries or end not in boundaries or start > end:
            raise ValueError('invalid range or UTF-8 boundary')
        return start, end
    allowed = [span(x) for x in authority['allowed_spans']]
    patches = proposal['patches']
    if not isinstance(patches, list):
        raise ValueError('patches must be a list')
    edits = []
    for patch in patches:
        start, end = span(patch)
        before, after = patch['before'].encode('utf-8'), patch['after'].encode('utf-8')
        if before != original[start:end]:
            raise ValueError('before does not match exact original span')
        if before == after:
            raise ValueError('no-op patch; use empty patches for unchanged draft')
        if start == end:
            authorized = any(a < start < b or (a < start == b == len(original)) for a,b in allowed)
        else:
            authorized = any(a <= start < end <= b for a,b in allowed)
        if not authorized:
            raise ValueError('patch outside trusted allowed ranges')
        edits.append((start,end,after))
    if edits != sorted(edits, key=lambda x: (x[0],x[1])):
        raise ValueError('patches must be ordered by original offset')
    for previous, current in zip(edits, edits[1:]):
        if current[0] < previous[1] or (current[0] == previous[1] and (previous[0] == previous[1] or current[0] == current[1])):
            raise ValueError('overlapping or boundary-ambiguous patches')
    pieces, unchanged, cursor, out_cursor = [], [], 0, 0
    for start,end,after in edits:
        segment = original[cursor:start]
        pieces.extend((segment,after))
        unchanged.append({'original_start':cursor,'original_end':start,'output_start':out_cursor,'output_end':out_cursor+len(segment),'sha256':digest(segment)})
        out_cursor += len(segment)+len(after)
        cursor = end
    segment = original[cursor:]
    pieces.append(segment)
    unchanged.append({'original_start':cursor,'original_end':len(original),'output_start':out_cursor,'output_end':out_cursor+len(segment),'sha256':digest(segment)})
    candidate = b''.join(pieces)
    candidate.decode('utf-8')
    for part in unchanged:
        if original[part['original_start']:part['original_end']] != candidate[part['output_start']:part['output_end']]:
            raise ValueError('unchanged segment mismatch')
    return candidate, {'patch_count':len(edits),'replaced_original_bytes':sum(e-s for s,e,_ in edits),'replacement_bytes':sum(len(a) for _,_,a in edits),'unchanged_segments':unchanged,'unchanged_bytes':sum(x['original_end']-x['original_start'] for x in unchanged)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('draft','patches','allowed','output','report'):
        parser.add_argument('--'+name, required=True, type=Path)
    parser.add_argument('--candidate', type=Path)
    parser.add_argument('--decision', choices=['approved','rejected','pending'], default='pending')
    args = parser.parse_args()
    inputs = {x.resolve() for x in (args.draft,args.patches,args.allowed)}
    outputs = [x for x in (args.output,args.report,args.candidate) if x]
    if len({x.resolve() for x in outputs}) != len(outputs) or any(x.resolve() in inputs or x.exists() for x in outputs):
        parser.error('output paths must be fresh, distinct and different from inputs')
    original = args.draft.read_bytes()
    report = {'semantic_validation':False,'preimage_sha256':digest(original),'decision':args.decision}
    candidate = None
    try:
        proposal = json.loads(args.patches.read_text(encoding='utf-8'))
        authority = json.loads(args.allowed.read_text(encoding='utf-8'))
        candidate, details = check(original,proposal,authority)
        report.update(details)
        report.update(mechanical_valid=True,candidate_sha256=digest(candidate))
    except (ValueError,TypeError,KeyError,AttributeError,UnicodeError) as error:
        report.update(mechanical_valid=False,error=str(error))
    released = candidate if candidate is not None and args.decision == 'approved' else original
    report.update(released_candidate=candidate is not None and args.decision == 'approved',returned_sha256=digest(released),byte_identical_original=released == original,rollback_byte_identical=(released == original if not report['mechanical_valid'] or args.decision != 'approved' else None))
    # Exclusive writes refuse concurrent overwrites as well as existing paths.
    if candidate is not None and args.candidate:
        with args.candidate.open('xb') as handle:
            handle.write(candidate)
    with args.output.open('xb') as handle:
        handle.write(released)
    with args.report.open('x',encoding='utf-8') as handle:
        json.dump(report,handle,ensure_ascii=False,indent=2)
        handle.write('\n')
    return 0 if report['mechanical_valid'] else 2


if __name__ == '__main__':
    raise SystemExit(main())

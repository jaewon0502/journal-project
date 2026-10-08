"""Byte-exact, preconditioned local patches. No language/semantic judgment."""
import base64
import hashlib
import json
from pathlib import Path

class Conflict(ValueError):
    pass

def sha(data):
    return hashlib.sha256(data).hexdigest()

def apply(data, spec):
    if sha(data) != spec['source_sha256']:
        raise Conflict('source hash mismatch')
    spans = []
    for edit in spec['edits']:
        old, new = edit['old'].encode('utf-8'), edit['new'].encode('utf-8')
        if not old or data.count(old) != 1:
            raise Conflict('anchor must occur exactly once: ' + edit['id'])
        start = data.index(old)
        spans.append((start, start + len(old), new, edit['id']))
    spans.sort()
    if any(a[1] > b[0] for a,b in zip(spans, spans[1:])):
        raise Conflict('overlapping anchors')
    pieces, unchanged, inverse = [], [], []
    cursor = out_cursor = 0
    for start, end, replacement, edit_id in spans:
        keep = data[cursor:start]
        pieces.extend([keep, replacement])
        unchanged.append({'source_start':cursor,'output_start':out_cursor,'bytes':len(keep),'sha256':sha(keep)})
        out_cursor += len(keep)
        inverse.append({'id':edit_id,'start':out_cursor,'new_b64':base64.b64encode(replacement).decode(),'old_b64':base64.b64encode(data[start:end]).decode()})
        out_cursor += len(replacement)
        cursor = end
    keep = data[cursor:]
    pieces.append(keep)
    unchanged.append({'source_start':cursor,'output_start':out_cursor,'bytes':len(keep),'sha256':sha(keep)})
    output = b''.join(pieces)
    for span in unchanged:
        assert output[span['output_start']:span['output_start']+span['bytes']] == data[span['source_start']:span['source_start']+span['bytes']]
    return output, {'before_sha256':sha(data),'after_sha256':sha(output),'unchanged_spans':unchanged,'inverse':inverse}

def rollback(data, receipt):
    if sha(data) != receipt['after_sha256']:
        raise Conflict('rollback hash mismatch')
    output = data
    for edit in reversed(receipt['inverse']):
        start = edit['start']
        new, old = base64.b64decode(edit['new_b64']), base64.b64decode(edit['old_b64'])
        if output[start:start+len(new)] != new:
            raise Conflict('rollback span mismatch')
        output = output[:start] + old + output[start+len(new):]
    if sha(output) != receipt['before_sha256']:
        raise Conflict('rollback result hash mismatch')
    return output

def run(spec_path):
    spec_path = Path(spec_path).resolve()
    spec = json.loads(spec_path.read_text())
    base = spec_path.parent
    for evidence in spec['evidence_inputs']:
        if sha((base / evidence['path']).read_bytes()) != evidence['sha256']:
            raise Conflict('evidence hash mismatch')
    source, target = base / spec['source'], base / spec['output']
    receipt_path = spec_path.with_suffix('.log.json')
    inputs = [spec_path, source] + [base / e['path'] for e in spec['evidence_inputs']]
    destinations = [target, receipt_path]
    if target.resolve() == receipt_path.resolve():
        raise Conflict('output and receipt must be separate')
    for destination in destinations:
        if any(destination.resolve() == item.resolve() for item in inputs):
            raise Conflict('output and receipt must be separate from all inputs')
        # is_symlink also rejects dangling links; exclusive open below closes
        # the ordinary check/create race without truncating an existing file.
        if destination.exists() or destination.is_symlink():
            raise Conflict('output and receipt must both be new')
    data = source.read_bytes()
    output, receipt = apply(data, spec)
    assert rollback(output, receipt) == data
    receipt.update({'source':str(source),'output':str(target),'chars_before':len(data.decode()),'chars_after':len(output.decode()),'length_limit':900,'length_pass':len(output.decode())<=900,'rollback_byte_equal':True,'test_type':'mechanical, not semantic evaluation'})
    receipt_bytes = (json.dumps(receipt, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    # Reserve the receipt exclusively before writing output. Existing inputs,
    # receipts and outputs are never opened in truncating mode.
    with receipt_path.open('xb') as receipt_file:
        with target.open('xb') as output_file:
            output_file.write(output)
        receipt_file.write(receipt_bytes)
    return receipt

if __name__ == '__main__':
    import sys
    print(json.dumps(run(sys.argv[1]), ensure_ascii=False, indent=2))

"""Synthetic portable smoke/parity checks. Never reads natural article evidence."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from itertools import combinations
from loader import load_receipt


def fixture(r, state, lang):
    source = ('a b' if lang == 'EN' else '가 나').encode()
    changes = ['A','B'] if lang == 'EN' else ['각','낙']
    patches = []
    for i, (before, after) in enumerate(zip(source.decode().split(), changes)):
        start = source.index(before.encode())
        patches.append(dict(id='p'+str(i+1),start=start,end=start+len(before.encode()),before=before,after=after))
    if state == 'no-op': patches = []
    proposal = r.canonical(dict(writer_id='writer',preimage_sha256=r.digest(source),patches=patches))
    ids = [p['id'] for p in patches]
    binding = dict(source_sha256=r.digest(source),proposal_sha256=r.digest(proposal),complete=True,read_complete=True)
    dependency = r.canonical(dict(binding,auditor_id='dep',patch_ids=ids,pairs=[dict(ids=list(pair),relation='independent') for pair in combinations(ids,2)]))
    audit = r.canonical(dict(binding,auditor_id='patch',patch_decisions=[dict(id=pid,decision='rejected' if state=='partial' and pid=='p2' else 'approved') for pid in ids],preexisting_findings=[]))
    initial = r.engine.propose_selection(source,proposal,dependency,audit)
    final = r.canonical(dict(binding,auditor_id='final',whole_candidate_reviewed=True,candidate_sha256=initial.candidate_sha256,selected_ids=list(initial.selected_ids),decision='rejected' if state=='rolledback' else 'approved',findings=[]))
    finals = () if state == 'abstained' else (final,)
    output, note = r.v10.build_delivery(source,proposal,dependency,audit,finals)
    return output,initial.candidate,note,source,proposal,dependency,audit,finals


def reference_loader(candidate_dir):
    path=Path(candidate_dir).resolve()/'receipt.py'
    spec=importlib.util.spec_from_file_location('_original_receipt_reference',path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    return module


def run(version='v1_1', reference=None):
    portable=load_receipt(version)
    original=reference_loader(reference) if reference else None
    rows=[]
    for lang in ('EN','KO'):
        for state in ('applied','partial','rolledback','no-op','abstained'):
            args=fixture(portable,state,lang)
            receipt=portable.build(*args)
            rendered=portable.emit(receipt,*args,lang=lang)
            assert json.loads(receipt.raw)['status']==state
            assert rendered['status']=='verified'
            with tempfile.TemporaryDirectory() as tmp:
                store=portable.Store(Path(tmp)/'objects')
                try:
                    store.put(receipt,*args)
                    assert store.get(receipt.address,*args)==receipt
                finally: store.close()
            row=dict(lang=lang,state=state,receipt_sha256=receipt.address,output_sha256=portable.digest(args[0]),portable_roundtrip=True)
            if original:
                baseline_args=fixture(original,state,lang)
                baseline=original.build(*baseline_args)
                baseline_text=original.emit(baseline,*baseline_args,lang=lang)
                assert args==baseline_args
                assert receipt.raw==baseline.raw
                assert rendered==baseline_text
                row.update(actual_inputs_equal=True,receipt_bytes_equal=True,annotations_equal=True)
            rows.append(row)
    return dict(version=version,synthetic_cases=len(rows),reference_comparison=bool(reference),rows=rows,provenance=portable.PORTABLE_REPLAY_PROVENANCE)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version',choices=['v1_1','v1_2','v1_3'],default='v1_1')
    parser.add_argument('--reference',type=Path,help='optional frozen original directory; original loader remains unchanged')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    result=run(args.version,args.reference)
    output=json.dumps(result,indent=2,ensure_ascii=False)+'\n'
    if args.output: args.output.write_text(output)
    print(output,end='')

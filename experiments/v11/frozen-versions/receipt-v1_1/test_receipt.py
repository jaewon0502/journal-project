import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from itertools import combinations
import receipt as r


def fixture(kind='applied', lang='EN'):
    source = ('a b' if lang=='EN' else '가 나').encode()
    patches=[]
    for i,(old,new) in enumerate(zip(source.decode().split(),['A','B'] if lang=='EN' else ['각','낙'])):
        start=source.index(old.encode()); patches.append(dict(id='p'+str(i+1),start=start,end=start+len(old.encode()),before=old,after=new))
    if kind=='no-op': patches=[]
    proposal=r.canonical(dict(writer_id='writer',preimage_sha256=r.digest(source),patches=patches))
    ids=[p['id'] for p in patches]
    binding=dict(source_sha256=r.digest(source),proposal_sha256=r.digest(proposal),complete=True,read_complete=True)
    dep=r.canonical(dict(**binding,auditor_id='dep',patch_ids=ids,pairs=[dict(ids=list(x),relation='independent') for x in combinations(ids,2)]))
    audit=r.canonical(dict(**binding,auditor_id='patch',patch_decisions=[dict(id=i,decision='rejected' if kind=='partial' and i=='p2' else 'approved') for i in ids],preexisting_findings=[]))
    initial=r.engine.propose_selection(source,proposal,dep,audit)
    final=r.canonical(dict(**binding,auditor_id='final',whole_candidate_reviewed=True,candidate_sha256=initial.candidate_sha256,selected_ids=list(initial.selected_ids),decision='rejected' if kind=='rolledback' else 'approved',findings=[]))
    finals=() if kind=='abstained' else (final,)
    output,note=r.v10.build_delivery(source,proposal,dep,audit,finals)
    return output,initial.candidate,note,source,proposal,dep,audit,finals


class ReceiptTests(unittest.TestCase):
    def test_states_and_language(self):
        for lang in ('EN','KO'):
            for state in ('applied','partial','rolledback','no-op','abstained'):
                args=fixture(state,lang); receipt=r.build(*args)
                self.assertEqual(json.loads(receipt.raw)['status'],state)
                rendered=r.emit(receipt,*args,lang=lang)
                self.assertEqual(rendered['status'],'verified')
                self.assertIn(receipt.address,rendered['text'])
                self.assertEqual(json.loads(receipt.raw)['question_resolution'],'not_adjudicated')
    def test_all_actual_values_bound(self):
        args=fixture(); receipt=r.build(*args)
        for index in (0,1,3,4,5,6):
            bad=list(args); bad[index]+=b'!'
            self.assertEqual(r.emit(receipt,*bad)['status'],'verification_failed')
        for field in args[2]:
            bad=list(args); bad[2]=copy.deepcopy(args[2]); del bad[2][field]
            self.assertEqual(r.emit(receipt,*bad)['status'],'verification_failed',field)
    def test_aliases_prose_and_receipt_tampering(self):
        args=fixture(); receipt=r.build(*args)
        for value in (1,1.0,'true',None):
            bad=list(args); bad[2]=copy.deepcopy(args[2]); bad[2]['released']=value
            self.assertEqual(r.emit(receipt,*bad)['status'],'verification_failed')
        bad=list(args); bad[2]=copy.deepcopy(args[2]); bad[2]['delivery_summary']='Everything was published and verified.'
        self.assertEqual(r.emit(receipt,*bad)['status'],'verification_failed')
        for key,value in [('question_resolution','resolved'),('external_publication_performed',True),('selected_ids',[]),('extra','prose')]:
            changed=json.loads(receipt.raw); changed[key]=value
            self.assertEqual(r.emit(r.Receipt(r.canonical(changed)),*args)['status'],'verification_failed')
    def test_stale_or_malformed_audit_abstains(self):
        args=fixture()
        for final in (b'{}',b'not json',r.canonical(dict(json.loads(args[7][0]),candidate_sha256='0'*64)),r.canonical(dict(json.loads(args[7][0]),complete=1))):
            a=list(args); a[7]=(final,); a[0],a[2]=r.v10.build_delivery(*a[3:7],a[7])
            rec=r.build(*a); self.assertEqual(json.loads(rec.raw)['status'],'abstained')
            self.assertFalse(json.loads(rec.raw)['locally_released'])
    def test_empty_unapproved_abstains(self):
        a=list(fixture('no-op')); a[7]=(); a[0],a[2]=r.v10.build_delivery(*a[3:7])
        self.assertEqual(json.loads(r.build(*a).raw)['status'],'abstained')
    def test_source_only_separate_candidate(self):
        a=list(fixture()); a[0],a[2]=r.v10.build_delivery(*a[3:7],a[7],policy='source_only')
        rec=r.build(*a,policy='source_only'); data=json.loads(rec.raw)
        self.assertEqual(data['status'],'rolledback'); self.assertNotEqual(data['candidate_sha256'],data['output_sha256'])
    def test_store_roundtrip_and_collision(self):
        args=fixture(); rec=r.build(*args)
        with tempfile.TemporaryDirectory() as tmp:
            store=r.Store(Path(tmp)/'objects')
            try:
                self.assertEqual(store.put(rec,*args),rec.address); store.put(rec,*args)
                self.assertEqual(store.get(rec.address,*args),rec)
                p=Path(tmp)/'objects'/(rec.address+'.json'); os.chmod(p,0o600); p.write_bytes(b'bad')
                with self.assertRaises(ValueError): store.put(rec,*args)
                with self.assertRaises(ValueError): store.get(rec.address,*args)
                for address in ('../a','A'*64,'0'*63):
                    with self.assertRaises(ValueError): store.get(address,*args)
            finally: store.close()
    def test_store_rejects_symlinks_and_legacy(self):
        args=fixture(); rec=r.build(*args)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'legacy').mkdir(); (root/'legacy'/'keep').write_text('legacy')
            with self.assertRaises(FileNotFoundError): r.Store(root/'legacy')
            self.assertEqual((root/'legacy'/'keep').read_text(),'legacy')
            (root/'alias').symlink_to(root/'legacy',target_is_directory=True)
            with self.assertRaises(OSError): r.Store(root/'alias')
            with self.assertRaises(OSError): r.Store(root/'alias'/'new')
            store=r.Store(root/'objects')
            try:
                (root/'objects'/(rec.address+'.json')).symlink_to(root/'legacy'/'keep')
                with self.assertRaises(OSError): store.put(rec,*args)
                self.assertEqual((root/'legacy'/'keep').read_text(),'legacy')
            finally: store.close()
    def test_store_hardlink_and_fifo_rejected(self):
        args=fixture(); rec=r.build(*args)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); store=r.Store(root/'objects'); dest=root/'objects'/(rec.address+'.json')
            try:
                (root/'other').write_bytes(rec.raw); os.link(root/'other',dest)
                with self.assertRaises(ValueError): store.put(rec,*args)
                dest.unlink(); os.mkfifo(dest)
                with self.assertRaises(ValueError): store.put(rec,*args)
            finally: store.close()

if __name__=='__main__': unittest.main()

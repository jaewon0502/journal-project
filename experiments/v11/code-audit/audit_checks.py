"""Six independent checks; no frozen-file mutations and no hidden-case inputs.
Run: PYTHONDONTWRITEBYTECODE=1 python /historical-research/journal-v11/code-audit/audit_checks.py
"""
import copy, hashlib, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, '/historical-research/journal-v11/receipt')
import receipt as r
from test_receipt import fixture
ROOT=Path('/historical-research/journal-v11/code-audit')
OBS={}

def rebuilt(a):
    a=list(a)
    a[1]=r.engine.propose_selection(*a[3:7]).candidate
    a[0],a[2]=r.v10.build_delivery(*a[3:7],a[7])
    return a

def rejected(call):
    try: call()
    except (ValueError, OSError): return True
    return False

class IndependentChecks(unittest.TestCase):
    def test_01_stale_and_intermediate_binding(self):
        a=fixture('abstained'); rec=r.build(*a)
        self.assertNotEqual(a[0],a[1])
        for indices in ((0,), (0,1)):
            bad=list(a)
            if indices==(0,): bad[0]=a[1]
            else: bad[0],bad[1]=a[1],a[0]
            self.assertEqual(r.emit(rec,*bad)['status'],'verification_failed')
        b=fixture('applied'); rec2=r.build(*b)
        bad=list(b); bad[0]=b[0]+b' post-receipt edit'
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            store=r.Store(Path(tmp)/'objects')
            try:
                store.put(rec2,*b)
                self.assertTrue(rejected(lambda:store.get(rec2.address,*bad)))
            finally: store.close()
        OBS['01']={'result':'pass','checks':'changed output, candidate substituted for output, swapped output/candidate, stale store retrieval'}

    def test_02_dependency_rejection_then_fresh_partial(self):
        source=b'a b c'; patches=[dict(id='p'+str(i+1),start=2*i,end=2*i+1,before=c,after=c.upper()) for i,c in enumerate('abc')]
        prop=r.canonical(dict(writer_id='writer',preimage_sha256=r.digest(source),patches=patches))
        binding=dict(source_sha256=r.digest(source),proposal_sha256=r.digest(prop),complete=True,read_complete=True)
        dep=r.canonical(dict(**binding,auditor_id='dep',patch_ids=['p1','p2','p3'],pairs=[dict(ids=ids,relation=rel) for ids,rel in [(['p1','p2'],'dependent'),(['p1','p3'],'independent'),(['p2','p3'],'independent')]]))
        audit=r.canonical(dict(**binding,auditor_id='patch',patch_decisions=[dict(id=p['id'],decision='approved') for p in patches],preexisting_findings=[]))
        initial=r.engine.propose_selection(source,prop,dep,audit)
        final=dict(**binding,auditor_id='final',whole_candidate_reviewed=True,candidate_sha256=initial.candidate_sha256,selected_ids=list(initial.selected_ids),decision='rejected',findings=[dict(id='f',description='drop p1',relation='offending',patch_ids=['p1'])])
        rejection=r.canonical(final); reduced=r.engine.release_selection(initial,rejection).provisional
        self.assertEqual(reduced.selected_ids,('p3',))
        a=rebuilt([None,None,None,source,prop,dep,audit,(rejection,)])
        self.assertEqual(a[0],source); self.assertEqual(json.loads(r.build(*a).raw)['status'],'rolledback')
        # Stale approval of the initial candidate cannot approve the reduced one.
        old_approval=r.canonical(dict(final,decision='approved',findings=[]))
        stale=rebuilt(a[:7]+[(rejection,old_approval)])
        self.assertEqual(json.loads(r.build(*stale).raw)['status'],'abstained')
        fresh=r.canonical(dict(final,decision='approved',findings=[],candidate_sha256=reduced.candidate_sha256,selected_ids=['p3']))
        approved=rebuilt(a[:7]+[(rejection,fresh)])
        data=json.loads(r.build(*approved).raw)
        self.assertEqual(approved[0],b'a b C'); self.assertEqual(data['selected_ids'],['p3']); self.assertEqual(data['status'],'partial')
        self.assertEqual(data['rejected_ids'],['p1','p2']); self.assertEqual(data['candidate_selected_ids'],['p1','p2','p3'])
        OBS['02']={'result':'pass','output':approved[0].decode(),'selected':data['selected_ids'],'rejected':data['rejected_ids'],'status':data['status']}

    def test_03_types_failure_templates_and_prose(self):
        a=list(fixture()); audit=json.loads(a[6]); marker='UNTRUSTED_WRITER_COMPLETED_AND_RESOLVED'
        audit['preexisting_findings']=[dict(description=marker,evidence_ids=[marker])]; a[6]=r.canonical(audit)
        final=json.loads(a[7][0]); final['findings']=[dict(id='f',description=marker,relation='preexisting_independent',patch_ids=[])]; a[7]=(r.canonical(final),)
        a=rebuilt(a); rec=r.build(*a); data=json.loads(rec.raw)
        for lang in ('EN','KO'):
            emitted=r.emit(rec,*a,lang=lang)
            self.assertEqual(emitted['status'],'verified'); self.assertNotIn(marker,emitted['text'])
            self.assertEqual(data['semantic_truth'],'not_independently_verified'); self.assertEqual(data['question_resolution'],'not_adjudicated')
            mutations=[('released',1),('source_equals_output',0),('not_semantic_proof',1)]
            for key,val in mutations:
                bad=copy.deepcopy(a); bad[2][key]=val
                fail=r.emit(rec,*bad,lang=lang)
                self.assertEqual(fail['status'],'verification_failed'); self.assertIsNone(fail['receipt_sha256'])
                self.assertEqual(fail['text'], 'Verification failed. No completion or application claim is available.' if lang=='EN' else '검증 실패. 완료 또는 적용 여부를 확인할 수 없습니다.')
            bad=copy.deepcopy(a); bad[2]['patches'][0]['source_span'][0]=False
            self.assertEqual(r.emit(rec,*bad,lang=lang)['status'],'verification_failed')
        OBS['03']={'result':'pass','prose_marker_absent':True,'semantic_truth':data['semantic_truth'],'question_resolution':data['question_resolution']}

    def test_04_write_once_incomplete_and_unsafe_store(self):
        a=fixture(); rec=r.build(*a)
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            root=Path(tmp); store=r.Store(root/'objects'); dest=root/'objects'/(rec.address+'.json')
            try:
                # Fault at durability step after exclusive creation. No normal API can repair/overwrite it.
                with patch.object(r.os,'fsync',side_effect=OSError('injected interrupted fsync')):
                    self.assertTrue(rejected(lambda:store.put(rec,*a)))
                self.assertEqual(dest.read_bytes(),rec.raw)
                # Model an interrupted short write in this isolated, audit-owned store.
                os.chmod(dest,0o600); dest.write_bytes(rec.raw[:37]); before=dest.read_bytes()
                self.assertTrue(rejected(lambda:store.put(rec,*a))); self.assertTrue(rejected(lambda:store.get(rec.address,*a)))
                self.assertEqual(dest.read_bytes(),before)
                dest.unlink(); target=root/'target'; target.write_bytes(rec.raw)
                dest.symlink_to(target)
                self.assertTrue(rejected(lambda:store.put(rec,*a))); self.assertTrue(rejected(lambda:store.get(rec.address,*a)))
                dest.unlink(); os.link(target,dest)
                self.assertTrue(rejected(lambda:store.put(rec,*a))); self.assertTrue(rejected(lambda:store.get(rec.address,*a)))
                self.assertEqual(target.read_bytes(),rec.raw)
            finally: store.close()
        OBS['04']={'result':'pass','checks':'fsync exception propagated; short object not repaired; symlink and hardlink put/get rejected; targets unchanged'}

    def test_05_deep_malformed_final_returns_fixed_failure(self):
        a=list(fixture()); rec=r.build(*a)
        a[7]=(b'{"deep":'+b'['*1100+b'0'+b']'*1100+b'}',)
        try:
            result=r.emit(rec,*a)
            OBS['05']={'result':'pass' if result['status']=='verification_failed' else 'failure','returned':result}
        except Exception as exc:
            OBS['05']={'result':'failure','exception':type(exc).__name__,'message':str(exc),'raw_audit_bytes':len(a[7][0])}
            self.fail('emit escaped '+type(exc).__name__+' instead of fixed failure template')

    def test_06_large_valid_receipt_roundtrip_and_render(self):
        a=list(fixture()); audit=json.loads(a[6]); audit['preexisting_findings']=[{'description':'review reference','evidence_ids':[]} for _ in range(30000)]; a[6]=r.canonical(audit)
        a=rebuilt(a); rec=r.build(*a)
        result=r.emit(rec,*a)
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            store=r.Store(Path(tmp)/'objects')
            try:
                address=store.put(rec,*a)
                try: store.get(address,*a); get_result='success'
                except Exception as exc: get_result=type(exc).__name__+': '+str(exc)
            finally: store.close()
        OBS['06']={'result':'pass' if result['status']=='verified' and get_result=='success' else 'failure','patch_audit_bytes':len(a[6]),'receipt_bytes':len(rec.raw),'verified':r.verify(rec,*a),'emitted_status':result['status'],'put_returned_address':address,'get':get_result}
        self.assertEqual((result['status'],get_result),('verified','success'),'mint/verify/put succeeded, but render and get failed')

if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(IndependentChecks)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    (ROOT/'observations.json').write_text(json.dumps(OBS,indent=2,ensure_ascii=False)+'\n')
    sys.exit(not result.wasSuccessful())

"""Paired KO/EN synthetic contract checks; no model or external calls."""
import copy
import json
import unittest
from itertools import combinations
from delivery import build_delivery, verify_delivery, engine, digest, local_hunks


def raw(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True).encode()


def fixture(lang='EN', rejected=(), unknown=(), relation='independent', noop=False):
    source = ('가 나 다' if lang == 'KO' else 'a b c').encode()
    patches = []
    for i, (a,b) in enumerate(zip(source.decode().split(), ['각','낙','닥'] if lang == 'KO' else ['A','B','C'])):
        start = source.index(a.encode())
        patches.append(dict(id=chr(65+i), start=start, end=start+len(a.encode()), before=a, after=b))
    if noop:
        patches = []
    proposal = raw(dict(writer_id='writer', preimage_sha256=digest(source), patches=patches))
    ids = [p['id'] for p in patches]
    bind = dict(source_sha256=digest(source), proposal_sha256=digest(proposal), complete=True, read_complete=True)
    dep = raw(dict(**bind, auditor_id='dependency', patch_ids=ids, pairs=[dict(ids=list(pair),relation=relation if pair==('A','B') else 'independent') for pair in combinations(ids,2)]))
    audit = raw(dict(**bind, auditor_id='patch', patch_decisions=[dict(id=i, decision='rejected' if i in rejected else 'unknown' if i in unknown else 'approved') for i in ids], preexisting_findings=[]))
    return source, proposal, dep, audit


def verdict(args, selection=None, **update):
    s = selection or engine.propose_selection(*args)
    d = dict(source_sha256=digest(s.source), proposal_sha256=digest(s.proposal_raw),
             auditor_id='final', complete=True, read_complete=True, candidate_sha256=s.candidate_sha256,
             selected_ids=list(s.selected_ids), whole_candidate_reviewed=True, decision='approved', findings=[])
    d.update(update)
    return raw(d)


class DeliveryTests(unittest.TestCase):
    def test_independent_good_bad(self):
        for lang in ('KO','EN'):
            args=fixture(lang,rejected=('B',)); out,n=build_delivery(*args,[verdict(args)])
            self.assertEqual(n['applied_ids'],['A','C'])
            self.assertEqual([x['state'] for x in n['components']],['applied','rolledback','applied'])
            self.assertTrue(verify_delivery(out,n,*args,[verdict(args)]))

    def test_dependency_one_factor(self):
        for lang in ('KO','EN'):
            args=fixture(lang,rejected=('B',),relation='dependent')
            out,n=build_delivery(*args,[verdict(args)])
            self.assertEqual(n['applied_ids'],['C'])
            self.assertEqual(n['components'][0]['patch_ids'],['A','B'])

    def test_new_error_requires_new_final_hash(self):
        for lang in ('KO','EN'):
            args=fixture(lang,relation='dependent')
            first=verdict(args,findings=[dict(id='new',description='synthetic introduced issue',relation='offending',patch_ids=['B'])])
            out,n=build_delivery(*args,[first]); self.assertEqual(out,args[0]); self.assertFalse(n['released'])
            sel=engine.release_selection(engine.propose_selection(*args),first).provisional
            stale=build_delivery(*args,[first,first])[1]; self.assertFalse(stale['released'])
            second=verdict(args,sel)
            out,n=build_delivery(*args,[first,second]); self.assertEqual(n['applied_ids'],['C'])
            self.assertEqual(n['components'][0]['state'],'rolledback')
            self.assertEqual(n['final_candidate_sha256'],n['output_sha256'])

    def test_unrelated_preexisting_does_not_block(self):
        for lang in ('KO','EN'):
            args=fixture(lang)
            v=verdict(args,findings=[dict(id='old',description='synthetic unrelated old error',relation='preexisting_independent',patch_ids=[])])
            out,n=build_delivery(*args,[v]); self.assertTrue(n['released']); self.assertEqual(len(n['unresolved']),1)
            self.assertEqual(n['unresolved'][0]['state'],'resolution_not_adjudicated')
            self.assertIn('잔존 오류 확정이 아니며',n['delivery_summary'])
            self.assertNotIn('synthetic unrelated',json.dumps(n))

    def test_noop_normal_still_requires_audit(self):
        for lang in ('KO','EN'):
            args=fixture(lang,noop=True)
            self.assertEqual(build_delivery(*args)[1]['status'],'held')
            out,n=build_delivery(*args,[verdict(args)])
            self.assertEqual(out,args[0]); self.assertEqual(n['status'],'noop'); self.assertTrue(n['released'])

    def test_uncertainty_one_factor(self):
        for lang in ('KO','EN'):
            for kw in (dict(unknown=('A',)),dict(relation='unknown')):
                args=fixture(lang,**kw); out,n=build_delivery(*args,[verdict(args)])
                self.assertNotIn('A',n['applied_ids'])
                self.assertEqual(n['components'][0]['state'],'held')
            args=fixture(lang)
            out,n=build_delivery(*args,[verdict(args,decision='unknown')]); self.assertEqual(out,args[0]); self.assertEqual(n['status'],'held')

    def test_whole_rollback_never_copies_completion_prose(self):
        for lang in ('KO','EN'):
            args=list(fixture(lang)); a=json.loads(args[3]); a['preexisting_findings']=[dict(description='the proposed patch corrects these units',evidence_ids=['E1'])]; args[3]=raw(a)
            out,n=build_delivery(*args,[verdict(args)],policy='source_only')
            self.assertEqual(out,args[0]); self.assertEqual(n['status'],'rolledback'); self.assertEqual(n['applied_ids'],[])
            self.assertNotIn('corrects',json.dumps(n)); self.assertEqual(n['unresolved'][0]['evidence_ids'],['E1'])

    def test_annotation_and_byte_tampering_fail(self):
        args=fixture(); audits=[verdict(args)]; out,n=build_delivery(*args,audits)
        for path,value in [('output_sha256','0'*64),('status','noop'),('applied_ids',[])]:
            altered=copy.deepcopy(n); altered[path]=value
            with self.assertRaises(ValueError): verify_delivery(out,altered,*args,audits)
        altered=copy.deepcopy(n); altered['patches'][0]['state']='held'
        with self.assertRaises(ValueError): verify_delivery(out,altered,*args,audits)
        altered=copy.deepcopy(n); altered['free_prose']='repair completed'
        with self.assertRaises(ValueError): verify_delivery(out,altered,*args,audits)
        with self.assertRaises(ValueError): verify_delivery(out+b'!',n,*args,audits)

    def test_missing_wrong_hash_malformed_final_holds(self):
        args=fixture()
        for v in (b'{}',b'not json',verdict(args,candidate_sha256='0'*64)):
            out,n=build_delivery(*args,[v]); self.assertEqual(out,args[0]); self.assertFalse(n['released'])

    def test_utf8_minimal_hunks_keep_unchanged_context(self):
        p=dict(start=3,before='금리 1.19% 및 1.43%',after='금리 1.19%포인트 및 1.43%포인트')
        hunks=local_hunks(p); self.assertEqual(len(hunks),2)
        self.assertTrue(all(h['before']=='' and h['after']=='포인트' for h in hunks))

    def test_exact_preimage_and_dependency_forgery_rejected(self):
        args=list(fixture()); p=json.loads(args[1]); p['patches'][0]['before']='wrong'; args[1]=raw(p)
        with self.assertRaises(ValueError): build_delivery(*args)
        args=list(fixture()); d=json.loads(args[2]); d['pairs']=[]; args[2]=raw(d)
        with self.assertRaises(ValueError): build_delivery(*args)


if __name__=='__main__': unittest.main(verbosity=2)

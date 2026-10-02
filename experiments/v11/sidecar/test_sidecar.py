import copy
import json
from pathlib import Path
import tempfile
import unittest
import sidecar as s

def replay(source=b'foo'):
    r=s.R
    proposal=r.canonical({'writer_id':'writer','preimage_sha256':r.digest(source),'patches':[]})
    binding={'source_sha256':r.digest(source),'proposal_sha256':r.digest(proposal),'complete':True,'read_complete':True}
    dependency=r.canonical(dict(binding,auditor_id='dependency',patch_ids=[],pairs=[]))
    audit=r.canonical(dict(binding,auditor_id='patch',patch_decisions=[],preexisting_findings=[]))
    initial=r.engine.propose_selection(source,proposal,dependency,audit)
    final=r.canonical(dict(binding,auditor_id='final',candidate_sha256=initial.candidate_sha256,selected_ids=[],whole_candidate_reviewed=True,decision='approved',findings=[]))
    output,note=r.v10.build_delivery(source,proposal,dependency,audit,(final,))
    args=(output,initial.candidate,note,source,proposal,dependency,audit,(final,))
    return r.build(*args).raw,args

def fixture(folder,lang='EN',empty=False,source=b'foo'):
    receipt,args=replay(source)
    container=s.R.canonical({'actual_receipt':json.loads(receipt)})
    path=Path(folder)/'receipt.json'; path.write_bytes(container)
    text=source.decode()
    anchor={'start_byte':0,'end_byte':len(source),'text':text,'sha256':s.digest(source)}
    evidence_anchor={'evidence_id':'E1','start_byte':0,'end_byte':3,'text':'bar','sha256':s.digest(b'bar')}
    issue={'id':'I1','kind':'question_comparison','review_status':'reported_unresolved','output_span':anchor,'evidence_span':evidence_anchor}
    data={'schema':'journal-v11.issue-sidecar-input.v1','input_id':'developer-replay','language':lang,
          'actual_output':text,'output_sha256':s.digest(source),
          'receipt_address':{'path':str(path),'json_pointer':'/actual_receipt','file_sha256':s.digest(container),'receipt_sha256':s.digest(receipt)},
          'evidence':[{'id':'E1','text':'bar','sha256':s.digest(b'bar')}],'issues':[] if empty else [issue]}
    return data,receipt,args

class SidecarTests(unittest.TestCase):
    def test_normal_both_languages_and_kinds(self):
        with tempfile.TemporaryDirectory() as folder:
            for lang in ('EN','KO'):
                for kind in ('question_comparison','arithmetic'):
                    d,receipt,args=fixture(folder,lang); d['issues'][0]['kind']=kind
                    raw=s.R.canonical(d); before=(receipt,args[0])
                    result=s.build(raw,receipt,*args)
                    self.assertTrue(s.verify(result,raw,receipt,*args))
                    emitted=s.emit(raw,receipt,*args)
                    self.assertEqual(emitted['status'],'verified'); self.assertIn('foo',emitted['text']); self.assertIn('bar',emitted['text'])
                    self.assertIn(s.CAVEAT[lang],emitted['text']); self.assertEqual(before,(receipt,args[0]))
    def test_empty_is_not_all_resolved(self):
        with tempfile.TemporaryDirectory() as folder:
            for lang in ('EN','KO'):
                d,receipt,args=fixture(folder,lang,True)
                result=s.emit(s.R.canonical(d),receipt,*args)
                self.assertEqual(result['text'],s.EMPTY[lang])
    def test_stale_hashes_and_receipt_body(self):
        with tempfile.TemporaryDirectory() as folder:
            d,receipt,args=fixture(folder)
            for change in ('output','evidence','file','receipt','actual_output'):
                bad=copy.deepcopy(d)
                if change=='output': bad['output_sha256']='0'*64
                elif change=='evidence': bad['evidence'][0]['sha256']='0'*64
                elif change=='file': bad['receipt_address']['file_sha256']='0'*64
                elif change=='receipt': bad['receipt_address']['receipt_sha256']='0'*64
                else: bad['actual_output']='different'
                self.assertEqual(s.emit(s.R.canonical(bad),receipt,*args)['status'],'verification_failed')
            altered=list(args); altered[0]=b'changed'
            self.assertEqual(s.emit(s.R.canonical(d),receipt,*altered)['status'],'verification_failed')
    def test_anchors_unknown_kind_status_fields_and_type_alias(self):
        with tempfile.TemporaryDirectory() as folder:
            d,receipt,args=fixture(folder,source='한글'.encode())
            changes=[('kind','invented'),('review_status','resolved'),('extra_prose','Everything resolved')]
            for key,value in changes:
                bad=copy.deepcopy(d); bad['issues'][0][key]=value
                self.assertEqual(s.emit(s.R.canonical(bad),receipt,*args)['status'],'verification_failed')
            for key,value in [('start_byte',1),('start_byte',False),('text','invented'),('sha256','0'*64)]:
                bad=copy.deepcopy(d); bad['issues'][0]['output_span'][key]=value
                self.assertEqual(s.emit(s.R.canonical(bad),receipt,*args)['status'],'verification_failed')
    def test_no_partial_truncation_or_modified_prose_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            d,receipt,args=fixture(folder); raw=s.R.canonical(d); result=s.build(raw,receipt,*args)
            for key,value in [('issues',[]),('rendered_text','All issues resolved.'),('input_sha256','0'*64)]:
                bad=json.loads(result.raw); bad[key]=value
                with self.assertRaises(ValueError): s.verify(s.Sidecar(s.R.canonical(bad)),raw,receipt,*args)
            self.assertEqual(s.emit(raw[:-3],receipt,*args)['status'],'verification_failed')
    def test_lengths_fail_without_omission(self):
        with tempfile.TemporaryDirectory() as folder:
            for lang in ('EN','KO'):
                d,receipt,args=fixture(folder,lang)
                d['issues']=[dict(copy.deepcopy(d['issues'][0]),id='I'+str(i)) for i in range(16)]
                self.assertEqual(s.emit(s.R.canonical(d),receipt,*args)['status'],'verification_failed')
            d,receipt,args=fixture(folder)
            long='x'*(s.MAX_SPAN_BYTES+1); d['evidence'][0].update(text=long,sha256=s.digest(long.encode()))
            d['issues'][0]['evidence_span'].update(text=long,end_byte=len(long),sha256=s.digest(long.encode()))
            self.assertEqual(s.emit(s.R.canonical(d),receipt,*args)['status'],'verification_failed')
    def test_generic_schema_receipt_is_not_verified(self):
        for n in (1,2):
            raw=(s.ROOT/'examples'/f'input-{n}.json').read_bytes()
            container=json.loads((s.ROOT/'examples'/f'receipt-{n}.json').read_bytes())
            fake=s.R.canonical(container['actual_receipt']); _,args=replay()
            self.assertEqual(s.emit(raw,fake,*args)['status'],'verification_failed')
    def test_duplicate_or_missing_reference_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            d,receipt,args=fixture(folder)
            d['issues'].append(copy.deepcopy(d['issues'][0]))
            self.assertEqual(s.emit(s.R.canonical(d),receipt,*args)['status'],'verification_failed')
            d['issues'].pop(); d['issues'][0]['evidence_span']['evidence_id']='missing'
            self.assertEqual(s.emit(s.R.canonical(d),receipt,*args)['status'],'verification_failed')

if __name__=='__main__': unittest.main()

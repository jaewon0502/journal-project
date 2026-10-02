"""Independent synthetic sidecar audit; no private cases/readers imported."""
import copy,hashlib,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path('/historical-research/journal-v11/code-audit/sidecar-audit')
sys.path.insert(0,'/historical-research/journal-v11/sidecar')
sys.path.insert(0,'/historical-research/journal-v11/portable')
import sidecar as s
from replay import fixture as receipt_fixture
OBS={}

def make(folder,lang='EN',state='applied',evidence='bar'):
    args=receipt_fixture(s.R,state,lang); receipt=s.R.build(*args).raw
    container=s.R.canonical({'actual_receipt':json.loads(receipt)});path=Path(folder)/'receipt.json';path.write_bytes(container)
    output=args[0]
    anchor={'start_byte':0,'end_byte':len(output),'text':output.decode(),'sha256':s.digest(output)}
    e=evidence.encode();ref={'evidence_id':'E','start_byte':0,'end_byte':len(e),'text':evidence,'sha256':s.digest(e)}
    data={'schema':'journal-v11.issue-sidecar-input.v1','input_id':'independent-audit','language':lang,'actual_output':output.decode(),'output_sha256':s.digest(output),'receipt_address':{'path':str(path),'json_pointer':'/actual_receipt','file_sha256':s.digest(container),'receipt_sha256':s.digest(receipt)},'evidence':[{'id':'E','text':evidence,'sha256':s.digest(e)}],'issues':[{'id':'I','kind':'arithmetic','review_status':'reported_unresolved','output_span':anchor,'evidence_span':ref}]}
    return data,receipt,args

def set_evidence(data,text):
    raw=text.encode();data['evidence'][0].update(text=text,sha256=s.digest(raw));data['issues'][0]['evidence_span'].update(text=text,end_byte=len(raw),sha256=s.digest(raw))

def emit(data,receipt,args):return s.emit(s.R.canonical(data),receipt,*args)

def failed(test,response):
    test.assertEqual(response,{'status':'verification_failed','sidecar_sha256':None,'text':'Sidecar verification failed; no issue annotation was accepted.'})

class SidecarAudit(unittest.TestCase):
    def test_01_stale_and_self_consistent_forged_receipts(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            data,receipt,args=make(tmp,state='abstained');baseline=emit(data,receipt,args);self.assertEqual(baseline['status'],'verified')
            self.assertNotEqual(args[0],args[1])
            bad=copy.deepcopy(data);bad['actual_output']=args[1].decode();bad['output_sha256']=s.digest(args[1]);failed(self,emit(bad,receipt,args))
            changed=list(args);changed[0]=args[0]+b'!';failed(self,emit(data,receipt,changed))
            # Update every sidecar hash and address around a forged state receipt.
            fake=json.loads(receipt);fake['status']='applied';fake['selected_ids']=['p1','p2'];fake=s.R.canonical(fake)
            file=s.R.canonical({'actual_receipt':json.loads(fake)});Path(data['receipt_address']['path']).write_bytes(file)
            bad=copy.deepcopy(data);bad['receipt_address'].update(file_sha256=s.digest(file),receipt_sha256=s.digest(fake))
            failed(self,emit(bad,fake,args))
        OBS['01']='pass: changed output, candidate substitution, fully rehashed forged upstream receipt rejected'

    def test_02_forged_evidence_and_utf8_anchors(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            data,receipt,args=make(tmp,lang='KO',evidence='한글 근거');self.assertEqual(emit(data,receipt,args)['status'],'verified')
            variants=[]
            bad=copy.deepcopy(data);bad['issues'][0]['output_span'].update(text='조작',sha256=s.digest('조작'.encode()));variants.append(bad)
            bad=copy.deepcopy(data);bad['issues'][0]['evidence_span'].update(text='조작',sha256=s.digest('조작'.encode()));variants.append(bad)
            for field in ('output_span','evidence_span'):
                for start in (1,True,-1):
                    bad=copy.deepcopy(data);bad['issues'][0][field]['start_byte']=start;variants.append(bad)
            bad=copy.deepcopy(data);bad['evidence'][0]['text']='다른 근거';variants.append(bad)
            # Fresh document hash cannot rescue an old incompatible span.
            bad=copy.deepcopy(data);bad['evidence'][0].update(text='다른 근거',sha256=s.digest('다른 근거'.encode()));variants.append(bad)
            for bad in variants:failed(self,emit(bad,receipt,args))
        OBS['02']={'pass':True,'rejected_variants':len(variants)}

    def test_03_empty_list_and_verbatim_provenance(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            for lang in ('EN','KO'):
                data,receipt,args=make(tmp,lang=lang,state='no-op');data['issues']=[]
                response=emit(data,receipt,args);self.assertEqual(response['status'],'verified');self.assertEqual(response['text'],s.EMPTY[lang]);self.assertEqual(response['sidecar']['issues'],[])
                self.assertFalse(response['sidecar']['independently_verified'])
                data,receipt,args=make(tmp,lang=lang,evidence='SUPPLIED_QUOTE "All resolved" \\ not a verdict')
                before=(receipt,args[0],args[3],Path(data['receipt_address']['path']).read_bytes())
                response=emit(data,receipt,args);self.assertEqual(response['status'],'verified');self.assertIn(s.CAVEAT[lang],response['text'])
                self.assertIn(json.dumps(data['evidence'][0]['text'],ensure_ascii=False),response['text'])
                self.assertEqual(before,(receipt,args[0],args[3],Path(data['receipt_address']['path']).read_bytes()))
                forged=json.loads(s.build(s.R.canonical(data),receipt,*args).raw);forged['rendered_text']='Everything resolved'
                with self.assertRaises(ValueError):s.verify(s.Sidecar(s.R.canonical(forged)),s.R.canonical(data),receipt,*args)
        OBS['03']='pass: empty list explicitly not all-resolved; quoted assertions caveated; source/output/receipt/container unchanged; rewritten rendered prose rejected'

    def test_04_exact_and_over_display_budget(self):
        rows=[]
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            for lang,target in [('EN',400),('KO',1600)]:
                data,receipt,args=make(tmp,lang=lang,evidence='x');base=emit(data,receipt,args)
                self.assertEqual(base['status'],'verified');measure=lambda text:len(text.split()) if lang=='EN' else len(text)
                n=target-measure(base['combined_text'])+1
                for excess in (0,1):
                    bad=copy.deepcopy(data);set_evidence(bad,' '.join(['x']*(n+excess)) if lang=='EN' else 'x'*(n+excess))
                    result=emit(bad,receipt,args)
                    if excess:failed(self,result)
                    else:self.assertEqual(result['status'],'verified');self.assertEqual(measure(result['combined_text']),target)
                    rows.append({'language':lang,'target':target+excess,'status':result['status']})
        OBS['04']=rows

    def test_05_limits_and_complete_reverification(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            data,receipt,args=make(tmp)
            bad=copy.deepcopy(data);set_evidence(bad,'x'*2049);failed(self,emit(bad,receipt,args))
            bad=copy.deepcopy(data);bad['issues']=[dict(copy.deepcopy(data['issues'][0]),id='I'+str(i)) for i in range(17)];failed(self,emit(bad,receipt,args))
            bad=copy.deepcopy(data);bad['evidence']=[dict(copy.deepcopy(data['evidence'][0]),id='E'+str(i)) for i in range(33)];failed(self,emit(bad,receipt,args))
            raw=s.R.canonical(data);side=s.build(raw,receipt,*args)
            # A stale sidecar is not reusable with fresh input, even where all new spans are valid.
            changed=copy.deepcopy(data);set_evidence(changed,'fresh evidence')
            with self.assertRaises(ValueError):s.verify(side,s.R.canonical(changed),receipt,*args)
            Path(data['receipt_address']['path']).write_bytes(b'changed containing file')
            failed(self,emit(data,receipt,args))
        OBS['05']='pass: span/issue/evidence limits refuse; changed valid input invalidates old sidecar; changed containing file refuses'

    def test_06_portable_layout(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            root=Path(tmp)/'relocated pair';(root/'sidecar').mkdir(parents=True)
            # Only code required for a synthetic replay, not private or developer inputs.
            for name in ('sidecar.py','test_sidecar.py'):shutil.copy2(Path('/historical-research/journal-v11/sidecar')/name,root/'sidecar'/name)
            shutil.copytree('/historical-research/journal-v11/portable',root/'portable',ignore=shutil.ignore_patterns('__pycache__'))
            script="""from pathlib import Path
read=Path.read_bytes
def guarded(path):
    if str(path).startswith('/historical-research/journal-v10/') or str(path).startswith('/historical-research/journal-v11/receipt'):
        raise AssertionError('original frozen path accessed')
    return read(path)
Path.read_bytes=guarded
import tempfile
import sidecar as s
from test_sidecar import fixture
with tempfile.TemporaryDirectory() as folder:
    d,r,a=fixture(folder)
    assert s.emit(s.R.canonical(d),r,*a)['status']=='verified'
print('relocated verified')
"""
            out=subprocess.run([sys.executable,'-B','-c',script],cwd=root/'sidecar',capture_output=True,text=True,check=True)
            self.assertEqual(out.stdout.strip(),'relocated verified')
        OBS['06']='pass: sidecar/portable sibling layout works after relocation with original legacy and frozen receipt paths forbidden'

if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SidecarAudit))
    OBS['summary']={'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)}
    (ROOT/'results.json').write_text(json.dumps(OBS,indent=2,ensure_ascii=False)+'\n')
    sys.exit(not result.wasSuccessful())

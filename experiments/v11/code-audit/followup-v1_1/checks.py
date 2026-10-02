import sys,json,unittest,tempfile,hashlib
from pathlib import Path
ROOT=Path('/historical-research/journal-v11/code-audit/followup-v1_1')
sys.path.insert(0,'/historical-research/journal-v11/receipt-v1_1')
import receipt as r
from test_receipt import fixture,ReceiptTests
namespace={'__name__':'independent_followup'}
original=Path('/historical-research/journal-v11/code-audit/audit_checks.py').read_text()
exec(compile(original.replace("sys.path.insert(0, '/historical-research/journal-v11/receipt')", "sys.path.insert(0, '/historical-research/journal-v11/receipt-v1_1')"),'preserved_original_checks_followup','exec'),namespace)
suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(ReceiptTests)])
for name in unittest.defaultTestLoader.getTestCaseNames(namespace['IndependentChecks']):
    if not name.startswith('test_06'): suite.addTest(namespace['IndependentChecks'](name))
result=unittest.TextTestRunner(verbosity=2).run(suite)
records={'native_plus_prior_01_to_05':{'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)},'size_contract_changed':True,'original_check06_preserved_as_original_failure':True}
def args_for(n):
    a=list(fixture()); audit=json.loads(a[6]);audit['preexisting_findings']=[{'evidence_ids':['z'*n]}];a[6]=r.canonical(audit);a[0],a[2]=r.v10.build_delivery(*a[3:7],a[7]);return a
base=len(r.build(*args_for(0)).raw)
records['boundary']=[]
for delta in (-1,0,1):
    a=args_for(r.MAX_RECEIPT_BYTES+delta-base)
    row={'target':r.MAX_RECEIPT_BYTES+delta,'audit_bytes':len(a[6])}
    try:
        rec=r.build(*a);row['mint_bytes']=len(rec.raw);row['verify']=r.verify(rec,*a);row['emit']=[r.emit(rec,*a,lang=l)['status'] for l in ('EN','KO')]
        with tempfile.TemporaryDirectory(dir=ROOT) as tmp:
            store=r.Store(Path(tmp)/'objects')
            try:store.put(rec,*a);row['roundtrip']=store.get(rec.address,*a)==rec
            finally:store.close()
    except Exception as e:row['exception']=type(e).__name__+': '+str(e)
    records['boundary'].append(row)
records['nested']=[]
a=fixture(); rec=r.build(*a)
for n in (3000,10000):
    b=list(a);b[7]=(b'{"deep":'+b'['*n+b'0'+b']'*n+b'}',)
    try: result=r.emit(rec,*b);row={'depth':n,'structured':result}
    except Exception as e:row={'depth':n,'uncaught':type(e).__name__+': '+str(e)}
    records['nested'].append(row)
(ROOT/'results.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records,indent=2),flush=True)
# Same original failing large fixture, now explicitly expected to reject at mint.
a=list(fixture()); audit=json.loads(a[6]);audit['preexisting_findings']=[{'description':'review reference','evidence_ids':[]} for _ in range(30000)];a[6]=r.canonical(audit);a[0],a[2]=r.v10.build_delivery(*a[3:7],a[7])
try:r.build(*a);records['original_large_followup']='UNEXPECTED accepted'
except Exception as e:records['original_large_followup']=type(e).__name__+': '+str(e)
for version in ('receipt','receipt-v1_1'):
    root=Path('/historical-research/journal-v11')/version;m=json.loads((root/'frozen-manifest.json').read_text());checks=[hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in m['files'].items()];checks += [hashlib.sha256(Path(k).read_bytes()).hexdigest()==v for k,v in m['legacy_dependencies'].items()];records[version+'_freeze']={'files':len(checks),'unchanged':all(checks)}
(ROOT/'results.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records,indent=2),flush=True)

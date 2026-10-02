"""Independent v1.2 audit; all fixtures synthetic, no frozen writes."""
import hashlib,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path('/historical-research/journal-v11/code-audit/followup-v1_2')
sys.path.insert(0,'/historical-research/journal-v11/receipt-v1_2')
import receipt as r
from test_receipt import fixture,ReceiptTests
from test_nesting_contract import NestingContractTests
from test_size_contract import SizeContractTests
suite=unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(ReceiptTests),unittest.defaultTestLoader.loadTestsFromTestCase(NestingContractTests)])
for name in ('test_real_near_exact_and_above_boundary','test_oversized_bypass_rejected_before_store_write'):
    suite.addTest(SizeContractTests(name))
result=unittest.TextTestRunner(verbosity=2).run(suite)
observed={'native_run':result.testsRun,'native_failures':len(result.failures),'native_errors':len(result.errors),'large_30000_case':'not redundantly rerun; v1.1 rejection already independently confirmed','encoding_checks':[]}
for encoding in ('utf-8','utf-16','utf-16-be','utf-32'):
    # Valid complete final review, retaining all exact binding fields.
    a=list(fixture());text=a[7][0][:-1].decode()+',"escaped":"\\\"","deep":'+'['*64+'0'+']'*64+'}'
    raw=text.encode(encoding)
    assert isinstance(json.loads(raw),dict)
    a[7]=(raw,);a[0],a[2]=r.v10.build_delivery(*a[3:7],a[7])
    row={'encoding':encoding,'actual_container_depth':65,'bytes':len(raw)}
    try:rec=r.build(*a);row['depth65_mint']='accepted';row['depth65_emit']=r.emit(rec,*a)['status']
    except Exception as exc:row['depth65_mint']=type(exc).__name__+': '+str(exc)
    # The original nested-failure shape, adding one escaped-quote string.
    a=list(fixture());rec=r.build(*a)
    raw=('{"escape":"\\\"","deep":'+'['*10000+'0'+']'*10000+'}').encode(encoding)
    a[7]=(raw,);row['deep_bytes']=len(raw)
    try:r.bounded_json_nesting(raw);row['deep_guard']='accepted'
    except Exception as exc:row['deep_guard']=type(exc).__name__+': '+str(exc)
    try:row['deep_emit']=r.emit(rec,*a)
    except Exception as exc:row['deep_emit']={'uncaught':type(exc).__name__,'message':str(exc)}
    observed['encoding_checks'].append(row)
# Verify bounds guard does not count syntax encoded inside ordinary UTF-8 strings,
# including slash runs, escaped quotes, unicode escapes, and brackets.
observed['string_cases']=[]
for value in ('[]{}'*200,'\\'*9+'"'+'['*100,'\\'*10+'"'+']'*100,'literal \\u005b \\u0022'):
    raw=json.dumps({'value':value}).encode();r.bounded_json_nesting(raw)
    observed['string_cases'].append({'input_bytes':len(raw),'accepted':True})
# The bound must not be bypassed by invalid closers prepended to an array.
try:r.bounded_json_nesting(b']'*100+b'['*65)
except ValueError:observed['extra_closers_cannot_cancel_depth']=True
else:observed['extra_closers_cannot_cancel_depth']=False
# A programming recursion error remains visible: no blanket swallowing.
a=fixture();rec=r.build(*a)
try:
    with patch.object(r.v10,'verify_delivery',side_effect=RecursionError('independent programming-error sentinel')):
        r.emit(rec,*a)
except RecursionError:observed['unrelated_programming_recursion_visible']=True
for version in ('receipt','receipt-v1_1','receipt-v1_2'):
    root=Path('/historical-research/journal-v11')/version;mraw=(root/'frozen-manifest.json').read_bytes();m=json.loads(mraw)
    pairs=[(root/k,v) for k,v in m['files'].items()]+[(Path(k),v) for k,v in m['legacy_dependencies'].items()]
    observed[version+'_freeze']={'files':len(pairs),'unchanged':all(hashlib.sha256(p.read_bytes()).hexdigest()==h for p,h in pairs),'manifest_sha256':hashlib.sha256(mraw).hexdigest()}
(ROOT/'results.json').write_text(json.dumps(observed,indent=2)+'\n')
print(json.dumps(observed,indent=2))

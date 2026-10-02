"""Old/new reproduction; only developer fixture and synthetic malformed JSON."""
from pathlib import Path
import importlib.util
import json
import sys
import receipt as current
from test_receipt import fixture

HERE=Path(__file__).resolve().parent

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec); sys.modules[name]=module
    spec.loader.exec_module(module)
    return module

rows=[]
for label,path in [('v11','/historical-research/journal-v11/receipt/receipt.py'),('v1.1','/historical-research/journal-v11/receipt-v1_1/receipt.py'),('v1.2',str(HERE/'receipt.py'))]:
    module=load('repro_'+label.replace('.','_'),path)
    args=list(fixture()); rec=module.build(*args)
    args[7]=(b'{"deep":'+b'['*10000+b'0'+b']'*10000+b'}',)
    row={'version':label,'depth':10000,'final_audit_bytes':len(args[7][0])}
    try: row['emitted']=module.emit(rec,*args)
    except RecursionError as exc: row['uncaught']='RecursionError'; row['message']=str(exc)
    rows.append(row)
result={'runtime_recursion_limit':sys.getrecursionlimit(),'rows':rows,'no_external_calls':True,'no_hidden_cases_read':True}
(HERE/'evidence'/'nesting-old-new.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(result,indent=2,ensure_ascii=False))

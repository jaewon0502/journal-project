"""Old/new encoding-bypass reproduction using developer-only authored inputs."""
from pathlib import Path
import importlib.util
import json
import sys
import receipt as current
from test_receipt import fixture
from test_encoding_contract import ENCODINGS,deep_text
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('previous_encoding_receipt','/historical-research/journal-v11/receipt-v1_2/receipt.py')
old=importlib.util.module_from_spec(spec); sys.modules[spec.name]=old; spec.loader.exec_module(old)
rows=[]
for label,module in [('v1.2',old),('v1.3',current)]:
    for encoding,bom in ENCODINGS:
        for prefix in (b'',bom):
            args=list(fixture()); rec=module.build(*args)
            args[7]=(prefix+deep_text(10000).encode(encoding),)
            row={'version':label,'encoding':encoding,'bom':bool(prefix),'depth':10000,'audit_bytes':len(args[7][0])}
            try: row['emitted']=module.emit(rec,*args)
            except RecursionError as exc: row['uncaught']='RecursionError'; row['message']=str(exc)
            rows.append(row)
result={'rows':rows,'compatibility_tightening':'UTF-16/UTF-32 autodetected byte JSON is now rejected; strict UTF-8 (optional UTF-8 BOM), no raw NUL bytes required. Escaped JSON \\u0000 remains accepted.','no_hidden_cases_read':True}
(HERE/'evidence'/'encoding-old-new.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'versions':{v:{'cases':sum(x['version']==v for x in rows),'uncaught_recursion':sum(x['version']==v and x.get('uncaught')=='RecursionError' for x in rows),'fixed_failure':sum(x['version']==v and x.get('emitted',{}).get('status')=='verification_failed' for x in rows)} for v in ('v1.2','v1.3')}},indent=2))

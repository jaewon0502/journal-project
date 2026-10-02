"""Two generic full-replay examples, separate from designer shape-only fixtures."""
from pathlib import Path
import json
import sidecar as s
from test_sidecar import fixture

def save(path,value):
    raw=json.dumps(value,ensure_ascii=False,indent=2)+'\n'
    if path.exists():
        if path.read_text()!=raw: raise ValueError('refusing differing existing artifact')
    else: path.write_text(raw)

rows=[]
for number,lang,empty in ((1,'EN',False),(2,'KO',True)):
    folder=s.ROOT/'developer-replay'/str(number); folder.mkdir(parents=True,exist_ok=True)
    data,receipt,args=fixture(folder,lang,empty)
    raw=s.R.canonical(data)
    output=s.emit(raw,receipt,*args)
    assert output['status']=='verified'
    result=s.build(raw,receipt,*args); s.verify(result,raw,receipt,*args)
    save(folder/'input.json',data)
    save(folder/'result.json',output)
    rows.append({'example':number,'language':lang,'issue_count':len(data['issues']),'receipt_sha256':s.digest(receipt),'sidecar_sha256':result.address,'status':output['status']})
save(s.ROOT/'evidence'/'developer-replay-summary.json',rows)
print(json.dumps(rows,indent=2))

"""Standalone reproduction of check 06 using an independently constructed fixture."""
import json, sys, tempfile, time
from pathlib import Path
sys.path.insert(0,'/historical-research/journal-v11/receipt')
import receipt as r
started=time.monotonic()
source=b'a'
proposal=r.canonical({'writer_id':'writer','preimage_sha256':r.digest(source),'patches':[{'id':'p1','start':0,'end':1,'before':'a','after':'A'}]})
binding={'source_sha256':r.digest(source),'proposal_sha256':r.digest(proposal),'complete':True,'read_complete':True}
dependency=r.canonical(dict(binding,auditor_id='dependency',patch_ids=['p1'],pairs=[]))
audit=r.canonical(dict(binding,auditor_id='patch',patch_decisions=[{'id':'p1','decision':'approved'}],preexisting_findings=[{'description':'review reference','evidence_ids':[]} for _ in range(30000)]))
selection=r.engine.propose_selection(source,proposal,dependency,audit)
final=r.canonical(dict(binding,auditor_id='final',candidate_sha256=selection.candidate_sha256,selected_ids=['p1'],whole_candidate_reviewed=True,decision='approved',findings=[]))
output,note=r.v10.build_delivery(source,proposal,dependency,audit,(final,))
args=(output,selection.candidate,note,source,proposal,dependency,audit,(final,))
rec=r.build(*args)
rendered=r.emit(rec,*args)
with tempfile.TemporaryDirectory(dir='/historical-research/journal-v11/code-audit') as tmp:
    store=r.Store(Path(tmp)/'objects')
    try:
        address=store.put(rec,*args)
        try: store.get(address,*args); fetched='success'
        except Exception as exc: fetched=type(exc).__name__+': '+str(exc)
    finally: store.close()
result={'test':'independent reproduction of check 06; same failure class, separately constructed one-patch fixture','patch_audit_bytes':len(audit),'receipt_bytes':len(rec.raw),'output':output.decode(),'receipt_status':json.loads(rec.raw)['status'],'emit':rendered,'put_returned_address':address,'get':fetched,'elapsed_seconds':round(time.monotonic()-started,3)}
Path('/historical-research/journal-v11/code-audit/size-reproduction.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
assert rendered['status']=='verification_failed' and fetched=='ValueError: unsafe store object'

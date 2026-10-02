"""Four labeled developer examples and designated prior v10 replays only."""
from pathlib import Path
import json
import receipt as r
from test_receipt import fixture
HERE=Path(__file__).resolve().parent
PRIVATE=Path('/historical-research/journal-v10-private')

def save(path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=json.dumps(value,ensure_ascii=False,indent=2)+'\n'
    if path.exists():
        if path.read_text()!=raw: raise ValueError('refusing to overwrite different artifact '+str(path))
    else: path.write_text(raw)

def record(name,args,policy='selective',location='evidence'):
    rec=r.build(*args,policy=policy)
    store=r.Store(HERE/'objects')
    try:
        store.put(rec,*args,policy=policy)
        loaded=store.get(rec.address,*args,policy=policy)
        assert loaded==rec
    finally: store.close()
    pair=dict(case=name,classification='developer_example' if location=='developer_examples' else 'prior_v10_replay_not_confirmation',
        output=args[0].decode(),candidate=args[1].decode(),receipt=json.loads(rec.raw),
        receipt_sha256=rec.address,
        annotations={lang:r.emit(loaded,*args,policy=policy,lang=lang) for lang in ('EN','KO')},
        writer_explanation_attached=False,external_publication_performed=False)
    save(HERE/location/(name+'.json'),pair)
    return dict(case=name,status=pair['receipt']['status'],receipt_sha256=rec.address,
                output_sha256=r.digest(args[0]),candidate_sha256=r.digest(args[1]),policy=policy)

def real(packet_id):
    packet=json.loads((PRIVATE/'final-inputs'/(packet_id+'.json')).read_bytes())
    delivered=json.loads((PRIVATE/'delivered'/(packet_id+'.json')).read_bytes())
    found=[p for p in (PRIVATE/'integration').glob('*.proposal.json') if r.digest(p.read_bytes())==packet['proposal_sha256']]
    assert len(found)==1
    stem=found[0].name.removesuffix('.proposal.json')
    source=packet['source'].encode()
    proposal,dep,audit=[(PRIVATE/'integration'/(stem+'.'+suffix+'.json')).read_bytes() for suffix in ('proposal','dependency','patch-audit')]
    final=(PRIVATE/'final-results'/(packet_id+'.json')).read_bytes()
    args=(delivered['output'].encode(),packet['candidate'].encode(),delivered['machine_delivery'],source,proposal,dep,audit,(final,))
    # Original actual output and complete machine ledger are used unchanged.
    rows=[record(packet_id+'-actual',args)]
    output,note=r.v10.build_delivery(source,proposal,dep,audit,(final,),policy='source_only')
    rows.append(record(packet_id+'-source_only',(output,args[1],note,*args[3:]),policy='source_only'))
    # Hold comparison is explicit local scenario: no final decision available.
    output,note=r.v10.build_delivery(source,proposal,dep,audit,())
    rows.append(record(packet_id+'-hold',(output,args[1],note,source,proposal,dep,audit,())))
    return rows

if __name__=='__main__':
    rows=[]
    for i,(kind,lang) in enumerate((('applied','EN'),('partial','KO'),('rolledback','EN'),('no-op','KO')),1):
        args=fixture(kind,lang)
        name=f'dev-{i:02d}-{kind}-{lang}'
        rows.append(record(name,args,location='developer_examples'))
        save(HERE/'developer_examples'/(name+'-inputs.json'),dict(source=args[3].decode(),proposal_raw=args[4].decode(),dependency_raw=args[5].decode(),patch_audit_raw=args[6].decode(),final_audits=[x.decode() for x in args[7]]))
    for packet in ('25a01f3a9c8795125f5534e2','f12a64e6ead7b66dbfa6f9ac'): rows.extend(real(packet))
    save(HERE/'evidence'/'replay-summary.json',rows)
    print(json.dumps(rows,indent=2))

"""Replay private v19 saved outputs and audits. No retrieval or model calls."""
import argparse, hashlib, importlib.util, json, sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
IDS=['KO191','EN191','KO192','EN192','EXK183']
def read(p): return json.loads(p.read_text())
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def run(root):
    hashes=read(HERE/'raw-hashes.json')['private_files']
    for path,digest in hashes.items(): assert sha(root/path)==digest, 'Changed artifact: '+path
    sys.path.insert(0,str(HERE.parent/'v18/code'))
    engine=module('v19_registered_engine',HERE.parent/'v18/code/check_output_v3.py')
    strict=module('v19_strict_counterfactual',HERE/'code-audit/check_output_strict.py')
    schema=read(root/'schema.json');rows=[]
    for uid in IDS:
        folder=root/'audit'/f'{uid}-v2';u=read(folder/'input.json');o=read(root/'raw'/f'{uid}-v2.json');obs=read(folder/'observation.json');ref=read(folder/'reference.json');result=read(folder/'result.json')
        assert u['unit_id']==o['unit_id']==uid
        assert obs['raw_sha256']==sha(root/'raw'/f'{uid}-v2.json')
        assert result['judgment_sha256']==sha(folder/'judgment.json')
        expected={f['id'] for f in ref['findings'] if f['necessity']=='yes'}
        outcomes=result['reference_issue_results'];actual=[x.get('reference_issue_id',x.get('reference_id')) for x in outcomes]
        assert len(actual)==len(set(actual)) and set(actual)==expected, 'Reference rows mismatch: '+uid
        error=None;applied=None
        try: applied=engine.apply_checked(u,o,schema)
        except (ValueError,KeyError,TypeError) as exc:error=type(exc).__name__+': '+str(exc)
        assert applied==obs['mechanical_applied_article'] and bool(error)==bool(obs['mechanical_errors'])
        strict_error=None
        try: strict_applied=strict.apply_checked(u,o,schema);assert strict_applied==applied
        except (ValueError,KeyError,TypeError) as exc: strict_error=type(exc).__name__+': '+str(exc)
        counts={s:sum(x['status']==s for x in outcomes) for s in ['safe_success','failed','held','uncertain']}
        assert sum(counts.values())==len(expected)
        assert not(error and counts['safe_success']), 'Undelivered repair counted'
        phase='regression' if uid=='EXK183' else ('development' if uid in ['KO191','EN191'] else 'evaluation')
        freeze=read(root/phase/f'{uid}-writer-freeze.json')
        for key,item in freeze['files'].items():
            old=Path(item['path']);parts=old.parts;i=next(i for i,x in enumerate(parts) if x.endswith('-private'));path=root.joinpath(*parts[i+1:]);assert sha(path)==item['sha256'], 'Writer freeze changed: '+uid+'/'+key
        rows.append({'unit_id':uid,'phase':phase,'contract_valid':error is None,'strict_identity_replay_valid':strict_error is None,'contract_error':error,'strict_error':strict_error,'patches':len(o['patches']),'native_unchanged':o['full_edited_article']==u['article']['full_text'],'native_sha256':hashlib.sha256(o['full_edited_article'].encode()).hexdigest(),'reference_classification':ref['article_classification'],'frozen_necessary_findings':len(expected),'reference_outcomes':counts,'additional_outcomes':[{'issue_id':x.get('issue_id'),'status':x.get('status'),'necessity':x.get('necessity'),'classification':x.get('classification'),'necessity_adjudication':x.get('necessity_adjudication'),'reason':x.get('reason')} for x in result.get('additional_issue_results',[])],'audit_scoped_assessment':result['final_scoped_assessment'],'decision':o['preservation_decision'],'input_file_chars':sum(len((root/x).read_text()) for x in ['writer-v2.md','schema.json'])+len((folder/'input.json').read_text()),'output_file_chars':len((root/'raw'/f'{uid}-v2.json').read_text())})
    return {'scope':'v19 native article outputs; saved independent AI judgments, not human truth or general accuracy','writer_outputs':len(rows),'new_articles':4,'exposed_source_expansion_regressions':1,'rows':rows,'input_file_chars_total':sum(x['input_file_chars'] for x in rows),'output_file_chars_total':sum(x['output_file_chars'] for x in rows),'limits':'Exact deployment/seed/tokens/cost unavailable. Unicode file characters exclude hidden prompts; audits/retrieval not included. Strict replay is not a new model run. Frozen reference omissions and necessity disagreements remain separate.'}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--private-root',required=True,type=Path);p.add_argument('--output',type=Path);a=p.parse_args();s=json.dumps(run(a.private_root),ensure_ascii=False,indent=2)
    if a.output:a.output.write_text(s+'\n')
    print(s)

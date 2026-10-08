"""Replay frozen v18 evidence; requires authorized private artifacts, no model calls."""
import argparse, hashlib, importlib.util, json
from pathlib import Path
HERE = Path(__file__).resolve().parent
IDS = ['K181-v1','E183-v1','K181-v2','E183-v2','E181-v2','E182-v2','K182-v2','K183-v2','REG181-v2','REG182-v2']
DEN = {'K181':1,'E183':0,'E181':1,'E182':2,'K182':0,'K183':2,'REG181':1,'REG182':1}
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p): return json.loads(p.read_text())
def resolve_saved(name, root, local):
    path=Path(name)
    if not path.is_absolute(): return local/path
    parts=path.parts
    for i,part in enumerate(parts):
        if part.endswith('-private'): return root.joinpath(*parts[i+1:])
    i=parts.index('experiments')
    return HERE.parents[1].joinpath(*parts[i:])
def run(root):
    manifest=read(HERE/'raw-hashes.json')['private_files']
    for name,digest in manifest.items():
        assert sha(root/name)==digest, 'Changed/missing artifact: '+name
    for name in manifest:
        if name.endswith('freeze.json') or '/unit-freezes/' in '/'+name:
            data=read(root/name)
            for target,digest in data.get('files',{}).items():
                assert sha(resolve_saved(target,root,(root/name).parent))==digest, 'Freeze mismatch: '+target
            if 'input_path' in data:
                assert sha(resolve_saved(data['input_path'],root,(root/name).parent))==data['sha256']
    spec=importlib.util.spec_from_file_location('v18_checker',HERE/'code/check_output.py')
    checker=importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)
    schema=read(root/'schema.json'); rows=[]
    for ident in IDS:
        uid,version=ident.split('-'); folder=root/'audit'/ident
        unit=read(folder/'input.json'); output=read(root/'raw'/f'{ident}.json')
        assert unit['unit_id']==output['unit_id']==uid
        obs=read(folder/'observation.json'); result=read(folder/'result.json')
        reference=read(root/'reference'/f'{uid}.json')
        assert sum(f['necessity']=='yes' for f in reference['findings'])==DEN[uid], 'Changed reference denominator: '+uid
        assert obs['raw_sha256']==sha(root/'raw'/f'{ident}.json')
        for field in ('judgment_sha256','first_judgment_sha256'):
            if field in result: assert result[field]==sha(folder/'judgment.json')
        error=None; applied=None
        try: applied=checker.apply_checked(unit,output,schema)
        except (ValueError,KeyError,TypeError) as exc: error=type(exc).__name__+': '+str(exc)
        assert bool(error)==bool(obs['mechanical_errors']), 'Mechanical status changed: '+ident
        assert applied==obs['mechanical_applied_article']
        statuses=[]
        for issue in result['reference_issue_results']:
            status=next((issue[k] for k in ('delivered_repair','repair_status','repair_result','status') if k in issue),None)
            if status in ('safe_success','failed'): statuses.append(status)
        safe=statuses.count('safe_success')
        assert len(statuses)==DEN[uid], 'Reference denominator mismatch: '+ident
        assert not(error and safe), 'Failed contract credited as repair'
        phase='regression' if uid.startswith('REG') else ('evaluation' if uid in ('E181','E182','K182','K183') else ('development' if version=='v1' else 'development_rerun'))
        writer=root/f'writer-{version}.md'
        input_chars=sum(len(x.read_text()) for x in (writer,root/'schema.json',folder/'input.json'))
        rows.append(dict(output_id=ident,phase=phase,necessary_reference_issues=DEN[uid],safe_delivered_reference_repairs=safe,contract_valid=error is None,contract_error=error,patch_count=len(output['patches']),native_unchanged=output['full_edited_article']==unit['article']['full_text'],native_full_article_sha256=hashlib.sha256(output['full_edited_article'].encode()).hexdigest(),input_file_chars=input_chars,output_file_chars=len((root/'raw'/f'{ident}.json').read_text())))
    evaluation=[r for r in rows if r['phase']=='evaluation']
    return {'scope':'Frozen primary v18 only; adaptive v3/rollback followups excluded','writer_output_files':len(rows),'unique_article_inputs':8,'new_real_articles':6,'old_exposed_regression_inputs':2,'reference_files':8,'independent_audit_results':10,'evaluation':{'articles':4,'necessary_reference_issues':sum(r['necessary_reference_issues'] for r in evaluation),'safe_delivered_reference_repairs':sum(r['safe_delivered_reference_repairs'] for r in evaluation),'contract_valid_outputs':sum(r['contract_valid'] for r in evaluation),'reference_scoped_normal_outputs':1},'rows':rows,'input_file_chars_total':sum(r['input_file_chars'] for r in rows),'output_file_chars_total':sum(r['output_file_chars'] for r in rows),'measurement_limits':'Unicode character counts of assigned files only; hidden prompts and token/cost/latency unavailable. Exact deployment and seed not exposed. No humans; same inherited native runtime without requested overrides.','runtime_observations':read(root/'runtime-observations.json'),'elapsed_window_observation':read(root/'generation-window-observation.json')}
if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--private-root',type=Path,required=True); parser.add_argument('--output',type=Path)
    args=parser.parse_args(); summary=run(args.private_root)
    text=json.dumps(summary,ensure_ascii=False,indent=2)+'\n'
    if args.output: args.output.write_text(text)
    else: print(text)

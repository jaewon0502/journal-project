#!/usr/bin/env python3
"""Aggregate existing private v16 artifacts; publish only allowlisted metadata.
Usage: python aggregate.py --private-root PATH [--output-dir PATH]
No model calls or article text publication. Raises on changed frozen inputs.
"""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

FIELDS = ('correct_target_detection', 'required_repair_success', 'new_loss',
          'unsupported_or_unnecessary_patch', 'unwarranted_local_hold', 'source_claims_supported')
META = ('article_id', 'id', 'url', 'final_url', 'title', 'author', 'authors', 'publisher',
        'published_display', 'published_at', 'published', 'publication_date', 'modified_at',
        'modified', 'modification_date', 'modified_note', 'collected_at', 'scope', 'excluded',
        'lineage', 'limitation', 'body_sha256', 'full_text_sha256', 'raw_sha256', 'sha256',
        'body_characters', 'paragraphs_excluding_subheads', 'paragraph_count', 'word_count')

def read(p):
    return json.loads(p.read_text())

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def write(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--private-root', type=Path, required=True)
    ap.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parent)
    a = ap.parse_args(); p = a.private_root.resolve(); out = a.output_dir.resolve()
    e = p / 'evaluation'; out.mkdir(parents=True, exist_ok=True)
    refs = {u['unit_id']: u['source_preservation_reference'] for lang in ('ko','en')
            for u in read(p / f'reference-{lang}.json')['units']}
    assert Counter(refs.values()) == {'harmful':6, 'normal':4, 'uncertain':2}
    inputs = read(e/'mechanical-input-checks.json')
    units = {r['unit_id']:r for r in inputs['records']}
    mapping = read(e/'audit-mapping-private.json')
    mech = {(r['unit_id'],r['method']): r for r in read(e/'mechanical-output-checks.json')}
    audits = {}; postrefs = {}
    for file in sorted((e/'audit').glob('G*.result.json')):
        for u in read(file)['units']:
            assert u['unit_id'] not in postrefs
            postrefs[u['unit_id']] = u['independent_reference']
            for o in u['outputs']:
                m = mapping[o['result_id']]; key = (m['unit_id'],m['method'])
                assert key not in audits and m['unit_id'] == u['unit_id']
                audits[key] = {f:o[f] for f in FIELDS}
    expected = {(u,m) for u in refs for m in ('M0','M1')}
    assert set(mech) == set(audits) == expected
    verification = []
    for relative in ('evaluation/freeze.json','evaluation/method-freeze.json','evaluation/audit/freeze.json'):
        file = p/relative
        for name, digest in read(file)['files'].items():
            original = Path(name)
            if original.is_absolute():
                # Portable resolution of historic absolute paths, without publishing them.
                if 'journal-v16-private' in original.parts:
                    target = p.joinpath(*original.parts[original.parts.index('journal-v16-private')+1:])
                else:
                    target = out.joinpath(*original.parts[original.parts.index('v16')+1:])
            else:
                target = file.parent/original
            assert sha(target) == digest, f'Frozen artifact mismatch: {target.name}'
            verification.append({'freeze':relative,'artifact':target.name,'sha256':digest,'verified':True})
    for lang in ('ko','en'):
        file=p/f'reference-{lang}.json'
        assert sha(file) == read(p/f'reference-{lang}.json.lock.json')['sha256']
    rawmanifest=[]; rows=[]
    for key in sorted(expected):
        u,m=key; r=mech[key]; f=e/'raw'/f'{u}-{m}.json'; raw=read(f)
        assert sha(f)==r['raw_sha256']
        assert raw['preservation_decision']==r['decision']
        rawmanifest.append({'unit_id':u,'method':m,'artifact':f'evaluation/raw/{f.name}',
                            'sha256':sha(f),'public_body_available':False})
        rows.append({'unit_id':u,'method':m,'article_id':units[u]['article_id'],
                     'language':units[u]['language'],'frozen_reference':refs[u],
                     'post_audit_reference':postrefs[u], 'decision':r['decision'],
                     'proposed_patch_count':r['proposed_patch_count'],
                     'applied_patch_count':r['applied_patch_count'],
                     'mechanical_error_count':len(r['errors']),
                     'overall_readiness':raw['overall_readiness'],
                     'local_hold_codes':[h['code'] for h in raw['local_hold_reasons']],
                     'delivered_sha256':r['delivered_sha256'], **audits[key]})
    metrics={}
    for m in ('M0','M1'):
        rr=[r for r in rows if r['method']==m]
        metrics[m]={'actions':dict(Counter(r['decision'] for r in rr)),
                    'by_frozen_reference':{},'applied_patch_count':sum(r['applied_patch_count'] for r in rr),
                    'mechanical_error_count':sum(r['mechanical_error_count'] for r in rr),
                    'overall_readiness':dict(Counter(r['overall_readiness'] for r in rr))}
        for cls in ('harmful','normal','uncertain'):
            ss=[r for r in rr if r['frozen_reference']==cls]
            metrics[m]['by_frozen_reference'][cls]={'denominator':len(ss),'actions':dict(Counter(r['decision'] for r in ss)),
                **{f:dict(Counter(r[f] for r in ss)) for f in FIELDS}}
        applied=[r for r in rr if r['applied_patch_count']]
        metrics[m]['applied_output_safety']={'denominator':len(applied), **{f:dict(Counter(r[f] for r in applied)) for f in ('new_loss','unsupported_or_unnecessary_patch')}}
    summary={'schema_version':1,'evidence_status':'AI-only; no human gold; condition-blind post-output audit',
        'unique_articles':len({r['article_id'] for r in rows}),'comparison_variants':len(refs),'actual_outputs':len(rows),
        'fixed_pre_output_denominators':dict(Counter(refs.values())), 'methods':metrics,
        'paired_equal_action_count':sum(mech[u,'M0']['decision']==mech[u,'M1']['decision'] for u in refs),
        'paired_equal_delivered_hash_count':sum(mech[u,'M0']['delivered_sha256']==mech[u,'M1']['delivered_sha256'] for u in refs),
        'reference_disagreements':[{'unit_id':u,'frozen':refs[u],'post_audit':postrefs[u],'denominator_changed':False} for u in refs if refs[u]!=postrefs[u]],
        'uncertain_actions':[r for r in rows if r['frozen_reference']=='uncertain'],
        'rows':rows,'hash_verification':{'checked_freeze_entries':len(verification),'all_match':True,'raw_outputs_checked':len(rawmanifest),'reference_locks_checked':2},
        'costs':{'model_tokens':None,'model_latency_seconds':None,'monetary_cost':None,'deployment_snapshot':None,'model_seed':None,
                 'M0_input_characters':sum(r['base_input_characters'] for r in units.values()),
                 'M1_input_characters':sum(r['aligned_input_characters'] for r in units.values()),
                 'alignment_build_wall_seconds':inputs['alignment_build_wall_seconds'],'timing_scope':inputs['timing_scope']},
        'limitations':['Correlated variants of four articles; no causal or population generality claim.',
                      'Some audit outputs were accidentally partially exposed before complete input reading; post-audit is condition-blind, not an output-blind pre-reference.',
                      'Prior independent AI references were separately frozen before outputs; original article is not factual truth gold.',
                      'No composite success score; detection, repair, safety, holds and uncertainty remain separate.']}
    sources={'articles':[],'sources':[],'metadata_only':True}
    ko=read(p/'hidden-ko/source-manifest-private.json')
    for category in ('articles','sources'):
        sources[category].extend({k:r[k] for k in META if k in r} for r in ko[category])
    for i in (1,2):
        d=read(p/f'hidden-en/E{i}.article.json')
        sources['articles'].append({'article_id':f'A20{i}',**{k:d[k] for k in META if k in d}})
        sources['sources'].extend({k:r[k] for k in META if k in r} for r in read(p/f'hidden-en/E{i}.source-packet.json'))
    write(e/'aggregate.json',summary)
    write(out/'results-summary.json',summary)
    write(out/'raw-output-hashes.json',{'algorithm':'sha256','records':rawmanifest,'frozen_artifact_checks':verification})
    write(out/'sources-metadata.json',sources)
    print(json.dumps({'outputs':len(rows),'freeze_entries_verified':len(verification),'methods':metrics},ensure_ascii=False))

if __name__=='__main__':
    main()

#!/usr/bin/env python3
"""Mechanical join of blind model judgments; no new semantic judgments."""
import argparse
import json
from collections import Counter
from pathlib import Path
from realize_T import sha,encode,write_new

METHODS=('free','typed','exact_extractive')
MUTATIONS={'mutation','single_relation_reversal'}


def yesno(value):
    return True if value=='yes' else False if value=='no' else None


def conjunction(values):
    return False if False in values else None if None in values else True


def outcome(kind,original,revised,judgment,status):
    judgment=judgment or {}
    errors=judgment.get('new_factual_errors')
    error_count=len(errors) if isinstance(errors,list) else None
    supported=yesno(judgment.get('revised_source_supported'))
    unchanged=original==revised if revised is not None else None
    hold=status in {'unsupported','extractive_ineligible','shared_hold','model_hold','rollback','pending_model_response','pending'}
    preserve=conjunction([unchanged,supported]) if kind in ('normal','equivalent') else None
    repaired=conjunction([yesno(judgment.get('original_error_repaired')),supported,
        yesno(judgment.get('necessary_question_meaning_preserved')),
        None if error_count is None else error_count==0]) if kind in MUTATIONS else None
    contradiction=bool(kind in MUTATIONS and repaired is True and (hold or unchanged is True))
    if kind in MUTATIONS and repaired is not None and (hold or unchanged is True):
        repaired=False
    return {'byte_preserved':unchanged,'source_supported':supported,
        'preserved_and_source_supported':preserve,'repair_success':repaired,
        'new_factual_error_count':error_count,'unnecessary_edit':yesno(judgment.get('unjustified_edit')),
        'pipeline_hold':hold,'nominal_kind_vs_judgment_disagreement':contradiction,
        'judge_original_source_supported':judgment.get('original_source_supported','unknown'),
        'semantic_outcome_state': 'pending' if not judgment else 'unknown' if (kind in MUTATIONS and repaired is None) or (kind in ('normal','equivalent') and preserve is None) else 'known'}


def score(phase,root,private,output):
    provenance={}
    def load(path):
        raw=path.read_bytes();provenance[str(path)]=sha(raw);return json.loads(raw)
    keys=load(private/'T-inputs-v2/private-key.json')
    prepared=load(private/'T-realization-inputs'/phase/'prepared.json')
    items={x['case']['case_id']:x for x in prepared['items']}
    if len(items)!=len(prepared['items']):raise ValueError('Duplicate assigned case')
    blind_dir=private/'T-blind-inputs'/phase
    mapping=load(blind_dir/'private-mapping.json')['mapping'] if (blind_dir/'private-mapping.json').exists() else {}
    blind=load(blind_dir/'input.json')['cases'] if (blind_dir/'input.json').exists() else []
    blind_index={x['opaque_output_id']:x for x in blind}
    raw_path=root/'judgments/T'/(phase+'-outcomes.raw.json')
    raw=load(raw_path) if raw_path.exists() else {'items':[]}
    judgments={};duplicates=[]
    for j in raw['items']:
        opaque=j['opaque_output_id']
        if opaque in judgments:duplicates.append(opaque);judgments[opaque]=None
        else:judgments[opaque]=j
    joined={};diagnostics=[]
    for opaque,entries in mapping.items():
        if opaque not in blind_index:raise ValueError('Mapping has no blind input')
        for entry in entries:
            key=(entry['case_id'],entry['method'])
            if key in joined:raise ValueError('Duplicate case/method mapping')
            joined[key]=(opaque,entry)
    records={}
    for folder in (phase+'-realized',phase+'-free-realized'):
        path=root/'runs/T'/folder/'report.json'
        if path.exists():
            for record in load(path)['records']:records[(record['case_id'],record['method'])]=record
    events={}
    for cid,item in items.items():
        keyinfo=keys[cid];event=keyinfo['event_id'];kind=keyinfo['kind']
        if kind not in MUTATIONS|{'normal','equivalent'}:raise ValueError('Unknown intended fixture kind')
        event_row=events.setdefault(event,{'event_id':event,'methods':{m:[] for m in METHODS}})
        original=item['case']['draft'].encode()
        for method in METHODS:
            record=records.get((cid,method));pair=joined.get((cid,method));judgment=None;revised=None;opaque=None
            status=record['status'] if record else 'pending'
            if record:
                revised=Path(record['output_path']).read_bytes()
                if sha(revised)!=record['returned_sha256']:raise ValueError('Returned output hash mismatch')
            if pair:
                opaque,entry=pair;blind_case=blind_index[opaque]
                if blind_case['original'].encode()!=original or revised is None or blind_case['revised'].encode()!=revised or sha(revised)!=entry['output_sha256']:
                    raise ValueError('Blind/raw realization mismatch')
                judgment=judgments.get(opaque)
            row={'case_id':cid,'intended_kind':kind,'opaque_output_id':opaque,
                'pipeline_status':status,'guard_status':record.get('guard_status','unknown') if record else 'pending',
                'original_sha256':sha(original),'revised_sha256':sha(revised) if revised is not None else None,
                'source_preflight_validity':{k:item['audit'].get(k,'unknown') for k in ('shared_action','factual_error_confirmed','span_approved','typed_eligible','standalone_context_safe')},
                'blind_model_judgment':judgment,
                **outcome(kind,original,revised,judgment,status)}
            event_row['methods'][method].append(row)
    for event in events.values():
        event['method_counts']={}
        for method,rows in event['methods'].items():
            counts={'assigned_outputs':len(rows),'normal_equivalent_denominator':sum(r['intended_kind'] in ('normal','equivalent') for r in rows),
                'mutation_denominator':sum(r['intended_kind'] in MUTATIONS for r in rows)}
            for metric in ('preserved_and_source_supported','repair_success','unnecessary_edit'):
                applicable=[r for r in rows if metric!='repair_success' or r['intended_kind'] in MUTATIONS]
                if metric=='preserved_and_source_supported':applicable=[r for r in rows if r['intended_kind'] in ('normal','equivalent')]
                counts[metric]={str(value).lower():sum(r[metric] is value for r in applicable) for value in (True,False,None)}
            counts['pipeline_hold']=sum(r['pipeline_hold'] for r in rows)
            counts['guard_failed']=sum(r['guard_status']=='failed' for r in rows)
            counts['new_errors_known']=sum(r['new_factual_error_count'] or 0 for r in rows)
            counts['new_errors_unknown_outputs']=sum(r['new_factual_error_count'] is None for r in rows)
            event['method_counts'][method]=counts
    result={'phase':phase,'event_denominator':len(events),'assigned_case_denominator':len(items),
        'method_count':3,'assigned_method_outputs':len(items)*3,
        'unique_blind_inputs':len(blind_index),'unique_judged_outputs':sum(j is not None for j in judgments.values()),
        'outcome_model_raw_files':int(raw_path.exists()),'model_invocations':None,
        'note':'One judgment may map to multiple methods; unique outputs are not independent model calls or independent event samples.',
        'duplicate_judgment_ids':duplicates,'unexpected_judgment_ids':sorted(set(judgments)-set(blind_index)),
        'missing_judgment_ids':sorted(set(blind_index)-set(judgments)),
        'events':list(events.values()),'provenance':provenance,'statistical_superiority':None,'cost':None,
        'source_preflight_overrides_model_judgment':False}
    write_new(output,encode(result));return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--phase',required=True)
    p.add_argument('--root',type=Path,required=True)
    p.add_argument('--private',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();r=score(a.phase,a.root,a.private,a.output)
    print(json.dumps({k:r[k] for k in ('phase','event_denominator','assigned_case_denominator','assigned_method_outputs','unique_blind_inputs','unique_judged_outputs')}))

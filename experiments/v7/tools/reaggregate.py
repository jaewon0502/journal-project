#!/usr/bin/env python3
"""Reaggregate frozen public judgments. No source audit or model execution."""
import json
from pathlib import Path
from score_T import outcome, METHODS, MUTATIONS
ROOT = Path(__file__).resolve().parents[1]


def aggregate_t(data):
    totals = {m: {'repair_success': 0, 'mutation_denominator': 0,
                  'preserved': 0, 'control_denominator': 0, 'holds': 0,
                  'new_errors': 0, 'unnecessary_edits': 0} for m in METHODS}
    for event in data['events']:
        for method, rows in event['methods'].items():
            t = totals[method]
            for row in rows:
                # Hash equality stands in for original/revised byte equality only.
                # This does not verify the withheld original bytes or source support.
                derived = outcome(row['intended_kind'], row['original_sha256'],
                                  row['revised_sha256'], row['blind_model_judgment'], row['pipeline_status'])
                for key, value in derived.items():
                    if value != row[key]:
                        raise ValueError(f"Frozen outcome mismatch: {event['event_id']} {method} {key}")
                mutation = row['intended_kind'] in MUTATIONS
                t['mutation_denominator'] += mutation
                t['control_denominator'] += not mutation
                t['repair_success'] += derived['repair_success'] is True
                t['preserved'] += derived['preserved_and_source_supported'] is True
                t['holds'] += derived['pipeline_hold']
                t['new_errors'] += derived['new_factual_error_count'] or 0
                t['unnecessary_edits'] += derived['unnecessary_edit'] is True
            counts=event['method_counts'][method]
            if counts['assigned_outputs'] != len(rows):raise ValueError('Assigned count mismatch')
            for metric in ['repair_success','preserved_and_source_supported','unnecessary_edit']:
                applicable=[r for r in rows if metric=='unnecessary_edit' or
                            (r['intended_kind'] in MUTATIONS)==(metric=='repair_success')]
                for value in (True,False,None):
                    if counts[metric][str(value).lower()]!=sum(r[metric] is value for r in applicable):
                        raise ValueError('Frozen event count mismatch')
    return totals


def main():
    result={}
    for phase in ['dev-v1','dev-v2','eval']:
        result['T-'+phase]=aggregate_t(json.loads((ROOT/'results'/f'T-{phase}-summary.json').read_text()))
    j=json.loads((ROOT/'results/J-eval-summary.json').read_text())
    raw=json.loads((ROOT/'evidence/J-judgments.json').read_text())
    indexed={r['item_id']:r for r in raw['items'] if r['phase']=='eval'}
    triplets=0
    for event in j['events']:
        matches=[]
        for branch in event['branches']:
            decision=indexed[branch['item_id']]['decision']
            if decision != branch['decision']:raise ValueError('J decision mismatch')
            matched=decision==branch['expected']
            if matched!=branch['matches_expected']:raise ValueError('J branch mismatch')
            matches.append(matched)
        if all(matches)!=event['triplet_matches']:raise ValueError('J triplet mismatch')
        triplets+=all(matches)
    if triplets != j['summary']['triplet_matches']:raise ValueError('J summary mismatch')
    result['J-eval']={'events':len(j['events']),'triplets':triplets,'judgments':len(indexed)}
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()

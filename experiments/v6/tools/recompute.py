"""Offline arithmetic over public derived records; no model or network calls."""
import json
from collections import Counter
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def load(name):
    return json.loads((ROOT / 'data' / name).read_text())['records']

def compute():
    runs = load('performance-outputs.json')
    events = [e for r in runs for e in r['events']]
    result = {'performance_calls': len(runs), 'event_condition_records': len(events),
              'answers': sum(len(e['answers']) for e in events),
              'decisions': sum(len(e['candidates']) for e in events),
              'missing_candidate_slots': sum(3-len(e['candidates']) for r in runs
                 if r['arm'] in ('C0', 'D0', 'D1') for e in r['events']), 'qa': {}, 'eval_controls': {}}
    for phase in ('dev', 'eval'):
        for arm in ('A0', 'A1'):
            rows = [r for r in load('qa-scores.json') if r['phase']==phase and r['arm']==arm]
            obligations, claims = Counter(), Counter()
            for r in rows:
                obligations.update(r['obligation_counts']); claims.update(r['claim_counts'])
            result['qa'][phase+'_'+arm] = {'event_count': len(rows),
                'obligation_denominator': sum(r['obligation_denominator'] for r in rows),
                'obligation_counts': dict(obligations), 'claim_counts': dict(claims),
                'claim_denominator': sum(r['claim_denominator'] for r in rows),
                'severe_unresolved_events': sum(r['severe_omission_count'] is None for r in rows),
                'severe_omissions': sum(r['severe_omission_count'] or 0 for r in rows),
                'severe_additions': sum(r['severe_addition_count'] or 0 for r in rows)}
    for arm in ('C0', 'D0', 'D1'):
        rows = [r for r in load('eval-controls.json') if r['arm']==arm]
        controls = [c for r in rows for c in r['controls']]
        result['eval_controls'][arm] = {'decisions': dict(Counter(c['decision'] for c in controls)),
            'missing':sum(r['unavailable_planned_candidates'] for r in rows),
            'ineligible':sum(not c['eligible'] for c in controls),
            'eligible_mutations':sum(c['eligible'] and c['kind']=='mutation' for c in controls)}
    return result

if __name__ == '__main__':
    print(json.dumps(compute(), ensure_ascii=False, indent=2))

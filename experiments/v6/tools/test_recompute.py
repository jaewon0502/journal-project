import unittest
import hashlib
from collections import Counter
from recompute import compute, load

class PublicEvidenceTests(unittest.TestCase):
    def test_actual_call_and_output_counts(self):
        r = compute()
        for k,v in {'performance_calls':14,'event_condition_records':112,'answers':192,'decisions':165,'missing_candidate_slots':27}.items():
            self.assertEqual(r[k],v)
        self.assertNotIn('C1', {x['arm'] for x in load('performance-outputs.json')})
        for run in load('performance-outputs.json'):
            for event in run['events']:
                for answer in event['answers']:
                    self.assertEqual(hashlib.sha256(answer['original_model_text'].encode()).hexdigest(), answer['answer_text_sha256'])

    def test_eval_obligations_keep_missing(self):
        for arm,preserved in [('A0',66),('A1',65)]:
            rows = [r for r in load('qa-scores.json') if r['phase']=='eval' and r['arm']==arm]
            self.assertEqual(Counter(r['obligation_denominator'] for r in rows), {6:7,4:9})
            r=compute()['qa']['eval_'+arm]
            self.assertEqual(r['obligation_denominator'],78)
            self.assertEqual(r['obligation_counts']['unverifiable'],12)
            self.assertEqual(r['obligation_counts']['preserved'],preserved)
            self.assertEqual(r['severe_unresolved_events'],3)

    def test_annotations_match_scores(self):
        scores={r['output_id']:r for r in load('qa-scores.json')}
        for r in load('ai-judgments.json'):
            s=scores[r['output_id']]
            self.assertEqual(Counter(o['status'] for o in r['obligations']),s['obligation_counts'])
            self.assertEqual(Counter(c['status'] for c in r['claims']),s['claim_counts'])

    def test_ineligible_controls_retained(self):
        r=compute()['eval_controls']
        for arm in r:
            self.assertEqual(r[arm]['missing'],9)
            self.assertEqual(r[arm]['ineligible'],1)
            self.assertEqual(r[arm]['eligible_mutations'],12)
        self.assertEqual(r['C0']['decisions'],{'accept':0,'reject':13,'abstain':26} if 'accept' in r['C0']['decisions'] else {'reject':13,'abstain':26})
        self.assertEqual(r['D0']['decisions'],{'accept':2,'reject':13,'abstain':24})
        self.assertEqual(r['D0'],r['D1'])
        d=next(r for r in load('dev-controls.json') if r['event_id']=='DEV03')
        self.assertEqual(d['D0']['invalid_or_unknown'],3)
        self.assertEqual(d['D1']['invalid_or_unknown'],3)

    def test_split_and_source_snapshot(self):
        self.assertEqual(Counter(r['split'] for r in load('events.json')), {'dev':8,'eval':16})
        for r in load('source-manifest.json'):
            self.assertIn('event_date',r)
            if r.get('sha256'): self.assertEqual(len(r['sha256']),64)

if __name__ == '__main__': unittest.main()

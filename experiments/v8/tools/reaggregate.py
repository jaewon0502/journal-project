"""Recount published numeric judgments offline, separately by language and phase."""
from collections import Counter, defaultdict
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIELDS = ('source_claims', 'source_severity', 'source_paragraphs', 'output_paragraphs',
          'output_claims', 'external_verification', 'issues')


def aggregate(rows):
    groups, seen = {}, set()
    for row in rows:
        identity = (row['split'], row['article_id'], row['arm'], row['config_id'])
        if identity in seen:
            raise ValueError('Duplicate case/arm/config observation')
        seen.add(identity)
        if row['language'] not in {'KO', 'EN'} or row['split'] not in {'DEV', 'EVAL'}:
            raise ValueError('Invalid language or split')
        if row['arm'] not in {'ORIGINAL', 'FULLREWRITE', 'LOCAL'}:
            raise ValueError('Invalid arm')
        key = tuple(row[k] for k in ('split', 'language', 'phase', 'arm', 'config_id'))
        group = groups.setdefault(key, {'observations': 0, 'counts': defaultdict(Counter),
                                       'reference_errata_count': 0, 'unscored_errata_claim_count': 0})
        group['observations'] += 1
        counts = row['counts']
        for field in FIELDS:
            for status, value in counts[field].items():
                if type(value) is not int or value < 0:
                    raise ValueError('Counts must be nonnegative integers')
                group['counts'][field][status] += value
        for field in ('reference_errata_count', 'unscored_errata_claim_count'):
            value = counts[field]
            if type(value) is not int or value < 0:
                raise ValueError('Errata counts must be nonnegative integers')
            group[field] += value
    return [{**dict(zip(('split', 'language', 'phase', 'arm', 'config_id'), key)),
             **{k: v for k, v in group.items() if k != 'counts'},
             'counts': {field: dict(sorted(values.items())) for field, values in group['counts'].items()}}
            for key, group in sorted(groups.items())]


def calculate():
    rows = []
    for split in ('dev', 'eval'):
        rows.extend(json.loads((ROOT / 'data' / (split + '-per-case.json')).read_text()))
    return aggregate(rows)


if __name__ == '__main__':
    expected = json.loads((ROOT / 'data' / 'aggregates.json').read_text())
    if calculate() != expected:
        raise SystemExit('Published aggregate mismatch')
    print('Verified DEV/EVAL aggregates with languages, phases and configurations separated.')

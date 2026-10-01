"""Verify public counts, status disagreements, and authored fixture hashes offline."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def main():
    summary = json.loads((ROOT / 'results/summary.json').read_text())
    assert len(summary['speech']) == 14
    assert len(summary['gate']) == 10
    assert summary['accounting']['native_generated_speech_responses'] == 14
    assert summary['accounting']['gate_arm_observations'] == 10
    rows = summary['speech'] + summary['gate']
    unique = {}
    for row in rows:
        key = (row['case_id'], row['output_sha256'])
        if key in unique:
            assert unique[key] == row['ratings']
        unique[key] = row['ratings']
    assert len(unique) == 18
    assert sum(len(ratings) for ratings in unique.values()) == 36
    disagreements = 0
    for ratings in unique.values():
        a, b = ratings
        assert {a['reader'], b['reader']} == {'A', 'B'}
        assert a['task_resolution'] == b['task_resolution']
        assert len(a['statuses']) == len(b['statuses']) == 7
        disagreements += sum(a['statuses'][metric] != b['statuses'][metric] for metric in a['statuses'])
    assert disagreements == len(summary['paired_disagreements']) == 9
    fixtures = sorted((ROOT / 'fixtures').glob('*.json'))
    assert len(fixtures) == 8
    for path in fixtures:
        case = json.loads(path.read_text())
        assert digest(case['source']) == case['source_sha256']
        for result in case['conditions']:
            assert digest(result['output']) == result['output_sha256']
            matches = [r for r in rows if r['case_id'] == case['case_id'] and r['arm'] == result['condition']]
            assert len(matches) == 1 and matches[0]['output_sha256'] == result['output_sha256']
    accounting = summary['accounting']
    assert (accounting['source_cases'], accounting['exposed_regressions'], accounting['real_new_cases'], accounting['authored_synthetic_cases']) == (12, 2, 2, 8)
    assert accounting['mechanical_tests'] == 17 and accounting['cross_family_runs'] == 0
    print('Verified: 24 condition rows, 18 unique outputs, 36 readings, 9/126 disagreements, 8 synthetic fixtures; no new model run.')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Demonstrate the original defect with an isolated synthetic fixture."""
import json
from test_aggregation import AggregationRegression
import score_T_checked as checked

fixture = AggregationRegression()
fixture.setUp()
try:
    fixture.judgments.append({'opaque_output_id': 'unknown-extra'})
    fixture.write(fixture.root / 'judgments/T/eval-outcomes.raw.json', {'items': fixture.judgments})
    old = checked.legacy.score('eval', fixture.root, fixture.private, fixture.output)
    try:
        checked.score('eval', fixture.root, fixture.private, fixture.output.with_name('checked.json'))
        raise AssertionError('Invalid identities were accepted')
    except checked.JudgmentIdentityError as error:
        new_diagnostics = error.diagnostics
    result = {
        'fixture': 'Synthetic one case, three methods sharing one blind output; one unknown extra raw judgment',
        'expected_unique_judged_outputs': 1,
        'legacy_unique_judged_outputs': old['unique_judged_outputs'],
        'legacy_unique_blind_inputs': old['unique_blind_inputs'],
        'legacy_assigned_method_outputs': old['assigned_method_outputs'],
        'legacy_unexpected_judgment_ids': old['unexpected_judgment_ids'],
        'checked_result_written': fixture.output.with_name('checked.json').exists(),
        'checked_rejection': new_diagnostics,
    }
    assert old['unique_judged_outputs'] == 2
    assert not result['checked_result_written']
    print(json.dumps(result, indent=2))
finally:
    fixture.doCleanups()

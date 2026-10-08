"""Public synthetic matrix for the existing v18 v3 checker."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'v18/code'))
import test_atomic_dependencies as fixture_module


def run():
    rows = []
    for label in ['input_quote', 'modified_quote', 'duplicate_source', 'blank_unit_id', 'blank_source_id', 'numeric_source_id', 'duplicate_protection_id', 'wrong_output_type', 'wrong_unit_id', 'partial_delivery', 'missing_partner']:
        unit, output = fixture_module.fixture()
        if label == 'input_quote': output['findings'][0].update(original_quote='alpha', candidate_quote='alpha')
        if label == 'modified_quote': output['findings'][0]['candidate_quote'] = 'ALPHA LONG'
        if label == 'duplicate_source': unit['sources'] *= 2
        if label == 'blank_unit_id': unit['unit_id'] = output['unit_id'] = ' '
        if label == 'blank_source_id':
            unit['sources'][0]['id'] = ' '; output['findings'][0]['source_refs'] = [' ']
        if label == 'numeric_source_id':
            unit['sources'][0]['id'] = 1; output['findings'][0]['source_refs'] = []
        if label == 'duplicate_protection_id':
            item = dict(id='R', original_quotes=['Tail unchanged.'], relation='context', why_preserve='synthetic', confidence='supported', conflict='none')
            output['protection_items'] = [item, item]
        if label == 'wrong_output_type': output['unit_id'] = 1
        if label == 'wrong_unit_id': output['unit_id'] = 'other'
        if label == 'partial_delivery': output['full_edited_article'] = unit['article']['full_text'].replace('alpha', 'ALPHA LONG')
        if label == 'missing_partner': output['patches'].pop()
        try:
            fixture_module.apply_checked(unit, output, fixture_module.SCHEMA)
            rows.append(dict(case=label, accepted=True))
        except Exception as error:
            rows.append(dict(case=label, accepted=False, error=type(error).__name__ + ': ' + str(error)))
    return rows


if __name__ == '__main__':
    print(json.dumps(run(), indent=2))

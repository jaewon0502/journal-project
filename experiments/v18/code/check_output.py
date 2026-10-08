"""Reuse v17 patch gates and verify the actual native whole-article delivery."""
import importlib.util
from pathlib import Path

path = Path(__file__).resolve().parents[2] / 'v17' / 'code' / 'check_output.py'
spec = importlib.util.spec_from_file_location('v17_checked_patches', path)
v17 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v17)

def apply_checked(unit, output, schema):
    original = unit['article']['full_text']
    adapted = {'unit_id': unit['unit_id'], 'original_text': original,
               'candidate_text': original, 'sources': unit['sources']}
    expected = v17.apply_checked(adapted, output, schema)
    for item in output['protection_items']:
        if not item['original_quotes'] or any(not q or q not in original for q in item['original_quotes']):
            raise ValueError('inexact or absent protection anchor')
    if output['full_edited_article'] != expected:
        raise ValueError('native whole article differs from declared exact patches')
    return expected

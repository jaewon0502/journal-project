"""Separate identity boundary for new v18-style atomic article checks.

Frozen v18 paths stay unchanged. This checks structure and identifiers, not
source applicability, factual truth, or preservation-inventory completeness.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location('v18_atomic_for_strict_input', ROOT / 'experiments/v18/code/check_output_v3.py')
v18 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v18)


def identifier(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('invalid ' + label + ': nonblank string required')


def validate_input(unit):
    if not isinstance(unit, dict):
        raise ValueError('invalid unit: object required')
    identifier(unit.get('unit_id'), 'unit id')
    article = unit.get('article')
    if not isinstance(article, dict) or not isinstance(article.get('full_text'), str):
        raise ValueError('invalid article text: string required')
    sources = unit.get('sources')
    if not isinstance(sources, list):
        raise ValueError('invalid sources: array required')
    seen = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError('invalid source: object required')
        key = source.get('id')
        identifier(key, 'source id')
        if key in seen:
            raise ValueError('duplicate source id')
        seen.add(key)
        if not isinstance(source.get('text'), str):
            raise ValueError('invalid source text: string required')


def apply_checked(unit, output, schema):
    validate_input(unit)
    v18._frozen.v17.schema_check(output, schema)
    identifier(output['unit_id'], 'output unit id')
    seen = set()
    for item in output['protection_items']:
        key = item['id']
        identifier(key, 'protection id')
        if key in seen:
            raise ValueError('duplicate protection id')
        seen.add(key)
    return v18.apply_checked(unit, output, schema)

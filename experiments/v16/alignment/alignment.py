"""Deterministic change-location aid. It does not classify meaning or truth."""
from difflib import SequenceMatcher
from hashlib import sha256
import json


def digest(text):
    return sha256(text.encode('utf-8')).hexdigest()


def _rows(original, candidate, context):
    rows, segments = [], []
    for kind, a, b, c, d in SequenceMatcher(None, original, candidate, autojunk=False).get_opcodes():
        segments.append({'operation': kind, 'original_start': a, 'original_end': b,
                         'candidate_start': c, 'candidate_end': d,
                         'equal_text_omitted_but_available_in_full_documents': kind == 'equal'})
        if kind == 'equal':
            continue
        rows.append({'operation': kind, 'original_start': a, 'original_end': b,
                     'candidate_start': c, 'candidate_end': d,
                     'original_span': original[a:b], 'candidate_span': candidate[c:d],
                     'original_context': original[max(0, a-context):min(len(original), b+context)],
                     'candidate_context': candidate[max(0, c-context):min(len(candidate), d+context)]})
    return rows, segments


def _validate_context(context):
    if type(context) is not int or not 0 <= context <= 1000:
        raise ValueError('context must be an integer in 0..1000')


def build_alignment(original, candidate, context=80):
    if not isinstance(original, str) or not isinstance(candidate, str):
        raise ValueError('both documents must be strings')
    _validate_context(context)
    rows, segments = _rows(original, candidate, context)
    result = {'schema': 'v16-character-alignment-2', 'algorithm': 'SequenceMatcher(autojunk=False)',
              'offset_unit': 'Python Unicode code points, half-open intervals', 'context_characters': context,
              'original_sha256': digest(original), 'candidate_sha256': digest(candidate),
              'rows': rows, 'all_segments': segments,
              'warning': 'Locations only. Alignment is not semantic equivalence, error detection, a protection list, or an editing instruction.'}
    if replay(original, result) != candidate:
        raise ValueError('internal alignment replay mismatch')
    return result


def replay(original, artifact):
    if not isinstance(original, str) or not isinstance(artifact, dict):
        raise ValueError('invalid document or artifact type')
    if artifact.get('schema') != 'v16-character-alignment-2' or artifact.get('algorithm') != 'SequenceMatcher(autojunk=False)':
        raise ValueError('unsupported alignment contract')
    if artifact.get('offset_unit') != 'Python Unicode code points, half-open intervals':
        raise ValueError('unsupported offset unit')
    _validate_context(artifact.get('context_characters'))
    if digest(original) != artifact.get('original_sha256'):
        raise ValueError('original digest mismatch')
    rows = artifact.get('rows')
    if not isinstance(rows, list):
        raise ValueError('rows must be a list')
    previous_end = 0
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('row must be an object')
        a, b = row.get('original_start'), row.get('original_end')
        if type(a) is not int or type(b) is not int or not previous_end <= a <= b <= len(original):
            raise ValueError('invalid or overlapping original offsets')
        if original[a:b] != row.get('original_span') or not isinstance(row.get('candidate_span'), str):
            raise ValueError('span mismatch')
        previous_end = b
    candidate = original
    for row in reversed(rows):
        candidate = candidate[:row['original_start']] + row['candidate_span'] + candidate[row['original_end']:]
    if digest(candidate) != artifact.get('candidate_sha256'):
        raise ValueError('candidate digest mismatch')
    expected_rows, expected_segments = _rows(original, candidate, artifact['context_characters'])
    # Validate display locations and unchanged ranges, not only resulting bytes.
    try:
        exact_rows = json.dumps(rows, sort_keys=True, ensure_ascii=False, allow_nan=False) == json.dumps(expected_rows, sort_keys=True, ensure_ascii=False, allow_nan=False)
        exact_segments = json.dumps(artifact.get('all_segments'), sort_keys=True, ensure_ascii=False, allow_nan=False) == json.dumps(expected_segments, sort_keys=True, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ValueError('non-JSON alignment table') from error
    if not exact_rows or not exact_segments:
        raise ValueError('noncanonical, incomplete, or altered alignment table')
    if ''.join(original[t['original_start']:t['original_end']] for t in expected_segments) != original or ''.join(candidate[t['candidate_start']:t['candidate_end']] for t in expected_segments) != candidate:
        raise ValueError('incomplete segment coverage')
    return candidate

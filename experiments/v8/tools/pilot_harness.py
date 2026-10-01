"""Private pilot integrity helpers; no model runner or semantic scorer.

Paragraph byte offsets must describe the complete frozen normalized article.
No Unicode normalization is performed. Blind keys never belong in reader packets.
"""
import hashlib
import secrets
import re
from collections import Counter, defaultdict
from patch_guard import check


def sha(data):
    return hashlib.sha256(data).hexdigest()


def config_id(row):
    value = row.get('config_id', row.get('condition', 'canonical'))
    if 'condition' in row and row['condition'] != value:
        raise ValueError('condition/config_id mismatch')
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}', value):
        raise ValueError('invalid config_id')
    return value


def paragraph_patch(original, paragraphs, proposal, authority):
    """Validate exact paragraph-local patches and use v7 byte preservation guard."""
    original.decode('utf-8')
    cursor, ids = 0, set()
    for p in paragraphs:
        if p['id'] in ids or p['start'] != cursor or type(p['end']) is not int or not cursor < p['end'] <= len(original):
            raise ValueError('paragraphs must uniquely partition complete article')
        original[p['start']:p['end']].decode('utf-8')
        ids.add(p['id'])
        cursor = p['end']
    if cursor != len(original):
        raise ValueError('paragraph coverage incomplete')
    if authority['preimage_sha256'] != sha(original):
        raise ValueError('authority preimage mismatch')
    by_id = {p['id']: p for p in paragraphs}
    for patch in proposal['patches']:
        p = by_id[patch['paragraph_id']]
        if not p['start'] <= patch['start'] <= patch['end'] <= p['end']:
            raise ValueError('patch crosses paragraph boundary')
    return check(original, proposal, authority)


def blind_packets(cases):
    """Return separately stored reader packets and custodian mapping.

    One packet per unique article/output byte pair, even when arms coincide.
    Caller must freeze inventories first and supply only sanitized common evidence.
    """
    packets, mapping, seen, assigned = [], [], {}, set()
    for case in cases:
        key = (case['article_id'], case['arm'], config_id(case))
        if key in assigned or case['arm'] not in {'ORIGINAL', 'FULLREWRITE', 'LOCAL'}:
            raise ValueError('duplicate or invalid arm')
        assigned.add(key)
        content = case['output'].encode('utf-8')
        identity = (case['article_id'], sha(content))
        if identity not in seen:
            token = secrets.token_hex(16)
            seen[identity] = (token, case['source'], case['evidence'], case['reference_sha256'])
            packets.append({'packet_id': token, 'source': case['source'],
                            'evidence': case['evidence'], 'reference_sha256': case['reference_sha256'],
                            'output': case['output'], 'output_sha256': sha(content)})
        token, source, evidence, reference = seen[identity]
        if (source, evidence, reference) != (case['source'], case['evidence'], case['reference_sha256']):
            raise ValueError('inconsistent common evidence/reference')
        mapping.append({'packet_id': token, 'article_id': case['article_id'],
                        'arm': case['arm'], 'config_id': config_id(case), 'output_sha256': sha(content)})
    secrets.SystemRandom().shuffle(packets)
    return packets, mapping


def aggregate(rows, expected_manifest, paragraph_rows):
    """Count explicit adjudications, never infer semantics from bytes or collapse scores.

    One row per article/arm/reference issue. status is success/failed/unknown
    for necessary issues, preserved/changed/unknown for unnecessary issues,
    and unknown for issues with unresolved necessity.
    """
    rows, paragraph_rows = list(rows), list(paragraph_rows)
    expected_issues, expected_paragraphs, expected_cases = {}, set(), {}
    for case in expected_manifest:
        identity = (case['article_id'], case['arm'], config_id(case))
        if identity in expected_cases:
            raise ValueError('duplicate expected article/arm/config')
        if case['arm'] not in {'ORIGINAL', 'FULLREWRITE', 'LOCAL'} or case['language'] not in {'KO', 'EN'}:
            raise ValueError('invalid expected arm/language')
        expected_cases[identity] = case['language']
        for issue, necessity in case['issues'].items():
            if necessity not in {'necessary', 'unnecessary', 'unknown'}:
                raise ValueError('invalid frozen necessity')
            expected_issues[identity + (issue,)] = necessity
        if not case['paragraph_ids'] or len(set(case['paragraph_ids'])) != len(case['paragraph_ids']):
            raise ValueError('empty or duplicate frozen paragraphs')
        expected_paragraphs.update(identity + (p,) for p in case['paragraph_ids'])
    observed_paragraphs = set()
    for row in paragraph_rows:
        key = (row['article_id'], row['arm'], config_id(row), row['paragraph_id'])
        if key in observed_paragraphs or key not in expected_paragraphs:
            raise ValueError('duplicate or unexpected paragraph judgment')
        if row['coverage'] not in {'covered', 'incomplete', 'uncertain'}:
            raise ValueError('invalid coverage judgment')
        observed_paragraphs.add(key)
    if observed_paragraphs != expected_paragraphs:
        raise ValueError('missing frozen paragraph judgments')
    counts, seen = defaultdict(Counter), set()
    valid = {'necessary': {'success', 'failed', 'unknown'},
             'unnecessary': {'preserved', 'changed', 'unknown'},
             'unknown': {'unknown'}}
    for row in rows:
        identity = (row['article_id'], row['arm'], config_id(row))
        key = identity + (row['issue_id'],)
        if key not in expected_issues or expected_cases[identity] != row['language']:
            raise ValueError('unexpected issue/config/language')
        if row['necessity'] != expected_issues[key]:
            raise ValueError('frozen necessity mismatch')
        if key in seen:
            raise ValueError('duplicate issue adjudication')
        seen.add(key)
        if row['arm'] not in {'ORIGINAL', 'FULLREWRITE', 'LOCAL'} or row['language'] not in {'KO', 'EN'}:
            raise ValueError('invalid arm or language')
        necessity, status = row['necessity'], row['status']
        if necessity not in valid or status not in valid[necessity]:
            raise ValueError('invalid necessity/status pair')
        c = counts[(row['language'], row['arm'], config_id(row))]
        c[necessity + '_denominator'] += 1
        c[necessity + '_' + status] += 1
    if seen != set(expected_issues):
        raise ValueError('missing frozen issue judgments')
    for row in paragraph_rows:
        identity = (row['article_id'], row['arm'], config_id(row))
        c = counts[(expected_cases[identity], row['arm'], config_id(row))]
        c['paragraph_denominator'] += 1
        c['paragraph_' + row['coverage']] += 1
    return {'/'.join(key): dict(value) for key, value in sorted(counts.items())}

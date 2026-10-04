"""v15 procedural dependency contracts; no model calls or semantic certification."""
from hashlib import sha256
from itertools import permutations

FIELDS = ('necessity', 'evidence_support', 'preserves_other_meaning', 'context_safe')
VERDICTS = {'yes', 'no', 'unknown'}


def digest(text):
    return sha256(text.encode('utf-8')).hexdigest()


def apply_exact(original, patches):
    """Apply immutable original-coordinate edits atomically, including cycles."""
    ids = [p['id'] for p in patches]
    if any(not isinstance(i, str) or not i for i in ids) or len(ids) != len(set(ids)):
        raise ValueError('invalid or duplicate patch id')
    positions = []
    for p in patches:
        before, after = p['before'], p['after']
        if not isinstance(before, str) or not before:
            raise ValueError('empty, missing or nonunique anchor: ' + p['id'])
        start = original.find(before)
        # Search from the next character, not after the previous match: 'aa'
        # occurs twice in 'aaa', although str.count reports just one match.
        if start < 0 or original.find(before, start + 1) != -1:
            raise ValueError('empty, missing or nonunique anchor: ' + p['id'])
        if not isinstance(after, str):
            raise ValueError('after must be text')
        positions.append((start, start + len(before), after))
    positions.sort()
    if any(a[1] > b[0] for a, b in zip(positions, positions[1:])):
        raise ValueError('overlapping original anchors')
    result = original
    for start, end, after in reversed(positions):
        result = result[:start] + after + result[end:]
    return result


def prepare_candidates(original, patches):
    """Actual O, O+P and O+P+Q, computed before AI relation assessment."""
    apply_exact(original, patches)  # validate the entire frozen patch set
    rows = []
    for p, q in permutations(patches, 2):
        p_only = apply_exact(original, [p])
        both = apply_exact(original, [p, q])
        rows.append({'dependent': p['id'], 'prerequisite': q['id'],
                     'original': original, 'p_only': p_only, 'p_plus_q': both,
                     'original_sha': digest(original), 'p_only_sha': digest(p_only),
                     'p_plus_q_sha': digest(both)})
    return rows


def _anchor(text, quote):
    # Exact location proves occurrence only, never relevance or entailment.
    return isinstance(quote, str) and bool(quote.strip()) and quote in text


def _relation_errors(row, artifact, sources):
    errors = []
    fields = ('kind', 'has_new_break', 'p_only_breaks', 'p_plus_q_repairs',
              'broken_candidate_span', 'original_span', 'repaired_candidate_span',
              'source_document_id', 'source_quote', 'reason',
              'original_sha', 'p_only_sha', 'p_plus_q_sha')
    if any(k not in row for k in fields):
        return ['missing_contract_field']
    kind = row['kind']
    if not isinstance(kind, str) or kind not in {'requires', 'context_only', 'unknown'}:
        errors.append('invalid_kind')
    verdicts = [row[k] for k in ('has_new_break', 'p_only_breaks', 'p_plus_q_repairs')]
    if any(not isinstance(v, str) or v not in VERDICTS for v in verdicts):
        errors.append('invalid_relation_verdict')
    if any(row[k] != artifact[k] for k in ('original_sha', 'p_only_sha', 'p_plus_q_sha')):
        errors.append('candidate_hash_mismatch')
    source_id = row['source_document_id']
    if not isinstance(source_id, str) or source_id not in sources:
        errors.append('unknown_source_document')
    elif not _anchor(sources[source_id], row['source_quote']):
        errors.append('missing_source_anchor')
    if not isinstance(row['reason'], str) or not row['reason'].strip():
        errors.append('missing_reason')
    if kind == 'requires':
        if verdicts != ['yes', 'yes', 'yes']:
            errors.append('requires_not_established')
        for field, textfield in [('original_span', 'original'),
                                 ('broken_candidate_span', 'p_only'),
                                 ('repaired_candidate_span', 'p_plus_q')]:
            if not _anchor(artifact[textfield], row[field]):
                errors.append('missing_' + field)
        # Identical passages alone cannot demonstrate a newly introduced break or repair.
        # This is deliberately conservative; distant contextual changes need broader spans.
        if row['original_span'] == row['broken_candidate_span']:
            errors.append('no_original_contrast')
        if row['broken_candidate_span'] == row['repaired_candidate_span']:
            errors.append('no_repair_contrast')
    elif kind == 'context_only':
        if verdicts != ['no', 'no', 'no']:
            errors.append('context_only_contradiction_or_unknown')
    if kind == 'unknown' or 'unknown' in verdicts:
        errors.append('unknown_relation')
    return errors


def decide(original, patches, reviews, relations, sources):
    """Select an unaudited candidate. AI claims are validated structurally only.

    Each directed pair needs exactly one record per reviewer_index 0/1.
    Missing or duplicate indexed assessments hold its dependent.
    Conflicting assessments for one directed pair also hold its dependent.
    A valid requires record is retained for conservative propagation even when a
    second assessment contradicts it. No implicit reverse edges are constructed.
    """
    artifacts = {(r['dependent'], r['prerequisite']): r
                 for r in prepare_candidates(original, patches)}
    ids = [p['id'] for p in patches]
    if len(reviews) != 2:
        raise ValueError('exactly two initial reviews required')
    maps = []
    for review in reviews:
        rows = review['patch_assessments']
        mapping = {r['patch_id']: r for r in rows}
        if len(rows) != len(mapping) or set(mapping) != set(ids):
            raise ValueError('review coverage mismatch')
        if any(not isinstance(mapping[i].get(f), str) or mapping[i].get(f) not in VERDICTS
               for i in ids for f in FIELDS):
            raise ValueError('invalid patch verdict')
        maps.append(mapping)
    reasons = {i: [] for i in ids}
    accepted = set(ids)
    for i in ids:
        for n, mapping in enumerate(maps, 1):
            for f in FIELDS:
                if mapping[i][f] != 'yes':
                    accepted.discard(i)
                    reasons[i].append(f'reviewer{n}:{f}={mapping[i][f]}')
    required = {i: set() for i in ids}
    relation_results, seen = [], {}
    coverage = {pair: {0: 0, 1: 0} for pair in artifacts}
    for row in relations:
        if not isinstance(row, dict):
            raise ValueError('relation must be an object')
        p, q = row.get('dependent'), row.get('prerequisite')
        if not isinstance(p, str) or p not in reasons:
            raise ValueError('unknown dependent ID; cannot scope hold')
        if not isinstance(q, str) or q not in reasons:
            errors = ['unknown_prerequisite']
        elif p == q:
            errors = ['self_edge']
        else:
            errors = _relation_errors(row, artifacts[p, q], sources)
            reviewer = row.get('reviewer_index')
            if type(reviewer) is not int or reviewer not in (0, 1):
                errors.append('invalid_reviewer_index')
            else:
                coverage[p, q][reviewer] += 1
            if not errors and row['kind'] == 'requires':
                required[p].add(q)
            signature = tuple(row.get(k) for k in
                              ('kind', 'has_new_break', 'p_only_breaks', 'p_plus_q_repairs'))
            key = (p, q)
            if key in seen and seen[key] != signature:
                errors.append('conflicting_relation_assessments')
            seen[key] = signature
        if errors:
            accepted.discard(p)
            reasons[p].extend(f'relation:{q}:{e}' for e in errors)
        relation_results.append({'dependent': p, 'prerequisite': q, 'errors': errors})
    # Missing judgments cannot establish independence. Every directed pair needs
    # exactly one contract from each indexed initial reviewer, including context-only.
    for (p, q), counts in coverage.items():
        for reviewer, count in counts.items():
            if count != 1:
                accepted.discard(p)
                reasons[p].append(f'relation:{q}:reviewer{reviewer}:coverage_count={count}')
    changed = True
    while changed:
        changed = False
        for p in ids:
            if p in accepted and not required[p] <= accepted:
                accepted.remove(p)
                reasons[p].append('required_prerequisite_held')
                changed = True
    risk = any(r.get('global_risk') is not False or
               any(e.get('severity') == 'major' for e in r.get('new_errors', []))
               for r in reviews)
    if risk:
        accepted.clear()
        for i in ids:
            reasons[i].append('global_or_new_major_risk_or_missing_verdict')
    result = apply_exact(original, [p for p in patches if p['id'] in accepted])
    if not patches:
        status = ('unchanged_acceptable' if not risk and
                  all(r.get('no_change_acceptable') == 'yes' for r in reviews) else 'hold')
    else:
        status = 'accepted' if len(accepted) == len(ids) else 'partial' if accepted else 'hold'
    return {'status': status, 'accepted_ids': [i for i in ids if i in accepted],
            'held_ids': [i for i in ids if i not in accepted], 'reasons': reasons,
            'required_edges': {i: sorted(required[i]) for i in ids},
            'relation_validation': relation_results,
            'relation_coverage': [{'dependent': p, 'prerequisite': q,
                                   'reviewer_counts': counts}
                                  for (p, q), counts in coverage.items()], 'candidate_article': result,
            'candidate_sha256': digest(result), 'original_sha256': digest(original),
            'requires_final_audit': True, 'final_audit_status': 'not_performed',
            'scope': 'Procedural selection only; independent AI audit of the entire actual '
                     'selected candidate is required. Not truth or factual certification.'}

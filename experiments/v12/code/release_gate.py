"""Deterministic delivery wrapper. Does not certify meaning or repair original omissions."""
from copy import deepcopy
from hashlib import sha256
from apply_exact import apply

LIMIT = 'Fallback retains original omissions and errors; acceptance is not semantic correctness.'
PATCH_FIELDS = ('warranted', 'new_assertion', 'meaning_loss', 'overediting', 'location_correct', 'repairs_identified_issue', 'evidence_justifies_difference')
ENUMS = {
    'verdict': {'supported', 'unsupported', 'partial', 'unknown'},
    'category': {'omission', 'inaccuracy', 'already_present', 'nonmaterial_context', 'uncertain'},
    'eligibility_agreement': {'agree', 'challenge', 'unknown'},
    'original_presence': {'covered', 'partial', 'absent', 'unknown'},
    'candidate_presence': {'covered', 'partial', 'absent', 'unknown'},
    'writer_identified': {'yes', 'no', 'partial', 'unknown'},
    'semantic_answer_match': {'yes', 'no', 'partial', 'unknown'},
    'status': {'answered', 'partial', 'unanswered', 'unknown'},
}
GROUPS = {
    'finding_assessments': ('atomic_id', ('verdict', 'category')),
    'reference_assessments': ('reference_id', ('eligibility_agreement', 'original_presence', 'writer_identified', 'candidate_presence', 'semantic_answer_match')),
    'unanswered_scope': ('question_id', ('status', 'acknowledged_by_writer')),
}

def digest(text):
    return sha256(text.encode('utf-8')).hexdigest()

def release_gate(original, patches, reviews, *, packet_id, expected_source_sha256, expected_candidate_sha256):
    """Pure, all-or-nothing gate over two actual review objects and trusted packet hashes.

    Reviews' hashes are not in the evaluator schema: caller must authenticate their
    packet provenance. No prose is interpreted as approval. Inputs are never edited.
    """
    if not isinstance(original, str):
        raise TypeError('original must be text')
    reasons = []
    proposed = None
    source_hash = digest(original)
    if source_hash != expected_source_sha256:
        reasons.append('source_hash_mismatch')
    try:
        applied = apply(original, deepcopy(patches))
        proposed = applied['candidate']
        if applied['candidate_sha256'] != expected_candidate_sha256:
            reasons.append('candidate_hash_mismatch')
    except (ValueError, KeyError, TypeError):
        reasons.append('patch_application_failed')
    if not isinstance(packet_id, str) or not packet_id:
        reasons.append('expected_packet_id_missing')
    if type(reviews) is not list or len(reviews) != 2:
        reasons.append('exactly_two_reviews_required')
        reviews = []
    ids = [p.get('id') for p in patches if isinstance(p, dict) and isinstance(p.get('id'), str)] if isinstance(patches, list) else []
    signatures = []
    for i, review in enumerate(reviews):
        tag = f'reviewer_{i + 1}'
        if not isinstance(review, dict):
            reasons.append(tag + ':missing_review')
            continue
        if review.get('packet_id') != packet_id:
            reasons.append(tag + ':packet_id_mismatch')
        if review.get('complete') is not True or review.get('read_complete') is not True:
            reasons.append(tag + ':incomplete_review')
        flags = review.get('overall_flags', {})
        if not isinstance(flags, dict):
            flags = {}
        for field in ('any_supported_harm', 'any_unresolved_material_issue'):
            if flags.get(field) is not False:
                reasons.append(tag + ':' + field)
        assessments = review.get('patch_assessments')
        if not isinstance(assessments, list):
            assessments = []
            reasons.append(tag + ':missing_patch_assessments')
        got = [a.get('patch_id') for a in assessments if isinstance(a, dict) and isinstance(a.get('patch_id'), str)]
        if len(got) != len(assessments) or len(got) != len(ids) or set(got) != set(ids) or len(set(got)) != len(got):
            reasons.append(tag + ':patch_coverage_mismatch')
        patch_sig = []
        for index, a in enumerate(assessments):
            if not isinstance(a, dict):
                continue
            for field in PATCH_FIELDS:
                allowed = {'yes', 'no', 'unknown'}
                if field == 'repairs_identified_issue':
                    allowed.add('partial')
                if field == 'evidence_justifies_difference':
                    allowed.add('not_applicable')
                if not isinstance(a.get(field), str) or a.get(field) not in allowed or a.get(field) == 'unknown':
                    reasons.append(f'{tag}:patch_{index + 1}:{field}_missing_or_unknown')
            for field in ('warranted', 'location_correct'):
                if a.get(field) != 'yes':
                    reasons.append(f'{tag}:patch_{index + 1}:{field}_not_yes')
            for field in ('meaning_loss', 'overediting'):
                if a.get(field) != 'no':
                    reasons.append(f'{tag}:patch_{index + 1}:{field}_not_no')
            if a.get('new_assertion') == 'yes' and a.get('evidence_justifies_difference') != 'yes':
                reasons.append(f'{tag}:patch_{index + 1}:unsupported_new_meaning')
            patch_sig.append((a.get('patch_id'), tuple(a.get(f) for f in PATCH_FIELDS)))
        signature = {'patches': sorted(patch_sig, key=repr), 'flags': flags}
        for group, (key, fields) in GROUPS.items():
            rows = review.get(group)
            if not isinstance(rows, list):
                rows = []
                reasons.append(tag + ':' + group + '_missing')
            signature[group] = []
            for row in rows:
                if not isinstance(row, dict) or not row.get(key) or any(f not in row for f in fields):
                    reasons.append(tag + ':' + group + '_malformed')
                    continue
                if any((type(row[f]) is not bool if f == 'acknowledged_by_writer' else
                        not isinstance(row[f], str) or row[f] not in ENUMS[f]) for f in fields):
                    reasons.append(tag + ':' + group + '_invalid_value')
                if any(row[f] == 'unknown' for f in fields):
                    reasons.append(tag + ':' + group + '_unknown')
                signature[group].append((row[key], tuple(row[f] for f in fields)))
            signature[group].sort(key=repr)
        unlisted = review.get('unlisted_findings')
        if not isinstance(unlisted, list):
            reasons.append(tag + ':unlisted_findings_missing')
            unlisted = []
        # These items lack stable finding IDs and harm/omission discrimination.
        # Never invent an approval or match prose across reviewers.
        if unlisted:
            reasons.append(tag + ':unlisted_findings_require_resolution')
        signatures.append(signature)
    if len(signatures) == 2 and signatures[0] != signatures[1]:
        reasons.append('reviewer_disagreement')
    reasons = sorted(set(reasons))
    delivered = original if reasons else proposed
    return {'status': 'hold' if reasons else ('no-op' if delivered == original else 'accept'),
            'source_sha256': source_hash, 'proposed_sha256': digest(proposed) if proposed is not None else None,
            'delivered_sha256': digest(delivered), 'delivered_text': delivered,
            'reasons': reasons, 'semantic_approval': False, 'limitation': LIMIT}

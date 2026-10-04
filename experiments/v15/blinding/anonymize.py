"""Allowlist metadata blinding, not a guarantee of inferential anonymity."""
import re

# Deliberately excludes labels such as A/B, condition names and model names.
# IDs are assigned by the caller, independently of writer output metadata.
_NEUTRAL_ID = re.compile(r'C[0-9]{3,}\Z', re.ASCII)


def anonymize(writer_outputs, neutral_candidate_ids):
    """Return (public_records, private_mapping); never serialize them together.

    Each writer object must contain candidate_text (str) and patches (list of
    objects with unique nonempty id, before and after strings). Extra fields
    are intentionally ignored, never recursively copied. Candidate text and
    before/after text are preserved byte-for-byte as Python strings.
    """
    if not isinstance(writer_outputs, list) or not isinstance(neutral_candidate_ids, list):
        raise ValueError('writer_outputs and neutral_candidate_ids must be lists')
    if len(writer_outputs) != len(neutral_candidate_ids):
        raise ValueError('candidate ID count mismatch')
    if any(not isinstance(i, str) or not _NEUTRAL_ID.fullmatch(i) for i in neutral_candidate_ids):
        raise ValueError('neutral candidate IDs must match C followed by at least three ASCII digits')
    if len(set(neutral_candidate_ids)) != len(neutral_candidate_ids):
        raise ValueError('duplicate neutral candidate ID')
    public_records, private_mapping = [], []
    for index, (writer, candidate_id) in enumerate(zip(writer_outputs, neutral_candidate_ids)):
        if not isinstance(writer, dict) or not isinstance(writer.get('candidate_text'), str):
            raise ValueError('writer must have candidate_text string')
        patches = writer.get('patches')
        if not isinstance(patches, list):
            raise ValueError('patches must be a list')
        public_patches, patch_mapping, seen = [], [], set()
        for ordinal, patch in enumerate(patches, 1):
            if not isinstance(patch, dict):
                raise ValueError('patch must be an object')
            raw_id = patch.get('id')
            if not isinstance(raw_id, str) or not raw_id.strip() or raw_id in seen:
                raise ValueError('patch IDs must be nonempty unique strings within each candidate')
            seen.add(raw_id)
            if not isinstance(patch.get('before'), str) or not isinstance(patch.get('after'), str):
                raise ValueError('patch before and after must be strings')
            neutral_patch_id = f'P{ordinal:02d}'
            public_patches.append({'id': neutral_patch_id, 'before': patch['before'], 'after': patch['after']})
            patch_mapping.append({'neutral_patch_id': neutral_patch_id, 'raw_patch_id': raw_id})
        public_records.append({'neutralcandidate_id': candidate_id,
                               'candidate_text': writer['candidate_text'], 'patches': public_patches})
        private_mapping.append({'neutralcandidate_id': candidate_id,
                                'writer_input_index': index, 'patch_id_mapping': patch_mapping})
    return public_records, private_mapping

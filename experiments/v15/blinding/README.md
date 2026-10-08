# Allowlist blinding for candidate audits

`anonymize.py` prevents writer metadata and original patch IDs from being copied into the public audit payload. It uses an explicit allowlist rather than removing a known set of sensitive keys. Tests are synthetic; no real article, private original record, or hidden evaluation item was read to implement this helper.

```python
from anonymize import anonymize

public_records, private_mapping = anonymize(
    writer_outputs,                 # list of writer dictionaries
    neutral_candidate_ids=['C832', 'C107'],  # caller-assigned, unique IDs
)
# Send only public_records to the auditor.
# Preserve private_mapping separately in private storage, never in audit input.
```

Each input requires `candidate_text: str` and `patches: list[{id: str, before: str, after: str}]`. An upstream caller using another body-field name must explicitly adapt that field. Raw patch IDs must be nonempty strings and unique within each candidate. Empty patch lists and empty replacement text are supported. Patch applicability and semantic safety are outside this helper's scope.

Each output record contains **only** `neutralcandidate_id`, `candidate_text`, and `patches`. Every public patch contains **only** `id`, `before`, and `after`; IDs are reassigned in order as `P01`, `P02`, etc., starting anew for each candidate. Original IDs, rationale, inventory, condition, model, filenames and any other metadata are not copied. The private return value records input index and raw-to-neutral patch ID mappings. Public and private containers do not alias mutable input containers.

Candidate IDs must be caller-supplied unique strings matching `C` plus at least three ASCII digits. The function never derives IDs from writer fields or reuses original condition labels. The caller must assign these IDs and candidate ordering independently of condition/model labels; the function cannot prove that the caller's numbering convention is neutral. Patches retain their original sequence, which can also provide contextual clues.

This is metadata blinding, **not a guarantee that the condition cannot be inferred**. Article wording, edit choices, patch order or legitimate text mentioning A/B may reveal clues. Body and before/after strings are preserved exactly, including legitimate A/B characters; deleting these characters would alter the article and is not an acceptable anonymization strategy. Text fields containing leaked metadata require separate review, not destructive character filtering.

Run from the repository root:

```sh
python -m unittest discover -s experiments/v15/blinding -v
```

Eight synthetic tests pass: exact allowed output keys, independent candidate ID assignment, neutral patch renumbering, private mapping separation, input immutability, preservation of legitimate A/B text, required types and duplicate ID rejection, and empty/no-op cases. Passing these tests establishes the helper's structural behavior, not actual model independence or complete inferential blinding.

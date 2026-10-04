# v15 directed dependency contract engine

`gate.py` is a deterministic procedural experiment. It does not call an AI model, generate real model assessments, or establish the semantic truth of an article. `test_gate.py` contains hand-authored synthetic assertions, not independent reviewers or human gold. No v14 file is modified.

## Call sequence

```python
from gate import prepare_candidates, decide

artifacts = prepare_candidates(original, patches)
# Freeze these engine-generated artifacts and source documents, then give them
# to actual independent AI assessors. Do not let an assessor invent candidates.
# Collect two initial patch reviews and two directed relation records per pair,
# indexed reviewer_index=0/1 to match reviews[0]/reviews[1].
result = decide(original, patches, reviews, relations, sources)
# A separate AI audit must inspect result['candidate_article'] in full, pinned
# to result['candidate_sha256'], against original and sources. This module does
# not perform or simulate that audit. 'accepted' means procedural selection.
```

- `original`: UTF-8 Python text. Hashes are SHA-256 of exact UTF-8 bytes (no normalization).
- `patches`: list of `{id, before, after}`. IDs must be nonempty unique strings; every nonempty `before` must occur exactly once in original; original-coordinate ranges cannot overlap. All changes apply atomically using original positions. Empty `after` supports deletion.
- `sources`: `{source_document_id: full_source_text}`. The caller must freeze and preserve these sources and their provenance. This engine checks quoted occurrence, not source authenticity.
- `reviews`: exactly two `{patch_assessments: [{patch_id, necessity, evidence_support, preserves_other_meaning, context_safe}], global_risk: false, new_errors: [{severity: ...}]}` objects. Each axis is `yes/no/unknown`; both reviews must say yes on all four axes for initial acceptance. Each review must cover each patch exactly once. Missing/true global risk or any `major` new error holds everything. No-op additionally requires both `no_change_acceptable: "yes"`.
- Legacy patch `dependencies` and review `related_patches` have **no effect**. Only explicit validated v15 relation records create mandatory edges. Every ordered pair must have exactly one record from reviewer_index 0 and exactly one from reviewer_index 1. Missing pairs, missing reviewer records, and duplicate reviewer records hold the dependent and propagate through valid required edges. Thus an empty relation list with two or more patches cannot approve any patch. Zero or one patch has no pair coverage requirement. The complete selected candidate still needs independent audit.

`prepare_candidates` returns one row per ordered pair P,Q: `{dependent, prerequisite, original, p_only, p_plus_q, original_sha, p_only_sha, p_plus_q_sha}`. The assessment denominator is fixed to these ordered pairs: 2*n*(n-1) reviewer records. This is quadratic; scope the frozen patch set deliberately for large inputs. Unreviewed important relationships cannot silently pass merely because a record was omitted.

Each relation record has this complete shape (anchors are literal text strings, not offsets):

```json
{
  "reviewer_index": 0,
  "dependent": "P",
  "prerequisite": "Q",
  "kind": "requires",
  "has_new_break": "yes",
  "p_only_breaks": "yes",
  "p_plus_q_repairs": "yes",
  "original_span": "literal contrasting passage from original",
  "broken_candidate_span": "literal newly broken passage from O+P",
  "repaired_candidate_span": "literal repaired passage from O+P+Q",
  "source_document_id": "S",
  "source_quote": "literal supporting quotation in S",
  "reason": "Explain the new break caused by P, original contrast, and repair by Q.",
  "original_sha": "engine-generated SHA-256",
  "p_only_sha": "engine-generated SHA-256",
  "p_plus_q_sha": "engine-generated SHA-256"
}
```

`reviewer_index` must be an exact integer 0 or 1 (booleans and string numerals are invalid), linking the record to reviews[0] or reviews[1]. Caller-owned model request/response artifacts must preserve actual reviewer provenance; an index cannot prove independent AI execution. All three hashes, source ID/quotation and a nonempty reason are checked for every relation. `requires` needs all three verdicts `yes`, nonempty matching anchors in O/O+P/O+P+Q, and different original/broken and broken/repaired passages. The contrasting passages may include enough surrounding context to show a distant interaction. Exact occurrence cannot prove that the passage supports the reason or that the alleged break was absent from the original. `has_new_break` is the assessor's explicit claim, never a code-inferred semantic fact.

`context_only` requires all three verdicts `no`; the three span fields remain present but may be empty. It never creates a mandatory edge. `unknown`, any unknown verdict, incomplete evidence, invalid hashes, self-edge, unknown prerequisite, or contradictory assessments holds only its dependent initially. Valid required edges then propagate holds. An unknown dependent raises `ValueError`, because no existing patch can safely be identified as the hold target. Unknown source IDs hold the dependent.

Exactly two assessments of each pair are required, one per reviewer. Different kind/verdict tuples hold the dependent; any individually valid required claim remains in the conservative graph. Duplicate reviewer rows also hold the dependent, even if their contents match. The engine enforces indexed coverage but cannot authenticate assessor identity or independence. It does not auto-generate reverse edges. A cycle is applied together if every member is accepted; a hold anywhere propagates around the cycle. Pairwise contracts do not establish safety of a three-way combination.

Output includes ordered `accepted_ids`, `held_ids`, per-patch `reasons`, `required_edges`, per-record validation, indexed `relation_coverage`, actual candidate/hash, and always `requires_final_audit: true`, `final_audit_status: "not_performed"`. No publication operation is implemented. The separate full-candidate audit must also check protected original meaning, source relevance, unlisted omissions, and multi-patch interactions; its outcome is not supplied by this module.

## Verification

```sh
python -m unittest discover -s experiments/v15/dependency -v
```

24 synthetic tests pass. They cover actual candidates/hashes; false/missing anchors and hashes; duplicate IDs, empty/nonunique/overlapping anchors; context-only background; true directed dependencies; unknown/contradiction propagation; self/unknown IDs; unchanged original error claims; cycles; two-review four-axis and global/major gates; no-op; the deliberately unproven semantic relevance of a matching source quote; and a three-switch example where every pair is safe but the entire selected combination violates a hypothetical constraint. The last two tests demonstrate limits, not semantic success. See `test-results.txt` for the executed test output.

## Discovered defect and correction

Root review found that the first implementation treated missing relation records as no dependency. `coverage-defect-before-fix.json` preserves a synthetic reproduction: an empty relation list incorrectly selected both patches. The corrected engine requires complete indexed two-review coverage for every ordered pair. New regression tests exercise missing pairs, one missing reviewer, duplicate reviewers, invalid reviewer indices/types, coverage-hold propagation, and the one-patch exception. `test-results-before-coverage-fix.txt` preserves the original 18-test run; `test-results.txt` records the corrected 23-test run. The earlier passing tests did not establish coverage safety.

Independent review subsequently found that Python `str.count` ignores overlapping occurrences: `aa` has two starting positions in `aaa`. `overlapping-anchor-defect-before-fix.json` preserves the erroneous first-match application. The validator now checks for any second occurrence starting one character after the first. A regression tests repeated-character and periodic overlapping anchors, as well as a unique valid anchor. `test-results-before-overlapping-anchor-fix.txt` preserves the previous 23-test run; the current `test-results.txt` records 24 passing tests.

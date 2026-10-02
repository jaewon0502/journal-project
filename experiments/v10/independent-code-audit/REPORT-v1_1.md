# Independent v1.1 follow-up verification

Verdict: the demonstrated annotation type-alias defect is fixed within the requested narrow scope. No further fixes made or requested.

Independent source diff shows only `math` import, addition of recursive `strict_json_equal`, and replacement of the annotation equality check in `verify_delivery`. Existing delivery generation, renderer, local hunks, output handling and vendor engine are unchanged. The comparator distinguishes bool/int/float and requires exact JSON container/value types, rejecting custom types and nonfinite floats; object key ordering remains irrelevant. Additional differences are follow-up documentation, tests, logs and manifests.

The four original adversarial cases all pass against v1.1. The original test and original failing evidence are preserved. The new `test_independent_v1_1.py` changes only the module target, results filename and expected-rejection adapter: a `ValueError` now counts as rejection, consistent with the existing verifier contract. This is not a production-code change.

All 14 original synthetic fixture files are byte-identical between versions. Independent replay of each under both `selective` and `source_only` policies yields identical output bytes and complete delivery annotations (28 comparisons). All 28 normal JSON round trips and all 28 recursively reordered JSON objects pass v1.1 verification. Thus source data and generated text/notes are unchanged for these cases; this does not establish semantic correctness.

The original 25-file frozen manifest and v1.1 35-file manifest both match all hashes and byte sizes. Both vendor engines retain SHA-256 `480cfc3aaf8da84b95e850f05ccb7d454f3cb05dc3e89edce60218a5d690360a`.

Evidence:

- `v1_1-adversarial-tests.txt`: 4/4 independent cases pass.
- `v1_1-adversarial-results.json`: exact case notes and rejected alias mutation.
- `check_v1_1.py`: independent AST scope, frozen-integrity, replay and round-trip checks.
- `v1_1-independent-checks.json`: complete 14-fixture/two-policy comparison results.
- `v1_1-original-and-fix-tests.txt`: original and implementer regression suites pass.

Remaining blockers: none within this mechanical verification scope. No semantic/editorial improvement claim is made.

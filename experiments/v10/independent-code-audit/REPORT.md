# Independent frozen v10 mechanical code audit

Scope: actual delivered bytes, hashes, dependency states, readable summary consistency, source-only behavior, finding provenance and changed-candidate re-audit. No external APIs, semantic adjudication, implementation changes or frozen artifact regeneration.

## Results

- Existing suite: 11/11 test methods pass (`original-tests.txt`).
- New bounded adversarial suite: 3/4 pass; one intentionally failing regression exposes a narrow verifier defect (`adversarial-tests.txt`).
- All 25 files listed in the frozen manifest match their SHA-256 and byte size (`frozen-integrity.json`).
- Pristine vendor engine SHA-256: `480cfc3aaf8da84b95e850f05ccb7d454f3cb05dc3e89edce60218a5d690360a`.

The three successful cases establish, for these inputs only:

1. Korean UTF-8 replacements with unequal lengths and deletion proposals respect an atomic rejected dependency component. Only the independent patch lands; every reported output range hash and readable count matches delivered bytes.
2. Explicit source-only policy returns exact source bytes even with final approval, dependent patches and proposal/final finding prose claiming completion. Applied IDs are empty, all patch states are rolled back, finding references remain unadjudicated, and the prose claims do not enter the note.
3. An offending finding removes its entire dependency component. Approval of the original candidate cannot release the reduced candidate. A separately generated verdict bound to the reduced candidate releases exactly the surviving independent patch, with matching output hash and readable counts.

## Demonstrated defect: JSON field type changes pass verification

Location: `/historical-research/journal-v10/editing/delivery.py:169`.

`verify_delivery` uses Python dictionary equality, which does not distinguish equal-valued booleans, integers and floating-point numbers. A valid note was serialized through JSON after changing:

- `released`: `true` to `1`;
- first patch `source_span`: `[0, 1]` to `[false, true]`;
- first patch `output_span`: `[0, 1]` to `[0.0, 1.0]`.

The serialized annotation differs, yet `verify_delivery(...)` returns `True`. A downstream Python byte-slice consumer cannot use the accepted floating-point output offsets without a `TypeError`. This contradicts the documented exact rejection of modified annotation fields and weakens schema integrity at the final delivery boundary.

Severity and limit: low; this reproduction does **not** demonstrate wrong delivered bytes, a wrong output hash, a misleading rendered state summary, or bypass of candidate approval. It is a type-validation defect, not evidence of the original proposal/application disclosure regression returning. No fix was made after freeze.

Reproduce from any working directory:

```sh
PYTHONDONTWRITEBYTECODE=1 python /historical-research/journal-v10/independent-code-audit/test_independent.py
```

Expected result: three passing cases and one failing expected-rejection assertion. `adversarial-results.json` records the exact accepted field mutations and complete synthetic passing-case notes. All test inputs are invented text.

Mechanical checks do not establish semantic correctness, editorial quality or human comprehension. No execution blocker remains; the demonstrated narrow defect remains unfixed by instruction.

# v1.1 bounded follow-up: strict annotation types

Only implementation change: `delivery.py` now recursively compares exact JSON types and values instead of Python dictionary equality. Boolean/integer/float aliases are rejected; nonfinite floats, non-JSON containers, non-string keys and custom scalar types are rejected. Object field order remains immaterial. Invalid notes retain the existing `ValueError` rejection contract. Output generation, release selection, audit state, rendering and vendor engine are unchanged.

The frozen original `/historical-research/journal-v10/editing` was copied in full and never edited. Its original manifest is preserved as `baseline-manifest.json`; the sibling original `editing/manifest.json` remains authoritative for v1. The new `manifest.json` describes v1.1 and links the baseline hash. Prior logs and synthetic data copied into this package are historical v1 artifacts, not silently relabeled v1.1 runs. New follow-up logs have `v1_1` or `independent-` names.

## Exact validation results

- Existing 11 test methods plus 4 bounded type-regression methods: **15/15 pass**. Tests cover the three original aliases separately and together, ordinary JSON round trip, recursive key reordering, NaN/infinities and other non-JSON values.
- Actual independent source is `independent-code-audit/test_independent.py`; no `test_adversarial.py` exists in this workspace. It is loaded unchanged against the v1.1 module without executing its file-writing main block. Direct run: **3 pass, 1 ERROR**, because test 4 expects `False`, while the verifier correctly raises `ValueError` for its tampered note. Full traceback is retained in `evidence/independent-direct.txt`.
- The same unchanged test source with a harness-only `ValueError` → `False` rejection adapter: **4/4 pass**. This adapter does not change the implementation or assertion and is disclosed in `run_independent.py`. It reconciles the two rejection conventions; it is not reported as a clean direct-suite pass.
- All **25** original manifest files retain their frozen SHA-256/size. All **14** existing synthetic fixtures replay to exactly the original delivered bytes and annotation objects under v1.1 and pass the stricter verifier. Evidence: `evidence/v1_1-integrity-and-replay.json`.

```sh
cd /historical-research/journal-v10/editing-v1_1
PYTHONDONTWRITEBYTECODE=1 python -m unittest -v test_delivery test_strict_types
PYTHONDONTWRITEBYTECODE=1 python run_independent.py direct
# Above exits 1 for the documented rejection-convention error.
PYTHONDONTWRITEBYTECODE=1 python run_independent.py normalize_rejection
```

This is one local verifier repair prompted by the independent audit. It does not claim any semantic-performance, editorial-quality or reader-comprehension improvement across versions. No new research cases, native candidate judgments, remote calls or paid APIs were used. No remaining implementation blocker was found in this bounded follow-up; the direct independent test's exception convention is explicitly outstanding as a harness mismatch.

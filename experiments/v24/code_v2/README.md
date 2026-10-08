# Bounded structural repair v2

`gate.run(unit, certificate)` and `delivery.enforce(unit, proposal, gate)` remain the public APIs. This directory is a separate implementation; original `code/` remains v1. Results from v2 are separate corrected replays, not replacements or rescoring of the frozen trial.

The gate binds its permission artifact to the exact unit ID and UTF-8 article SHA-256. Each eligible comparison contains its unique original article quote/span, exact numeric token/span, original quantity/unit, rational target expressed in that same unit, and normalized target. Delivery checks all referenced IDs, exact spans, original scalar, and target scalar. Only one numeric literal may change per patch, with every other character preserved, including attached Korean suffixes. It applies no proposal full-text fallback. Contradicted audit rows must also contain the permitted numeric span and reference only eligible comparisons.

Arithmetic requires explicit operand units and anchored operands, normalizes exact rational values, propagates dimension exponents, and rejects incompatible addition/subtraction or endpoint results. Length times length has area dimension; division of like dimensions is dimensionless. Counts, ratios/percentages, length, area, mass, volume, and currency retain the supported v1 unit vocabulary. Volume remains the independent v1 volume dimension (liters); no new cubic-length conversion vocabulary is introduced. No constants, calls, powers, or unary expression nodes are introduced.

## Compatibility constraints

- Gate artifacts are trusted local code outputs, not model-generated authorization records. The hash is a binding, not an authenticity signature. V1 gate artifacts cannot authorize v2 delivery; rerun v2 on the original certificate first.
- Unit/comparison/source identifiers must be nonempty strings and unique within their scopes. Source text and article text must be strings. Duplicate comparison IDs or malformed top-level inputs return structured blocked diagnostics.
- Article quote must occur exactly once. Within it, exactly one whole numeric token must match the certified article quantity. The old deliberately false `999` article scalar test now blocks. Repeated/ambiguous numbers and anchors require review.
- A patch must change exactly one numeric token. Signed decimal, scientific notation, and conventional thousands separators are supported; arbitrary prose, unit changes, multiple number edits, and rounded rational targets require review. Fractional values are supported in certificates/calculation but replacement text must be one numeric literal; nonterminating targets are not rounded or guessed.
- Every referenced comparison must be eligible and authorize that same numeric span and expected value. Unknown, blocked, normalized-equal, or duplicate referenced IDs cannot authorize an edit. Broad before strings are accepted only if their sole changed numeric token is the certified token and all other text stays identical.
- Malformed comparisons are blocked individually. Malformed patches/audit rows are reported individually as review-required, preserving unaffected valid edits. Malformed top-level inputs and incompatible gate artifacts return the original article unchanged (or null when no article exists).
- The delivery import resolves the sibling v2 gate explicitly so loading it with `importlib` does not accidentally pick up v1.

## Residual semantic limitation

Neither exact quotes nor `relation=same` establish semantic identity or truth. A certificate falsely claiming article A and source B are the same referent can still permit an exact numeric A edit from 2 to 3. `test_known_semantic_certificate_limitation` explicitly demonstrates this with real A/B anchors and an accepted edit. The false semantic certificate problem remains; this repair addresses transferable permission, unrestricted replacement, untyped arithmetic, and schema robustness only.

## Validation

Run `python -m unittest discover -s experiments/v24/code_v2 -p test_gate.py -v` from the repository root. The suite uses only new synthetic fixtures and the permitted code-audit counterexamples. It includes truthful mismatch edits, equivalent-unit preservation, all supported units, converted same-unit targets, exact rational rejection of rounding, typed subtraction, length×length area, dimensionless division, Korean suffix preservation, every S1/S2/S3/S4 regression, overlap/ambiguity checks, and the residual semantic failure witness. No heldout cases, certificates, generated outputs, or scores were read.

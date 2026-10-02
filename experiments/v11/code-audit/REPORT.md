# Frozen receipt code audit

Scope: `/historical-research/journal-v11/receipt`; six new adversarial checks, native tests, and read-only inspection of the fingerprinted v10 dependencies. No hidden confirmation cases or keys were opened. No implementation or frozen evidence was edited. Hashes are treated as byte bindings, not authentication; the filesystem owner and caller-supplied audit identities remain trusted.

## Reproduced failure: inconsistent receipt size limits

A valid 1,590,340-byte patch audit containing 30,000 preexisting finding references produces a **6,890,933-byte receipt**. The input is below the pinned engine's 2 MiB raw-JSON limit. The ordinary `build` and exact `verify` calls succeed, and `Store.put` successfully writes the receipt and returns address `0d6b2a0f863c84849c3414335b385d7e2fc9caf276b9334d9d4ab2224bf6d13b`.

However:

- `emit` returns `verification_failed`, because `_text` parses the expanded receipt with `engine.parse`, which rejects raw JSON over 2 MiB.
- `Store.get` raises `ValueError: unsafe store object`, because `_read` rejects objects over 4 MiB.

The receipt adds structured provenance to each finding, so accepted input expands beyond both downstream limits. No receipt-size restriction is declared in INTERFACE.md, `build`, or `Store.put`. Thus a receipt accepted for minting and storage cannot be rendered or retrieved. This is an availability/round-trip contract failure, **not** an application-status bypass, arbitrary-prose injection, external publication, semantic-resolution claim, or owner-tampering finding.

Relevant implementation locations: `receipt.py:67-82` constructs the receipt without a bound; `receipt.py:94` uses the bounded engine parser for rendering; `receipt.py:171` imposes the 4 MiB read cap; `receipt.py:181-187` accepts and stores a larger verified receipt. No fix was applied.

Reproduction:

```sh
PYTHONDONTWRITEBYTECODE=1 python /historical-research/journal-v11/code-audit/audit_checks.py
PYTHONDONTWRITEBYTECODE=1 python /historical-research/journal-v11/code-audit/reproduce_size_failure.py
```

The six-check suite intentionally exits nonzero for this failure. The separate reproduction asserts the observed failure behavior and writes `size-reproduction.json`; it constructs a one-patch fixture independently, rather than reusing the native fixture helper. This reproduction is the same sixth check, not a seventh adversarial hypothesis. It independently confirmed the failure: a 1,590,306-byte audit produced a 6,890,819-byte receipt with status `applied`; `put` returned address `7dc33f4447070bb41665a94b884e49c99ca5234a6ab3d3b44457615bd032d1d6`, while `emit` returned its fixed verification-failure template and `get` rejected the object. The separate run took 113.760 seconds; no latency threshold was asserted.

## Coverage and passing evidence

Native tests: **9/9 passed**, recorded in `native-tests.txt`.

New adversarial checks: **5/6 passed**, recorded in `adversarial-tests.txt` and `observations.json`.

1. Stale output bytes, candidate substitution, swapped output/candidate, and store retrieval with changed actual output all fail verification.
2. Rejection of one patch in a dependent pair removes the entire pair. Rejection alone does not release the reduced candidate; stale initial-candidate approval abstains; fresh review releases only the independent third patch. Receipt correctly reports partial, selected `p3`, rejected `p1` and `p2`, while preserving all three initial candidate IDs.
3. Nested boolean/integer ledger corruption fails. Both EN and KO failure paths return exactly the fixed failure template and no receipt address. Injected finding descriptions and evidence IDs never appear in the rendered text. Successful patch application retains `semantic_truth=not_independently_verified` and `question_resolution=not_adjudicated`.
4. An injected fsync exception propagates. A deliberately truncated object in an isolated audit-owned store is neither repaired nor overwritten by `put`, and `get` rejects it. Symlink and hardlink objects reject both reads and writes; target bytes remain unchanged. Existing native tests additionally cover directory/parent symlinks, legacy-directory collisions, FIFO objects, and ordinary corrupt collisions. These are API checks within the accepted owner trust boundary.
5. A deeply nested malformed final audit returns the fixed verification-failure template without an application claim.
6. Large valid provenance fails the rendering and storage round-trip contract as detailed above.

Code inspection supports the renderer claim beyond the injected marker: the successful template interpolates only fixed status labels, counts, and receipt/output/candidate hashes. It never interpolates audit descriptions, evidence-ID text, or a freeform writer annotation. Fixed text explicitly distinguishes patch application from factual truth and question resolution.

## Freeze and limits

`freeze-verification.json` verifies all **34** manifested candidate/evidence files and legacy dependencies byte-for-byte against `frozen-manifest.json`. The manifest was read, not changed. Audit deliverables are isolated under `/historical-research/journal-v11/code-audit`.

These are bounded implementation checks, not hidden confirmation results or a demonstration of semantic superiority. Process-kill timing races were not exhaustively enumerated; the incomplete-object state and fsync error were exercised explicitly. The failure found remains unfixed because the candidate is frozen. No external APIs or publication handlers were invoked.

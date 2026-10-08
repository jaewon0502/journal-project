# Audit of the reported 234 unittest methods

The saved run reports **234 methods in 17 unittest invocations**, exit code 0, with **no executed skips and no new model calls**. The source inventory matches every logged suite count. These are software contract/regression checks, not 234 independent model or semantic evaluations.

| Suite | Methods |
|---|---:|
| `experiments/legacy/repair-v4/patches` | 7 |
| `experiments/v6/tools` | 5 |
| `experiments/v7/tools` | 21 |
| `experiments/v8/tools` | 26 |
| `experiments/v9/tools` | 18 |
| `experiments/v10/editing-v1_1` | 15 |
| `experiments/v10/independent-code-audit` | 4 |
| `experiments/v12/code` | 8 |
| `experiments/v13/v13/code` | 17 |
| `experiments/v15/code-audit/receipt` | 1 |
| `experiments/v15/code-audit/aggregation` | 15 |
| `experiments/v15/dependency` | 24 |
| `experiments/v15/blinding` | 8 |
| `experiments/v16/alignment` | 15 |
| `experiments/v17/code` | 10 |
| `experiments/v18/code` | 19 |
| `experiments/v19/code-audit` | 21 |

## What the count measures

| Primary property family (coarse, disjoint by module) | Methods |
|---|---:|
| patch_realization_and_renderer_contract | 22 |
| accounting_and_scoring_contract | 17 |
| delivery_review_dependency_and_artifact_contract | 131 |
| strict_type_schema_and_input_identity_contract | 13 |
| filesystem_path_and_write_preservation_contract | 1 |
| scoring_identity_and_binding_contract | 27 |
| blinding_identity_and_content_preservation_contract | 8 |
| alignment_offset_hash_and_reconstruction_contract | 15 |

These primary families sum to 234; individual modules often combine hash binding, exact spans, schema, reviewer/patch identity, dependency closure and rejection behavior. This is not a coverage percentage or an assertion count. The JSON contains all method names and source line numbers.

**219 methods use hand-authored synthetic fixtures; 15 consume saved artifacts or mutations of them**: legacy output replay (1), v6 accounting (5), v7 aggregation (3), v8 aggregation (5), v9 public accounting (1). Saved projections and mutated records are not new semantic judgments. Synthetic fixtures can contain semantically named fields whose values are manually assigned.

**Nested cases are not extra methods.** The v15 receipt CLI matrix runs 20 subprocess cases (4 expected successes, 16 expected rejections) inside one of the 234 methods. A separate v7 method runs 3 CLI cases. The alignment exhaustive-small test checks 225 string pairs in one method. Other methods contain additional loops/subtests; no global subcase total is asserted.

## Additional replay stages (outside the 234 methods)

- `legacy/verify_archive.py`: 88 output markdown files and 4 synthetic responses; stored gate counts; historical artifact verification.
- `v7/tools/reaggregate.py`: T-dev-v1, T-dev-v2, T-eval score arithmetic; J-eval 4 events, 4 triplets, 12 judgments.
- `v10/run_checks.py`: 12 paired calibration packets; 9 natural+synthetic initial projected rows; saved final state arithmetic; full natural raw judgments not redistributed.
- `v11/run_checks.py`: SHA256SUMS; 10 frozen synthetic confirmations; 6 mechanical rejection mutations; recount 60 raw reader judgments, 8 natural precision projected judgments, 16 sidecar raw judgments; no natural-source reverification.
- `v11/portable/replay.py --version v1_3`: 10 hand-authored smoke cases: 2 languages x 5 receipt states; store roundtrip; reference_comparison=false; not new saved model outputs.
- `v12/code/verify_public_package.py`: 185 manifest entries; 24 saved synthetic exact patch replays; semantic_validation=false.
- `v13/v13/code/verify_public_package.py --full-gate`: 89 manifest entries; 12 saved synthetic delivered rows; exact patch/hash replay and full gate decision comparison against saved reviews.
- `v16/synthetic/replay.py`: 27 derivative hashes; 14 saved synthetic outputs (v1 8, v2 6); patch anchors, overlap, four supplied approval flags and action counts. Reconstructs text but does not compare reconstructed text to a saved delivered-text/hash oracle; semantic_rescoring=false.
- `v17/synthetic/replay.py`: 12 saved synthetic outputs: v1 8 (1 valid/7 rejected), v2 4 (all valid); compare expected decision, error and delivered hash. Passing includes preservation of saved rejection failures.
- `v17/annotation/replay.py`: 6 items (2 exposed regression + 4 fresh synthetic), 3 saved annotation sets, 3 categorical axes; agreement and exact quote witnesses (19 anchors/set); no prose semantic reassessment.
- `v19/synthetic/replay.py`: 2 saved native synthetic outputs: SY191 unchanged, SY192 repair; strict checker, patch count, unchanged flag, delivered character count, frozen input hash. No explicit saved output-file hash check in this script; semantic findings remain saved AI judgments.

The v9 verification invoked by its one unittest method reports 24 condition rows, 18 unique outputs, 36 readings, 9/126 disagreements and 8 synthetic fixtures. It is already represented in the 234 method count.

## Unrun and adapted paths

The runner leaves **81 defined test methods in 13 files uninvoked**: v10 original editing (11), v11 frozen receipt versions (59), v11 portable tests (3), and v11 sidecar tests (8). Archived evidence files are not fresh executions. The only `skipTest` in this inventory is in the uninvoked portable suite; it is not a skip among the 234. The v11 replay uses v1_3 with no reference comparison. The v15 receipt legacy-versus-fixed `--evidence` branch is unrun.

The v10 independent suite is run against the selected v1_1 implementation with an adapter converting `ValueError` rejection to `False`; it is not an untouched rerun against the archived original implementation.

## What passing does not establish

- No fresh model calls, detector recall/precision evaluation, independent semantic rescoring, or independent factual source verification follows from this test count.
- Necessity, evidence support, preservation of other meaning and context safety are supplied labels in fixtures or saved AI judgments; schema/quote/hash checks cannot establish their truth.
- A matching source quotation does not prove relevance, entailment, completeness or correct attribution. v15 dependency test explicitly accepts irrelevant but present evidence.
- Whole text/byte identity proves unchanged content only; it does not prove original content is correct or acceptable. v16 explicitly tests this limit.
- Pairwise dependency completeness does not detect arbitrary three-way semantic interactions; v15 has an explicit counterexample requiring a final audit not performed by that gate.
- Review IDs/indices and distinct records enforce structural uniqueness, not epistemic independence of reviewers or statistical independence of model outputs.
- No coverage instrumentation or exhaustive real filesystem/concurrency/race/security validation is reported. Path tests cover a fixed sequential fixture matrix.
- Published counts and hashes reproduce fixed records, including known failures; they do not validate external validity or production performance.

Evidence: `REPO/tools/run_checks.py`, nested v10/v11 runners, executed test sources, replay sources, `V19_PRIVATE/full-checks.log`, and `test-summary.json`. SHA-256 evidence bindings and full file/method inventories are in `V20_PRIVATE/test-scope.json`. This audit used source inspection, saved results, and the supplemental current-path checks below; it did not regenerate models, rerun historical faulty code, or modify historical artifacts.


## Supplemental current-path checks (separate from the original 234)

The 81 omitted definitions are not automatically defects: 70 belong to explicitly archived v10 original editing / v11 frozen receipt versions. The remaining 11 concern the usable v11 portable and sidecar paths, which were attempted with bytecode writes disabled on the unchanged package.

- **Portable:** exit 0; 3 discovered methods, 2 passed, 1 skipped because its hypothetical missing v1_2 has since been bundled. The relocation test replays every bundled version from a temporary path containing spaces while refusing legacy absolute reads. Log: `V20_PRIVATE/supplemental-v11-portable.log`.
- **Sidecar:** exit 1 during import; none of its 8 real methods execute. `sidecar.py:14` expects original receipt hash `3f3a4dc118c4311bd0adef8fe4893cd6d1340ce1e490b445febb7d13464a6014`, but the current portable v1_3 loader reports `120e8c86cce2fc13dee257bde4b19e691f034f69b044ca5d387e2724a3f70e8e`, causing `ValueError: unexpected receipt implementation`. The printed “Ran 1 test” is a loader error placeholder, not a ninth sidecar method. Log: `V20_PRIVATE/supplemental-v11-sidecar.log`.

This is a current package reachability/pin mismatch, separate from intentional preservation of archived failures. The original full runner verifies saved sidecar reader counts without importing `sidecar.py`, so its successful 234-method report does not expose this failure. No historical pin or code was changed, and no unsupported cause for the mismatch is inferred.


## Separate v20 binding repair

A separate adapter is now available at `experiments/v20/code-audit/sidecar/sidecar_adapter.py` in journal-v20-work. It pins six source files, retains the original sidecar assertion, changes exactly its obsolete receipt-hash binding in memory, and verifies full portable execution provenance. The current portable receipt and frozen v1_3 receipt are byte-identical, establishing the precise current binding without relaxing integrity checks. The reason for the original historical hash difference is not inferred.

The adapter's **12 methods pass**: 4 new binding tests plus all 8 unchanged sidecar methods. Negatives reject each changed source pin and incorrect provenance values; the original import failure is preserved as an explicit check. These are supplemental results, not additions to or replacements for the historical 234-method count. See `experiments/v20/code-audit/sidecar/README.md` for the interface and reproduction command, `V20_PRIVATE/sidecar-v20-tests.log` for results and `sidecar-v20-provenance.json` for exact bindings. Historical files remain unchanged.

# v20 historical T realization impact audit

The accessible preserved T inputs do not exhibit the v19 within-report duplicate realization-key defect. Running both v15 `score_T_checked.py` and v19 `score_T_checked_v2.py` against the actual preserved inputs, with fresh temporary output paths, accepted all three phases and produced byte-identical old/new summaries. Each replay also matched its original v7 summary exactly. No historical score change was observed in this inventory.

| Phase | Assigned cases | Initial rows | Explicit free followup rows | Final method outputs | Blind / judgment rows | Within-report duplicate rows |
|---|---:|---:|---:|---:|---:|---:|
| dev-v1 | 6 | 18 | 6 | 18 | 10 / 10 | 0 |
| dev-v2 | 6 | 18 | 6 | 18 | 10 / 10 | 0 |
| eval | 12 | 36 | 12 | 36 | 20 / 20 | 0 |
| Phase-total | 24 | 72 | 24 | 72 | 40 / 40 | 0 |

These are phase totals, not independent unique cases across development versions. All 96 report rows have accessible output files whose returned hashes match. Prepared case IDs are unique within each phase; report prepared hashes match; final case/method key coverage is complete with no unexpected keys. Mapping pair counts are 18, 18, and 36; the completed judgment rows have unique IDs within each phase.

The 24 repeated keys across initial and followup reports are exclusively `free` updates. This is the producer's explicit two-stage behavior (`experiments/v7/tools/realize_T.py:163–169`), retained by the v19 validator. They are not within-report duplicates.

Repair-success true counts, in method order free / typed / exact_extractive, remain dev-v1 2 / 0 / 2, dev-v2 2 / 2 / 2, and eval 4 / 3 / 3. Preserved-and-source-supported true counts remain 4 / 4 / 4 in each development phase and 8 / 8 / 8 in evaluation. No semantic rejudgment was performed.

The filename-scoped local inventory covered 36 existing `journal-v*` directories, excluding `.git`, `.aws`, `.codex`, `.agents`, `node_modules`, `.venv`, and `__pycache__`. It found 42 relevant files: six realization reports, three prepared inputs, three blind inputs, three private mappings, three raw judgments, and 24 summary files. Actual replay inputs are under `V7_PUBLIC` and `V7_PRIVATE`. The 24 summaries comprise three original summaries plus 21 public export copies, grouped into six distinct file hashes. All 24 preserve identical outcome rows and method counts after excluding the redacted blind-judgment payload; all 21 exports declare the matching original summary hash and no semantic rejudgment. Export redactions account for their different whole-file hashes.

There were no traversal errors and no inaccessible required files for the three located phases. Public work/release summaries do not establish separately preserved raw execution sets; none were located by this inventory outside v7. This finding says nothing about remote, deleted, unmounted, excluded-directory, or otherwise unlocated inputs. The scope does not include unrelated v18 aggregate/checker experiments.

Original inventoried files were hash-checked before and after replay and remained unchanged. Realized outputs were read and hash-checked only. Replay outputs were written only into a temporary directory and removed afterwards. No original output, model response, judgment, article, or source was edited. No remote, paid API, model call, or commit was performed.

Evidence: `V20_PRIVATE/historical-impact.json` contains the exact root inventory, input SHA-256 manifest, per-report counts, phase comparison hashes, and public-copy checks. `V20_PRIVATE/audit_historical_impact.py` reproduces the audit without printing article or source text.

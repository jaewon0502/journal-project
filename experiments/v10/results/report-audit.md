# v10 report independent evidence audit

Scope: read-only audit of `results/report.md` against the actual initial/final summaries, calibration summary/report, protection report/tables/access log, independent v1.1 code audit, and narrowly selected private final inputs/results/deliveries. No new research, generation, candidate rewriting, publication, or report editing was performed.

Audited report SHA-256: `a91bba1dc2f1b440f86c5a63dafa26eed3418207d9dd1ff48f651e1ba122e079`. Line references below refer to that version.

## Required corrections

### 1. Significant remaining delivery ambiguity is absent from the report

**Location:** lines 65 and 69–77, discussion of successful state binding and the held synthetic candidate.

The approved, actually delivered KO011 explanation still says `실제 게시 기사 수정이나 최종 확정을 뜻하지 않는다`. This is not merely an unused proposal: the exact string is retained in `/historical-research/journal-v10-private/delivered/f12a64e6ead7b66dbfa6f9ac.json`, alongside `machine_delivery.status=applied`, `released=true`, and `semantic_admission=approved`.

In contrast, the synthetic `25a01f3a9c8795125f5534e2` was rejected because its explanation said the patch was not finally released. Its final raw finding explicitly calls the state-dependent statement contradictory upon approval. The KO011 reader accepted its phrase, apparently allowing the final-confirmation disclaimer to refer to an external/publication scope. The record does not establish that those two scopes are consistently distinguished.

**Correction:** disclose that KO011 retained an accepted but ambiguous finality disclaimer, whereas the synthetic finality disclaimer was rejected. Limit the demonstrated success to machine-generated status/annotation integrity; general free-form explanation consistency remains unresolved. Do not retroactively relabel KO011, change raw judgments, or assert that it definitively fails: this audit identifies an unresolved interpretive inconsistency, not a new adjudicated gold label.

### 2. Shared-package replay is broader than the available dependency evidence supports

**Location:** lines 119–121.

`results/summarize.py` reads `/historical-research/journal-v10-private/reader-results` and `reader-inputs`. `evaluation/results/aggregate.py` hard-codes `/historical-research/journal-v10-private/calibration-results`. Final release/summary construction likewise uses private final inputs/results. `editing-v1_1/reproduce.py` also requires `/historical-research/journal-v9-private` for its real-case step. Thus the raw-response aggregation command paths do not run from a public-only copy of the current tree.

**Correction:** say which operations run from the actual shared package and which require private records. A package-contained recomputation of counts from published summary rows can be described as that; it is not reaggregation from complete native raw responses. If packaging adds a portable replay script or synthetic calibration raws, verify those exact commands and name their narrower scope. Do not fix reproducibility by accidentally redistributing full articles.

### 3. Full source copies exist outside the named private tree; package exclusions are essential

**Location:** lines 47 and 119, claims about private originals and no redistribution.

`evaluation/original-v9/reader-inputs/` contains actual files, not symlinks, with full `source` and `output` text. Examples include:

- KO011: `a11c65a19d8cacd84b88c523.json` and `1a5e8af8491895d287b2b3b4.json` (1,448-character source each).
- EN023: `c0862d34887c8ada0cd33b05.json` and `3dc463c681de47d225ea2888.json` (6,737-character source each).
- Other real-source copies: `9c2d55fc0071b125a98fe3e0.json` (2,367 characters, Korean lunar mission article) and `59df1122c36fddc9b307a0b8.json` (4,155 characters, CBS/Spaceflight source).

**Correction:** explicitly exclude the original-v9 reader-input copies and any equivalent source-bearing files from the shared archive; verify the final archive listing. The report can say original texts are retained in the private working environment, but must not imply they exist only under the `journal-v10-private` directory. The report's own short anchor quotations and source links do not present a full-text publication problem; the copied packet files do.

### 4. The source-evidence table does not render as a Markdown table

**Location:** line 39.

The four-column header is followed immediately by data rows, with no separator row.

**Correction:** insert `|---|---|---|---|` after the header. This makes the source locations and associated limitations legible in the intended table.

## One narrow scope clarification

At lines 73–75, add that the held synthetic candidate's `target_resolution=resolved` belongs to the reviewed edited candidate. After returning the original, the actual final summary records `delivered_target_resolution=not_reassessed_after_hold`. The existing report does not falsely claim all nine delivered outputs resolved their targets; this addition prevents a reader from transferring the accepted numerical clarification to the returned original.

## Confirmed claims; no correction needed

- Nine native writer responses comprise six synthetic cases, two previously exposed real regressions, and one newly acquired NASA scoped normal control. The 12 calibration candidates are author-created, with zero native writer outputs in that calibration branch.
- Native judgments total 51 = 18 initial + 24 calibration + 9 final. These are response counts, not 51 independent cases. The table and prose do not claim otherwise.
- Initial candidates: four edited/five unchanged, five proposed patches. Final local outcomes: three edited releases, five unchanged releases, one held return, four applied patches. Eight initial unanimous approvals are correctly reported; the later-held synthetic was one of them.
- All seven A/B agreement numerators match both summaries. Exact all-axis agreement is 9/12 calibration and 6/9 native initial candidates, independently recalculated from rows.
- Same-runtime separate-context review is correctly distinguished from human or cross-family evaluation. Nothing in these files alone proves stronger access independence, and the report does not claim cross-model validation.
- NASA source has four selected protection rows; the additional N010/N016 limitations are supported. NASA is a no-op normal control, not a correction success. Lines 33/57 correctly limit that result.
- KO011 changes exactly two percent-unit spans. EN023 retains the original reported speech, date assertion, uncertainty/tie, and criticism, adding a bulletin clarification. Both remain partial verification, not whole-article truth certification.
- Synthetic rebuttal preservation is an unchanged-source observation (origin `3d43980ef7ef5ade22b8eb3b`); line 49 is literally supported. It should not be elevated to demonstrated rewriting/compression preservation. The report currently makes no such quantitative claim.
- Access log supports the reported 22:47 direct HTTP 200 results and tool-access failures, without replacement of frozen input. NASA acquisition date/scope and 22:55:23 final completion timestamp match evidence.
- The v1.1 independent audit supports the type-alias fix, four independent adversarial passes, byte-identical 14 fixtures, and equal outputs/annotations under both policies. The report correctly avoids treating that as semantic improvement.
- Calibration contamination (`더 높은`), multi-change date pair, authored expectations not being gold, and proposition/target ambiguity are already materially disclosed. No hidden count reversal or missing failed branch was found in those summaries.

No blocker to completing the report after these narrow corrections and a final package exclusion/replay check. This audit did not modify any candidate or adjudication.

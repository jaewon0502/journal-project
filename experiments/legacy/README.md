# Legacy research archive

This is a public, sanitized derivative of recovered research artifacts, not a byte-identical mirror and not a new experiment. The historical work concerns Korean news synthesis and revision. Generated text may contain errors: it is retained as experimental evidence, not presented as current reporting.

## What was recovered

| Group | Generated Markdown files | Stored rating rows | Scope |
|---|---:|---:|---|
| Original A–D | 54 | 54 | 24 development v1, 6 D-v2 development regressions, 24 evaluation v2 |
| Modules | 20 | 14 initial + 6 additional | 18 synthetic stimuli, 2 real-transfer outputs |
| Repair v3 | 10 | 6 initial + 2 guarded + 4 synthetic | Initial ratings also re-rate 2 earlier outputs |
| Repair v4 | 4 | Separate audits | 3 patched outputs and 1 new baseline |

There are **88 generated Markdown files**. The often-used **74** count is exactly original A–D (54) plus modules (20), not the complete archive. V4 also contains **4 generated synthetic responses inside JSON**, counted separately; they are not extra Markdown files. Ratings, repeated audits, artifacts, and independent experimental cases are different units. No repair-v5 artifact was found in the inspected research directory; this archive makes no claim about its existence elsewhere.

`inventory.json` records the original artifact hash and public derivative hash for selected recovered artifacts. Citation identifiers are replaced consistently by `SRCnnn`; `sources.json` supplies short bibliographic metadata and recovered public news/official-source URLs where available; missing URLs are explicit. The links were checked against recovered metadata, not fetched again for this release. Source article/PDF/HTML bodies, private retrieval paths, private service links and identifiers, prompts containing orchestration, and raw execution logs are excluded. Some source metadata remains unavailable. Line references locate historical extracted text and cannot independently establish support without the omitted source corpus.

## Original comparison

- A: general summary of one article.
- B: neutral rewrite of the same article.
- C: general summary of multiple articles plus primary material.
- D: the same material as C, with a structured verification procedure.

Six development cases were run in all four v1 arms. D was revised on development evidence, producing six D-v2 regression outputs. Six evaluation cases were then run in all four arms using v2. The additional six development outputs do not create six additional cases. A/B versus C/D changes information access as well as procedure; those contrasts cannot isolate a prompt effect. C versus D is the closer same-input comparison.

Original stored gate passes were A/B/C/D = **0/0/0/0 of 6** in development v1, **2/6** for development D-v2, and **0/0/1/1 of 6** in evaluation v2. These are historical AI ratings, not corrected gold labels. `experiment/ratings.json` keeps aggregate rows; `experiment/claim-ratings/` keeps deblinded claim labels, citation positions, core statuses and question statuses. `experiment/cases/` contains short case definitions and rubrics, not full source packets. Historical character counts describe the original texts: sanitizing citation labels changes public text lengths.

## Corrections that must accompany the scores

**Minimum wage, DEV01, F7:** original D-v1 was rated `preserved`, while D-v2 was `partial`. The later blinded consistency audit rated **both partial**. Both preserve the identifiable speaker, assertion strength and distinction from established causality, but omit the limitation to jobs at the minimum-wage boundary. The original core definition did not spell out every later subcondition. Therefore these are rubric/interpretation differences, not proof that v1 preserved that scope. `repair-v3/minimum-wage-consistency.json` retains the later criteria, per-output results and limitations. Original metrics are preserved separately rather than silently overwritten.

**Questions answered is not core retained:** EVAL05-D-v2 originally has all six questions `answered` but only 5/9 core items `preserved`; EVAL03-D-v2 also loses important detail. Broad question coverage can coexist with missing exceptions, dates, criticism or comparison context. Claim support, question coverage, core retention and adoption decisions must be read separately.

**Repair-v3 initial successes did not survive broader checks:** its initial stored ratings can mark patch outputs as passing selected support/core criteria. The guarded follow-up recovered 8/8 and 9/9 listed core items for EVAL03/EVAL05 but still found respectively 2 and 3 major issues; neither was adoption-ready. This is targeted post-failure regression work, not a fresh holdout. Module synthetic performance is 17/18 stimuli (initial 12/12; extension 5/6), not a C–D effect estimate. One initial overediting flag described supported elaboration rather than weakened meaning; the M09A failure concerned omitted explicit responsibility scope.

**Repair-v4 controls edits, not semantic completeness:** actual patches edit two spans in each of three cases. Original lengths were 849→935 and 865→945 for the existing cases, exceeding 900; the new case was 850→896 but remained `hold` because of an ambiguous sentence and an omitted counterargument of unresolved importance. Byte retention and successful rollback do not certify a complete protection list. Two AI evaluators agreed on all five axes for eight fixed questions, including one common `hold`. Those are eight purpose-selected items, not forty independent cases or human validation.

## Replay and limits

Run from this directory with Python 3 (standard library only):

```sh
python verify_archive.py
python -m unittest discover -s repair-v4/patches -p 'test_*.py' -v
```

The patch engine and seven test methods are adapted from the recovered v4 code. Tests replay three actual sanitized before/after fixtures, check unchanged spans and rollback, and exercise wrong hashes, missing/duplicate/overlapping anchors and rollback conflicts. Handwritten minimal pairs test byte operations, not automatic language understanding. The published specs use new hashes for sanitized text and relative paths. Private evidence-input checks are explicitly absent; passing fixture replay is not source revalidation. The CLI refuses to overwrite existing targets; use the tests to replay archived outputs without writing them.

The verifier validates public derivative hashes and row/output counts, prints the stored gate counts, and checks the v4 synthetic edit responses against their synthetic drafts. No model runs are included. Exact model deployment, seed, token usage and cost were not controlled or measured sufficiently for replication. AI judgments are not human gold; this small, selected research sequence does not establish political-bias reduction, reader outcomes, or generalization. The public subset permits score inspection and mechanical replay, not full source-support re-evaluation.

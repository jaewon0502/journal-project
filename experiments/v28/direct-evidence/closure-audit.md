# Independent cessation/restart audit

2026-10-03. Read-only review of the v23–v28 summaries, approach ledgers/counts, v25/v27/v28 lineage, and v28 replay/private records. No network, API, credentials, or model experiment was used by this audit. Following the parent request, this audit fixed the current v28 replay and lineage statement, added synthetic replay tests and a correction addendum, and preserved v27 original reports/evaluations. A separately acquired author slide deck was reported by the parent during the audit; its semantic mapping is being assessed separately.

## Decision

Stopping repeated checklist/prompt variants is justified. Declaring all problems solved, all possible interventions exhausted, or ten independent failures for the same problem is not justified. The record contains concrete unresolved semantic failures and missing evidence. It also contains a small amount of useful local maintenance that can be completed without new data: correct one misleading source-access statement and strengthen the reproducibility checker. These record/code fixes are now complete; they are not another research iteration or new method family. Newly acquired author slides reopen a narrow source-mapping analysis. No claim that all external paths have been exhausted is justified.

## Verified evidence

The requested command completed successfully:

`python3 repository/experiments/v28/replay.py local-workspace/journal-v28-private local-workspace/journal-v27-private/raw`

Output: `15 frozen clean inputs; 1 exact local patch replay passed. No semantic certification.`

Independent read-only checks additionally verified:

- All 29 entries of v28/private-artifact-manifest.json match the private files' byte sizes and SHA-256 hashes.
- All 15 clean records have distinct IDs; they represent 9 distinct final text strings and 5 original-article payloads. The five payloads include the two variants of the single sea-level article; they are not five independent new events.
- All 15 article and sources payloads equal the corresponding v27-private/inputs packets.
- Public/private local-patch.json objects are equal. Local-clean's article and sources equal the C396 input's corresponding fields.
- The one PS replacement and its before/after hashes replay exactly. This checks exact execution, not scientific validity or complete article verification.

No present manifest corruption, source-payload drift, or patch divergence was found.

## Concrete defects fixed

1. **Source-access wording overstates what was inspected.** v27/RESULTS.md:28 says D71's area/similar-size relation was not resolved by the full paper; v28/LINEAGE.md repeats that the full paper did not resolve it. Yet v27/SOURCES.md:14 and v28/SOURCES.md expressly say full-paper access failed previously and was not retried. The available evidence supports “the supplied announcement/expert-comment packet does not resolve the relation; the paper was unavailable,” not an assertion that the full paper was inspected and lacked the answer. The current v28 lineage now corrects this wording; `v28/REPRODUCIBILITY-CORRECTION.md` records the historical v27 wording issue without overwriting v27. A request for a specific relevant method/figure/supplement remains appropriate; lack of a located answer is not evidence that the full paper contains none.

2. **Replay silently disables its checks under Python optimization.** All eight checks in v28/replay.py:10–23 are assert statements. Compiling the existing script with optimize=0 produces eight LOAD_ASSERTION_ERROR instructions; optimize=1 produces zero. The same success print remains. This is a concrete validation-code defect, not evidence that the documented normal invocation failed. Fixed by replacing assertions with explicit validation exceptions. Synthetic tampered-final/source/article/public-patch fixtures now fail both normal and optimized invocation; the real record passes both modes.

3. **Replay's scope is narrower than full provenance verification.** It checks clean-file hashes against a private freeze, four top-level keys, final text against v27 raw, a count of 15, and the private patch. It does not authenticate the freeze/map/patch against the public manifest, compare public/private patch metadata, compare article/sources to v27 input packets, enforce unique IDs/set coverage, or preserve article/sources in local-clean. All these checks can use present files; the extra direct checks above passed. The fixed executable now compares article/sources to v27 inputs, enforces unique mapping and exact ID/file-set coverage, compares public/private patch metadata, preserves article/sources in local-clean, and checks coordinate validity. It still does not authenticate the private map/freeze against the public manifest; the separate 29-entry manifest check passed. This is a bounded reproducibility improvement, not grounds to rerun semantic experiments. Exact-key checks alone also cannot prove absence of evaluative cues embedded in payload text; do not claim semantic blindness from them.

## Accurate method-family counts

The defensible conservative historical lower bounds remain:

| Problem | Tried-family lower bound | Confirmed residual-failure-family lower bound |
|---|---:|---:|
| P1: incomplete protected-meaning inventory | 4 | 1 |
| P2: collateral loss/minimal editing | 8 | 4 |
| P3: factual/semantic/necessity judgment disagreement | 4 | 1 |

P1 families: A01, A02, A03, A10; confirmed residual failure A01.

P2 families: A02, A04, A05, A06, A07, A08, A09, A10; confirmed residual failures A02, A04, A08, A09.

P3 families: A03, A11, A12, A13; confirmed residual failure A11.

These sets overlap. Their union contains 13 identified families A01–A13 across the three different problems; 4+8+4 is not 16 independent approaches. The historical upper bound is unknown. These are traceable conservative ledger counts, not a freshly exhaustive reassignment of every later failure to families.

v23's source exposure control, v24's executable gate, v25's native table-image contrast, v26's integrated regression/counterexample selection, v27's W/T/S granularity contrast, and v28's clean reassessment each add zero independently established families in the supplied lineage. Their distinct bounded contrasts and results should remain visible, but versions, control arms, prompts, outputs, evaluator judgments, and repeated failures are not additional families. No-benefit findings and operational abstention are not automatically factual failures. Ten independent failed approaches to the narrow wrong-referent or attribution problem remain unestablished.

## Meaningful remaining work with current data

- The record/checker fixes above are complete. Eight synthetic mutation tests passed (each runs normal and optimized Python, 16 subprocess checks). The current private records passed both invocation modes. No new article or model run was used.
- Retain D71's S final text as the presently supported local treatment of estimated production without added attribution; leave the original similar-size condition unresolved. Retain the PS local regression repair and its separate audit. Neither is an article-wide accuracy certificate.
- Use the existing v28 distinction between unsupported, false, ambiguous, and optional clarification consistently. In particular, do not restore a universal-quantifier error score for the collective microplastics list, or call a targeted attribution follow-up autonomous detection.
- A v15 dependency-contract transfer into v27 could technically be executed with the present packets, but would be an existing-family implementation/regression, would add fallible relation judgments, and would not establish independent truth. There is no reproduced mechanical closure defect in this audit requiring that study now.
- Additional same-channel reassessments could estimate instability on exposed outputs, but without a new prespecified reproducibility question they simply repeat a documented limitation. They cannot resolve the absent source relation or the editorial standard. Do not generate another report version solely for those repetitions.

## Specific evidence needs and restart conditions

1. **D71 source facts:** a direct method/figure/supplement or author/source statement tying the compared production systems to physical footprint, and direct support for the propositions actually attributed to the expert. A DOI identifies the paper, not a plot, footprint, or endorsed proposition. The absent paper cannot be treated as inspected. No additional prompt can supply these facts.
2. **D72 historical obligation:** the relevant contemporaneous rule or official record for the affected population, with effective dates. A later recommendation alone does not establish or refute an earlier duty or plan. This audit does not make a legal conclusion.
3. **D73 out-of-packet assertions:** the original disease/causality research, interview record, and external statistics actually supporting those clauses. The available blood-study preproof does not automatically support them.
4. **Editorial necessity:** a stated precision policy and threshold for mandatory correction versus optional clarification. Reader/editor evidence may address misleading interpretations; it does not determine source facts. Do not invent a rule solely to make 17/22 versus 80% score as an error.
5. **Generalization/independent relation judgment:** held-out complete article/source/compound-edit packets, independently justified relation annotations or a separately validated resolver, and prespecified source-backed outcomes. An installed compatible checkpoint, evaluation labels, language coverage, compute and cost were not established by the reviewed records. This is unexecuted and availability-unverified, not failed or impossible.

The parent has now acquired `private-evidence/author-slides.pdf` and reports pages 33/34 with real layout dimensions and a simulation denominator. That is a changed source input: a narrow independent mapping of those exact definitions to the disputed article comparison is warranted now. This audit has not independently inspected those pages and does not certify that their dimensions describe the same compared systems or resolve attribution. This concrete mapping work must not be replaced by another preservation-checklist trial. Resume broader semantic experimentation only when the available evidence or judgment capability supports a specified contrast. Ordinary provenance/code maintenance is complete here. The supported conclusion is bounded cessation of redundant trials while concrete unresolved problems remain.

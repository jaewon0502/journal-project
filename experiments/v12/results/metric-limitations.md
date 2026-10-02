# Additional descriptive metrics and limitations

This supplement preserves every raw verdict and fixed reference criterion. It reports 20 judge rows for ten real outputs (four v1 development, two exposed v2 development B reruns, four v2 locked evaluation). Two judges are correlated assessments, not extra experiments. The original score ledger remains authoritative for fixed-reference omission and required-meaning scores. This supplement does not revise those scores or accept new reference extensions.

Run `python journal-v12/code/additional_metrics.py` from the workspace. The code reads private maps, writer IDs, and reviews, emits public quote-free IDs/counts, and cross-checks population totals against `independent-validation.json`. Reproduction needs the private inputs; the public files alone do not recreate semantic judgments. Exact before/after anchors remain in the private reviews and are deliberately excluded here.

## Precision and yield

Precision is supported / (supported + unsupported). Partial and unknown rows are excluded, never silently credited. These fractions describe assessable findings, not all submitted findings; high excluded counts can make perfect fractions misleading. The table's P/U column gives partial/unknown exclusions. Unique means connected roots of explicit `duplicate_of` links among supported rows. It is **not an independently adjudicated semantic-unique yield**. Both KO-DEV v1 A reviews mark F1b as duplicating F1a, but F1b is partial; therefore the supported-root counts remain the supported counts. Missing duplicate links do not prove uniqueness. Atomic decomposition also differs between judges; counts must stay separate. No manual semantic deduplication is performed.

| Output | Judge | Supported/assessable | P/U excluded | Explicit-link unique supported | Observed harmful patch union / proposed |
|---|---|---:|---:|---:|---:|
| v1/KO-DEV-01/A | A | 5/5 | 2/0 | 5 | 0/6 |
| v1/KO-DEV-01/A | B | 6/6 | 1/0 | 6 | 0/6 |
| v1/KO-DEV-01/B | A | 3/3 | 1/0 | 3 | 0/4 |
| v1/KO-DEV-01/B | B | 4/4 | 1/0 | 4 | 0/4 |
| v1/EN-DEV-01/A | A | 6/6 | 1/0 | 6 | 1/8 |
| v1/EN-DEV-01/A | B | 6/6 | 1/0 | 6 | 1/8 |
| v1/EN-DEV-01/B | A | 7/7 | 0/0 | 7 | 2/8 |
| v1/EN-DEV-01/B | B | 7/7 | 0/0 | 7 | 2/8 |
| v2/KO-DEV-01/B | A | 4/4 | 1/0 | 4 | 1/5 |
| v2/KO-DEV-01/B | B | 4/4 | 1/0 | 4 | 0/5 |
| v2/EN-DEV-01/B | A | 5/5 | 1/0 | 5 | 1/5 |
| v2/EN-DEV-01/B | B | 5/5 | 1/0 | 5 | 0/5 |
| v2/KO-EVAL-01/A | A | 7/7 | 1/0 | 7 | 0/5 |
| v2/KO-EVAL-01/A | B | 8/8 | 0/0 | 8 | 0/5 |
| v2/KO-EVAL-01/B | A | 10/10 | 0/0 | 10 | 0/9 |
| v2/KO-EVAL-01/B | B | 8/8 | 2/0 | 8 | 0/9 |
| v2/EN-EVAL-01/A | A | 4/4 | 1/0 | 4 | 0/3 |
| v2/EN-EVAL-01/A | B | 3/4 | 1/0 | 3 | 0/3 |
| v2/EN-EVAL-01/B | A | 3/3 | 2/0 | 3 | 0/3 |
| v2/EN-EVAL-01/B | B | 4/4 | 0/0 | 4 | 0/3 |

The sole unsupported atomic verdict is in EN-EVAL A judge B (3/4 assessable, one further partial excluded). Every other assessable precision fraction is 100%, often with partial exclusions. Same-version paired B-minus-A count and precision differences are stored in JSON. v2 development has no new A output, so no same-version pair is invented; its A baseline is reused from v1 and was not rerun.

## Patch diagnostics and harm

The 56 proposed patches have 112 judge assessments. `new_assertion=yes` occurs 107 times, **not 107 harmful patches**. Of these, 99 assessments also have evidence_justifies_difference=yes and are reported as justified new meaning. Eight have evidence_justifies_difference=no, but all eight also flag meaning loss and overediting. That whole-patch field cannot automatically identify which new assertion is unsupported. Direction-specific unsupported-new-meaning totals remain null rather than invented. Five assessments have no new-assertion flag.

A bounded, explicitly post-hoc reading of existing review reasons identifies strengthening on v1 EN-DEV B P8 in both judges. This is one patch with two observations, not two independent harms. It is recorded separately from raw structured flags; it does not alter any raw verdict. The other mixed justification rows remain direction-specifically unknown, not automatically unsupported additions. No new semantic generation or source re-adjudication was performed.

Loss and overediting are separately reported, with overlapping tags unioned by patch ID. There are eight loss flags and eight overediting flags on the same eight judge-patch rows: three distinct patches agreed by both judges (v1 EN-DEV A P6; v1 EN-DEV B P7/P8), plus two contested patches (v2 KO-DEV B P2; v2 EN-DEV B P2). The any-judge union is therefore **five distinct patches**, not sixteen errors. Four locked outputs have no flagged patch harm in these two reviews; that is absence of recorded flags, not proof of absence of harm. The per-judge observed-union rate uses all proposed patches here because all loss/overedit tags are binary; it is not a complete adjudicated rate for every possible unsupported strengthening.

All raw overediting tags are yes/no, so overediting denominators equal proposed-patch counts. Those labels combine unnecessary loss within otherwise warranted patches with whole-patch overediting. The raw schema does not separately adjudicate the preregistered narrower numerator of patches wholly lacking a discrepancy or justified integration. That narrower normal-text-overediting metric remains unresolved. No edit-distance proxy is substituted.

## Unanswered scope

Each row below gives answered / unanswered / partial / unknown components; acknowledgment refers to explicit `acknowledged_by_writer` labels. Silent gaps count unanswered or partial components marked false. Writer-declared entry counts and per-component question/status/acknowledgment IDs are in JSON. Honest unknown-limit disclosure is not coverage success. Component inventories differ between judges and outputs, and cannot be summed or aligned as an exhaustive common denominator. Answered/(answered+unanswered) in JSON is only the descriptive fraction within that review's inventory; partial/unknown are excluded explicitly. All-unknown or all-partial inventories produce null.

| Output | Judge | Answered / unanswered / partial / unknown | Acknowledged components / total | Silent unanswered or partial |
|---|---|---:|---:|---:|
| v1/KO-DEV-01/A | A | 1 / 0 / 1 / 2 | 3/4 | 1 |
| v1/KO-DEV-01/A | B | 0 / 0 / 1 / 2 | 2/3 | 1 |
| v1/KO-DEV-01/B | A | 3 / 0 / 1 / 0 | 4/4 | 0 |
| v1/KO-DEV-01/B | B | 2 / 0 / 1 / 1 | 4/4 | 0 |
| v1/EN-DEV-01/A | A | 3 / 1 / 1 / 0 | 4/5 | 1 |
| v1/EN-DEV-01/A | B | 2 / 0 / 1 / 1 | 4/4 | 0 |
| v1/EN-DEV-01/B | A | 1 / 1 / 2 / 1 | 4/5 | 1 |
| v1/EN-DEV-01/B | B | 0 / 2 / 1 / 1 | 3/4 | 1 |
| v2/KO-DEV-01/B | A | 2 / 0 / 2 / 0 | 4/4 | 0 |
| v2/KO-DEV-01/B | B | 2 / 0 / 1 / 0 | 3/3 | 0 |
| v2/EN-DEV-01/B | A | 3 / 0 / 1 / 0 | 3/4 | 1 |
| v2/EN-DEV-01/B | B | 3 / 0 / 0 / 0 | 3/3 | 0 |
| v2/KO-EVAL-01/A | A | 3 / 0 / 1 / 0 | 3/4 | 1 |
| v2/KO-EVAL-01/A | B | 0 / 0 / 1 / 1 | 1/2 | 1 |
| v2/KO-EVAL-01/B | A | 1 / 0 / 0 / 2 | 3/3 | 0 |
| v2/KO-EVAL-01/B | B | 1 / 0 / 0 / 2 | 3/3 | 0 |
| v2/EN-EVAL-01/A | A | 1 / 2 / 0 / 1 | 4/4 | 0 |
| v2/EN-EVAL-01/A | B | 2 / 2 / 0 / 1 | 5/5 | 0 |
| v2/EN-EVAL-01/B | A | 2 / 2 / 1 / 0 | 5/5 | 0 |
| v2/EN-EVAL-01/B | B | 0 / 2 / 0 / 1 | 3/3 | 0 |

## Identical-original baseline inconsistencies

Two reference atoms receive inconsistent original_presence ratings despite identical original article hashes:

- **KO-EVAL R09:** both judges say covered for condition A and partial for condition B. The B-side challenge concerns an entitlement unit within a compound reference atom. This is baseline-rating inconsistency on the same original, not content changed by condition B. Any apparent pre/post gain using these different baselines inherits that inconsistency. A shared baseline adjudication and possible atom split are needed before interpreting that gain causally; the frozen score is not silently repaired.
- **EN-EVAL R25:** judge A says absent for condition A and partial for condition B; judge B says partial for both. Again this is the same original. All original observations and matching hashes are retained in JSON.

The protocol's compound atoms, differing finding atomization, unadjudicated semantic duplication, direction-specific patch support, and differing scope inventories limit comparative interpretation. An accepted-extension union and its overlap require the separate extension/counter-audit process; these raw counts do not create acceptance. No claims of population performance, independent validation, or complete unknown-error recall follow from this supplement.

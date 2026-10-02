# v10 report audit closure

This is a narrow closure review of the four corrections and one scope clarification in `report-audit.md`. No new research, model generation, candidate editing, semantic re-adjudication, or additional experiment was performed.

Reviewed report SHA-256: `83f2b2e58e6ada9d8bc901ffe6a87c0cbca35a70769a4b4e0ce21a3494b8cdb0`. The report in `share/results/report.md` matches the working report byte for byte.

| Audit requirement | Status | Verified correction |
|---|---|---|
| Remaining KO011 finality ambiguity | Closed | Report line 76 explicitly discloses the accepted KO011 disclaimer and rejected synthetic disclaimer, says their referents were not shown to be consistently distinguished, preserves original labels, and limits demonstrated improvement to the generated ledger's state/hash consistency. |
| Shared-package replay overclaim | Closed | Report line 122 and `share/README.md` distinguish raw synthetic calibration reaggregation from arithmetic recomputation of disclosed native judgment projections. They explicitly exclude complete natural raw re-audit and new model inference. `share/run_checks.py` uses package-relative inputs for those operations. |
| Full article copies in original-v9 | Closed within stated packaging scope | No `original-v9` paths exist under `share`. Package README explicitly excludes full natural source/candidate texts and expansive raw quotations. `package-validation.json` records no exact full-known-source matches and explicitly limits this check rather than claiming universal detection. The working report now says raw records remain in the private working environment, not exclusively in one directory. |
| Source table rendering | Closed | The four-column separator row is present at report line 40. |
| Reviewed candidate versus held returned original | Closed | Report line 74 explicitly says the resolution label concerns the edited candidate and the returned original was not reassessed; the exact `not_reassessed_after_hold` label is included. |

## Supporting package evidence

`share/results/package-checks.txt` records 15 implementation/regression tests and four independent adversarial tests passing, synthetic calibration raw agreement counts (12/11/12/11/11/11/11 over 12), projected native agreement counts (9/8/7/9/8/9/9 over 9), and the final 8 released/1 held, 3 edited/5 unchanged, four-patch state counts. `results/package-validation.json` records portable temporary-copy execution exit 0. This closure review inspected that existing evidence; it did not claim to independently rerun the suite.

`run_checks.py` recomputes calibration counts, checks initial projected agreement/body-change aggregates, checks final released/edited counts, and enforces the held-target scope marker. It prints other final summary totals. These are mechanical/arithmetic checks, not independent validation of natural-language judgments or every summary field.

## Metadata bookkeeping — closed

The initial 162-versus-163 file-count ambiguity was corrected during closure. `package-validation.json` now names the field `files_scanned_at_validation_step` and explicitly describes its snapshot as preceding the validation record, later closure, and final package metadata. It does not claim to be the final archive entry count. No additional test run was needed for this description change.

All requested report corrections and the bookkeeping clarification are closed. No remaining blocker was found within this narrow closure scope. Final archive entry counting remains ordinary packaging, outside this report audit.

# Separate source-linked review-assertion sidecar

This module implements contract.md and interface-addendum.md as a separate bounded exposed-regression module. It does not modify any frozen receipt implementation, receipt bytes, source or output. It adds exact supplied source/evidence quotations and fixed localized labels for `question_comparison` or `arithmetic`, always stating that supplied review reports an unresolved issue and the sidecar does not independently verify it. An empty supplied list is explicitly not proof that all issues are resolved.

## API and package layout

Keep `sidecar/` next to `portable/`. The module loads `../portable/loader.py`, requests frozen `v1_3`, and checks its original code fingerprint. The portable loader verifies the frozen receipt and legacy dependencies; no new absolute legacy dependency is introduced.

```python
import sidecar
result = sidecar.emit(sidecar_raw, receipt_raw,
    actual_output, actual_candidate, actual_result,
    source, proposal_raw, dependency_raw, patch_audit_raw,
    final_audits, policy='selective')
```

All raw values are bytes, except actual_result (the full exact v10 replay ledger) and final_audits (a sequence of raw JSON bytes). Receipt bytes are the unchanged canonical bytes minted by frozen v1.3. **Language comes from the sidecar input**, not a keyword argument. `build` takes the same arguments and returns immutable `Sidecar.raw` bytes and `.address`. `verify(sidecar, <same arguments>)` regenerates the entire sidecar and rejects any changed fields, issue count, anchors or rendered text. `emit` returns verified text and combined_text, or a fixed verification_failed object without accepting an annotation.

Every call first performs full frozen v1.3 replay verification. It then opens the supplied `receipt_address.path` read-only, binds its exact file hash, and requires `/actual_receipt` to equal the fully verified canonical receipt. A hash, a minimal authored receipt stub or a caller `verified:true` flag cannot substitute for replay. The two designer-supplied generic examples are shape fixtures only; their minimal receipts deliberately fail this stronger end-to-end interface. `developer-replay/` contains separate executable foo/bar examples with full real receipts.

## Supported limits and failure behavior

- Raw sidecar JSON, containing receipt file, and canonical sidecar output: at most 2 MiB each; strict UTF-8/no raw NUL and at most 64 nested JSON containers, inherited from frozen v1.3.
- At most 16 issues and 32 evidence documents. IDs are nonempty, trimmed, contain no control characters and have at most 128 Unicode characters.
- Each nonempty quote span has at most 2,048 UTF-8 bytes. Offsets must be exact integer UTF-8 byte positions with matching supplied text and SHA-256; booleans cannot alias offsets.
- Combined original status annotation plus sidecar: KO at most 1,600 Unicode characters; EN at most 400 whitespace-separated words.
- Exceeding any bound refuses the entire sidecar. There is no truncation, issue dropping, evidence selection, replacement-text synthesis, status reinterpretation, or general exception catch.

All issue and evidence records use exact fields. Duplicate IDs, unknown kinds, changed review status, stale hashes, missing references, invented anchors, partial JSON and modified rendered prose fail. The renderer quotes supplied spans verbatim through JSON string quoting; those quotes remain source/evidence assertions, not verified facts. Source/evidence text, reviewer assertions and filesystem provenance are still supplied trust inputs. Hashes are integrity links, not authentication; no semantic verification or external publication is performed.

## Checks

```sh
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s /historical-research/journal-v11/sidecar -v
PYTHONDONTWRITEBYTECODE=1 python /historical-research/journal-v11/sidecar/reproduce.py
```

The implementation and developer checks did not access private sidecar inputs, confirmation cases or reader outputs. This is an exposed regression module, not independent evidence of semantic improvement.

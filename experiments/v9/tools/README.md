# Bounded selective rollback gate

`selective_rollback.py` is a standard-library-only mechanical gate. It performs
no external calls, semantic scoring, evidence retrieval, or model inference.
The tests use synthetic, hand-authored verdicts. They are mechanical contract
tests, **not semantic experiments or evidence of writing quality**.

## API and state transitions

```python
selection = propose_selection(source_bytes, proposal_raw, dependency_raw, patch_audit_raw)
# selection.candidate is PROVISIONAL, never a release authorization.
result = release_selection(selection, final_audit_raw)
if result.released:
    publishable_bytes = result.output
else:
    original_bytes = result.output
    next_provisional = result.provisional
    # A changed next_provisional needs a fresh independent final audit.
```

No files are written by either function. Callers must preserve returned raw
artifacts, distinguish `released` from `output == source`, and never publish a
provisional candidate. Invalid proposal or initial audits raise an exception
without producing a selection. Invalid final audits return a held result with
the original source, an empty provisional selection, the raw failed audit, and
the error reason. Tampered Selection objects raise rather than release.

Inputs and candidates are bounded to 2 MiB apiece; proposals to 64 patches and
therefore at most 2,016 unique unordered pairs. All hashes are SHA-256 hex of the
exact bytes, including the raw proposal's whitespace. JSON duplicate keys are
rejected. Source and patch text use UTF-8; offsets are bytes.

## Input contracts

The proposal contains `writer_id`, `preimage_sha256`, and `patches`. Each patch
has a unique nonempty string `id`, integer `start` and `end`, exact `before`, and
replacement `after`. Patches are ordered, nonoverlapping original-source spans;
insertions sharing a boundary with another patch are rejected. A no-op draft is
`patches: []`; an individual unchanged patch is invalid.

Both initial audits require `source_sha256`, `proposal_sha256`, `auditor_id`,
`complete: true`, and `read_complete: true`.

* The separate dependency audit has `patch_ids` covering exactly the proposal
  IDs, and `pairs`, each with `ids: ["A", "B"]` and a `relation` of `independent`,
  `dependent`, or `unknown`. Every unordered pair must occur exactly once,
  including independent pairs. No omitted edges imply independence.
* The patch audit has `patch_decisions`, each with an `id` and a `decision` of
  `approved`, `rejected`, or `unknown`. Every patch must occur exactly once.

Writer, dependency auditor, and patch auditor IDs must be distinct. Dependent
and unknown edges form undirected connected components. A rejected or unknown
patch vote blocks the entire component. An unknown edge blocks its endpoints'
whole connected component. Cycles and transitive dependencies are handled
without splitting components. Unrelated approved components stay provisional.

The final audit requires the common audit fields plus:

```json
{
  "auditor_id": "separate-final-auditor",
  "candidate_sha256": "SHA-256 OF EXACT PROVISIONAL BYTES",
  "selected_ids": ["A", "B"],
  "whole_candidate_reviewed": true,
  "decision": "approved",
  "findings": []
}
```

The final auditor ID must differ from all three preceding roles. `selected_ids`
must match exactly. `decision` is `approved`, `rejected`, or `unknown`; only
`approved` can release, and only if no finding requires rollback. Whole-candidate
review is mandatory even for a zero-patch draft. Patch votes alone cannot release.

Each final finding contains unique nonempty `id`, nonempty `description`, a
`relation`, and `patch_ids`:

* `offending` with nonempty selected patch IDs removes all their components from
  the next provisional candidate. Release remains held. The reduced bytes need
  a fresh whole-candidate verdict; the old hash cannot authorize them.
* `unknown`, or `offending` with no localized IDs, holds all changes and reduces
  the next provisional candidate to the source. Unknown relation cannot be
  laundered into a localized safe subset merely by supplying IDs.
* `preexisting_independent` requires an empty ID list. It preserves independent
  approved patches and remains disclosed in the raw final audit. This is an
  auditor assertion, not an inference by this module. A rejected whole-candidate
  verdict still holds release regardless of such a finding.

Every Selection retains the exact source, proposal, dependency audit, and patch
audit bytes. Successive final audit bytes accumulate in `disclosures_raw`;
Release also exposes the current `final_audit_raw`. The gate does not rewrite
raw results or silently turn rejection into approval.

## Verification and limitations

From this experiment directory, run `python -m unittest discover -s tools -v`.
The public release reruns the same 17 mechanical tests; private execution logs are excluded.

This gate enforces a contract, not semantic truth. Distinct auditor IDs and
review flags are assertions, not authenticated identities or proof of independent
reasoning. A trusted caller must bind identities to real reviewers, supply the
intended source, and perform whole-document review against the evidence. Pairwise
classifications cannot establish higher-order independence; the auditor must
conservatively encode any known group dependency as connecting edges, and flag
uncertainty. The final whole-candidate review is essential for missed interactions,
omissions, unsupported additions, and context-dependent defects.

There is no trusted edit-authorization-span policy, durable artifact store,
signature verification, or publishing integration here. Rollback output may
retain defects already in the source; it is not labeled semantically corrected.
Raw inputs of failed initial validation remain the caller's responsibility because
no Selection can be constructed. Bounds intentionally exclude large documents.

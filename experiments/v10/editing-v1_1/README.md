# v10 delivery ledger / 최소편집 전달상태

`delivery.py` is a stdlib wrapper over the existing, read-only v9 engine. A pristine copy is bundled under `vendor/`; its exact SHA-256 is checked at load time. `V10_ENGINE_PATH` can explicitly select another copy with the same required hash. No engine or fixes were modified. No network, API, paid service, or authority escalation is used. No AGENTS.md was present under /workspace at inspection.

## Reproduce

```sh
cd /historical-research/journal-v10/editing
PYTHONDONTWRITEBYTECODE=1 python reproduce.py
PYTHONDONTWRITEBYTECODE=1 python -m unittest -v test_delivery
```

The real-case script requires the existing private v9 inputs at `/historical-research/journal-v9-private`. Generated evidence contains file hashes, compact fragments, and structured delivery notes, never the full source article. Synthetic fixtures contain invented text and exact serialized audit inputs; their hashes can be replayed with `build_delivery`.

## Actual regression

In KO011 the WHOLE reader packet output equals its source (`9d581bc4…`). It retains `1.19%` and `1.43%`. Its common delivery disclosure is exactly the proposal audit's `preexisting_findings`, including “the proposed patch corrects these units”. The selective gate result instead has hash `2ac5f606…` and the added `포인트` units. Reader A accepts the disclosure while distinguishing proposal from application; reader B flags a misleading completion implication and minor new harm. Both label task resolution failed. This disagreement is recorded, not converted to a consensus.

Before: source-only output + proposal-dependent completion prose.
After: source-only output + `status=rolledback`, `applied_ids=[]`, exact output hash, `p1.state=rolledback`, and audit references marked `resolution_not_adjudicated` (not a confirmed remaining error). Selective output separately receives `p1.state=applied` only after replaying the independent, whole-candidate audit for its exact hash.

## Contract

- Exact UTF-8 source-byte ranges and before text are verified by v9. Dependency components remain atomic; independent approved components can survive a rejected component.
- `local_hunks` strips unchanged context with deterministic difflib character matching. A paragraph patch may expose two small unit insertions, still belonging to its original component. Reconstruction is checked. This is a localized representation, **not a claim of globally minimal edit distance or semantic independence**. The signed proposal bytes and final candidate remain unchanged.
- Every final audit transition is replayed. New offending findings require a fresh audit of the reduced candidate; approval of the prior hash cannot release the new bytes.
- `applied` means actual delivered after-bytes; `rolledback` means an excluded/reverted component in the approved or explicit source-only output; `held` means approval is absent or uncertain. `noop` means an empty proposal with final approval, not successful error repair.
- Document status is a summary, not an all-patches verdict: mixed delivery may be `applied` with other components `rolledback` or `held`. Per-component and per-patch states are authoritative.
- Source/output hashes, actual range hashes, proposed after hashes, components, evidence pointers and audit history are deterministic. `verify_delivery` regenerates the entire document, rejects modified prose/fields/states/hashes, and compares exact output bytes. Call it at the final delivery boundary; later edits require regeneration.
- Proposal and final finding prose stays in raw audits. The `unresolved` ledger carries `resolution_not_adjudicated` state with raw-audit SHA-256 and JSON pointer; it never upgrades a proposal claim into repair completion. Even applied patch findings remain unadjudicated at the finding level until separate resolution evidence exists; this does not claim that the original error remains. This deliberately conservative policy can over-disclose; patch application alone does not prove a finding resolved.
- An audit file's digest is integrity binding, not a signature or authenticated identity. Auditor independence is the existing v9 distinct-ID contract, not identity verification.

## Evidence and limits

`evidence/unittest.txt` records 11 passing unittest methods, with KO/EN parameter cases. `synthetic/` has 14 replayable fixtures: baseline and six controlled dimensions in each language (independent good+bad, dependent, new error, unrelated preexisting, normal noop, uncertainty). The dependent case changes only the A/B relation against the good+bad case; others name the baseline reference and factor. These are mechanical contract checks, **not semantic proof, blinded human evaluation, external fact verification, or evidence of editorial-quality gain**. The real case reuses existing audits without new model calls.

`delivery_summary` is a deterministic Korean renderer of actual application/rollback/hold counts, unadjudicated finding count, output hash and limits. It includes no raw proposal/final finding prose. The complete note, including this rendered text, is rechecked by `verify_delivery`.

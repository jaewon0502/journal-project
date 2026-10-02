# v11 receipt interface (stdlib Python)

`import receipt` with `/historical-research/journal-v11/receipt` on sys.path.

`build(actual_output: bytes, actual_candidate: bytes, actual_result: dict, source: bytes, proposal_raw: bytes, dependency_raw: bytes, patch_audit_raw: bytes, final_audits: iterable[bytes] = (), *, policy='selective') -> Receipt`

`actual_result` is the **full exact v10 build_delivery note**, not an intent record or reduced hand-written applied-ID list. `actual_candidate` is `receipt.engine.propose_selection(source, proposal_raw, dependency_raw, patch_audit_raw).candidate` (the initial reviewed candidate; retained on hold). The three raw inputs use unchanged v10 contracts. Patch fields are id, start, end (UTF-8 byte offsets), before, after. Build requires all these actual values and rejects any mismatch through full replay. To adapt a native experiment, make a valid proposal/dependency/patch audit and final gate audit from its explicitly supplied decisions, run the pinned v10 harness to obtain actual_output and actual_result, then pass those exact results. Never reinterpret authored status prose as the actual result.

`emit(receipt, <same positional build args>, lang='EN'|'KO', policy=...)` replays and returns a dict with status verified/verification_failed, receipt_sha256, text. Failure gives only a fixed failure template, never a completion statement. No arbitrary annotation/semantic-facts string is accepted. A semantic claim from an audit remains evidence reference, not a true fact or resolved question.

`Store(absolute_path)` exclusively creates a new store or validates an existing marked store. Parent directories must already exist. `store.put(receipt, <same build args>) -> address`; `store.get(address, <same build args>) -> Receipt`; `store.close()`. Every retrieval repeats exact replay. Receipt.raw is frozen canonical bytes; Receipt.address is its SHA-256.

States: no-op = empty proposal with passed local final review; applied = all proposal patches present; partial = strict nonempty subset present; rolledback = original source output under source_only or validated rejection; abstained = no changes applied because approval is missing/uncertain. Invalid supplied receipts cannot be minted and emit verification_failed. Malformed/stale final audits are retained in replay provenance and produce abstained, not a release. No-op without approval also abstains.

selected_ids means applied to actual output, candidate_selected_ids means selected in initial candidate; rejected_ids includes excluded/rolledback IDs, held_ids means unconfirmed. Exclusion does not prove semantic error. Full original v10 component reasons and every audit hash remain in decision_provenance.

Only local outputs/candidates are handled. No publication handler exists. Hashes are not authentication; caller-selected source, audits, role IDs, and the process filesystem owner remain trusted. The store is write-once through this API, not an OS defense against its owner changing permissions or rewriting it.

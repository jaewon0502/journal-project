# Independent size-only v1.1 follow-up

This report is separate from the preserved original audit and failure logs. No candidate implementation was edited; no hidden confirmation cases were inspected.

Independent implementation diff (`independent.diff`) confirms only a shared 2,097,152-byte receipt bound, constructor/verification/renderer checks, and bounded persistence reads/writes. State computation, receipt schema, serialization, provenance fields, and human templates are unchanged. `SIZE_FIX.md` explicitly changes the contract: oversized expanded receipts now reject at mint. The inherited INTERFACE.md still names the original import directory and does not itself state the limit; the supplemental size contract is needed when using this frozen copy.

## Passing regression evidence

- Original native suite and original adversarial checks 01–05: **14/14 pass** against v1.1 (`run.txt`). The original sixth test and its failing expectations/logs remain unchanged in the parent audit directory; its new-contract rejection is recorded separately.
- Independently generated genuine receipts of **2,097,151** and **2,097,152** bytes mint, verify, render in EN/KO, store, and retrieve successfully. Corresponding patch audits remain below the engine input limit.
- A genuine receipt that would be **2,097,153** bytes rejects at mint with `ValueError: receipt exceeds shared byte limit or is not bytes`. Its raw patch audit is only 2,095,244 bytes.
- Constructor-bypassed oversized objects reject verification, produce the structured failure template, and reject persistence before creating a receipt object (`bypass-test.txt`).
- `results.json` confirms the original 30,000-finding input now rejects at mint with the shared-limit ValueError. Final freeze checks match all 34 original and 39 v1.1 manifested files/dependencies. Only mint rejection was rerun for the large case, avoiding the redundant full oversized rendering/store loop.

The fixed normal-ten comparison belongs to the parent and was not inspected here. Existing renderer/provenance/application-status checks remain passing; this size revision adds no semantic evidence.

## Remaining confirmed boundary issue: uncaught deeply nested audit

Both original and v1.1 `emit` escape with **RecursionError** when supplied a 20,010-byte final audit containing `{"deep":` plus 10,000 nested arrays around `0` and closing delimiters. This is below the raw audit byte limit. The final audit is invalid for the required review schema. Parsing fails before replay can reject its missing fields; `RecursionError` is not among the caught exception types. Therefore the public entry point raises instead of returning its promised fixed verification-failure object.

This issue is inherited, not introduced by the size fix. It produces no applied/completion claim and is not evidence of semantic bypass. A 3,000-level sample instead returns structured `verification_failed`; the original 1,100-level check also remains passing. Accordingly the lower-depth passing check does not cover the demonstrated deeper parser failure.

Evidence: `results.json` contains v1.1 outcomes; `nested-baseline.json` independently records the same exception in the original. The reproducible construction appears in `checks.py`. Remediation remains outside the frozen size-only scope. No fix was applied.

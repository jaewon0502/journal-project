# v1.1: one receipt byte limit

This is a separate copy of the frozen v11 candidate. Only the receipt size contract changed. `MAX_RECEIPT_BYTES = engine.MAX_BYTES = 2,097,152` is shared by receipt construction, verification, rendering, storage creation and storage reads. Oversized receipt bytes are rejected before any receipt object file is created. Stored reads use both an fstat limit and a bounded limit-plus-one read, then check the byte limit again. The inherited marker is also below this limit.

The original defect allowed a 1,590,340-byte patch audit with 30,000 findings to expand into a 6,890,933-byte receipt. Minting, verification and storage creation accepted it, while rendering's parser rejected over 2 MiB and retrieval rejected over 4 MiB. v1.1 rejects this expansion during receipt construction. It does not truncate finding provenance or claim successful delivery.

There are no changes to receipt fields, canonical serialization, identifiers, state rules, human templates, or semantics. Every previously valid receipt within the shared bound has the same bytes and address. The version directory is separate; the receipt schema remains unchanged. `baseline-manifest.json` is an unchanged copy of the original candidate's freeze manifest. The new `frozen-manifest.json` describes this version.

`test_size_contract.py` uses a single evidence-ID ASCII string to tune genuine canonical receipts to 2,097,151 and exactly 2,097,152 bytes. Both boundaries must mint, verify, render in KO/EN, store, and retrieve. Adding one byte must fail minting, while all raw audit inputs still fit the existing parser bound. The tests also exercise the actual 30,000-finding expansion and constructor-bypassed oversized objects to ensure verification, fixed failure rendering and pre-write rejection. These are developer checks, not hidden confirmation cases.

Reproduce:

```sh
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s /historical-research/journal-v11/receipt-v1_1 -v
```

Known limits from the original candidate remain. This size-only change does not repair the separately identified deeply nested malformed JSON exception path, alter absolute legacy dependencies, or add semantic evidence. Those are outside this narrowly scoped follow-up.

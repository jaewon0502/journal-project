# v1.3: explicit UTF-8 JSON byte contract

This final isolated implementation revision retains the v1.1 2 MiB byte bound and v1.2 64-container nesting bound. It adds strict UTF-8 decoding and rejection of raw NUL bytes before the byte-oriented nesting scanner. Both checks run on all proposal/dependency/patch/final JSON inputs and receipt bytes before recursive JSON parsing. Existing ValueError/UnicodeError handling yields the existing fixed verification-failure response. No general exception catch is added.

**Compatibility is tightened.** The old JSON decoder implicitly accepted UTF-16 and UTF-32 encoded bytes through autodetection. Those encodings are now unsupported, even for shallow valid JSON. This is a newly enforced format contract, not a claim about original behavior. Supported byte JSON must be strict UTF-8, optionally with a UTF-8 BOM, and contain no raw NUL byte. An ASCII-encoded JSON escape `\u0000` inside a string remains valid, as do Korean Unicode, escaped quotes and backslashes. Receipt canonical serialization remains UTF-8 without BOM and is unchanged for supported inputs.

Why both checks are needed: some UTF-16/UTF-32 ASCII payloads contain only byte values that can individually decode as UTF-8, plus NUL bytes. Strict UTF-8 decoding alone cannot exclude those payloads. The raw NUL check closes that ambiguity before the scanner interprets quotes and escapes. Neither check rejects the six ASCII bytes of the JSON escape `\u0000`.

`reproduce_encoding.py` records the actual escaped-quote/deep-array bypass across UTF-16LE, UTF-16BE, UTF-32LE and UTF-32BE, each with and without its BOM. The previous v1.2 escapes with RecursionError for all eight 10,000-array inputs; v1.3 returns fixed `verification_failed` for all eight. Complete correctly bound depth-65 audit variants are also rejected before minting. These are developer-authored tests; no hidden confirmation or reader artifacts were opened.

```sh
PYTHONDONTWRITEBYTECODE=1 python /historical-research/journal-v11/receipt-v1_3/reproduce_encoding.py
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s /historical-research/journal-v11/receipt-v1_3 -v
```

There are no semantic, template, receipt field, canonical serialization, identity/authentication or portability changes. The runtime/support limits documented in NESTING_FIX.md continue to apply with this stricter encoding rule. Previous version directories and manifests remain unchanged; inherited reports/evidence describe their historical versions. `v1_2-manifest.json` preserves the immediate prior freeze; `frozen-manifest.json` binds this version.

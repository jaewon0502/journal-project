# v1.2: bounded JSON nesting before recursive parsing

This separate version retains v1.1's shared 2 MiB receipt limit and adds a narrow, nonrecursive JSON resource preflight. It changes no receipt fields, canonical bytes for supported inputs, semantic state rules, or human templates. Previous version directories are untouched.

Supported resource contract:

- Source and each raw JSON input retain the existing engine's 2,097,152-byte limit. Receipts retain the same shared byte limit from v1.1.
- Proposal, dependency audit, patch audit, every final audit, and receipt JSON support at most **64 nested object/array containers**, counting the root container as level one. Strings, escaped quotes, and brackets inside strings do not count.
- The intended runtime is ordinary Python with its default recursion limit (1,000 in the recorded reproduction), without a caller lowering that interpreter-wide setting. Input nesting is checked before recursive decoding, so decoder recursion does not depend on accepting arbitrary input depth.
- Exceeding the supported nesting limit raises ValueError before replay or parsing. Public `emit` turns that into its existing fixed `verification_failed` response with no receipt address or completion claim. Build, verify, and store callers receive the validation error normally.

The scanner is not a replacement JSON parser. Ordinary syntax, duplicate keys, UTF-8 and schema validation remain with the pinned v10 path, preserving its existing malformed-audit behavior. It scans at most each existing bounded input's byte length and uses constant extra state. Unexpected programming failures are not broadly caught: a test injects an application RecursionError into v10 verification and confirms that it still propagates.

`reproduce_nesting.py` demonstrates the actual reported case: a 20,010-byte final-audit JSON object containing 10,000 nested arrays. Original v11 and v1.1 escape with RecursionError during decoding. v1.2 returns the unchanged English failure template. `test_nesting_contract.py` checks that same input in both languages, real valid depth-63/depth-64 metadata, rejected depth-65 metadata, all raw JSON entry paths, a forged receipt, and string escaping.

```sh
PYTHONDONTWRITEBYTECODE=1 python /historical-research/journal-v11/receipt-v1_2/reproduce_nesting.py
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s /historical-research/journal-v11/receipt-v1_2 -v
```

The inherited README, SIZE_FIX.md and older evidence describe their original versions and remain historical records. This document supersedes SIZE_FIX.md's statement that the nested-JSON input issue remains unrepaired. Absolute dependency paths, trusted-input/authentication limits and semantic limitations are unchanged. No hidden confirmation cases or reader materials were accessed. `v1_1-manifest.json` preserves the prior freeze; the new `frozen-manifest.json` binds this version.

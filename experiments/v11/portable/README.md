> Git adaptation: candidate path literals are redacted placeholders. `bundle-manifest.json` binds the public candidate bytes and retains each original receipt hash separately. Original byte identity claims below describe the historical package, not these redacted files. Dependencies are unchanged. Public replay is rerun; historical audit outcomes are not rescored.

# Portable frozen receipt replay

This bundle contains only receipt implementation code, the byte-identical pinned v10 wrapper and engine, and synthetic replay checks. No natural article or hidden confirmation input is copied.

## Explicit adaptation and trust boundary

`loader.load_receipt('v1_1')` verifies `bundle-manifest.json` candidate fingerprints and the two hard-coded legacy dependency hashes. It asserts that the original receipt source contains **exactly one** instance of:

```python
V10 = Path('/historical-research/journal-v10/editing-v1_1/delivery.py')
```

It replaces that assignment **only in memory**, with a `repr`-quoted absolute path to this bundle's `dependencies/delivery.py`, before compiling. Original and executed source hashes and the exact replacement are available in `PORTABLE_REPLAY_PROVENANCE`. This provenance lives on the loaded module; it is not injected into receipt bytes.

The copied receipt source remains byte-identical to the frozen original. The wrapper and engine are never rewritten, even in memory. The unchanged wrapper resolves its engine from its sibling `vendor` directory. An existing `V10_ENGINE_PATH` environment override is rejected, rather than allowing an external engine path. Unset that variable before replay.

This is a documented portability adaptation, not an assertion that executed receipt source bytes are identical to the frozen receipt source. Dependency fingerprint fields remain identical. Hashes establish byte consistency, not authenticated identities. Trusted Python execution, local filesystem owner, and caller-selected audit identities remain the same trust boundary.

## Commands

From any location, after copying this whole directory:

```sh
PYTHONDONTWRITEBYTECODE=1 python /path/to/portable/replay.py
PYTHONDONTWRITEBYTECODE=1 python /path/to/portable/test_portability.py
```

The smoke replay covers applied, partial, rolledback, no-op, and abstained in EN/KO, including persistence round trips. It uses tiny synthetic `a b` / `가 나` inputs only.

To compare with an original frozen loader on a machine where its original legacy path exists:

```sh
PYTHONDONTWRITEBYTECODE=1 python /path/to/portable/replay.py \
  --version v1_1 --reference /path/to/receipt-v1_1 --output parity.json
```

Only this optional reference comparison requires the original loader's absolute dependency path. Normal portable replay does not. `test_portability.py` copies the bundle to a path containing spaces and successfully replays while a read guard rejects any `/historical-research/journal-v10/` byte read.

## v1.2 intake and replay plan

The loader supports both version labels now. An absent future version yields a clear `ValueError`; it is never silently mapped to v1.1. After v1.2 is frozen, load it directly without copying by calling:

```python
from loader import load_receipt
receipt = load_receipt('v1_2', candidate_dir='/path/to/receipt-v1_2')
```

For a self-contained movable bundle, copy only its receipt code with:

```sh
PYTHONDONTWRITEBYTECODE=1 python /path/to/portable/loader.py \
  --version v1_2 --candidate-dir /path/to/receipt-v1_2 --bundle
PYTHONDONTWRITEBYTECODE=1 python /path/to/portable/replay.py \
  --version v1_2 --reference /path/to/receipt-v1_2 --output parity-v1_2.json
```

Intake verifies the frozen candidate's receipt hash and exact legacy dependency fingerprint set, records its origin freeze-manifest hash, refuses to overwrite a different bundled version, and copies no evidence/article files. Intake checks the exact one-assignment substitution prerequisite before writing. Independent semantic comparison or hidden confirmation is not part of this harness.

## Evidence

- `bundle-manifest.json`: original receipt and dependency hashes; original freeze-manifest digest.
- `parity-v1_1.json`: all ten synthetic cases have identical actual inputs, receipt bytes, and annotation dicts under original and portable loaders.
- `portability-tests.txt`: relocation guard, environment override refusal, and explicit unavailable-version checks passed.

Frozen source trees and legacy dependencies are not modified. The portable directory is a separate working deliverable, not a replacement freeze.

## Follow-up versions

v1.2 is now bundled from its confirmed frozen manifest; `parity-v1_2.json` records ten successful synthetic original/portable parity cases. This is execution parity, not a claim that its known encoding-depth issue is fixed. Version label `v1_3` is also supported for the separately requested final UTF-8-contract revision, using the same explicit intake command and provenance rules with `--version v1_3`. It is unavailable until separately bundled.

Final v1.3 is now bundled from manifest `7ad693ff4da32daaeefa18c120746af8cb6f2b1308dbadd7a9732aeddd570777`. `parity-v1_3.json` records ten successful original/portable comparisons. The relocation test now exercises every bundled version, and `portability-tests-final.txt` records that result. All original frozen directories remain unchanged.

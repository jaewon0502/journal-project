# Sidecar implementation binding adapter

The recommended v11 sidecar path is not historical-only: `v11/README.md` says to keep it next to `portable`, and `sidecar.py` explicitly loads portable v1_3. Its original source nevertheless requires receipt hash `3f3a4dc118c4311bd0adef8fe4893cd6d1340ce1e490b445febb7d13464a6014`. The current portable bundle and current frozen receipt-v1_3 source both hash to `120e8c86cce2fc13dee257bde4b19e691f034f69b044ca5d387e2724a3f70e8e`. Thus an unchanged import raises `ValueError: unexpected receipt implementation` before its eight unittest methods can execute. The main checker only recounts stored sidecar judgments, so its green result does not exercise this import.

This diagnoses an interface binding mismatch, not a demonstrated semantic defect or a claim about why historical source bytes changed. In particular, `original_receipt_sha256` means receipt bytes before the portable loader's single in-memory dependency-path replacement; it is not the executed receipt hash. Changing the expected value to the executed hash would be incorrect.

`sidecar_adapter.load_sidecar()` supplies a separate v20 entrypoint. It verifies fixed SHA-256 pins for the original sidecar, portable loader, both receipt copies, delivery wrapper and rollback engine; the original portable loader also checks its bundle manifest and dependency pins. The adapter changes exactly one receipt-hash literal in the verified sidecar source **in memory**, retaining the sidecar's `R.require` assertion. After import it verifies every portable provenance field, including the executed receipt hash computed from the exact single path replacement. A caller-selected root may relocate the same verified files but cannot choose different hashes. The original files and their original failing entrypoint remain untouched. Provenance exposes both original and executed sidecar hashes and both receipt bindings.

Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python -B -m unittest discover -s experiments/v20/code-audit/sidecar -p 'test_*.py' -v
```

Result: **12 methods pass**: 4 new adapter tests and all 8 unchanged sidecar tests, loaded with the verified adapter as their sidecar module. The new tests verify the positive binding, rejection of six individually changed pinned sources, rejection of eight wrong provenance variants, and preservation of the original import failure. These 12 are separate from the original 234-method report; the imported eight are not new authored test methods or model evaluations.

No receipt/sidecar assertions are removed, no historical code is edited, and no models or network resources are called. Sidecar semantics remain supplied review assertions; passing verifies the mechanical contract and implementation binding only. Test and provenance evidence are retained at `V20_PRIVATE/sidecar-v20-tests.log` and `sidecar-v20-provenance.json`; the original failing log is `supplemental-v11-sidecar.log`.

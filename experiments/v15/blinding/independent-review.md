# Independent review — 2026-10-03

All eight supplied synthetic tests pass. Independent synthetic checks additionally confirm exact UTF-8 preservation of Korean, combining characters, emoji, control characters and empty replacement strings; unique sequential IDs across 101 patches; exclusion of extra nested metadata; separate private raw-ID mappings; and rejection of a malformed late patch without changing any input.

The explicit allowlist removes original patch-ID metadata from the public payload and creates new public/private containers. Original IDs remain only in the private mapping unless they also occur in the preserved article or edit text. The helper performs no serialization, file writes or model calls, so the caller remains responsible for storing and sending the two return values separately.

No reproduced correctness defect was found in this scope. The README accurately limits the guarantee to metadata blinding: caller-chosen IDs/order and preserved wording may still reveal conditions, and actual reviewer independence is not established. The function does not validate patch applicability or semantic safety.

Reviewed only `anonymize.py`, `test_anonymize.py`, `README.md`, and additional synthetic tests. No real private article, candidate, assessment, hidden fixture or micro output was read. Implementation was not modified; no model loop was run.

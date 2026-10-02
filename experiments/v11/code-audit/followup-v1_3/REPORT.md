# Independent final frozen v1.3 audit

**No remaining failure was reproduced within the tested boundary scope.** The previous v1.2 encoding-depth bypass now fails closed. This is a separate follow-up result; all original, v1.1, and v1.2 reports and failure evidence remain intact.

Confirmed frozen manifest SHA-256: `7ad693ff4da32daaeefa18c120746af8cb6f2b1308dbadd7a9732aeddd570777`. All **53 listed files plus two legacy dependencies** match. Prior freezes also match. No frozen implementation/evidence was edited; no hidden confirmation or natural article input was inspected.

## Narrow change verified

The independent source diff (`independent.diff`) adds only strict UTF-8 decoding, a raw-NUL rejection, and explanatory docstring text inside the existing nonrecursive preflight. It changes no status rules, receipt fields, templates, provenance serialization, dependency hashes, or exception catch lists.

This is an explicit compatibility restriction: shallow UTF-16/32 JSON previously accepted by the pinned decoder is now unsupported. Both checks are needed because BOM-less ASCII UTF-16/32 can otherwise decode as UTF-8 byte values containing NULs. Escaped JSON `\u0000` is not a raw NUL and remains supported. No broad catch hides unrelated programming recursion errors.

## Independent outcomes

- **Eight encoding variants**—UTF-16LE/BE and UTF-32LE/BE, each with/without BOM—reject the complete, correctly bound depth-65 audit before minting. Their 10,000-array counterparts return structured `verification_failed`, rather than escaping with `RecursionError`.
- The earlier UTF-8 depth behavior is preserved: 63/64 containers accepted, 65 rejected. The earlier 20,024-byte UTF-8 deep sample produces the fixed failure object.
- **Eight malformed UTF-8/raw-NUL byte samples** include isolated continuation, overlong sequence, surrogate encoding, truncated sequence, code point above the Unicode maximum, and three raw-NUL placements. Every sample returns the exact fixed failure template across proposal, dependency, patch-audit, and final-audit paths in both EN and KO. Corrupt stored receipts with these bytes are also rejected.
- **Six independently constructed Korean no-op cases** combine UTF-8 BOM absent/present with 63/64/65-container metadata. Brackets, braces, escaped quotes/backslashes, Korean text, and escaped `\u0000` remain valid at 63/64. These mint and render `no-op`, while explicitly retaining unverified factual truth and unadjudicated question resolution. Depth 65 rejects at mint.
- Quoted delimiter and odd/even slash-run checks pass; leading invalid closers cannot cancel later depth. An unrelated programming `RecursionError` remains visible.
- **20 relevant native tests pass**, including all nine ordinary receipt tests, five nesting tests, four encoding tests, and the two smaller size-contract tests. The already independently established 30,000-finding size-rejection test was deliberately not repeated. Genuine near/exact 2 MiB receipts still verify, render in EN/KO, store, and retrieve; above-limit receipts reject.

Evidence: `results.json`, `boundary-results.json`, `run.txt`, `boundaries.txt`. Reproduce with `PYTHONDONTWRITEBYTECODE=1 python checks.py` and `PYTHONDONTWRITEBYTECODE=1 python boundaries.py` in this directory.

## Portable intake and parity

The exact frozen v1.3 was copied through the previously documented portable intake, which bundles only receipt code and byte-identical pinned dependencies. The loader asserts exactly one in-memory substitution of the absolute V10 assignment; it does not alter frozen disk sources or wrapper/engine code.

`/historical-research/journal-v11/portable/parity-v1_3.json` confirms **10/10 synthetic state/language cases** match the original loader's actual inputs, receipt bytes, and annotation dictionaries. The final relocation test runs all three bundled versions—30 synthetic cases—from a copied directory containing spaces, with a read guard forbidding the original absolute legacy directory. Environment override refusal passes. The historical missing-v1.2 test is explicitly skipped now that v1.2 is bundled; it is not counted as a pass.

## Remaining limits

No new implementation blocker was found in these finite tests. This is not exhaustive parser fuzzing, semantic validation, authenticated provenance, or a hidden confirmation result. It does not establish application-to-semantic-resolution equivalence. Trusted filesystem ownership and supplied audit identities remain the accepted boundary, and intentional unsupported encodings/depth/size now reject rather than claiming successful delivery.

# Pre-code-freeze interface strengthening

This addendum strengthens the already locked contract before implementation freeze; it does not change any case, issue, span, evidence, or reader question. The input lock at 23:50:12 UTC is preserved.

Root requires independent upstream receipt replay, not a caller-supplied verified flag. The implementation accepts sidecar input bytes, actual receipt bytes, and the full exact build arguments for receipt v1.3 through the sibling `../portable/loader.py`. It independently replays/verifies the receipt with those arguments and then checks the sidecar's address/file/canonical-object/output bindings. Merely trusting receipt hashes or a `verified:true` field is insufficient. The two generic examples exercise sidecar shape/anchor handling only; their minimal generic receipts are not end-to-end upstream replay fixtures. Use independent developer replay fixtures when testing full API. Existing production receipt bytes must remain unchanged.

Combined status annotation plus sidecar must fit KO <=1600 Unicode characters, EN <=400 whitespace-separated words. This is a deterministic render budget, not an invitation to omit issues or caveats; fail if exceeded. Status-only uses the same original status annotation and common body/input data. No native writing. The sidecar may use compact output/evidence excerpts only if they are exactly the supplied spans; it must not select different spans after inspection of outcomes.

Freeze this addendum separately with its timestamp/hash before code freeze. No renderer edit after reader outcomes within this bounded regression.

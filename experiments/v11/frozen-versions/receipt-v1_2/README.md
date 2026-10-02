# Local v11 receipt candidate

The prior synthetic final rejected a writer sentence saying the patch was not finally released, because that sentence would conflict with an approving gate. The Korean case passed its exact candidate review. This harness addresses that status-channel coupling: the human annotation can only be rendered after replaying an immutable applied-patch receipt against actual output, actual candidate and the complete actual gate result. It never attaches unrestricted writer explanation. The v10 engine and delivery wrapper are loaded from fingerprinted bytes without editing either file.

Run from any directory:

```sh
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s /historical-research/journal-v11/receipt -v
PYTHONDONTWRITEBYTECODE=1 python /historical-research/journal-v11/receipt/reproduce.py
```

The two `evidence/*-actual.json` pairs reuse the exact existing v10 delivered output and full machine ledger. Other paired records explicitly simulate source_only or missing-final-review hold using the same source and candidate, with no external publication. Both the original local candidate and actual returned output are included; their hashes are distinct where appropriate. The rejected synthetic stays rejected: removing freeform explanation does not constitute a fresh approving review. The approved Korean output remains byte-identical to its existing v10 result.

`developer_examples/` contains exactly four initial developer fixtures, separately labeled and never represented as unseen confirmation evidence. Tests exercise both languages and all five states, byte/ledger mismatches, missing fields, boolean/integer/float aliases, state/prose tampering, stale and malformed audits, no-op without review, source_only, and store corruption/symlink/hardlink/FIFO/legacy-directory collisions. No confirmation cases or calibration contents were read.

The store is content addressed, rejects unsafe path components, uses exclusive creation, and never overwrites objects. Retrieval verifies the address and performs exact replay. A process crash during an exclusive write can leave a partial object; subsequent access fails closed rather than repairing or overwriting it. This is an application-level write-once contract. The trusted filesystem owner could still change permissions and files. Hashes do not authenticate writers or auditors; role IDs and all supplied semantic audits remain caller-provided trust inputs. There is no signature verification, independent fact research, semantic resolution inference, or actual publication operation.

Semantic truth and question resolution are always separate, explicit unverified/unadjudicated fields. This deliberately avoids claiming that applied patches prove correctness. Structured finding references preserve provenance without copying unrestricted prose. The fixed annotation omits detailed non-status reasoning from the old writer explanation; this information loss is a limitation for independent reader evaluation, not evidence of improved explanation quality.

See INTERFACE.md for the exact adapter contract. `frozen-manifest.json` records the candidate source and all initial evidence hashes; it excludes itself. This local candidate is ready for independent confirmation, not demonstrated semantic superiority.

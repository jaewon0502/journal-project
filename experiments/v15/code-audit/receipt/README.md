# PR1: receipt path collision — reproduced and repaired in a v15 derivative

The archived CLI has a real data-loss defect: `spec_path.with_suffix('.log.json')` is written with truncating `write_text()` after exclusive output creation. For `case.spec.json` with output `case.spec.log.json`, the CLI exits 0 while replacing the requested patched bytes with receipt JSON. Its `after_sha256` then describes bytes no longer present at the output path. A receipt path that names the source, evidence, another existing receipt, or a symlink/hardlink to an input likewise overwrites existing data.

## Version and scope

`patch_engine.py` here is the repaired executable derivative. The archived file at `experiments/legacy/repair-v4/patches/patch_engine.py` remains unchanged because it is covered by the archive inventory's public hash:

`6be5edc905bf62daafeb26e383f0fe7ede0167acf3a0912c10b1f0e002c7b6a8`

Use the v15 executable for new CLI operations. The archive is historical evidence and retains the defect; no original output, rating, evaluation, spec, or inventory was rewritten. This is a local correctness repair, not evidence of a semantic or model-performance improvement. All reproduction inputs are synthetic and created in temporary directories.

## Repair

The receipt filename convention stays compatible. Both destinations must be distinct after path resolution, separate from the spec/source/evidence inputs, and absent (including dangling symlinks). Existing hardlinks are rejected by the existence check. All collision checks, byte patching, rollback verification and receipt serialization precede writes. Both files use exclusive creation, so a newly appearing file is never truncated. The receipt is reserved first, ensuring an already occupied receipt cannot cause an output write.

This is not a two-file transactional publication protocol: an I/O failure or concurrent creator after preflight may leave an empty receipt or partial new output; callers must require successful CLI completion. Adversarial concurrent replacement of ancestor directories is outside this local-tool repair. Ordinary exclusive creation prevents existing-file truncation, but no generalized race-free directory confinement is claimed.

## Observed regression results

`cli-evidence.json` records **20 actual subprocess CLI scenarios** for both engines. The archived CLI violates the contract in 9, including result/receipt equality, source/evidence collisions, existing receipt, symlink and hardlink aliases, dangling receipt symlinks, and lexical `..` aliases. The repaired CLI passes all 20: 4 valid runs produce exact patched bytes plus correct receipt hashes; 16 rejected layouts exit nonzero without creating or changing files. The valid cases specifically cover `.log.json` spec, source and output names, showing the suffix alone is not forbidden. Result/source, result/spec, result/evidence, existing result and result-link collisions are checked too. A receipt equal to a distinct regular spec cannot arise directly from this suffix transform; the receipt-to-spec symlink case tests its reachable alias form.

`archive-impact.json` confirms all **138 inventory hashes** remain intact. For the three public sanitized historical specs (EVAL03, EVAL05, NEW01), the repaired and archived in-memory patch operations yield identical archived output bytes and receipts, with exact rollback. Their declared source and output paths do not collide with the derived receipt paths. The 7 archived regression methods pass unchanged.

This supports **no observed impact on the retained public fixture outputs**. A follow-up read-only inspection also located original private v4 artifacts in the retained project research tree. The four named intake locations (project, deliverables, v6 intake, Git intake) were searched by filenames and manifests; the project tree contained all three original specs and their derived receipts, plus an extended NEW01 receipt. `private-impact-summary.json` exports only case IDs, hashes, counts and boolean checks—no private text, input paths, inverse payloads or raw receipts.

For **all three original cases**, source hashes match both spec and receipt, output hashes match receipt, fixed-engine replay reproduces the original output bytes exactly, receipt core fields equal the regenerated receipt, and rollback yields the exact original source. The extended NEW01 receipt also matches original input/output hashes and rolls back exactly. All **6 evidence-input hash checks** pass. All **59 files** in the original v4 tree are byte-unchanged before and after this read-only audit. Original source/output/receipt paths are distinct in every retained case. The original engine hash also matches the archive inventory's original artifact hash (`d456b986f105f224e436b4bc66ff669b87212dbc732ff2790648ffb90ba3992c`).

Therefore **no receipt-collision damage was detected in the retained original results**. This does not establish the absence of discarded or unretained executions. Source support, evaluation scores and the historical model conclusions were not recomputed or changed.

## Reproduce

From repository root (Python standard library only):

```sh
python -m unittest discover -s experiments/v15/code-audit/receipt -p 'test_*.py' -v
python experiments/v15/code-audit/receipt/test_receipt_paths.py --evidence
python experiments/v15/code-audit/receipt/check_archive_impact.py
python -m unittest discover -s experiments/legacy/repair-v4/patches -p 'test_*.py' -v
```

To execute a new authorized spec, pass its path to `python experiments/v15/code-audit/receipt/patch_engine.py PATH`. Relative source, evidence and output paths remain relative to the spec directory. The output and generated receipt must both be new.

The private check can be repeated only where authorized original artifacts remain available:

```sh
python experiments/v15/code-audit/receipt/check_private_impact.py /LOCAL/RESEARCH/repair-v4
```

It reads originals in place and prints a sanitized summary; it does not execute the original CLI or copy any original document.

### 길이 주석의 범위

수정판은 이전 receipt 형식과 비교할 수 있도록 `length_limit: 900` 및 `length_pass` 메타데이터를 유지한다. 이 값은 옛 실험의 길이 주석이며 이 도구는 그 값으로 쓰기를 거부하지 않는다. v15 전체기사 실험은 길이 상한을 두지 않는다. 따라서 이 필드를 현재 기사의 합격 기준이나 사용자의 분량 요구로 해석해서는 안 된다. 이번 수정의 검증 범위는 경로 충돌·기존 파일 보존·정확 적용/복원이다.

# Reproducibility and source-access correction

2026-10-03. This addendum preserves the v27 original reports, outputs, and evaluations.

The sentence in v27/RESULTS.md:28 about the area/similar-size condition not being resolved by the full paper is misleading. v27/SOURCES.md explicitly records unsuccessful full-paper access and no retry. The available announcement/expert-comment packet did not resolve the condition; the record does not establish what an inspected full paper would resolve. v28/LINEAGE.md now states that distinction. Later author-slide evidence is a separate acquisition and must be assessed on its own exact relation to the article.

The original v28 replay passed its documented normal invocation. Its eight assertions were nevertheless disabled by Python optimization, leaving a misleading success print. The checker now uses explicit runtime validation, compares each article/source payload with its v27 input packet, checks map/ID/file coverage, compares public/private patch metadata, validates coordinates, and checks local article/source preservation. The v27 input directory defaults to `V27_RAW_DIR/../inputs`, with `--v27-input-dir` available for other layouts.

Validation: the existing private records pass both normal Python and `python3 -O`. `python3 experiments/v28/test_replay.py` passes eight synthetic tests, each under normal and optimized invocation (16 subprocess checks). They cover a valid packet, changed final text, changed source/article payloads even with an updated freeze, changed local source/article payloads, a public/private patch discrepancy, and duplicate output mapping. Temporary fixtures contain synthetic text only and are deleted after testing.

Separately, all 29 public private-artifact-manifest entries matched actual private byte sizes and hashes. Fifteen clean records correspond to nine distinct final strings; public/private patch objects matched. These are provenance and exact-application findings, not new semantic accuracy results or additional method families.

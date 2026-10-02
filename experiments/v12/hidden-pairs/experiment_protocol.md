# Fixed synthetic detector experiment, initial method lock

The experiment contains six authored fictional bases (KO3/EN3), two candidates per base, and two procedures per candidate: 24 procedure items. H0 performs generic source/candidate consistency checking and smallest repair. H1 uses the same source/candidate/question plus independently source-generated QA, explicit semantic answer agreement, and counterexample checks in both directions. Exact instructions and output schema are in `shared_instruction.txt`, `H0_method.txt`, `H1_method.txt`, and `output_schema.json`.

## Split and execution

Before any detector outputs, sort opaque base IDs lexicographically within each language. Assign the first Korean base and first two English bases to development (KO1/EN2); assign the remaining bases to heldout (KO2/EN1). Keep both candidates and both procedures for a base together. This yields 12 development and 12 heldout procedure items. Run development first. Do not inspect heldout packet contents or run heldout until the final method is frozen. The private mapping is for subsequent scoring and must not be included in detector context.

Each detector invocation receives only one complete locked packet. Use the same native runtime/model/version/settings, one fresh invocation per packet, equal generation-token ceilings, and the same tool policy and retry rule for H0 and H1. Do not supply expected labels, other candidate packets, validation commentary, pair membership, or results. Detector work must use supplied text only. Record actual runtime settings, tokens, latency, retries and errors. This preparer does not choose an unverified native model or launch detectors.

The same response schema and response budget apply: at most 300 English words or 1,000 Korean characters across non-anchor string values, excluding only exact copied source_anchor and candidate_anchor spans. Repairs count toward the budget. Equal output budget does not mean equal total input/preprocessing budget.

The source-only QA file is fixed for both phases. At most one development-informed method revision may be made before heldout execution. If used, preserve this initial lock, create a new version of the affected method packets, state the exact change and its development-only rationale, and freeze all revised heldout input hashes before any heldout output. Do not modify source, candidates, QA, expected labels, split or original candidate freeze. A method adjustment is not a new candidate. If no adjustment is made, use these exact locked packets in both phases.

Score development and heldout separately: detection on injected errors, false positives on normal controls, valid minimal repairs, unresolved/unknown decisions, and budget adherence. Report pair-level outcomes and denominators; do not relabel unknowns as successes. All original twelve candidates remain unchanged.

## Limitations

- Six authored synthetic base contexts, three per language, with twelve authored candidates; not real-news outcomes or natural error discovery.
- The source-first questions were frozen before that separate agent inspected candidates; the original candidate files had already been authored. Do not claim questions predate candidate authoring.
- The independent validator accepted all six normal/mutant pairs, but three mutants contain internal tension that can shortcut source-grounded detection; numerical anchors also make one reversal conspicuous.
- H1 adds nineteen independently source-generated QA records across the six sources, plus explicit answer-agreement and two-direction counterexample instructions. This is an information-plus-procedure intervention with additional preprocessing, not a pure equal-token prompt effect.
- Both procedures share the underlying source, fixed broad question, candidate, output schema, output limit and required native runtime configuration. H1 necessarily has longer input; input-token and preprocessing costs must be reported separately.
- The development/heldout split is deterministic by base ID within language, not random or balanced by error factor; each split has only three base contexts. Candidate roles and procedures are correlated within each base.
- Validation was separate-agent same-AI review, not human validation. The author, questionmaker and detector roles must be distinguished.
- Same-runtime/model conclusions cannot establish external validity, large-sample accuracy, generation-quality improvements, or a winning architecture.

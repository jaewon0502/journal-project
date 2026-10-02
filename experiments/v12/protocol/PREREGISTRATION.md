# v12: unprimed omission discovery and minimum-edit fidelity

Status: development method v1. The development freeze manifest fixes this protocol, exact serialized prompts and scoring schema before writer execution; each provisional reference is separately frozen before its outputs. One documented adaptation may precede locked evaluation. Any unlogged post-freeze change is a deviation, not a preregistered choice.

## Claim and limits

Test whether a source-first reverse-coverage procedure, followed by typed relation checks and a minimum patch, discovers more source-supported omissions than a general evidence audit without adding unsupported scope or strengthening meaning. Receipt quality and delivery of already-known issues are not evidence of new discovery. The four real-news packets support a small, descriptive paired comparison, not a population performance estimate. Authored minimal pairs are a separate mechanism probe.

All writers, curators, counter-auditors, and graders are internal AI of the same model family. Separation of roles reduces direct contamination but cannot establish independence from shared blind spots. Reference requirements are provisional, never gold. Model deployment, seed, native-fork internals, and cost may be unknown; record rather than infer them.

## Real-news sample and split

- Acquire four fresh ordinary news articles, each with relevant primary evidence: two Korean and two English. Do not select because an omission, ambiguity, or failure is known. Log acquisition time, article/source dates and URLs, retrieval status, selection reason, and selection order.
- Assign the first eligible article in each language to development and the second to locked evaluation. If acquisition order has already been assigned independently, record that assignment before output generation. Replacement is permitted only for inaccessible, duplicate-event, non-news, missing-primary-evidence, or inadequate-source packets; log exclusion before seeing condition outputs.
- Match conditions within each packet. Both receive byte-identical article, primary evidence excerpts, questions, instructions about external access, and output budget. Freeze source boundaries; neither condition browses beyond them during a scored run.
- The comparison has two development packets and two locked evaluation packets, one per language in each split. Language is descriptive context, not a subgroup claim.

## Roles, blindness, and order

1. Packet acquisition records article and primary evidence without annotating known defects.
2. Before any condition output, an independent curator derives atomic provisional required meanings and omission opportunities from the sources and broad questions. The curator may then inspect the article to classify already expressed versus absent meaning. Preserve the source-first draft and the article-comparison layer separately.
3. A separate counter-auditor, also before condition outputs, challenges reference completeness, source support, question alignment, and article-presence judgments. Preserve disagreements and excluded/partial items. Neither curator nor counter-auditor sees condition outputs or writers' prompts beyond shared task scope.
4. Writers receive only the shared packet and their condition prompt. They receive no required-meaning list, opportunities, known-issue checklist, curator annotations, synthetic labels, or previous-run feedback. Use fresh native forks with the same visible runtime configuration and no cross-condition conversation history.
5. Start conditions in opposite order across the two packets in each split (KO A then B, EN B then A); record actual start/end times. This controls observed order only, not deployment drift or hidden runtime differences.
6. Grade anonymized outputs in randomized display order against sources and the preregistered provisional reference. A finding outside the frozen reference must be assessed on its evidence, not rejected because it is absent from the reference.
7. After the two initial evaluations, a third auditor examines ALL eight primary real-news outputs (four packets × two methods), including all-pass/no-flag outputs, with sources and original article available. First inspect paragraphs and cross-paragraph relations directly, without the earlier judges' verdicts; then inspect disagreements and reference omissions. Do not select only contested outputs. This is an internal shared-blind-spot check, not an independent human truth standard.

Here “source-only” question generation means the generator sees the complete original article plus primary evidence as the source packet, never a method-produced candidate or an old defect list. Preserve primary-evidence-first extraction as a useful substep, but do not deprive the question generator of the original article. The separate pre-output counter-auditor challenges both missing questions and incomplete answer keys.

## Two conditions

A — General evidence audit: read the article, evidence, and questions; find consequential missing or inaccurate meaning; provide only supported findings and the smallest justified edits. No reverse-coverage template or typed-slot checklist is prescribed.

B — Reverse coverage plus typed relations: first derive question-relevant atomic claims from primary evidence; map each to article coverage (covered, partial, absent, uncertain); inspect the claims' actor/attribution, modality or causal status, quantity/qualifier, temporal relation, and scope; then report only supported discrepancies and produce the smallest justified patch. Slots guide how evidence is represented; they do not assert that any slot contains a defect.

Both conditions use the same public output schema and budget. The output schema contains findings, source receipts, exact local patch proposals, and unanswered scope. Intermediate reasoning or a filled private worksheet is neither required nor scored. The shared requested reader-facing narrative budget is at most 900 English words or 3,500 Korean Unicode characters, excluding JSON keys and copied exact anchors. Report both narrative and total output lengths. There is no finding-count cap; do not suppress consequential findings to satisfy an item count. This is a requested output cap, not a measure of reasoning effort. If the runtime cannot enforce it, use the same requested cap and record observed lengths/violations. A truncation is an execution outcome and must not be silently rerun.

## Questions and required-meaning alignment

Broad questions define relevance; they are not exhaustive answer keys. Use identical broad questions for both conditions on each article. Use Q1: What occurred or was proposed, and what is its status? Q2: What does the primary evidence establish and not establish? Q3: What conditions, comparisons, affected groups, or counterarguments are materially needed to understand the event? Article-specific questions may identify the event or topic but must not name a suspected missing detail.

For each provisional required meaning, record: stable ID; one atomic proposition; exact primary-evidence receipt; broad-question ID; why omission would materially change an answer; article coverage span or absence judgment; confidence; and counter-auditor challenge. A key is eligible only if source support, material relevance, and baseline article absence/partial absence can be adjudicated. Not every fact in the source is required. Do not turn broad questions into an unlimited obligation to reproduce the source.

Answerability alone is insufficient. For each assessed question/key atom, compare the source answer, candidate answer, and their exact anchors for semantic agreement, including speaker, modality, condition, time, scope, and counterargument where relevant. “The candidate answers the question” cannot receive coverage credit if its answer changes those relations. Judges must also inspect paragraph claims and cross-paragraph relations not represented by any question, and log reference gaps separately.

Separate (a) all eligible required meanings, including meanings already present in the article, from (b) eligible omission opportunities in the unmodified article. This prevents counting preserved article content as newly discovered omissions. Split partially expressed meanings into an already covered atom and a missing atom when justified; otherwise label partial/unknown and exclude from success denominators while reporting it.

## Findings and reference revision

An atomic supported finding identifies a concrete article discrepancy or consequential omission, supplies an adequate source receipt, and falls within the broad-question scope. Deduplicate repeated versions of the same missing proposition; one output item may contain multiple atomic findings. A correct general observation without a concrete article discrepancy is not a discovery.

“Previously unlisted discovery” means a supported finding absent from the frozen provisional reference and absent from all task-visible annotations. This is a bounded operational category, not proof that no human or model previously knew the issue. Also report ordinary unprimed discovery of frozen-reference omissions: none was disclosed to writers. Seeded authored-test findings never count as real unknown discoveries.

Use the result wording “additional defects verified within the audited sample.” Do not call this unknown-error recall: the universe of unknown errors has no known denominator. Keep three provenance classes explicit: naturally occurring article/method-output defects; artificial hidden perturbations; and post hoc grader labels or reference extensions. Labels never retroactively make an item seeded, and artificial perturbations never become natural performance observations.

For a finding outside the reference, a blind grader records a proposed extension and a counter-auditor checks it against sources, article, and question scope. Keep the original-reference score and an explicitly labeled extended-reference sensitivity score; do not silently repair the denominator in favor of a condition. Compare both outputs against the union of accepted extensions. Unresolved extensions remain unknown and are reported separately.

## Descriptive metrics; no invented pass thresholds

Report per packet and condition, with atomic-item evidence and exact denominators. Show paired B-minus-A differences and the raw counts; do not pool away disagreements. No significance tests, superiority threshold, or aggregate weighted score are preregistered.

1. Supported findings: supported atomic findings / all assessable atomic findings, with unsupported and unknown counts. Also show unique supported findings, to distinguish precision from yield.
2. Omission discovery: eligible frozen-reference omission atoms identified / eligible frozen-reference omission atoms. Report all provisional reference atoms and excluded partial/unknown atoms alongside the denominator. Zero eligible opportunities yields N/A, not perfect performance.
3. Required-meaning coverage: eligible frozen-reference required atoms represented in the article after applying proposed patches / all eligible required atoms. Also report pre-patch coverage and the change, so preservation cannot masquerade as discovery. If no patch is proposed, evaluate the original article.
4. Previously unlisted discovery: accepted supported real-packet omissions absent from the frozen reference; count independently for each condition and show overlap. Provide receipts and reference-extension adjudication, not just a total.
5. Patch harm: count proposed patches containing unsupported/overscoped additions or semantic strengthening; report over all assessable proposed patches. Tag overlapping harms separately and give a deduplicated harmful-patch total. Strengthening includes turning approximate into exact, attributed into asserted, possible into certain, association into causation, or a bounded statement into an unbounded one. Preservation of original source words does not establish preservation of meaning.
6. Normal-text overediting: patches to text without an adjudicated discrepancy or justified omission integration, / all assessable patches. Show exact before/after spans, and separately describe avoidable extra rewritten text inside otherwise justified patches. Do not use raw edit distance as a semantic verdict.
7. Unanswered scope: broad-question components left unanswered or not assessable in the final article/output. Distinguish writer-acknowledged evidence limits from silent gaps; honest limitation disclosure is not coverage success. Use a provisional component inventory and report unknown/partial components outside the success denominator.

Unknown or partially adjudicable items never enter a success numerator or eligible denominator. Report their counts, reasons, and possible effect on interpretation. Include unsupported findings even when no edit follows; include harmful edits even when their associated finding is correct. Unchanged controls and no-patch outputs remain valid outcomes.

For each proposed edit, test both directions at the edited clause and affected relations: can the original be true while the edit is false (possible new assertion), and can the edit be true while the original is false (possible content loss)? Give a concrete counterexample when one exists. This is a diagnostic, not a blanket equivalence requirement: primary evidence may justify correcting a genuine error. Record that justification. Do not demand equivalence of the entire original and patched article, since a supported omission repair intentionally adds information. Score location detection, successful repair, false positive, new assertion, content loss, and unknown separately; a detected location is not automatically a successful repair.

## Small authored diagnostic suite

Freeze the delegated hidden-pairs agent's six bases/twelve items before locked evaluation; do not launch a second suite. Use tiny self-contained invented news/source excerpts, not modified real evaluation packets. Each pair differs in one semantic relation; order and identifiers conceal which version is altered. Score source support and exact local correction, not fluency. Include faithful adversarial controls within that item budget, including justified criticism that must not be softened merely for sounding negative. Keep authored tests out of real-news totals. The hidden-pairs manifest fixes the exact implemented categories.

The actual six relation categories, exact paired text, faithful controls, and hidden labels are owned by the hidden-pairs manifest. Do not infer that unimplemented candidate categories were tested. The normal member of each pair is its faithful control; the suite contains twelve total items, with no additional two-item control set.

For pair comparisons, record detection on the altered member, restraint on the faithful member, and whether the proposed patch fixes only the manipulated relation. Negative controls measure false positive editing. This suite checks constructed mechanisms; it cannot estimate ordinary-news frequency or unknown-issue discovery.

## Development, single adaptation, and freeze

Run both conditions on the two development packets; inspect failures. At most one documented method adaptation is permitted, using development evidence only. Record the previous prompt, exact replacement, motivating development failure, and expected effect. If adapted, rerun both conditions on development only if needed for interpretability, label exposure, and preserve earlier outputs. Do not describe reused development results as held out. Freeze final prompts/reference/scoring and authored tests before opening locked outputs. Locked evaluation runs each final condition once per packet; preserve runtime failures and truncations. Any necessary rerun is labeled a deviation and both outputs retained.

The “10 failed approaches” rule means record genuinely distinct attempted approaches and whether the same failure recurs. Do not manufacture ten approaches, relabel repeated runs as approaches, or claim ten failures from fewer attempts. A failed-approach log may contain fewer than ten rows. Distinguish methods, prompt revisions, execution repeats, and authored test cases.

## Timing and deliverables

Target window: 00:30–03:10 experiments; 03:10–03:25 report. At the experiment cutoff, preserve incomplete runs as incomplete; do not compress unresolved adjudication into success. Freeze timing uses the actual observed clock and timezone.

Deliverables: packet/acquisition manifest; source-first curator drafts and article-comparison layers; counter-audits; freeze hash manifest; exact condition prompts; runtime metadata and raw outputs; atomic scoring ledger; reference extensions/disagreements; development adaptation and failed-approach logs; separate real-news and authored-test results; deviations and remaining blockers. Store within the local workspace. No external writes or personal data are needed.

## Research inspiration and actual implementation

QuestEval §§3–4 distinguishes source-to-summary recall from summary-to-source consistency; §4.2 explicitly notes that answerability can accept an incorrect answer. v12 borrows the source-first direction and checks semantic agreement of anchored answers. It does not implement QuestEval's trained question generator, answerer, saliency model, F1 formula, or reported benchmark. [QuestEval PDF](https://aclanthology.org/2021.emnlp-main.529.pdf)

SummEdits §4.2 verifies a seed, makes atomic local edits, and labels the result consistent, inconsistent, or borderline. v12 borrows validated faithful controls, small localized perturbations, and explicit unresolved cases. Its internal AI labels, tiny suite, relation categories, and direct repair task are v12 choices, not a replication of SummEdits or its human validation. [SummEdits PDF](https://aclanthology.org/2023.emnlp-main.600.pdf)

FaithBench §2 selects challenging detector-disagreement groups, and its limitations caution against extending rankings to all samples. v12 uses this as a reason to distinguish stress-test evidence from ordinary-sample evidence and audits all primary outputs, including no-flag cases. It does not reproduce FaithBench's multi-family detectors or expert human annotation. [FaithBench PDF](https://aclanthology.org/2025.naacl-short.38.pdf)

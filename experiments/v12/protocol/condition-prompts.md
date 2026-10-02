# Shared task wrapper

Audit the supplied news article against its supplied primary evidence, within the broad questions below. Identify consequential missing or inaccurate meaning and propose the smallest supported local edits. Evidence may be incomplete; say what cannot be determined. Work only from this packet. Do not infer a defect merely because the task asks for an audit. Preserve faithful text. An edit must not strengthen certainty, exactness, attribution, causality, timing, or scope beyond the evidence.

Output under the same frozen budget, in the article's language:

- Findings: each distinct discrepancy or omission; the article span or insertion point; the exact evidence receipt; why it matters to a broad question; confidence or unresolved limitation.
- Minimum patch: exact original and replacement text, or an exact insertion point and insertion text. If no justified change is found, say so.
- Unanswered scope: questions or components not answerable from the available packet.

For any edit, compare the changed clause and affected relations in both directions: could the original be true and the edit false, or vice versa? If the edit adds a claim or loses content, retain it only when the primary evidence justifies that specific correction or omission repair. Inspect paragraph claims and cross-paragraph relations even if no supplied question names them. A question counts as covered only when the source and article answers agree in meaning, including relevant speaker, modality, condition, time, scope, and counterargument.

[ARTICLE]
[PRIMARY EVIDENCE WITH STABLE RECEIPT IDS]
Q1: What occurred or was proposed, and what is its status?
Q2: What does the primary evidence establish and not establish?
Q3: What conditions, comparisons, affected groups, or counterarguments are materially needed to understand the event?
Reader-facing narrative budget: at most 900 English words or 3,500 Korean Unicode characters, excluding JSON keys and copied exact anchors. There is no finding-count cap. Report narrative length and total output length separately. The runtime may enforce this only as a requested cap; do not claim exact enforcement without evidence.

# Condition A addition

Perform a general evidence audit. Read the article, evidence, and questions carefully, check factual fidelity and consequential missing context, and produce the shared output.

# Condition B addition

Before proposing edits, work from the primary evidence toward the article. Derive atomic question-relevant source claims and map each to article coverage: covered, partial, absent, or uncertain. For these claims, check actor and attribution; modality and causal status; quantity and qualifiers; temporal relation; and scope. Treat these as representation slots, not a list of expected defects. Use the resulting coverage gaps and relation mismatches to produce the shared output and the smallest supported patches.

# Freeze notes

Replace placeholders identically for A and B on a packet. Do not include references, opportunities, prior findings, or synthetic labels. Record exact serialized prompts and hashes. The common fidelity warning intentionally holds minimum-edit standards constant; the method comparison concerns the source-first procedure, not unequal warnings about strengthening.

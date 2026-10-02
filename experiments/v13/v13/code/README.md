# Deterministic v13 gates

Requires Python 3 and jsonschema. No model calls. Engine and mechanics fixtures were authored from PREREGISTRATION.md before reviewing study data or results. The developer did not read v12 source/results. Fixture judgments are handcrafted code-mechanics inputs, never study observations.

Prepare wrapper: `python code/gate.py prepare bundle.json review_input.json`

Evaluate shared reviews: `python code/gate.py evaluate bundle.json review1.json review2.json gate_output.json`

Mechanics check: `cd code && python -m unittest -v test_gate`

Input file uses the author's unchanged contract: bundle_id, source_documents (id/url/paragraphs with id/text), original_article, questions, proposed_patches (id/before/after/reason/evidence_ids), source_scope_note. Inputs must have unique proposal IDs and source paragraph IDs. Offsets are derived from unique exact before strings in the original; overlapping proposals are held. Nonunique anchors are held even if a reviewer approves. Application is simultaneous by descending original Unicode span offsets.

input_sha256 hashes exact file bytes. source_sha256 and patches_sha256 hash canonical JSON arrays (UTF-8, sorted object keys, compact separators, non-ASCII unescaped); original_sha256 hashes original UTF-8 string. Reviewer wrappers contain both binding and unchanged parsed input, plus full candidate or application errors. Hashes are not embedded into input bytes. The exact reviewer JSON objects are additionally hashed canonically in gate output; retain raw files separately for provenance.

Both gates use exactly the same two reviews. Missing/invalid fields, incorrect coverage, hashes or evidence quotes hold the bundle; confidence cannot override fields. All five patch fields require unanimous yes. G1 unions dependencies from both reviewers and iteratively removes patches depending on held patches; cycles may survive only if every member survives. Unknown dependencies hold the patch and its dependents. Unlocalized global new/edit-related risk or unknown issue relation holds all. A material/unknown issue mapped to IDs holds those IDs. Documented unrelated original gaps do not hold G1, while any unresolved background issue holds G0. Preference differences are a separate nonblocking array. G0 additionally holds the entire bundle if any proposal is held. Empty valid proposal bundles return no_op; invalid reviews still hold.

No gate status certifies final safety. Every output is a pre-audit proposal with final_audit_required=true. A separate independent audit must evaluate the whole delivered candidate, including dependency cycles, changed adjacency, retained meaning and residual original errors. No data-driven tuning or automatic repair is performed.

FREEZE_GATE.json pins preregistration, reviewer instructions/schema, engine and mechanics fixtures before model reviews. Subsequent deviations, if unavoidable, must be explicitly logged rather than silently replacing frozen behavior.

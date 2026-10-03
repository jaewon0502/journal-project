"""Authored mechanical fixtures, not real article evaluations or human judgments."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import gate


def encoded(value):
    return gate.canonical(value)


def fixture():
    # P2/P5 reproduce only the relation structure disclosed in the v14 report.
    # All text and judgments below are synthetic; the original v14 inputs are absent.
    bundle = {"bundle_id": "synthetic-relations-v1",
              "original_article": "제목: 모든 항목이 바뀐다.\n본문: 둘째 항목이 바뀐다.\n배경: 회의는 월요일이다.",
              "evidence_documents": [{"id": "S1", "text": "첫째 항목이 바뀐다. 회의는 화요일이다."}],
              "proposed_patches": [
                  {"id": "P2", "before": "모든 항목", "after": "첫째 항목", "kind": "necessary_correction"},
                  {"id": "P5", "before": "둘째 항목", "after": "첫째 항목", "kind": "necessary_correction"},
                  {"id": "P9", "before": "월요일", "after": "화요일", "kind": "necessary_correction"}]}
    binding = gate.prepare(encoded(bundle))["binding"]
    review = {"reviewer_id": "R1", "binding": binding, "complete": True, "read_complete": True,
              "patch_assessments": [
                  {"patch_id": p["id"], "kind": p["kind"], **{k: "yes" for k in gate.AXES},
                   "atomic": "yes", "related_context": [], "required_dependencies": [],
                   "relation_status": "complete", "anchors": [{"document_id": "S1", "quote": "첫째 항목이 바뀐다."}],
                   "reason": "Authored synthetic judgment; not a semantic evaluation."}
                  for p in bundle["proposed_patches"]]}
    second = copy.deepcopy(review)
    second["reviewer_id"] = "R2"
    return bundle, [review, second]


def run(bundle, reviews, audit=None):
    return gate.evaluate(encoded(bundle), [encoded(r) for r in reviews], None if audit is None else encoded(audit))


def final_audit(result):
    return {"auditor_id": "R3", "binding": result["audit_binding"], "complete": True,
            "read_complete": True, "full_candidate_assessed": True,
            "assessed_patch_ids": result["selected_ids"], "unassessed_spans": [], "verdict": "approve",
            "anchors": [{"document_id": "candidate", "quote": result["candidate_text"]}],
            "reason": "Authored synthetic audit for gate testing only."}


class RelationGateTests(unittest.TestCase):
    def setUp(self):
        self.bundle, self.reviews = fixture()

    def refresh_binding(self):
        binding = gate.prepare(encoded(self.bundle))["binding"]
        for review in self.reviews:
            review["binding"] = binding

    def assess(self, pid):
        return [next(p for p in r["patch_assessments"] if p["patch_id"] == pid) for r in self.reviews]

    def relate(self, pid, required=(), related=()):
        for p in self.assess(pid):
            p["required_dependencies"] = list(required)
            p["related_context"] = list(related)

    def reject_patch(self, pid):
        for p in self.assess(pid):
            p["necessity"] = "no"

    def test_report_derived_p5_related_to_held_p2_is_selected(self):
        self.reject_patch("P2")
        self.relate("P5", related=["P2"])
        result = run(self.bundle, self.reviews)
        self.assertEqual(["P5", "P9"], result["selected_ids"])
        self.assertEqual("제목: 모든 항목이 바뀐다.\n본문: 첫째 항목이 바뀐다.\n배경: 회의는 화요일이다.", result["candidate_text"])
        self.assertEqual("awaiting_audit", result["status"])
        self.assertFalse(result["publication_allowed"])

    def test_required_chain_propagates_hold_to_fixed_point(self):
        self.reject_patch("P9")
        self.relate("P5", required=["P9"])
        self.relate("P2", required=["P5"])
        result = run(self.bundle, self.reviews)
        self.assertEqual([], result["selected_ids"])
        self.assertIn("required dependency held: P5", result["reasons"]["P2"])
        self.assertEqual(self.bundle["original_article"], result["candidate_text"])

    def test_required_cycle_is_all_or_none(self):
        self.relate("P2", required=["P5"])
        self.relate("P5", required=["P2"])
        self.assertEqual(["P2", "P5", "P9"], run(self.bundle, self.reviews)["selected_ids"])
        self.reject_patch("P2")
        self.assertEqual(["P9"], run(self.bundle, self.reviews)["selected_ids"])

    def test_required_vs_related_disagreement_holds_local_patch(self):
        first, second = self.assess("P5")
        first["required_dependencies"] = ["P2"]
        second["related_context"] = ["P2"]
        result = run(self.bundle, self.reviews)
        self.assertEqual(["P2", "P9"], result["selected_ids"])
        self.assertTrue(any("disagreement" in reason for reason in result["reasons"]["P5"]))

    def test_related_annotation_difference_does_not_become_required_dependency(self):
        self.reject_patch("P2")
        self.assess("P5")[0]["related_context"] = ["P2"]
        result = run(self.bundle, self.reviews)
        self.assertEqual(["P5", "P9"], result["selected_ids"])
        self.assertIn("P5", result["relation_notes"])
        self.assertEqual("awaiting_audit", result["status"])
        self.assertFalse(result["publication_allowed"])

    def test_relation_order_does_not_create_disagreement(self):
        self.assess("P5")[0]["related_context"] = ["P2", "P9"]
        self.assess("P5")[1]["related_context"] = ["P9", "P2"]
        self.assertIn("P5", run(self.bundle, self.reviews)["selected_ids"])

    def test_unknown_relations_hold_only_affected_patch_and_dependants(self):
        self.assess("P5")[0]["relation_status"] = "unknown"
        self.relate("P2", required=["P5"])
        result = run(self.bundle, self.reviews)
        self.assertEqual(["P9"], result["selected_ids"])
        self.assertEqual([], result["validation_errors"])

    def test_missing_unknown_duplicate_ids_fail_validation(self):
        def missing(r): r["patch_assessments"].pop()
        def unknown(r): r["patch_assessments"][0].update(patch_id="ABSENT")
        def duplicate(r): r["patch_assessments"].append(copy.deepcopy(r["patch_assessments"][0]))
        for mutate in (missing, unknown, duplicate):
            with self.subTest(mutate=mutate.__name__):
                reviews = copy.deepcopy(self.reviews)
                mutate(reviews[0])
                self.assertEqual("validation_failed", run(self.bundle, reviews)["status"])

    def test_unknown_duplicate_self_or_conflicting_relation_ids_fail_validation(self):
        for updates in ({"required_dependencies": ["ABSENT"]}, {"related_context": ["P2", "P2"]},
                        {"required_dependencies": ["P5"]},
                        {"related_context": ["P2"], "required_dependencies": ["P2"]}):
            with self.subTest(updates=updates):
                reviews = copy.deepcopy(self.reviews)
                reviews[0]["patch_assessments"][1].update(updates)
                self.assertEqual("validation_failed", run(self.bundle, reviews)["status"])

    def test_optional_enrichment_and_mixed_atomic_patch_are_held(self):
        self.bundle["proposed_patches"][1]["kind"] = "optional_enrichment"
        for p in self.assess("P5"):
            p["kind"] = "optional_enrichment"
        self.assess("P2")[0]["atomic"] = "no"
        self.refresh_binding()
        self.assertEqual(["P9"], run(self.bundle, self.reviews)["selected_ids"])

    def test_kind_disagreement_is_local_hold(self):
        self.assess("P5")[0]["kind"] = "optional_enrichment"
        self.assertEqual(["P2", "P9"], run(self.bundle, self.reviews)["selected_ids"])

    def test_non_yes_axes_cannot_be_overridden_by_other_reviewer(self):
        for axis in gate.AXES:
            for value in ("no", "unknown"):
                with self.subTest(axis=axis, value=value):
                    reviews = copy.deepcopy(self.reviews)
                    reviews[0]["patch_assessments"][1][axis] = value
                    self.assertNotIn("P5", run(self.bundle, reviews)["selected_ids"])

    def test_missing_or_inexact_evidence_anchor_fails_validation(self):
        for anchors in ([], [{"document_id": "MISSING", "quote": "첫째"}],
                        [{"document_id": "S1", "quote": "never present"}]):
            with self.subTest(anchors=anchors):
                reviews = copy.deepcopy(self.reviews)
                reviews[0]["patch_assessments"][0]["anchors"] = anchors
                self.assertEqual("validation_failed", run(self.bundle, reviews)["status"])

    def test_invalid_original_spans_and_duplicate_proposals_fail_validation(self):
        for problem in ("absent", "nonunique", "overlap", "duplicate", "unchanged"):
            with self.subTest(problem=problem):
                bundle = copy.deepcopy(self.bundle)
                if problem == "absent": bundle["proposed_patches"][0]["before"] = "not present"
                if problem == "nonunique": bundle["original_article"] += " 모든 항목"
                if problem == "overlap": bundle["proposed_patches"][1]["before"] = "제목: 모든 항목"
                if problem == "duplicate": bundle["proposed_patches"].append(copy.deepcopy(bundle["proposed_patches"][0]))
                if problem == "unchanged": bundle["proposed_patches"][0]["after"] = "모든 항목"
                self.assertEqual("validation_failed", run(bundle, self.reviews)["status"])

    def test_empty_proposals_are_noop_not_semantic_certification(self):
        self.bundle["proposed_patches"] = []
        self.refresh_binding()
        for r in self.reviews:
            r["patch_assessments"] = []
        result = run(self.bundle, self.reviews)
        self.assertEqual("no_op", result["status"])
        self.assertEqual(self.bundle["original_article"], result["candidate_text"])
        with_audit = run(self.bundle, self.reviews, final_audit(result))
        self.assertEqual("no_op", with_audit["status"])
        self.assertFalse(with_audit["semantic_certification"])
        self.assertFalse(with_audit["publication_allowed"])

    def test_exact_candidate_audit_is_required_for_approval(self):
        result = run(self.bundle, self.reviews)
        self.assertEqual("awaiting_audit", result["status"])
        approved = run(self.bundle, self.reviews, final_audit(result))
        self.assertEqual("approved", approved["status"])
        self.assertTrue(approved["publication_allowed"])
        self.assertFalse(approved["semantic_certification"])

    def test_unassessed_candidate_text_or_patch_blocks_audit(self):
        result = run(self.bundle, self.reviews)
        for updates in ({"full_candidate_assessed": False}, {"assessed_patch_ids": ["P2", "P5"]},
                        {"unassessed_spans": [{"document_id": "candidate", "quote": "배경:"}]},
                        {"verdict": "unknown"}, {"read_complete": False}, {"auditor_id": "R1"}):
            with self.subTest(updates=updates):
                audit = final_audit(result)
                audit.update(updates)
                rejected = run(self.bundle, self.reviews, audit)
                self.assertEqual("audit_rejected", rejected["status"])
                self.assertFalse(rejected["publication_allowed"])

    def test_stale_or_corrupt_review_input_is_rejected(self):
        raw = encoded(self.bundle)
        cases = [raw + b" ", raw.replace("월요일".encode(), "금요일".encode())]
        for bundle_raw in cases:
            with self.subTest(bundle_raw=bundle_raw[-20:]):
                result = gate.evaluate(bundle_raw, [encoded(r) for r in self.reviews])
                self.assertEqual("validation_failed", result["status"])
        self.assertEqual("validation_failed", gate.evaluate(raw, [b"{", encoded(self.reviews[1])])["status"])

    def test_stale_audit_binds_candidate_selection_input_and_exact_reviews(self):
        result = run(self.bundle, self.reviews)
        for field, value in (("candidate_sha256", "0" * 64), ("selected_ids", ["P5"]),
                             ("input_sha256", "0" * 64), ("selection_sha256", "0" * 64)):
            with self.subTest(field=field):
                audit = copy.deepcopy(final_audit(result))
                audit["binding"][field] = value
                self.assertEqual("audit_rejected", run(self.bundle, self.reviews, audit)["status"])
        audit = final_audit(result)
        self.reviews[0]["patch_assessments"][0]["reason"] += " changed after audit"
        self.assertEqual("audit_rejected", run(self.bundle, self.reviews, audit)["status"])

    def test_whitespace_change_in_review_invalidates_prior_audit(self):
        result = run(self.bundle, self.reviews)
        output = gate.evaluate(encoded(self.bundle), [encoded(self.reviews[0]) + b"\n", encoded(self.reviews[1])],
                               encoded(final_audit(result)))
        self.assertEqual("audit_rejected", output["status"])

    def test_corrupt_audit_is_rejected_without_losing_provisional_candidate(self):
        output = gate.evaluate(encoded(self.bundle), [encoded(r) for r in self.reviews], b"{")
        self.assertEqual("audit_rejected", output["status"])
        self.assertEqual(["P2", "P5", "P9"], output["selected_ids"])
        self.assertFalse(output["publication_allowed"])

    def test_missing_unknown_fields_and_duplicate_json_keys_fail_closed(self):
        for raw in (b'{"bundle_id":"one","bundle_id":"two"}',
                    encoded({**self.bundle, "related_patches": []}), b'{"value":NaN}',
                    encoded(self.bundle).replace(b'"bundle_id":', b'"bundle_id_missing":')):
            with self.subTest(raw=raw[:80]):
                self.assertEqual("validation_failed", gate.evaluate(raw, [encoded(r) for r in self.reviews])["status"])

    def test_incomplete_same_reviewer_or_wrong_review_count_fail_closed(self):
        cases = [self.reviews[:1], [self.reviews[0], copy.deepcopy(self.reviews[0])]]
        incomplete = copy.deepcopy(self.reviews)
        incomplete[0]["read_complete"] = False
        cases.append(incomplete)
        for reviews in cases:
            with self.subTest(reviews=len(reviews)):
                self.assertEqual("validation_failed", run(self.bundle, reviews)["status"])

    def test_duplicate_reserved_evidence_ids_and_invalid_unicode_fail_closed(self):
        for doc in ({"id": "S1", "text": "duplicate"}, {"id": "original", "text": "reserved"},
                    {"id": "candidate", "text": "reserved"}):
            with self.subTest(doc=doc):
                bundle = copy.deepcopy(self.bundle)
                bundle["evidence_documents"].append(doc)
                self.assertEqual("validation_failed", run(bundle, self.reviews)["status"])
        raw = encoded(self.bundle).replace(b'"synthetic-relations-v1"', b'"\\ud800"')
        self.assertEqual("validation_failed", gate.evaluate(raw, [encoded(r) for r in self.reviews])["status"])

    def test_cli_prepare_evaluate_and_reject(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            for name, value in (("bundle", self.bundle), ("r1", self.reviews[0]), ("r2", self.reviews[1])):
                (folder / name).write_bytes(encoded(value))
            script = str(Path(gate.__file__))
            subprocess.run([sys.executable, script, "prepare", str(folder / "bundle"), str(folder / "prepared")], check=True)
            self.assertIn("full_proposed_candidate", json.loads((folder / "prepared").read_bytes()))
            args = [sys.executable, script, "evaluate", *(str(folder / name) for name in ("bundle", "r1", "r2", "output"))]
            subprocess.run(args, check=True)
            self.assertEqual("awaiting_audit", json.loads((folder / "output").read_bytes())["status"])
            (folder / "r1").write_bytes(b"{")
            failed = subprocess.run(args, check=False)
            self.assertEqual(2, failed.returncode)
            self.assertFalse(json.loads((folder / "output").read_bytes())["publication_allowed"])
            (folder / "r1").unlink()
            self.assertEqual(2, subprocess.run(args, check=False).returncode)
            self.assertEqual("validation_failed", json.loads((folder / "output").read_bytes())["status"])


if __name__ == "__main__":
    unittest.main()

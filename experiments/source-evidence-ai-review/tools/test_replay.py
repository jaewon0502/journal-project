"""Mutation tests use copies of the actual public inputs, never the originals.

Run: python3 -m unittest discover -s experiments/source-evidence-ai-review/tools -v
"""

import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import replay


def by_id(rows, value):
    return next(row for row in rows if row["id"] == value)


class PublicReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.package = Path(self.temp.name) / "package"
        self.package.mkdir()
        shutil.copytree(replay.PACKAGE / "data", self.package / "data")
        shutil.copy2(replay.PACKAGE / "PUBLIC-DERIVATION.json", self.package)
        self.data = replay.load_package(self.package)

    def reject_mutation(self, mutate, diagnostic=None):
        data = copy.deepcopy(self.data)
        mutate(data)
        result = replay.validate(data)
        self.assertFalse(result["ok"], result)
        self.assertTrue(result["errors"], result)
        if diagnostic:
            self.assertIn(diagnostic, " ".join(result["errors"]))
        return result

    def test_actual_public_records_reaggregate_without_source_accuracy_claims(self):
        before = copy.deepcopy(self.data)
        result = replay.validate(self.package)
        self.assertTrue(result["ok"], result["errors"])
        self.assertEqual(result, replay.validate(self.data))
        self.assertEqual(before, self.data, "validate must not modify its inputs")
        summary = result["public_replay"]
        self.assertEqual(summary["source_first_unit_counts"], {"AI1": 27, "AI2": 26, "AI3": 22})
        self.assertEqual(summary["importance_candidates_per_reviewer"], dict.fromkeys(["AI1", "AI2", "AI3"], 6))
        self.assertEqual(summary["primary_unanimous_items"], 18)
        self.assertEqual(summary["challenger_agreement_with_each_primary"], dict.fromkeys(["AI1", "AI2", "AI3"], 18))
        self.assertEqual((summary["followup_inputs"], summary["followup_accepted"]), (7, 7))
        self.assertEqual((summary["wording_edits"], summary["unchanged_sentences"]), (6, 12))
        self.assertEqual((summary["source_answer_records"], summary["locator_structures_checked"]), (12, 55))
        self.assertIsNone(summary["semantic_accuracy_score"])
        self.assertIsNone(summary["unknown_gold"])
        archived = result["recorded_archival_checks"]
        self.assertFalse(archived["reexecuted_against_originals"])
        self.assertEqual((archived["source_audit_hash_checks"], archived["source_audit_locators"],
                          archived["local_validation_hash_checks"], archived["local_validation_quote_anchor_checks"]),
                         (26, 55, 35, 172))
        self.assertEqual(result["preserved_source_answer_metadata"]["warnings"],
                         self.data["archived-source-audit"]["warnings"])

    def test_regression_changed_id_set_cannot_hide_unverified_final_wording(self):
        # The old changed-ID-only check still passes this corrupted final text.
        cases_path = self.package / "data" / "cases.json"
        cases = self.data["cases"]
        by_id(cases["final_sentences"], "S05")["text"] += " 검증하지 않은 추가 문구."
        changed = {row["id"] for row in cases["final_sentences"]
                   if row["text"] != by_id(cases["initial_sentences"], row["id"])["text"]}
        self.assertEqual(changed, replay.REPAIRS)
        cases_path.write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
        result = replay.validate(self.package)
        self.assertFalse(result["ok"])
        self.assertIn("S05/V1: final text differs from actual verification input", result["errors"][0])

    def test_regression_cli_reported_errors_exit_nonzero(self):
        # Exercise the real command, not only the importable validator: previously
        # errors in a collected result could still leave the process at exit 0.
        path = self.package / "data" / "candidate-reviews.json"
        original = path.read_text(encoding="utf-8")
        baseline = subprocess.run([sys.executable, str(Path(replay.__file__))],
                                  cwd=self.temp.name, capture_output=True, text=True)
        self.assertEqual(baseline.returncode, 0, baseline.stderr)
        self.assertTrue(json.loads(baseline.stdout)["ok"])
        invalid = copy.deepcopy(self.data["candidate-reviews"])
        invalid["reviews"][0]["sentences"][0]["decision"] = "UNKNOWN"
        for contents, diagnostic in ((json.dumps(invalid), "unknown decision"), ("{", "JSONDecodeError")):
            with self.subTest(diagnostic=diagnostic):
                path.write_text(contents, encoding="utf-8")
                process = subprocess.run([sys.executable, str(Path(replay.__file__)), "--package", str(self.package)],
                                         capture_output=True, text=True)
                self.assertNotEqual(process.returncode, 0)
                result = json.loads(process.stdout)
                self.assertFalse(result["ok"])
                self.assertTrue(result["errors"])
                self.assertIn(diagnostic, process.stderr)
        path.write_text(original, encoding="utf-8")

    def test_every_exact_text_link_is_bound(self):
        mutations = [
            (lambda d: by_id(d["followup"]["changes"], "S05").update(before="changed before"), "changes.before"),
            (lambda d: by_id(d["candidate-reviews"]["reviews"][0]["sentences"], "S05").update(minimal_repair="changed repair"), "minimal_repair"),
            (lambda d: by_id(d["followup"]["changes"], "S05").update(after="changed after"), "minimal_repair"),
            (lambda d: by_id(d["followup"]["inputs"], "V1").update(text="changed input"), "actual verification input"),
            (lambda d: by_id(d["cases"]["final_sentences"], "S05").update(text="changed final"), "final text"),
        ]
        for mutate, diagnostic in mutations:
            with self.subTest(diagnostic=diagnostic):
                self.reject_mutation(mutate, diagnostic)

    def test_supported_wording_and_s08_evidence_only_intervention_are_preserved(self):
        mutations = [
            (lambda d: by_id(d["cases"]["final_sentences"], "S01").update(text="changed supported sentence"), "original supported wording changed"),
            (lambda d: by_id(d["cases"]["final_sentences"], "S05").update(wording_changed=False), "wording_changed"),
            (lambda d: by_id(d["followup"]["changes"], "S08").update(kind="meaning_repair"), "change kind"),
            (lambda d: by_id(d["cases"]["final_sentences"], "S08").update(evidence_scope="BOK six paragraphs"), "evidence scope"),
            (lambda d: by_id(d["followup"]["judgments"], "V4")["evidence"].update(source_id="BOK-20241011"), "supplementary evidence"),
        ]
        for mutate, diagnostic in mutations:
            with self.subTest(diagnostic=diagnostic):
                self.reject_mutation(mutate, diagnostic)

    def test_duplicate_and_missing_ids_are_rejected_at_each_stage(self):
        selectors = [
            lambda d: d["cases"]["initial_sentences"],
            lambda d: d["cases"]["final_sentences"],
            lambda d: d["source-first"]["reports"][0]["units"],
            lambda d: d["candidate-reviews"]["reviews"][0]["importance"],
            lambda d: d["candidate-reviews"]["reviews"][0]["sentences"],
            lambda d: d["challenger"]["sentences"],
            lambda d: d["followup"]["inputs"],
            lambda d: d["followup"]["changes"],
            lambda d: d["followup"]["judgments"],
            lambda d: d["source-answers"]["records"],
        ]
        for number, select in enumerate(selectors):
            with self.subTest(stage=number, mutation="duplicate"):
                self.reject_mutation(lambda d: select(d).append(copy.deepcopy(select(d)[0])), "duplicate")
            with self.subTest(stage=number, mutation="missing"):
                self.reject_mutation(lambda d: select(d).pop(), "missing or unexpected IDs")

    def test_unknown_labels_and_changed_recorded_agreements_are_rejected(self):
        mutations = [
            lambda d: d["cases"]["initial_sentences"][0].update(intended="unknown"),
            lambda d: d["source-first"]["reports"][0]["units"][0].update(importance="unknown"),
            lambda d: d["candidate-reviews"]["reviews"][0]["importance"][0].update(rating="unknown"),
            lambda d: d["challenger"]["sentences"][0].update(decision="unknown"),
            lambda d: d["followup"]["judgments"][0].update(decision="unknown"),
            lambda d: d["candidate-reviews"]["reviews"][0]["sentences"][0].update(decision="accept"),
            lambda d: d["challenger"]["sentences"][0].update(decision="accept"),
        ]
        for number, mutate in enumerate(mutations):
            with self.subTest(mutation=number):
                self.reject_mutation(mutate)

    def test_candidate_order_and_followup_bijection_are_checked(self):
        mutations = [
            lambda d: d["candidate-reviews"]["reviews"][0]["presented_sentence_order"].reverse(),
            lambda d: d["candidate-reviews"]["reviews"][0]["presented_sentence_order"].pop(),
            lambda d: d["followup"]["mapping"][0].update(original_id="S09"),
            lambda d: d["followup"]["mapping"][0].update(verification_id="V2"),
            lambda d: d["followup"]["mapping"].pop(),
        ]
        for number, mutate in enumerate(mutations):
            with self.subTest(mutation=number):
                self.reject_mutation(mutate)

    def test_legal_locator_structure_unknown_gold_and_pending_metadata(self):
        mutations = [
            lambda d: d["source-answers"]["records"][0]["locators"][0].update(kind="unsupported"),
            lambda d: d["source-answers"]["records"][0]["locators"][0].update(pages=[0]),
            lambda d: d["source-answers"]["records"][8]["locators"][0].update(block_indices_zero_based=[-1]),
            lambda d: d["source-answers"]["records"][0]["locators"].pop(),
            lambda d: d["source-answers"]["records"][0].update(original_gold_key="accept"),
            lambda d: d["source-answers"]["records"][0].update(answer_ko="changed answer"),
            lambda d: d["source-answers"].update(original_document_status="final"),
            lambda d: d["archived-source-audit"].update(warnings=[]),
        ]
        for number, mutate in enumerate(mutations):
            with self.subTest(mutation=number):
                self.reject_mutation(mutate)

    def test_archive_provenance_and_human_limits_remain_recorded(self):
        mutations = [
            lambda d: d["archived-local-validation"].update(hash_checks=34),
            lambda d: d["archived-source-audit"]["summary"].update(hash_checks=25),
            lambda d: d["archived-source-audit"]["summary"].update(errors=1),
            lambda d: d["archived-local-validation"].update(semantic_accuracy_score=1.0),
            lambda d: d["human-reference"].update(human_agreement_score=1.0),
            lambda d: d["human-reference"]["rows"][0]["ai_ratings"][0].update(rating="유용"),
            lambda d: d["followup"].update(verification_input_sha256="0" * 64),
            lambda d: d.pop("followup"),
        ]
        for number, mutate in enumerate(mutations):
            with self.subTest(mutation=number):
                self.reject_mutation(mutate)


if __name__ == "__main__":
    unittest.main()

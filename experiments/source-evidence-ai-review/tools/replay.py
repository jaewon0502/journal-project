#!/usr/bin/env python3
"""Replay public records, never the unpublished sources or model execution.

Usage: python3 tools/replay.py [--package package_directory]
validate() accepts that directory or a mapping keyed by JSON filename stems
(including PUBLIC-DERIVATION), and returns a JSON-serializable result. It does
not mutate its input. The fixed expectations describe this one recorded run;
construction labels are not used as gold or as semantic accuracy scores.
"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys


PACKAGE = Path(__file__).resolve().parents[1]
DATA_FILES = (
    "sources", "protocol", "cases", "source-first", "candidate-reviews",
    "challenger", "followup", "source-answers", "human-reference",
    "archived-source-audit", "archived-local-validation",
)
SENTENCE_IDS = {f"S{i:02}" for i in range(1, 19)}
IMPORTANCE_IDS = {f"U{i}" for i in range(1, 7)}
REVIEWERS = {"AI1", "AI2", "AI3"}
REPAIRS = {"S05", "S06", "S07", "S09", "S15", "S17"}
FOLLOWUP_MAPPING = dict(zip(
    [f"V{i}" for i in range(1, 8)],
    ["S05", "S09", "S17", "S08", "S15", "S07", "S06"],
))
MEANING = {"accept", "repair", "hold"}
IMPORTANCE = {"필수", "유용", "생략 가능", "판단 어려움"}
PENDING_STATUS = "latest merged wording pending final narrow checks"
LIMITS = [
    "Only published record structure, exact text bindings and stored decisions were replayed.",
    "Original files, 55 source locators and 172 quote anchors were not checked against source text.",
    "Archived hash/anchor counts are recorded local results, not checks executed by this program.",
    "No new model or human judgments, semantic accuracy, isolation or timing verification.",
]


class ValidationError(ValueError):
    """A public record violates an expected structural relationship."""


def require(condition, message):
    if not condition:
        raise ValidationError(message)


def index(rows, key, label, expected=None):
    require(isinstance(rows, list), f"{label}: expected a list")
    result = {}
    for row in rows:
        require(isinstance(row, dict), f"{label}: expected object rows")
        value = row.get(key)
        require(isinstance(value, str) and value, f"{label}: missing {key}")
        require(value not in result, f"{label}: duplicate {key} {value}")
        result[value] = row
    if expected is not None:
        require(set(result) == set(expected), f"{label}: missing or unexpected IDs")
    return result


def text(value, label):
    require(isinstance(value, str) and bool(value.strip()), f"{label}: expected nonempty text")


def digest(value, label):
    require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value),
            f"{label}: expected SHA-256 syntax (not source-byte verification)")


def integers(values, minimum, label):
    require(isinstance(values, list) and bool(values), f"{label}: expected nonempty list")
    require(all(type(v) is int and v >= minimum for v in values), f"{label}: invalid integer")
    require(len(set(values)) == len(values), f"{label}: duplicate integer")


def evidence(row, sources, label):
    ev = row["evidence"]
    require(ev["source_id"] in sources, f"{label}: unknown evidence source")
    text(ev["location"], f"{label}.evidence.location")
    digest(ev["quote_sha256"], f"{label}.evidence.quote_sha256")
    require(type(ev["quote_characters"]) is int and ev["quote_characters"] > 0,
            f"{label}: invalid quote length")
    require(ev["quote_text_published"] is False, f"{label}: quote publication flag changed")


def judgments(rows, expected, sources, label):
    found = index(rows, "id", label, expected)
    for sid, row in found.items():
        require(row["decision"] in MEANING, f"{label}/{sid}: unknown decision")
        text(row["reason"], f"{label}/{sid}.reason")
        evidence(row, sources, f"{label}/{sid}")
    return found


def load_package(package_path=PACKAGE):
    """Read only the public JSON files; no source fetch or private-path access."""
    root = Path(package_path)
    result = {name: json.loads((root / "data" / f"{name}.json").read_text(encoding="utf-8"))
              for name in DATA_FILES}
    result["PUBLIC-DERIVATION"] = json.loads((root / "PUBLIC-DERIVATION.json").read_text(encoding="utf-8"))
    return result


def _replay(data):
    protocol, cases = data["protocol"], data["cases"]
    require(set(protocol["rubric"]["meaning"]) == MEANING, "protocol: meaning rubric changed")
    require(set(protocol["rubric"]["importance"]) == IMPORTANCE, "protocol: importance rubric changed")
    for key in ("construction_labels_are_gold", "historical_v6_rescored", "human_alignment_proven"):
        require(protocol[key] is False, f"protocol: {key} must remain false")
    require(protocol["constructed_propositions"] == 18 and protocol["natural_articles"] == 0,
            "protocol: constructed case counts changed")
    require(protocol["relation_families"] == 6 and protocol["source_first_reviewers"] == 3 and
            protocol["blind_challengers"] == protocol["followup_reviewers"] == 1,
            "protocol: recorded study dimensions changed")
    require(protocol["predeclared_ambiguity_id"] == cases["predeclared_ambiguity_id"] == "S08",
            "protocol/cases: ambiguity ID changed")
    sources = index(data["sources"]["documents"], "source_id", "sources")
    require(len(sources) == 8, "sources: expected eight recorded documents")
    for sid, source in sources.items():
        digest(source["sha256"], f"sources/{sid}.sha256")

    initial = index(cases["initial_sentences"], "id", "cases.initial_sentences", SENTENCE_IDS)
    final = index(cases["final_sentences"], "id", "cases.final_sentences", SENTENCE_IDS)
    candidates = index(cases["importance_candidates"], "id", "cases.importance_candidates", IMPORTANCE_IDS)
    for label, rows in (("initial", initial), ("final", final), ("importance", candidates)):
        for sid, row in rows.items():
            text(row["text"], f"cases.{label}/{sid}.text")
    for sid, row in initial.items():
        require(row["intended"] in MEANING, f"cases.initial/{sid}: unknown intended decision")
        require(row["construction"] in {"faithful", "equivalent", "changed"},
                f"cases.initial/{sid}: unknown construction label")
    require(len({row["family"] for row in initial.values()}) == 6, "cases: expected six relation families")
    require({sid for sid, row in initial.items() if row["construction"] == "changed"} == REPAIRS,
            "cases: recorded construction labels changed")

    reports = index(data["source-first"]["reports"], "reviewer_id", "source-first", REVIEWERS)
    source_first_counts = {}
    source_first_ratings = {}
    for rid, expected_count in (("AI1", 27), ("AI2", 26), ("AI3", 22)):
        report = reports[rid]
        require(report["mode"] == "AI", f"source-first/{rid}: mode changed")
        require(report["before_candidate_delivery_recorded"] is True and
                report["independent_timestamp_attestation"] is False,
                f"source-first/{rid}: recorded timing qualifications changed")
        require(report["unit_texts_published"] is False, f"source-first/{rid}: publication flag changed")
        units = index(report["units"], "id", f"source-first/{rid}",
                      {f"U{i:02}" for i in range(1, expected_count + 1)})
        for uid, unit in units.items():
            require(unit["importance"] in IMPORTANCE, f"source-first/{rid}/{uid}: unknown importance")
            digest(unit["text_sha256"], f"source-first/{rid}/{uid}.text_sha256")
            evidence(unit, sources, f"source-first/{rid}/{uid}")
        source_first_counts[rid] = len(units)
        source_first_ratings[rid] = dict(Counter(u["importance"] for u in units.values()))

    reviews = index(data["candidate-reviews"]["reviews"], "reviewer_id", "candidate-reviews", REVIEWERS)
    expected_decisions = {sid: "repair" if sid in REPAIRS else "hold" if sid == "S08" else "accept"
                          for sid in SENTENCE_IDS}
    decisions, importance_rows = {}, {}
    for rid in sorted(reviews):
        review = reviews[rid]
        require(review["mode"] == "AI", f"candidate-reviews/{rid}: mode changed")
        order = review["presented_sentence_order"]
        require(isinstance(order, list) and len(order) == 18 and set(order) == SENTENCE_IDS,
                f"candidate-reviews/{rid}: invalid candidate order")
        rows = judgments(review["sentences"], SENTENCE_IDS, sources, f"candidate-reviews/{rid}")
        require([r["id"] for r in review["sentences"]] == order,
                f"candidate-reviews/{rid}: judgment order differs from presented candidate order")
        decisions[rid] = {sid: row["decision"] for sid, row in rows.items()}
        require(decisions[rid] == expected_decisions, f"candidate-reviews/{rid}: recorded decisions changed")
        ratings = index(review["importance"], "id", f"candidate-reviews/{rid}.importance", IMPORTANCE_IDS)
        for uid, row in ratings.items():
            require(row["rating"] in IMPORTANCE, f"candidate-reviews/{rid}/{uid}: unknown importance")
            require(row["rating"] == "필수", f"candidate-reviews/{rid}/{uid}: recorded importance changed")
            evidence(row, sources, f"candidate-reviews/{rid}/{uid}")
        importance_rows[rid] = ratings

    challenger = data["challenger"]
    require(challenger["peer_votes_available"] is False, "challenger: peer-vote flag changed")
    challenger_rows = judgments(challenger["sentences"], SENTENCE_IDS, sources, "challenger")
    challenger_decisions = {sid: row["decision"] for sid, row in challenger_rows.items()}
    require(challenger_decisions == expected_decisions, "challenger: recorded decisions changed")

    followup = data["followup"]
    v_ids = set(FOLLOWUP_MAPPING)
    inputs = index(followup["inputs"], "id", "followup.inputs", v_ids)
    mapping = index(followup["mapping"], "verification_id", "followup.mapping", v_ids)
    targets = [row["original_id"] for row in mapping.values()]
    require(len(set(targets)) == 7, "followup.mapping: duplicate original_id")
    require({vid: row["original_id"] for vid, row in mapping.items()} == FOLLOWUP_MAPPING,
            "followup.mapping: recorded V-to-S mapping changed")
    changes = index(followup["changes"], "id", "followup.changes", REPAIRS | {"S08"})
    verified = judgments(followup["judgments"], v_ids, sources, "followup.judgments")
    require(all(row["decision"] == "accept" for row in verified.values()), "followup: recorded accept decisions changed")
    require(followup["source_ids"] == ["BOK-20241011", "KOSTAT-202409"], "followup: source scope changed")
    for vid, sid in FOLLOWUP_MAPPING.items():
        change = changes[sid]
        require(change["before"] == initial[sid]["text"], f"{sid}: changes.before differs from initial text")
        if sid in REPAIRS:
            first_review = next(row for row in reviews["AI1"]["sentences"] if row["id"] == sid)
            require(first_review["minimal_repair"] == change["after"],
                    f"{sid}: first review minimal_repair differs from changes.after")
        require(change["after"] == inputs[vid]["text"], f"{sid}/{vid}: changes.after differs from actual verification input")
        require(final[sid]["text"] == inputs[vid]["text"], f"{sid}/{vid}: final text differs from actual verification input")
        require(change["kind"] == ("new_evidence_without_wording_change" if sid == "S08" else "meaning_repair"),
                f"{sid}: change kind differs from recorded intervention")
    changed_ids = {sid for sid in SENTENCE_IDS if initial[sid]["text"] != final[sid]["text"]}
    require(changed_ids == REPAIRS, "cases: original supported wording changed or required repair missing")
    for sid in SENTENCE_IDS:
        require(final[sid]["wording_changed"] is (sid in changed_ids), f"{sid}: wording_changed flag mismatch")
        expected_scope = "BOK plus KOSTAT September CPI" if sid == "S08" else "BOK six paragraphs"
        require(final[sid]["evidence_scope"] == expected_scope, f"{sid}: evidence scope mismatch")
    require(verified["V4"]["evidence"]["source_id"] == "KOSTAT-202409",
            "S08/V4: supplementary evidence missing")

    answers = data["source-answers"]
    question_ids = {f"EVAL{event}-Q{i}" for event in ("08", "09", "10") for i in range(1, 5)}
    answer_rows = index(answers["records"], "id", "source-answers", question_ids)
    require(answers["original_gold_key_recovered"] is False and answers["not_original_v6_rejudgment"] is True,
            "source-answers: unknown gold/rejudgment qualifications changed")
    require(answers["original_document_status"] == PENDING_STATUS and answers["original_finalized_at_utc"] is None,
            "source-answers: original pending metadata must be preserved")
    require(answers["later_workflow_confirmation"] == "recorded separately; original metadata not rewritten",
            "source-answers: later workflow qualification changed")
    audit = data["archived-source-audit"]
    audited_questions = index(audit["questions"], "id", "archived-source-audit.questions", question_ids)
    archived_locators = {}
    for locator in audit["locators"]:
        key = (locator["question_id"], locator["locator_number"])
        require(key not in archived_locators, "archived-source-audit: duplicate locator ID")
        archived_locators[key] = locator
    locator_keys = set()
    for qid, answer in answer_rows.items():
        require(answer["event_id"] == qid.split("-")[0], f"{qid}: event ID mismatch")
        require(answer["original_gold_key"] is None, f"{qid}: unknown gold must remain null")
        require(answer["human_review"] == "not_run", f"{qid}: human review status changed")
        text(answer["answer_ko"], f"{qid}.answer_ko")
        require(hashlib.sha256(answer["answer_ko"].encode("utf-8")).hexdigest() == answer["answer_sha256"],
                f"{qid}: public answer text digest mismatch")
        locators = answer["locators"]
        require(isinstance(locators, list) and len(locators) == audited_questions[qid]["locator_count"],
                f"{qid}: locator count differs from archived record")
        for number, locator in enumerate(locators, 1):
            label = f"{qid}.locator/{number}"
            source = sources.get(locator["source_id"])
            require(source is not None and source["event_id"] == answer["event_id"], f"{label}: unknown or unrelated source")
            kind = locator["kind"]
            require(kind in {"pdf_pages", "html_block_prefix"}, f"{label}: unsupported locator kind")
            key = (qid, number)
            require(key in archived_locators, f"{label}: missing archived locator")
            recorded = archived_locators[key]
            require(recorded["source_id"] == locator["source_id"] and recorded["kind"] == kind,
                    f"{label}: archived locator identity differs")
            if kind == "pdf_pages":
                require(source["format"] == "pdf", f"{label}: source format mismatch")
                integers(locator["pages"], 1, f"{label}.pages")
                digest(locator["anchor_sha256"], f"{label}.anchor_sha256")
                require(recorded["pages"] == locator["pages"], f"{label}: archived pages differ")
            else:
                require(source["format"] == "html", f"{label}: source format mismatch")
                integers(locator["block_indices_zero_based"], 0, f"{label}.block_indices_zero_based")
                digest(locator["prefix_sha256"], f"{label}.prefix_sha256")
                for field in ("context_before", "context_after"):
                    require(type(locator[field]) is int and locator[field] >= 0, f"{label}: invalid {field}")
                require(recorded["resolved_block_indices_zero_based"] == locator["block_indices_zero_based"],
                        f"{label}: archived block indices differ")
            require(recorded["paragraph_markers_checked"] == locator.get("paragraphs", []),
                    f"{label}: archived paragraph markers differ")
            locator_keys.add(key)
    require(locator_keys == set(archived_locators) and len(locator_keys) == 55,
            "source-answers: expected exactly 55 distinct locator records")

    human = data["human-reference"]
    require(human["participants"] == 1 and human["direct_importance_responses"] == 3,
            "human-reference: prior partial response counts changed")
    require(human["human_agreement_score"] is None and human["new_human_responses_in_this_AI_run"] == 0,
            "human-reference: no new responses or agreement score permitted")
    human_rows = index(human["rows"], "unit_id", "human-reference.rows", {"U1", "U2", "U3"})
    for uid, row in human_rows.items():
        require(row["human_rating"] == "유용", f"human-reference/{uid}: recorded human rating changed")
        ai_rows = index(row["ai_ratings"], "reviewer_id", f"human-reference/{uid}", REVIEWERS)
        require(all(ai_rows[rid]["rating"] == importance_rows[rid][uid]["rating"] for rid in REVIEWERS),
                f"human-reference/{uid}: AI rating projection mismatch")

    require(audit["errors"] == [], "archived-source-audit: recorded errors present")
    require(audit["summary"]["hash_checks"] == 26 and audit["summary"]["locators"] == 55,
            "archived-source-audit: recorded counts changed")
    require(audit["summary"]["questions"] == len(answer_rows) and audit["summary"]["errors"] == 0 and
            audit["summary"]["warnings"] == len(audit["warnings"]),
            "archived-source-audit: archived summary/record mismatch")
    require(len(audit["warnings"]) == 1, "archived-source-audit: preserve pending-status warning")
    warning = audit["warnings"][0]
    text(warning["workflow_completed_at"], "archived-source-audit.warning.workflow_completed_at")
    require(warning["code"] == "workflow_answer_status_conflict" and
            warning["answer_document_status"] == answers["original_document_status"] and
            warning["answer_finalized_at_utc"] is None,
            "archived-source-audit: pending-status warning changed")
    local = data["archived-local-validation"]
    require(local["errors"] == [], "archived-local-validation: recorded errors present")
    for field, count in {"hash_checks": 35, "exact_quote_anchor_checks": 172,
                         "source_first_reports": 3, "primary_meaning_judgments": 54,
                         "blind_challenger_judgments": 18, "followup_judgments": 7,
                         "followup_accepted": 7, "wording_edits": 6,
                         "unchanged_sentences": 12, "new_human_responses": 0}.items():
        require(local[field] == count, f"archived-local-validation: recorded {field} changed")
    require(local["semantic_accuracy_score"] is None, "archived-local-validation: no semantic accuracy score")

    derivation = data["PUBLIC-DERIVATION"]
    require(derivation["kind"] == "curated_public_derivative_not_original_run_bytes" and
            derivation["new_model_calls_during_publication"] == 0, "PUBLIC-DERIVATION: scope changed")
    artifacts = index(derivation["original_artifacts"], "logical_name", "PUBLIC-DERIVATION.original_artifacts")
    for artifact in artifacts.values():
        digest(artifact["sha256"], "PUBLIC-DERIVATION.original_artifacts.sha256")
    provenance = {"challenger": challenger["original_report_sha256"],
                  "followup": followup["original_report_sha256"],
                  "verification_input": followup["verification_input_sha256"]}
    for i in range(1, 4):
        provenance[f"source_first_{i}"] = reports[f"AI{i}"]["original_report_sha256"]
        provenance[f"candidate_review_{i}"] = reviews[f"AI{i}"]["original_report_sha256"]
    for name, value in provenance.items():
        require(artifacts[name]["sha256"] == value, f"PUBLIC-DERIVATION: {name} recorded digest mismatch")

    return {
        "public_replay": {
            "source_first_unit_counts": source_first_counts,
            "source_first_importance_counts": source_first_ratings,
            "importance_candidates_per_reviewer": {rid: len(importance_rows[rid]) for rid in sorted(REVIEWERS)},
            "primary_decision_counts": {rid: dict(Counter(decisions[rid].values())) for rid in sorted(REVIEWERS)},
            "primary_unanimous_items": sum(len({decisions[rid][sid] for rid in REVIEWERS}) == 1 for sid in SENTENCE_IDS),
            "challenger_judgments": len(challenger_rows),
            "challenger_agreement_with_each_primary": {rid: sum(decisions[rid][sid] == challenger_decisions[sid] for sid in SENTENCE_IDS) for rid in sorted(REVIEWERS)},
            "followup_inputs": len(inputs), "followup_accepted": len(verified),
            "wording_edits": len(changed_ids), "unchanged_sentences": 18 - len(changed_ids),
            "wording_edit_ids": sorted(changed_ids), "evidence_only_ids": ["S08"],
            "exact_text_bindings_checked": len(mapping),
            "source_answer_records": len(answer_rows), "locator_structures_checked": len(locator_keys),
            "unknown_gold": None, "semantic_accuracy_score": None,
            "new_human_responses": 0,
        },
        "recorded_archival_checks": {
            "reexecuted_against_originals": False,
            "source_audit_hash_checks": audit["summary"]["hash_checks"],
            "source_audit_locators": audit["summary"]["locators"],
            "local_validation_hash_checks": local["hash_checks"],
            "local_validation_quote_anchor_checks": local["exact_quote_anchor_checks"],
        },
        "preserved_source_answer_metadata": {
            "original_document_status": answers["original_document_status"],
            "original_finalized_at_utc": answers["original_finalized_at_utc"],
            "warnings": audit["warnings"],
        },
    }


def validate(package=PACKAGE):
    """Return diagnostics and reaggregated records; failures always set ok=False."""
    result = {"ok": False, "scope": "public_record_replay_only", "errors": [], "limits": list(LIMITS)}
    try:
        data = package if isinstance(package, dict) else load_package(package)
        result.update(_replay(data))
        result["ok"] = True
    except (ValidationError, OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        result["errors"].append(f"{type(exc).__name__}: {exc}")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=PACKAGE)
    args = parser.parse_args(argv)
    result = validate(args.package)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["ok"]:
        for error in result["errors"]:
            print(f"replay: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

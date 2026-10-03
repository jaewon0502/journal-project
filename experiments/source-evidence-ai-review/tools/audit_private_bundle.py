"""Optional audit against an owner-supplied original research bundle.

Raw source documents and full run artifacts are not distributed in Git.
This performs local integrity/locator checks, not legal semantic grading.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re




def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def norm(text):
    return " ".join(text.split())


class Blocks(HTMLParser):
    """Independently reproduce HUDOC p/li text in DOM start order."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks, self.stack = [], []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "li"):
            self.blocks.append([])
            self.stack.append((tag, len(self.blocks) - 1))
        if tag == "br":
            self.handle_data(" ")

    def handle_endtag(self, tag):
        if self.stack and tag == self.stack[-1][0]:
            self.stack.pop()

    def handle_data(self, text):
        for _, index in self.stack:
            self.blocks[index].append(text)


def paragraph_ranges(pages):
    text, starts = "", []
    for page in pages:
        starts.append(len(text))
        text += page["text"] + "\n"
    starts.append(len(text))
    matches = list(re.finditer(r"(?m)^\s*(\d{1,3})\.\s+", text))
    ranges = []
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        ranges.append((int(match[1]), match.start(), end))
    return text, starts, ranges


def audit(bundle, output=None):
    BASE = Path(bundle).resolve()
    RUN = BASE / "source-first-review-2026-10-03"
    result = {"checked_at_utc": datetime.now(timezone.utc).isoformat(),
              "check_kind": "local_integrity_locator_and_extraction_structure",
              "errors": [], "warnings": [], "hash_checks": [],
              "documents": [], "questions": [], "locators": []}

    def check(ok, code, detail):
        if not ok:
            result["errors"].append({"code": code, "detail": detail})
        return bool(ok)

    def hash_check(path, expected, expected_bytes=None):
        ok = path.is_file()
        data = path.read_bytes() if ok else b""
        actual = sha256(data).hexdigest() if ok else None
        entry = {"file": str(path.relative_to(BASE)), "sha256": actual,
                 "expected_sha256": expected, "bytes": len(data),
                 "match": ok and actual == expected}
        if expected_bytes is not None:
            entry["expected_bytes"] = expected_bytes
            check(ok and len(data) == expected_bytes, "byte_count_mismatch", entry["file"])
        result["hash_checks"].append(entry)
        check(entry["match"], "hash_mismatch_or_missing", entry["file"])
        return data

    manifest = read(BASE / "source-manifest.json")
    freeze = read(BASE / "freeze-manifest.json")
    run = read(RUN / "run-manifest.json")
    previous_validation = read(RUN / "validation.json")
    answer_path = RUN / run["latest_answer_file"]
    answers = read(answer_path)
    docs = manifest["documents"]
    by_id = {d["source_id"]: d for d in docs}
    check(len(docs) == len(by_id) == 6, "source_set", list(by_id))
    extracted, pdf_ranges = {}, {}
    for doc in docs:
        source_id = doc["source_id"]
        raw = hash_check(BASE / doc["file"], doc["sha256"], doc["bytes"])
        hash_check(BASE / doc["derived_file"], doc["derived_sha256"])
        items = read(BASE / doc["derived_file"])
        extracted[source_id] = items
        detail = {"source_id": source_id, "format": doc["format"],
                  "role": doc["role"], "units": len(items),
                  "original_byte_identity": doc["original_byte_identity"]}
        if doc["format"] == "pdf":
            check(raw.startswith(b"%PDF-"), "pdf_signature", source_id)
            check([p["pdf_page"] for p in items] == list(range(1, len(items) + 1)),
                  "pdf_page_sequence", source_id)
            check(all(p["text"].strip() for p in items), "blank_pdf_extraction", source_id)
            pdf_ranges[source_id] = paragraph_ranges(items)
            detail["extraction_fidelity"] = "not_reextracted_from_pdf"
            maximum = {"EVAL08_order_UN": 57, "EVAL09_opinion_UN": 285}.get(source_id)
            if maximum:
                found = {n for n, _, _ in pdf_ranges[source_id][2]}
                missing = sorted(set(range(1, maximum + 1)) - found)
                check(not missing, "main_paragraph_coverage", {source_id: missing})
                detail["main_paragraphs_present"] = maximum - len(missing)
        else:
            parser = Blocks()
            parser.feed(raw.decode("utf-8"))
            reproduced = [norm("".join(t)) for t in parser.blocks]
            equal = reproduced == [norm(t) for t in items]
            check(equal, "html_reextraction_mismatch", source_id)
            detail["normalized_html_p_li_reextraction_exact"] = equal
            end = next(i for i, text in enumerate(items)
                       if text == "PARTLY CONCURRING PARTLY DISSENTING OPINION OF JUDGE EICKE" and i > 500)
            numbers = {int(m[1]) for t in items[:end] if (m := re.match(r"^(\d+)\.\s", t))}
            missing = sorted(set(range(1, 658)) - numbers)
            check(not missing, "main_paragraph_coverage", {source_id: missing})
            detail["main_paragraphs_present"] = 657 - len(missing)
        result["documents"].append(detail)

    hash_check(BASE / "source-manifest.json", freeze["files"]["source-manifest.json"])
    result["frozen_scope"] = {"verified": ["source-manifest.json"],
                              "not_read": [f for f in freeze["files"] if f != "source-manifest.json"],
                              "reason": "restricted source audit; no human-evaluation or importance inputs"}
    for reviewer in run["reviewers"]:
        hash_check(RUN / reviewer["source_file"], reviewer["source_sha256"])
        hash_check(RUN / reviewer["first_report_file"], reviewer["first_report_sha256"], reviewer["bytes"])
    for group in ("comparison_reports", "narrow_rechecks"):
        for report in run[group]:
            hash_check(RUN / report["file"], report["sha256"])
    hash_check(answer_path, run["latest_answer_sha256"])
    check(run["latest_answer_sha256"] == previous_validation["latest_answer_sha256"],
          "validation_latest_answer_hash", run["latest_answer_file"])

    rows = answers["records"]
    expected = {f"EVAL{event:02}-Q{question}" for event in (8, 9, 10) for question in range(1, 5)}
    check(len(rows) == 12 and {r["id"] for r in rows} == expected, "question_set", [r["id"] for r in rows])
    for row in rows:
        check(bool(row["answer_ko"].strip() and row["locators"]), "empty_answer_or_locators", row["id"])
        row_errors = len(result["errors"])
        for i, loc in enumerate(row["locators"], 1):
            doc = by_id.get(loc["source_id"])
            identity = f"{row['id']}/locator-{i}"
            if not check(doc is not None and doc["event_id"] == row["event_id"]
                         and doc["role"] == "primary_decision", "locator_source", identity):
                continue
            items = extracted[loc["source_id"]]
            entry = {"question_id": row["id"], "locator_number": i, "source_id": loc["source_id"],
                     "kind": loc["kind"], "cached_anchor_found_ignored": loc.get("anchor_found")}
            if loc["kind"] == "pdf_pages":
                pages = loc["pages"]
                if not check(bool(pages) and all(type(p) is int and 1 <= p <= len(items) for p in pages),
                             "page_range", identity):
                    continue
                entry["pages"] = pages
                entry["anchor_pages"] = [p for p in pages if norm(loc["anchor"]) in norm(items[p - 1]["text"])]
                check(bool(entry["anchor_pages"]), "anchor_missing_on_selected_page", identity)
                full, starts, ranges = pdf_ranges[loc["source_id"]]
                for paragraph in loc.get("paragraphs", []):
                    parts = re.fullmatch(r"(\d+)((?:\([a-z0-9]+\))*)", str(paragraph))
                    candidates = [(a, z) for n, a, z in ranges if parts and n == int(parts[1])]
                    candidates = [(a, z) for a, z in candidates if any(a < starts[p] and z > starts[p - 1] for p in pages)]
                    suffixes = re.findall(r"\(([a-z0-9]+)\)", parts[2]) if parts else []
                    valid = False
                    for a, z in candidates:
                        body = full[a:z]
                        position = 0
                        for suffix in suffixes:
                            match = re.search(r"(?m)^\s*\(" + re.escape(suffix) + r"\)", body[position:])
                            if not match:
                                break
                            position += match.end()
                        else:
                            valid = True
                    check(valid, "paragraph_or_subclause_missing", {identity: paragraph})
                entry["paragraph_markers_checked"] = loc.get("paragraphs", [])
            elif loc["kind"] == "html_block_prefix":
                indices = [j for j, t in enumerate(items) if norm(t).startswith(norm(loc["prefix"]))]
                check(len(indices) == 1 and indices == loc["block_indices_zero_based"], "html_prefix_identity", identity)
                entry["resolved_block_indices_zero_based"] = indices
                for j in indices:
                    before, after = loc.get("context_before", 0), loc.get("context_after", 0)
                    check(type(before) is int and type(after) is int and before >= 0 and after >= 0
                          and j - before >= 0 and j + after < len(items), "html_context_bounds", identity)
                    nearest = next((int(m[1]) for t in reversed(items[:j + 1]) if (m := re.match(r"^(\d+)\.\s", t))), None)
                    for paragraph in loc.get("paragraphs", []):
                        check(nearest == paragraph, "html_paragraph_context", {identity: paragraph})
                entry["paragraph_markers_checked"] = loc.get("paragraphs", [])
            else:
                check(False, "unsupported_locator_kind", identity)
            result["locators"].append(entry)
        result["questions"].append({"id": row["id"], "locator_count": len(row["locators"]),
                                    "evidence_locations_resolve": len(result["errors"]) == row_errors,
                                    "semantic_accuracy": "not_scored"})

    count = len(result["locators"])
    check(count == previous_validation["latest_answer_source_locations_checked"], "locator_count_matches_validation", count)
    if run.get("ai_review_workflow_completed_at_utc") and (answers.get("finalized_at_utc") is None
            or "pending" in answers.get("document_status", "")):
        result["warnings"].append({"code": "workflow_answer_status_conflict",
            "workflow_completed_at": run["ai_review_workflow_completed_at_utc"],
            "answer_document_status": answers.get("document_status"),
            "answer_finalized_at_utc": answers.get("finalized_at_utc")})
    result["summary"] = {"documents": len(docs), "formats": dict(Counter(d["format"] for d in docs)),
                         "questions": len(rows), "locators": count, "hash_checks": len(result["hash_checks"]),
                         "errors": len(result["errors"]), "warnings": len(result["warnings"])}
    result["limits"] = ["No live URL reachability or original-download byte identity tested.",
        "PDF text was not re-extracted or visually rechecked; matching stored hashes prove preservation, not transcription accuracy.",
        "Paragraph/subclause marker existence does not prove claim entailment or legal meaning.",
        "Recorded review timestamps do not independently establish exposure order or isolation.",
        "No semantic accuracy score, original v6 recovery, or participant evaluation follows from this audit."]
    if output is not None:
        Path(output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False, indent=2))
    if result["errors"]:
        print(json.dumps(result["errors"], ensure_ascii=False, indent=2))
    return bool(result["errors"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path,
                        help="Original research bundle; see README for required inputs")
    parser.add_argument("--output", type=Path, help="Optional local JSON result path")
    args = parser.parse_args()
    try:
        return audit(args.bundle, args.output)
    except (OSError, ValueError, KeyError, TypeError, IndexError, StopIteration) as exc:
        parser.exit(1, f"Source audit could not finish: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())

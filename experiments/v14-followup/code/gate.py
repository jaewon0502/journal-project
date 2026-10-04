"""New v14 follow-up gate, not recovered v14 code or a semantic truth checker.

Python standard library only. Input/review hashes bind exact UTF-8 file bytes.
"""
import argparse
import hashlib
import json
from pathlib import Path

IMPLEMENTATION = "v14-followup-new-v1"
AXES = ("necessity", "evidence_support", "preserves_other_meaning", "context_safe")
KINDS = ("necessary_correction", "optional_enrichment")
TRI = ("yes", "no", "unknown")


class Invalid(ValueError):
    """A malformed or unbound input must never authorize an edit."""


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def decode(raw):
    def reject_constant(value):
        raise Invalid("invalid JSON constant: " + value)

    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise Invalid("duplicate JSON key: " + key)
            result[key] = value
        return result
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Invalid("invalid UTF-8 JSON: " + str(exc)) from exc


def shape(value, fields, label):
    if not isinstance(value, dict) or set(value) != set(fields):
        raise Invalid(label + ": missing or unknown fields")


def string(value, label, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise Invalid(label + ": expected " + ("string" if allow_empty else "nonempty string"))
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise Invalid(label + ": invalid Unicode string") from exc


def array(value, label):
    if not isinstance(value, list):
        raise Invalid(label + ": expected array")


def choice(value, choices, label):
    if value not in choices or not isinstance(value, str):
        raise Invalid(label + ": invalid value")


def boolean(value, label):
    if type(value) is not bool:
        raise Invalid(label + ": expected boolean")


def ids(values, allowed, label):
    array(values, label)
    for value in values:
        string(value, label)
    if len(values) != len(set(values)) or not set(values) <= set(allowed):
        raise Invalid(label + ": duplicate or unknown ID")


def anchors(values, docs, label, allow_empty=False):
    array(values, label)
    if not values and not allow_empty:
        raise Invalid(label + ": evidence anchor required")
    for anchor in values:
        shape(anchor, ("document_id", "quote"), label)
        string(anchor["document_id"], label)
        string(anchor["quote"], label)
        if anchor["document_id"] not in docs or anchor["quote"] not in docs[anchor["document_id"]]:
            raise Invalid(label + ": inexact or unknown evidence anchor")


def bundle_data(raw):
    bundle = decode(raw)
    shape(bundle, ("bundle_id", "original_article", "evidence_documents", "proposed_patches"), "bundle")
    string(bundle["bundle_id"], "bundle_id")
    string(bundle["original_article"], "original_article")
    docs = {"original": bundle["original_article"]}
    array(bundle["evidence_documents"], "evidence_documents")
    for doc in bundle["evidence_documents"]:
        shape(doc, ("id", "text"), "document")
        string(doc["id"], "document ID")
        string(doc["text"], "document text")
        if doc["id"] in docs or doc["id"] == "candidate":
            raise Invalid("duplicate or reserved document ID")
        docs[doc["id"]] = doc["text"]
    array(bundle["proposed_patches"], "proposed_patches")
    patches, positions = {}, {}
    for patch in bundle["proposed_patches"]:
        shape(patch, ("id", "before", "after", "kind"), "patch")
        string(patch["id"], "patch ID")
        string(patch["before"], "before")
        string(patch["after"], "after", allow_empty=True)
        choice(patch["kind"], KINDS, "kind")
        if patch["id"] in patches:
            raise Invalid("duplicate proposal ID")
        original, before = bundle["original_article"], patch["before"]
        start = original.find(before)
        if start < 0 or original.find(before, start + 1) >= 0:
            raise Invalid("absent or nonunique original span: " + patch["id"])
        if before == patch["after"]:
            raise Invalid("unchanged patch: " + patch["id"])
        end = start + len(before)
        if any(start < e and s < end for s, e in positions.values()):
            raise Invalid("overlapping original spans: " + patch["id"])
        patches[patch["id"]] = patch
        positions[patch["id"]] = (start, end)
    binding = {"bundle_id": bundle["bundle_id"], "input_sha256": sha(raw),
               "original_sha256": sha(bundle["original_article"].encode("utf-8")),
               "evidence_sha256": sha(canonical(bundle["evidence_documents"])),
               "patches_sha256": sha(canonical(bundle["proposed_patches"]))}
    return bundle, docs, patches, positions, binding


def apply(bundle, patches, positions, selected):
    text = bundle["original_article"]
    for pid in sorted(selected, key=lambda pid: positions[pid][0], reverse=True):
        start, end = positions[pid]
        text = text[:start] + patches[pid]["after"] + text[end:]
    return text


def review_data(raw, binding, patches, docs):
    review = decode(raw)
    shape(review, ("reviewer_id", "binding", "complete", "read_complete", "patch_assessments"), "review")
    string(review["reviewer_id"], "reviewer_id")
    if review["binding"] != binding:
        raise Invalid("review input binding mismatch")
    for field in ("complete", "read_complete"):
        boolean(review[field], field)
        if not review[field]:
            raise Invalid("incomplete review: " + field)
    array(review["patch_assessments"], "patch_assessments")
    assessed = {}
    for item in review["patch_assessments"]:
        shape(item, ("patch_id", "kind", *AXES, "atomic", "related_context",
                     "required_dependencies", "relation_status", "anchors", "reason"), "assessment")
        string(item["patch_id"], "patch_id")
        pid = item["patch_id"]
        if pid not in patches or pid in assessed:
            raise Invalid("duplicate or unknown assessment ID")
        choice(item["kind"], KINDS, "assessment kind")
        for field in (*AXES, "atomic"):
            choice(item[field], TRI, field)
        choice(item["relation_status"], ("complete", "unknown"), "relation_status")
        for field in ("related_context", "required_dependencies"):
            ids(item[field], patches, field)
            if pid in item[field]:
                raise Invalid("self relation: " + pid)
        if set(item["related_context"]) & set(item["required_dependencies"]):
            raise Invalid("relation cannot be both related and required: " + pid)
        anchors(item["anchors"], docs, "assessment anchors")
        string(item["reason"], "assessment reason")
        assessed[pid] = item
    if set(assessed) != set(patches):
        raise Invalid("assessment IDs must cover every proposal exactly once")
    return review, assessed


def prepare(bundle_raw):
    """Produce exact bindings and a proposal preview, never an approval."""
    bundle, _, patches, positions, binding = bundle_data(bundle_raw)
    return {"implementation": IMPLEMENTATION, "binding": binding, "bundle": bundle,
            "full_proposed_candidate": apply(bundle, patches, positions, patches),
            "publication_allowed": False, "semantic_certification": False}


def audit_data(raw, binding, selected, docs, reviewer_ids):
    audit = decode(raw)
    shape(audit, ("auditor_id", "binding", "complete", "read_complete", "full_candidate_assessed",
                  "assessed_patch_ids", "unassessed_spans", "verdict", "anchors", "reason"), "audit")
    string(audit["auditor_id"], "auditor_id")
    if audit["auditor_id"] in reviewer_ids:
        raise Invalid("final auditor must differ from initial reviewer IDs")
    if audit["binding"] != binding:
        raise Invalid("audit binding mismatch (input, reviews, selection or exact candidate)")
    for field in ("complete", "read_complete", "full_candidate_assessed"):
        boolean(audit[field], field)
        if not audit[field]:
            raise Invalid("incomplete audit: " + field)
    ids(audit["assessed_patch_ids"], selected, "assessed_patch_ids")
    if set(audit["assessed_patch_ids"]) != set(selected):
        raise Invalid("audit must assess every selected patch exactly once")
    anchors(audit["unassessed_spans"], {"candidate": docs["candidate"]}, "unassessed_spans", allow_empty=True)
    if audit["unassessed_spans"]:
        raise Invalid("unassessed candidate text")
    choice(audit["verdict"], ("approve", "hold", "unknown"), "audit verdict")
    anchors(audit["anchors"], docs, "audit anchors", allow_empty=not selected)
    string(audit["reason"], "audit reason")
    return audit


def evaluate(bundle_raw, review_raws, audit_raw=None):
    """Select provisional patches, then validate a separate exact-candidate audit."""
    result = {"implementation": IMPLEMENTATION, "status": "validation_failed",
              "publication_allowed": False, "semantic_certification": False,
              "validation_errors": [], "audit_errors": [], "selected_ids": [],
              "held_ids": [], "reasons": {}, "candidate_text": None}
    try:
        bundle, docs, patches, positions, binding = bundle_data(bundle_raw)
        result.update(binding=binding, held_ids=list(patches), candidate_text=bundle["original_article"])
        if len(review_raws) != 2:
            raise Invalid("exactly two independent review records required")
        parsed = [review_data(raw, binding, patches, docs) for raw in review_raws]
        reviewer_ids = [review["reviewer_id"] for review, _ in parsed]
        if len(set(reviewer_ids)) != 2:
            raise Invalid("reviewer IDs must be distinct")
    except Invalid as exc:
        result["validation_errors"].append(str(exc))
        return result
    reasons, dependencies = {pid: [] for pid in patches}, {}
    relation_notes = {}
    for pid, patch in patches.items():
        first, second = (assessed[pid] for _, assessed in parsed)
        if patch["kind"] != "necessary_correction":
            reasons[pid].append("optional_enrichment: never automatically selected")
        for n, item in enumerate((first, second), 1):
            if item["kind"] != patch["kind"]:
                reasons[pid].append(f"review {n}: kind disagreement")
            for field in (*AXES, "atomic"):
                if item[field] != "yes":
                    reasons[pid].append(f"review {n}: {field}={item[field]}")
            if item["relation_status"] != "complete":
                reasons[pid].append(f"review {n}: unknown relations")
        if set(first["required_dependencies"]) != set(second["required_dependencies"]):
            reasons[pid].append("unresolved reviewer disagreement: required_dependencies")
        if set(first["related_context"]) != set(second["related_context"]):
            relation_notes[pid] = {
                "note": "non-required context annotation differs; inspect at final audit",
                "reviewer_context_ids": [first["related_context"], second["related_context"]],
            }
        # Never union conflicting relation interpretations; only consensus can select.
        dependencies[pid] = set(first["required_dependencies"])
    selected = {pid for pid in patches if not reasons[pid]}
    while True:
        removed = {pid for pid in selected if not dependencies[pid] <= selected}
        if not removed:
            break
        for pid in sorted(removed):
            reasons[pid].append("required dependency held: " + ", ".join(sorted(dependencies[pid] - selected)))
        selected -= removed
    selected_ids = [pid for pid in patches if pid in selected]
    candidate = apply(bundle, patches, positions, selected)
    audit_binding = {**binding, "reviews_sha256": [sha(raw) for raw in review_raws],
                     "selected_ids": selected_ids, "candidate_sha256": sha(candidate.encode("utf-8"))}
    audit_binding["selection_sha256"] = sha(canonical(audit_binding))
    result.update(selected_ids=selected_ids, held_ids=[pid for pid in patches if pid not in selected],
                  reasons=reasons, relation_notes=relation_notes,
                  candidate_text=candidate, candidate_sha256=audit_binding["candidate_sha256"],
                  audit_binding=audit_binding,
                  status="awaiting_audit" if selected else ("held" if patches else "no_op"))
    if audit_raw is not None:
        result["audit_sha256"] = sha(audit_raw)
        try:
            audit = audit_data(audit_raw, audit_binding, selected_ids,
                               {**docs, "candidate": candidate}, reviewer_ids)
            if audit["verdict"] != "approve":
                raise Invalid("audit verdict=" + audit["verdict"])
            if selected:
                result.update(status="approved", publication_allowed=True)
        except Invalid as exc:
            result["audit_errors"].append(str(exc))
            result["status"] = "audit_rejected"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("bundle")
    prep.add_argument("output")
    gate = sub.add_parser("evaluate")
    for name in ("bundle", "review1", "review2", "output"):
        gate.add_argument(name)
    gate.add_argument("--audit")
    args = parser.parse_args()
    try:
        raw = Path(args.bundle).read_bytes()
        result = prepare(raw) if args.command == "prepare" else evaluate(
            raw, [Path(args.review1).read_bytes(), Path(args.review2).read_bytes()],
            Path(args.audit).read_bytes() if args.audit else None)
    except (Invalid, OSError) as exc:
        result = {"implementation": IMPLEMENTATION, "status": "validation_failed",
                  "validation_errors": [str(exc)], "publication_allowed": False,
                  "semantic_certification": False}
    Path(args.output).write_bytes(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")
    return 2 if result.get("status") in ("validation_failed", "audit_rejected") else 0


if __name__ == "__main__":
    raise SystemExit(main())

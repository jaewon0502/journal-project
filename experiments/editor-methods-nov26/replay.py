"""Replay a three-reader routing policy on published sentence-level judgments."""

import argparse
import hashlib
import itertools
import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path
from zipfile import ZipFile

HERE = Path(__file__).resolve().parent
DESIGN = json.loads((HERE / "design.json").read_text())
CELLS = ("truePositive", "falseNegative", "falsePositive", "trueNegative", "panelTie")


def outcome(positive, total):
    if positive * 2 == total:
        return None
    return positive * 2 > total


def cell(decision, panel):
    if panel is None:
        return "panelTie"
    if decision:
        return "truePositive" if panel else "falsePositive"
    return "falseNegative" if panel else "trueNegative"


def percent(part, total):
    return round(100 * part / total, 5) if total else None


def rates(counts):
    tp, fn, fp, tn = (counts[name] for name in CELLS[:4])
    classified = tp + fn + fp + tn
    return {
        "comparablePanelOutcomes": classified,
        "agreementPct": percent(tp + tn, classified),
        "positivePanelAgreementPct": percent(tp, tp + fn),
        "negativePanelAgreementPct": percent(tn, tn + fp),
        "alwaysNegativeAgreementPct": percent(tn + fp, classified),
    }


def ordered_flags(raw, article, sentence):
    def sort_key(i):
        key = json.dumps([DESIGN["seed"], article, sentence, i], separators=(",", ":"))
        return hashlib.sha256(key.encode("utf-8")).digest()
    return [raw[i] >= 2 for i in sorted(range(len(raw)), key=sort_key)]


def single_split(flags):
    first, second, third = flags[:3]
    mixed = first != second
    adaptive = third if mixed else first
    fixed = sum(flags[:3]) >= 2
    if fixed != adaptive:
        raise ValueError("Adaptive and fixed-three majorities differ")
    panel = outcome(sum(flags[3:]), len(flags) - 3)
    return mixed, cell(adaptive, panel)


def tally_all_splits(n, positive_count):
    """Each unlabeled triple has three choices of third reader; first two are unordered."""
    counts = Counter()
    flags = [True] * positive_count + [False] * (n - positive_count)
    for a, b, c in itertools.combinations(flags, 3):
        positives = a + b + c
        panel = outcome(positive_count - positives, n - 3)
        counts[cell(positives >= 2, panel)] += 3
        counts["splits"] += 3
        counts["escalated"] += int(a != b) + int(b != c) + int(a != c)
    return counts


@lru_cache(maxsize=None)
def split_shares(n, positive_count):
    counts = tally_all_splits(n, positive_count)
    return {k: counts[k] / counts["splits"] for k in (*CELLS, "escalated")}


def analyze_rows(rows):
    fixed = Counter()
    all_splits = Counter()
    exclusions = Counter()
    sizes = Counter()
    two_only = Counter()
    for article, sentence, raw in rows:
        if not isinstance(raw, list) or any(type(v) not in (int, float) or v not in (0, 1, 2, 3) for v in raw):
            exclusions["invalidOrMissing"] += 1
            continue
        if len(raw) < 5:
            exclusions["fewerThanFive"] += 1
            continue
        sizes[len(raw)] += 1
        flags = ordered_flags(raw, article, sentence)
        mixed, result = single_split(flags)
        fixed["escalated"] += int(mixed)
        fixed[result] += 1
        if not mixed:
            two_only[result] += 1
        else:
            two_only["unresolved"] += 1
        all_splits.update(split_shares(len(raw), sum(flags)))
    n = sum(sizes.values())
    summary = {key: fixed[key] for key in CELLS}
    fixed_three = n * 3
    adaptive = n * 2 + fixed["escalated"]
    all_cells = {key: round(all_splits[key] / n, 9) if n else None for key in CELLS}
    all_escalated = all_splits["escalated"]
    return {
        "sentences": n,
        "excluded": dict(sorted(exclusions.items())),
        "responseCountsPerSentence": dict(sorted(sizes.items())),
        "rawResponseCount": sum(k * v for k, v in sizes.items()),
        "fixedSplit": {
            "fixedThreeRatings": fixed_three, "twoOnlyRatings": 2 * n, "adaptiveRatings": adaptive,
            "escalated": fixed["escalated"], "savedVersusThree": fixed_three - adaptive,
            "savedPctVersusThree": percent(fixed_three - adaptive, fixed_three),
            "additionalPctVersusTwo": percent(fixed["escalated"], 2 * n),
            "adaptiveVersusFixedThreeMismatches": 0,
            "adaptiveAgainstHeldOutPanel": {**summary, **rates(summary)},
            "twoOnlyAgainstSameHeldOutPanel": {
                "unresolved": two_only["unresolved"], **{k: two_only[k] for k in CELLS},
                **rates(two_only),
            },
        },
        "allSplitsWithEqualSentenceWeight": {
            "escalationPct": percent(all_escalated, n),
            "savedPctVersusThree": percent(n - all_escalated, fixed_three),
            "cellsAsFractionsOfAllSentences": all_cells,
            **{k: v for k, v in rates(all_splits).items() if k != "comparablePanelOutcomes"},
        },
    }


def replay(path):
    if hashlib.sha256(path.read_bytes()).hexdigest() != DESIGN["archiveSha256"]:
        raise ValueError("Source archive SHA-256 differs from design.json")
    rows = {q: [] for q in DESIGN["questions"]}
    seen = set()
    with ZipFile(path) as archive:
        articles = sorted(n for n in archive.namelist() if re.fullmatch(r"article_\d+\.json", n))
        for name in articles:
            article = json.loads(archive.read(name))
            for item in article["sentences"]:
                key = (article["id"], item["id"])
                if key in seen or item["article"] != key[0]:
                    raise ValueError("Duplicate or mismatched article/sentence ID")
                seen.add(key)
                judgments = item.get("bias", {}).get("judgements", {})
                for question in rows:
                    rows[question].append((*key, judgments.get(question)))
    return {
        "articles": len(articles), "uniqueSentenceRecords": len(seen),
        "questions": {q: analyze_rows(items) for q, items in rows.items()},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Unmodified Zenodo zip, stored outside the repository")
    parser.add_argument("--check", action="store_true", help="Compare the aggregate with the published result")
    args = parser.parse_args()
    result = json.dumps(replay(args.archive), ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.check:
        if result != (HERE / "results.json").read_text():
            raise SystemExit("Aggregate results differ")
        print("Verified both questions, each fixed split and its all-split sensitivity analysis.")
    else:
        print(result, end="")

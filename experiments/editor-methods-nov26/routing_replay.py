"""Replay label-dependent second reviews and article-level audits on the same fixed panels."""

import argparse
import hashlib
import itertools
import json
from collections import Counter
from pathlib import Path

from expert_replay import prepare, read_csv_file
from replay import HERE, cell, percent

SCHEME = json.loads((HERE / "routing-design.json").read_text())


def audited(article):
    digest = hashlib.sha256((SCHEME["auditSeed"] + "\n" + article).encode()).digest()
    return int.from_bytes(digest[:8], "big") % 10 == 0


def route(policy, a, b, c, audit):
    """Return how many binary ratings are read, and the delivered verdict or abstention."""
    if policy == "oneOnly":
        return 1, a
    if policy == "twoConsensus":
        return 2, a if a == b else None
    if policy == "fixedThree":
        return 3, a + b + c >= 2
    if policy not in ("twoPlusTie", "doubleFirstPositive", "doubleFirstNegative"):
        raise ValueError("Unknown policy")
    need_second = policy == "twoPlusTie" or audit or a == (policy == "doubleFirstPositive")
    if not need_second:
        return 1, a
    return (2, a) if a == b else (3, c)


def scores(counts):
    tp, fn, fp, tn = [counts[k] for k in ("truePositive", "falseNegative", "falsePositive", "trueNegative")]
    up, un = counts["unresolvedPositive"], counts["unresolvedNegative"]
    n = tp + fn + fp + tn
    return {
        "positivePanel": tp + fn + up, "negativePanel": tn + fp + un,
        "truePositive": tp, "falseNegative": fn, "falsePositive": fp, "trueNegative": tn,
        "unresolvedPositive": up, "unresolvedNegative": un, "conditionalAgreementPct": percent(tp + tn, n),
        "positiveHitsAmongAllPositivePct": percent(tp, tp + fn + up),
        "negativeHitsAmongAllNegativePct": percent(tn, tn + fp + un),
        "firstNegativeNotRechecked": counts["firstNegativeNotRechecked"],
        "panelPositiveAmongThese": counts["firstNegativeNotRecheckedPanelPositive"],
        "panelPositivePctAmongThese": percent(counts["firstNegativeNotRecheckedPanelPositive"], counts["firstNegativeNotRechecked"]),
    }


def report(folder):
    expert = read_csv_file(folder, "expertFile", "expertSha256")
    crowd = read_csv_file(folder, "crowdFile", "crowdSha256")
    usable, coverage = prepare(expert, crowd)
    articles = {url: audited(url) for url, _, _ in usable}
    # Counts of equal (first, second, third, audit, expert reference, crowd reference)
    # configurations suffice for every policy. No IDs or source text enter the report.
    groups = Counter()
    for url, votes, external in usable:
        total = sum(votes)
        for i, j, k in itertools.permutations(range(8), 3):
            a, b, c = votes[i], votes[j], votes[k]
            remaining_majority = total - (a + b + c) >= 3
            groups[(a, b, c, articles[url], remaining_majority, external)] += 1
    opportunities = sum(groups.values())
    results = {}
    for name in SCHEME["policies"]:
        assigned = 0
        held_out = Counter()
        separate = Counter()
        for (a, b, c, audit, held, external), count in groups.items():
            cost, decision = route(name, a, b, c, audit)
            assigned += cost * count
            for destination, ref in ((held_out, held), (separate, external)):
                if ref is None:
                    continue
                if decision is None:
                    destination["unresolvedPositive" if ref else "unresolvedNegative"] += count
                    continue
                destination[cell(decision, ref)] += count
                if cost == 1 and not decision:
                    destination["firstNegativeNotRechecked"] += count
                    if ref:
                        destination["firstNegativeNotRecheckedPanelPositive"] += count
        results[name] = {
            "requestedRatings": assigned,
            "savedPctVsTwo": percent(2 * opportunities - assigned, 2 * opportunities),
            "savedPctVsThree": percent(3 * opportunities - assigned, 3 * opportunities),
            "remainingFive": scores(held_out), "separateCrowd": scores(separate),
        }
    return {
        "sentenceCount": coverage["completeBinaryExpertSentences"],
        "crowdBinarySentenceCount": coverage["dispositions"]["eligibleExpertWithBinaryCrowd"],
        "articles": len(articles), "auditedArticles": sum(articles.values()),
        "sentencesInAuditedArticles": sum(articles[url] for url, _, _ in usable),
        "orderedTeams": 336, "sentenceTeamAssignments": opportunities, "policies": results,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    computed = json.dumps(report(args.folder), ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.check:
        if computed != (HERE / "routing-results.json").read_text():
            raise SystemExit("Routing replay differs")
        print("Verified six prespecified policies against disjoint panel votes and the external crowd.")
    else:
        print(computed, end="")

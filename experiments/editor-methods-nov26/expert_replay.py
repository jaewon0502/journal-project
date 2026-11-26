"""Test every fixed two-reader team and adjudicator in the BABE SG1 panel."""

import argparse
import csv
import hashlib
import itertools
import json
import statistics
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

from replay import CELLS, HERE, cell, percent, rates

SCHEME = json.loads((HERE / "expert-design.json").read_text())
BINARY = {"Biased": True, "Non-biased": False}


def read_csv_file(folder, name_key, digest_key):
    path = folder / SCHEME[name_key]
    if hashlib.sha256(path.read_bytes()).hexdigest() != SCHEME[digest_key]:
        raise ValueError("Input file does not match the locked edition: " + path.name)
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream, delimiter=";"))


def sentence_key(row):
    text = unicodedata.normalize("NFC", row["text"])
    return row["news_link"].strip(), " ".join(text.split())


def prepare(expert_rows, crowd_rows):
    grouped = defaultdict(list)
    people = sorted({row["annotator_id"] for row in expert_rows})
    if len(people) != 8 or "" in people:
        raise ValueError("Expected eight named source rater slots")
    for row in expert_rows:
        grouped[sentence_key(row)].append((row["annotator_id"], row["label_bias"]))
    crowd = {}
    for row in crowd_rows:
        key = sentence_key(row)
        if key in crowd or row["label_bias"] not in {*BINARY, "No agreement"}:
            raise ValueError("Nonunique sentence or unknown published crowd label")
        crowd[key] = row["label_bias"]

    audit = Counter()
    usable = []
    for key, labels in grouped.items():
        ids = [rater for rater, _ in labels]
        if len(ids) != len(set(ids)):
            audit["duplicateRater"] += 1
            continue
        if set(ids) != set(people):
            audit["incompletePanel"] += 1
            continue
        by_person = dict(labels)
        if any(label not in BINARY for label in by_person.values()):
            audit["missingOrNonbinary"] += 1
            continue
        external = crowd.get(key)
        if external is None:
            audit["eligibleExpertWithoutCrowdMatch"] += 1
        elif external == "No agreement":
            audit["eligibleExpertWithCrowdTie"] += 1
        else:
            audit["eligibleExpertWithBinaryCrowd"] += 1
        usable.append((key[0], [BINARY[by_person[p]] for p in people], BINARY.get(external)))
    return usable, {
        "expertInputRows": len(expert_rows), "expertDistinctSentenceKeys": len(grouped),
        "crowdDistinctSentenceKeys": len(crowd), "crowdAbsentFromExpertInput": len(crowd.keys() - grouped.keys()),
        "completeBinaryExpertSentences": len(usable),
        "dispositions": {k: audit[k] for k in ("duplicateRater", "incompletePanel", "missingOrNonbinary",
                           "eligibleExpertWithoutCrowdMatch", "eligibleExpertWithCrowdTie", "eligibleExpertWithBinaryCrowd")},
    }


def confusion(counts):
    summary = {name: counts[name] for name in CELLS[:-1]}
    return {**summary, **rates(summary)}


def grade_team(usable, first, second, third):
    costs = Counter()
    held_out = Counter()
    crowd = Counter()
    for _, votes, crowd_majority in usable:
        a, b, c = votes[first], votes[second], votes[third]
        mixed = a != b
        adaptive = c if mixed else a
        votes_three = a + b + c
        if adaptive != (votes_three >= 2):
            raise ValueError("Adaptive decision differs from the fixed-three majority")
        panel = (sum(votes) - votes_three) >= 3
        held_out[cell(adaptive, panel)] += 1
        if crowd_majority is not None:
            crowd[cell(adaptive, crowd_majority)] += 1
        costs["escalations"] += mixed
        costs["earlyNegativeWithPositivePanel"] += not a and not b and panel
    return costs, held_out, crowd


def distribution(values):
    return {"min": min(values), "median": statistics.median(values), "max": max(values)}


def report(folder):
    expert = read_csv_file(folder, "expertFile", "expertSha256")
    crowd = read_csv_file(folder, "crowdFile", "crowdSha256")
    usable, coverage = prepare(expert, crowd)
    n = len(usable)
    teams = 0
    all_costs, all_held, all_crowd = Counter(), Counter(), Counter()
    spreads = defaultdict(list)
    for a, b in itertools.combinations(range(8), 2):
        for c in range(8):
            if c in (a, b):
                continue
            costs, held, separate = grade_team(usable, a, b, c)
            all_costs.update(costs)
            all_held.update(held)
            all_crowd.update(separate)
            teams += 1
            m = costs["escalations"]
            spreads["adaptiveRatings"].append(2 * n + m)
            spreads["savedPctVsThree"].append(percent(n - m, 3 * n))
            spreads["escalationPct"].append(percent(m, n))
            spreads["fiveExpertAgreementPct"].append(rates(held)["agreementPct"])
            spreads["fiveExpertPositiveAgreementPct"].append(rates(held)["positivePanelAgreementPct"])
            spreads["fiveExpertNegativeAgreementPct"].append(rates(held)["negativePanelAgreementPct"])
            spreads["separateCrowdAgreementPct"].append(rates(separate)["agreementPct"])
    opportunities = n * teams
    escalations = all_costs["escalations"]
    return {
        "coverage": coverage,
        "standingTeams": teams, "sentenceTeamAssignments": opportunities,
        "individualRatings": {
            "fixedTwo": 2 * opportunities, "fixedThree": 3 * opportunities,
            "adaptive": 2 * opportunities + escalations, "unresolvedWithOnlyTwo": escalations,
            "additionalPctVsTwo": percent(escalations, 2 * opportunities),
            "savedVsThree": opportunities - escalations, "savedPctVsThree": percent(opportunities - escalations, 3 * opportunities),
            "adaptiveVsFixedThreeDecisionMismatches": 0,
        },
        "adaptiveAgainstRemainingFive": {
            **confusion(all_held),
            "earlyNegativeWithPositivePanel": all_costs["earlyNegativeWithPositivePanel"],
        },
        "adaptiveAgainstSeparateCrowdMajority": confusion(all_crowd),
        "across168Teams": {name: distribution(values) for name, values in spreads.items()},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path, help="Folder holding the two pinned source CSVs outside Git")
    parser.add_argument("--check", action="store_true", help="Compare with the published aggregate")
    args = parser.parse_args()
    computed = json.dumps(report(args.folder), ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.check:
        if computed != (HERE / "expert-results.json").read_text():
            raise SystemExit("Expert replay differs")
        print("Verified the historical labels for all 168 standing teams and the separate crowd comparison.")
    else:
        print(computed, end="")

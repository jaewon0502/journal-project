import itertools
import math
import unittest
from collections import Counter

from expert_replay import grade_team, prepare
from replay import analyze_rows, cell, single_split, tally_all_splits
from routing_replay import route, scores


class RoutingReplayTest(unittest.TestCase):
    def test_stopping_after_two_equals_three_for_every_binary_triple(self):
        for a, b, c in itertools.product((False, True), repeat=3):
            majority = (a + b + c) >= 2
            self.assertEqual(route("fixedThree", a, b, c, False), (3, majority))
            self.assertEqual(route("twoPlusTie", a, b, c, False), (2 + (a != b), majority))
            self.assertEqual(route("twoConsensus", a, b, c, False), (2, a if a == b else None))
            for policy, reviewed in (("doubleFirstPositive", a), ("doubleFirstNegative", not a)):
                expected = (2 + (a != b), majority) if reviewed else (1, a)
                self.assertEqual(route(policy, a, b, c, False), expected)
                self.assertEqual(route(policy, a, b, c, True), (2 + (a != b), majority))

    def test_disjoint_panel_rejects_its_opposite_and_preserves_ties(self):
        self.assertEqual(single_split([True, False, True, False, False]), (True, "falsePositive"))
        self.assertEqual(single_split([False, False, True, False, True]), (False, "panelTie"))
        usable = [("article", [False, False, False, True, True, True, True, True], None)]
        costs, held, crowd = grade_team(usable, 0, 1, 2)
        self.assertEqual(costs["earlyNegativeWithPositivePanel"], 1)
        self.assertEqual(held["falseNegative"], 1)
        self.assertFalse(crowd)

    def test_all_splits_match_independent_hypergeometric_calculation(self):
        for n in (5, 7, 15):
            for positives in range(n + 1):
                expected = Counter()
                for positive_draws in range(4):
                    if positive_draws > positives or 3 - positive_draws > n - positives:
                        continue
                    triples = math.comb(positives, positive_draws) * math.comb(n - positives, 3 - positive_draws)
                    remaining = positives - positive_draws
                    panel = None if 2 * remaining == n - 3 else 2 * remaining > n - 3
                    expected[cell(positive_draws >= 2, panel)] += 3 * triples
                    expected["splits"] += 3 * triples
                    if positive_draws in (1, 2):
                        expected["escalated"] += 2 * triples
                self.assertEqual(tally_all_splits(n, positives), expected)

    def test_invalid_labels_and_short_panels_do_not_become_negatives(self):
        report = analyze_rows([("a", "s", None), ("a", "t", [0, 0, 1, 2]), ("a", "u", [0, 1, 2, 3, True])])
        self.assertEqual(report["excluded"], {"invalidOrMissing": 2, "fewerThanFive": 1})
        self.assertEqual(report["sentences"], 0)
        self.assertIsNone(report["fixedSplit"]["savedPctVersusThree"])
        self.assertIsNone(report["allSplitsWithEqualSentenceWeight"]["agreementPct"])

    def test_only_complete_unique_panels_join_and_no_crowd_tie_becomes_negative(self):
        def row(person, label, sentence):
            return {"annotator_id": str(person), "label_bias": label, "news_link": "a", "text": sentence}
        people = range(8)
        valid = [row(n, "Biased" if n < 4 else "Non-biased", "same  text") for n in people]
        incomplete = [row(n, "Biased", "short") for n in range(7)]
        nonbinary = [row(n, "" if n == 0 else "Biased", "blank") for n in people]
        duplicate = [row(n, "Biased", "duplicate") for n in people] + [row(0, "Biased", "duplicate")]
        crowd = [{"text": "same text", "news_link": "a", "label_bias": "No agreement"}]
        usable, coverage = prepare(valid + incomplete + nonbinary + duplicate, crowd)
        self.assertEqual(len(usable), 1)
        self.assertIsNone(usable[0][2])
        counts = coverage["dispositions"]
        self.assertEqual([counts[k] for k in ("incompletePanel", "missingOrNonbinary", "duplicateRater", "eligibleExpertWithCrowdTie")], [1] * 4)
        with self.assertRaises(ValueError):
            prepare(valid, crowd * 2)

    def test_abstentions_stay_in_all_positive_and_negative_denominators(self):
        result = scores(Counter(truePositive=2, trueNegative=3, unresolvedPositive=2, unresolvedNegative=1))
        self.assertEqual(result["conditionalAgreementPct"], 100.0)
        self.assertEqual(result["positiveHitsAmongAllPositivePct"], 50.0)
        self.assertEqual(result["negativeHitsAmongAllNegativePct"], 75.0)


if __name__ == "__main__":
    unittest.main()

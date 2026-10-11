import unittest

from indicator_registry import roster_snapshot
from regime_adaptive_engine import evaluate, health


def sample_bars(count=80):
    bars = []
    base = 2600.0
    for i in range(count):
        close = base + i * 0.1
        bars.append({
            "timestamp": 1_800_000_000 + i * 60,
            "open": close - 0.05,
            "high": close + 0.15,
            "low": close - 0.15,
            "close": close,
            "volume": 100 + i,
        })
    return bars


class IndicatorRosterStage1Tests(unittest.TestCase):
    def test_locked_roster_counts_are_exact(self):
        roster = roster_snapshot()
        self.assertEqual(roster["expected_count"], 20)
        self.assertEqual(roster["actual_count"], 20)
        self.assertEqual(roster["engine_counts"], {"1": 6, "2": 5, "3": 4, "4": 5})
        self.assertFalse(roster["ready_for_signal"])

    def test_external_feed_indicators_are_not_fabricated(self):
        roster = roster_snapshot()
        indicators = {
            item["id"]: item
            for engine in roster["engines"]
            for item in engine["indicators"]
        }
        self.assertEqual(indicators["delta_buy_sell"]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")
        self.assertEqual(indicators["orderflow_footprint"]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")
        self.assertEqual(indicators["dxy_inverse"]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")
        self.assertEqual(indicators["us_high_impact_news"]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")

    def test_health_reports_locked_inventory_and_no_signal_readiness(self):
        result = health()
        self.assertEqual(result["indicator_inventory"], 20)
        self.assertEqual(result["indicator_engine_counts"], {"1": 6, "2": 5, "3": 4, "4": 5})
        self.assertFalse(result["indicator_roster_ready"])
        self.assertFalse(result["autoTrading"])

    def test_engine_reports_follow_locked_6_5_4_5_roster(self):
        result = evaluate(sample_bars(), symbol="BTCUSD", timeframe="1m")
        engines = result["engines"]
        self.assertEqual(list(engines.keys()), ["engine_1", "engine_2", "engine_3", "engine_4"])
        self.assertEqual(
            [engines["engine_%d" % i]["expected_indicators"] for i in range(1, 5)],
            [6, 5, 4, 5],
        )
        self.assertEqual(
            [engines["engine_%d" % i]["returned_indicators"] for i in range(1, 5)],
            [6, 5, 4, 5],
        )
        self.assertTrue(all(engine["aligned"] for engine in engines.values()))
        self.assertTrue(all(engine["signal"] == "WAIT" for engine in engines.values()))
        self.assertTrue(all(engine["score"] is None for engine in engines.values()))
        roster_ids = [
            [item["id"] for item in group["indicators"]]
            for group in result["indicator_roster"]["engines"]
        ]
        engine_ids = [
            [item["id"] for item in engines["engine_%d" % i]["indicators"]]
            for i in range(1, 5)
        ]
        self.assertEqual(engine_ids, roster_ids)

    def test_stage1_fails_closed_instead_of_publishing_legacy_signal(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        self.assertTrue(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertIsNone(result["confidence"])
        self.assertIn("indicator_roster", result)
        self.assertEqual(result["indicator_roster"]["actual_count"], 20)
        self.assertFalse(result["autoTrading"])


if __name__ == "__main__":
    unittest.main()

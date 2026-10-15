import unittest

from engine_system import EXPECTED_INDICATORS, LOCKED_ENGINE5, evaluate_engine_system, validate_snapshot


def sample_snapshot(symbol="XAU/USD", timeframe="1M", age_ms=10_000):
    now = 1_800_000_000_000
    bars = []
    price = 2300.0
    for i in range(80):
        op = price
        price += 0.2
        bars.append({"time": (now - 79 * 60_000 + i * 60_000) / 1000,
                     "open": op, "high": price + 0.1, "low": op - 0.1,
                     "close": price, "volume": 100 + i})
    return now, {"snapshot_id": "fixture-1", "symbol": symbol, "timeframe": timeframe,
                 "captured_at_ms": now - age_ms, "bars": bars}


def live_indicators():
    return {key: {"status": "CALCULATED", "score": 80, "bias": 1}
            for key in EXPECTED_INDICATORS
            if key not in {"Volume Profile", "High-Impact US News Filter"}}


class EngineSystemTests(unittest.TestCase):
    def test_locked_engine5_settings_are_preserved(self):
        self.assertEqual(LOCKED_ENGINE5["required_aligned_algorithms"], 4)
        self.assertEqual(LOCKED_ENGINE5["required_algorithms_evaluated"], 5)
        self.assertEqual(LOCKED_ENGINE5["minimum_confidence"], 80)
        self.assertEqual(LOCKED_ENGINE5["minimum_indicator_agreement"], 70)
        self.assertEqual(LOCKED_ENGINE5["minimum_active_indicators"], 6)
        self.assertEqual(LOCKED_ENGINE5["required_qualified_runs"], 3)
        self.assertFalse(LOCKED_ENGINE5["auto_trading"])

    def test_snapshot_rejects_non_gold_symbol(self):
        now, snap = sample_snapshot(symbol="BTCUSD")
        self.assertIn("symbol-not-XAU/USD", validate_snapshot(snap, now))

    def test_snapshot_rejects_stale_snapshot(self):
        now, snap = sample_snapshot(age_ms=600_000)
        self.assertIn("snapshot-stale", validate_snapshot(snap, now))

    def test_reports_all_four_engines(self):
        now, snap = sample_snapshot()
        result = evaluate_engine_system(snap, now, indicators=live_indicators())
        self.assertEqual(len(result["engines"]), 4)
        self.assertIn("ENGINE_3_VOLUME_LIQUIDITY", result["engines"])
        self.assertIn("ENGINE_4_DIVERGENCE_MARKET_CONTEXT", result["engines"])

    def test_missing_external_context_is_never_fabricated(self):
        now, snap = sample_snapshot()
        result = evaluate_engine_system(snap, now, indicators=live_indicators(), context={})
        blockers = result["master_engine_5"]["blockers"]
        self.assertIn("dxy-unavailable", blockers)
        self.assertIn("us-news-unavailable", blockers)
        self.assertIn("order-flow-unavailable", blockers)

    def test_outputs_are_experiment_only_and_auto_trading_off(self):
        now, snap = sample_snapshot()
        result = evaluate_engine_system(snap, now, indicators=live_indicators())
        self.assertFalse(result["production_ready"])
        self.assertFalse(result["auto_trading"])

    def test_unsupplied_indicators_are_not_fabricated(self):
        now, snap = sample_snapshot()
        result = evaluate_engine_system(snap, now, indicators=live_indicators())
        self.assertNotIn("Volume Profile", result["indicators"])
        self.assertNotIn("High-Impact US News Filter", result["indicators"])


if __name__ == "__main__":
    unittest.main()

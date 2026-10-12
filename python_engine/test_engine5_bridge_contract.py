"""Regression tests for the Engine 1–4 -> Engine 5 bridge contract."""
import unittest

from regime_adaptive_engine import evaluate


def sample_bars(count=90):
    bars = []
    base_ts = 1_800_000_000
    close = 2600.0
    for i in range(count):
        open_ = close
        close = close + (0.25 if i % 3 else -0.08)
        high = max(open_, close) + 0.35
        low = min(open_, close) - 0.30
        bars.append({
            "timestamp": base_ts + i * 60,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": 100 + (i % 7) * 5,
        })
    return bars


class Engine5BridgeTests(unittest.TestCase):
    def test_all_four_specialist_reports_reach_master_engine_and_remain_gated(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        self.assertTrue(result["ok"])
        master = result["engine_5"]
        self.assertIs(master, result["master_engine"])
        self.assertEqual(master["received_engine_reports"], 4)
        self.assertEqual(set(master["engine_inputs"]), {
            "engine_1", "engine_2", "engine_3", "engine_4"
        })
        self.assertEqual(master["received_indicators"], 20)
        self.assertTrue(master["bridge_ready"])
        self.assertEqual(master["bridge_status"], "ROUTED_WAIT_GATED")
        self.assertEqual(result["signal"], "WAIT")
        self.assertEqual(master["signal"], "WAIT")
        self.assertFalse(master["ready_for_signal"])
        self.assertFalse(result["autoTrading"])

    def test_engine5_bridge_does_not_claim_live_validation_from_candidates(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        master = result["engine_5"]
        self.assertEqual(master["status"], "BLOCKED_PENDING_LIVE_VALIDATION")
        self.assertGreater(len(master["unverified_indicator_ids"]), 0)
        for engine in master["engine_inputs"].values():
            self.assertFalse(engine["ready_for_signal"])
            self.assertEqual(engine["signal"], "WAIT")
            self.assertIsNone(engine["score"])


if __name__ == "__main__":
    unittest.main()

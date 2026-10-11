"""Basic deterministic tests for the isolated Rizvi regime-adaptive engine."""
import unittest
from python_engine.regime_adaptive_engine import evaluate, health, MIN_BARS


def make_bars(n=100, direction=1):
    rows = []
    price = 100.0
    for i in range(n):
        prev = price
        price += direction * (0.12 + (i % 3) * 0.01)
        high = max(prev, price) + 0.08
        low = min(prev, price) - 0.08
        rows.append({
            "timestamp": i,
            "open": prev,
            "high": high,
            "low": low,
            "close": price,
            "volume": 1000 + (i % 7) * 25,
        })
    return rows


class RegimeAdaptiveEngineTests(unittest.TestCase):
    def test_health_is_signal_only(self):
        result = health()
        self.assertTrue(result["ok"])
        self.assertEqual(result["engines"], 5)
        self.assertFalse(result["autoTrading"])

    def test_insufficient_data_fails_safe_to_wait(self):
        result = evaluate(make_bars(MIN_BARS - 1))
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_valid_bars_return_all_four_specialist_engines(self):
        result = evaluate(make_bars(100, 1), symbol="BTCUSD", timeframe="1m")
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["engines"]), 4)
        self.assertIn(result["signal"], {"BUY", "SELL", "WAIT", "WEAK_BUY", "WEAK_SELL"})
        self.assertFalse(result["autoTrading"])
        self.assertIn("master_engine", result)

    def test_invalid_ohlcv_is_rejected(self):
        bars = make_bars(100)
        bars[-1]["high"] = 1
        result = evaluate(bars)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")

    def test_orderflow_is_not_fabricated_from_ohlcv(self):
        result = evaluate(make_bars(100), order_flow=None)
        self.assertEqual(result["order_flow_status"], "NOT_ATTACHED")
        self.assertEqual(result["engines"]["engine_3_volume"]["delta"], "NOT_AVAILABLE_FROM_OHLCV")


if __name__ == "__main__":
    unittest.main()

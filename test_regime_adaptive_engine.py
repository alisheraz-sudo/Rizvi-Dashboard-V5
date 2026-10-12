"""Tests for the isolated Rizvi engine under the locked 20-indicator contract."""
import unittest
from python_engine.regime_adaptive_engine import evaluate, health, MIN_BARS


def make_bars(n=100, direction=1):
    rows = []
    price = 100.0
    for i in range(n):
        prev = price
        price += direction * (0.12 + (i % 3) * 0.01)
        rows.append({
            "timestamp": 1_800_000_000 + i * 60,
            "open": prev,
            "high": max(prev, price) + 0.08,
            "low": min(prev, price) - 0.08,
            "close": price,
            "volume": 1000 + (i % 7) * 25,
        })
    return rows


class RegimeAdaptiveEngineTests(unittest.TestCase):
    def test_health_reports_signal_only_locked_roster(self):
        result = health()
        self.assertTrue(result["ok"])
        self.assertEqual(result["engines"], 5)
        self.assertEqual(result["indicator_inventory"], 20)
        self.assertEqual(result["indicator_engine_counts"], {"1": 6, "2": 5, "3": 4, "4": 5})
        self.assertFalse(result["autoTrading"])
        self.assertFalse(result["indicator_roster_ready"])

    def test_insufficient_data_fails_safe_to_wait(self):
        result = evaluate(make_bars(MIN_BARS - 1))
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_valid_bars_return_diagnostics_but_no_trading_signal(self):
        result = evaluate(make_bars(100, 1), symbol="BTCUSD", timeframe="1m")
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["engines"]), 4)
        self.assertEqual(result["signal"], "WAIT")
        self.assertIsNone(result["confidence"])
        self.assertEqual(result["indicator_roster"]["actual_count"], 20)
        self.assertEqual(len(result["indicator_diagnostics"]["indicators"]), 20)
        self.assertFalse(result["autoTrading"])

    def test_invalid_ohlcv_is_rejected(self):
        bars = make_bars(100)
        bars[-1]["high"] = 1
        result = evaluate(bars)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_orderflow_is_not_fabricated_from_ohlcv(self):
        result = evaluate(make_bars(100), order_flow=None)
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])
        items = result["indicator_diagnostics"]["indicators"]
        self.assertIsNone(items["delta_buy_sell"]["value"])
        self.assertIsNone(items["orderflow_footprint"]["value"])
        self.assertIn("UNAVAILABLE", items["delta_buy_sell"]["status"])


if __name__ == "__main__":
    unittest.main()

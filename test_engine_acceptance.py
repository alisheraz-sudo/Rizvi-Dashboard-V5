"""Acceptance and edge-case tests for the isolated Rizvi Python engine."""
import math
import unittest

from python_engine.regime_adaptive_engine import MIN_BARS, _adaptive_weights, evaluate, health


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


class EngineAcceptanceTests(unittest.TestCase):
    def test_health_reports_five_engines_and_locked_twenty_indicator_roster(self):
        result = health()
        self.assertTrue(result["ok"])
        self.assertEqual(result["engines"], 5)
        self.assertEqual(result["indicator_inventory"], 20)
        self.assertEqual(result["indicator_engine_counts"], {"1": 6, "2": 5, "3": 4, "4": 5})
        self.assertFalse(result["autoTrading"])
        self.assertFalse(result["indicator_roster_ready"])

    def test_adaptive_weights_are_normalized_for_legacy_diagnostics(self):
        for regime in ("TRENDING", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY", "UNKNOWN"):
            weights = _adaptive_weights(regime)
            self.assertAlmostEqual(sum(weights.values()), 1.0, places=12)
            self.assertTrue(all(0 <= value <= 0.35 for value in weights.values()))

    def test_legacy_indicator_values_are_finite_when_present(self):
        result = evaluate(make_bars(), symbol="XAUUSD", timeframe="1m")
        self.assertTrue(result["ok"])
        values = result["indicators"]
        expected = {
            "EMA", "SMA", "MACD", "RSI", "STOCHASTIC", "BOLLINGER_UPPER",
            "ATR", "VWAP", "OBV", "CCI", "MFI", "CMF", "ADX", "ROC",
            "WILLIAMS_R", "ICHIMOKU_TENKAN", "VOLUME_PROFILE_BIAS", "CANDLE_PATTERN",
        }
        self.assertTrue(expected.issubset(values))
        for key, value in values.items():
            if value is not None:
                self.assertTrue(math.isfinite(value), "%s was not finite: %r" % (key, value))

    def test_missing_ohlcv_and_insufficient_bars_fail_safe_to_wait(self):
        self.assertEqual(evaluate(make_bars(MIN_BARS - 1))["signal"], "WAIT")
        bars = make_bars()
        bars[-1]["close"] = float("nan")
        result = evaluate(bars)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_out_of_order_and_missing_timestamps_are_rejected(self):
        bars = make_bars()
        bars[50]["timestamp"] = -1
        result = evaluate(bars)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        bars = make_bars()
        bars[50]["timestamp"] = None
        result = evaluate(bars)
        self.assertFalse(result["ok"])
        self.assertIn("timestamp", result["reason"].lower())

    def test_iso_timestamps_are_accepted_when_ordered(self):
        bars = make_bars()
        for i, row in enumerate(bars):
            row["timestamp"] = "2026-10-10T00:%02d:%02dZ" % (i // 60, i % 60)
        result = evaluate(bars)
        self.assertTrue(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertIsNone(result["confidence"])

    def test_unsupported_timeframe_fails_safe_to_wait(self):
        result = evaluate(make_bars(), timeframe="2m")
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertIn("timeframe", result["reason"].lower())

    def test_zero_volume_does_not_crash_or_fabricate_order_flow(self):
        bars = make_bars()
        for row in bars:
            row["volume"] = 0
        result = evaluate(bars)
        self.assertTrue(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertIsNone(result["confidence"])
        self.assertFalse(result["autoTrading"])
        self.assertEqual(result["indicator_diagnostics"]["indicators"]["delta_buy_sell"]["status"],
                         "UNAVAILABLE_UNLESS_VALIDATED_FEED")

    def test_scoring_is_disabled_even_when_legacy_calculations_exist(self):
        for direction in (1, -1):
            result = evaluate(make_bars(direction=direction), symbol="XAUUSD", timeframe="1m")
            self.assertEqual(result["signal"], "WAIT")
            self.assertIsNone(result["confidence"])
            self.assertIn("indicator_diagnostics", result)
            self.assertFalse(result["autoTrading"])


if __name__ == "__main__":
    unittest.main()

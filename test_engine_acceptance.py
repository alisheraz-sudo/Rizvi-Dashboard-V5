"""Acceptance and edge-case tests for the isolated Rizvi Python engine."""
import math
import unittest
from unittest.mock import patch

from python_engine.regime_adaptive_engine import (
    MIN_BARS, _adaptive_weights, evaluate, health,
)

ENGINE_NAMES = (
    "engine_1_trend",
    "engine_2_momentum",
    "engine_3_structure",
    "engine_4_volatility",
)


def make_bars(n=100, direction=1):
    rows = []
    price = 100.0
    for i in range(n):
        prev = price
        price += direction * (0.12 + (i % 3) * 0.01)
        rows.append({
            "timestamp": i,
            "open": prev,
            "high": max(prev, price) + 0.08,
            "low": min(prev, price) - 0.08,
            "close": price,
            "volume": 1000 + (i % 7) * 25,
        })
    return rows


def mocked_engines(score):
    return {name: {"score": score, "inputs": []} for name in ENGINE_NAMES}


class EngineAcceptanceTests(unittest.TestCase):
    def test_health_reports_five_engines_signal_only(self):
        result = health()
        self.assertTrue(result["ok"])
        self.assertEqual(result["engines"], 5)
        self.assertEqual(result["indicator_inventory"], 18)
        self.assertFalse(result["autoTrading"])

    def test_all_regime_weights_are_normalized_and_capped(self):
        for regime in ("TRENDING", "RANGING", "HIGH_VOLATILITY", "LOW_VOLATILITY", "UNKNOWN"):
            weights = _adaptive_weights(regime)
            self.assertEqual(set(weights), set(ENGINE_NAMES))
            self.assertAlmostEqual(sum(weights.values()), 1.0, places=12)
            self.assertTrue(all(0 <= value <= 0.35 for value in weights.values()))

    def test_indicator_inventory_has_18_core_indicators_and_finite_values(self):
        result = evaluate(make_bars(), symbol="XAUUSD", timeframe="1m")
        self.assertTrue(result["ok"])
        values = result["indicators"]
        expected = {
            "EMA", "SMA", "MACD", "RSI", "STOCHASTIC", "BOLLINGER_UPPER",
            "ATR", "VWAP", "OBV", "CCI", "MFI", "CMF", "ADX", "ROC",
            "WILLIAMS_R", "ICHIMOKU_TENKAN", "VOLUME_PROFILE_BIAS", "CANDLE_PATTERN",
        }
        self.assertEqual(len(expected), 18)
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
        for row in bars:
            row["timestamp"] = "2026-10-10T00:%02d:%02dZ" % (row["timestamp"] // 60, row["timestamp"] % 60)
        result = evaluate(bars)
        self.assertTrue(result["ok"])

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
        self.assertEqual(result["order_flow_status"], "NOT_ATTACHED")
        self.assertEqual(result["engines"]["engine_3_structure"]["delta"], "NOT_AVAILABLE_FROM_OHLCV")
        self.assertFalse(result["autoTrading"])

    def test_exact_70_percent_is_weak_and_exact_80_percent_is_strong(self):
        bars = make_bars()
        with patch("python_engine.regime_adaptive_engine._indicator_values", return_value={"LAST_CLOSE": 100.0}), \
             patch("python_engine.regime_adaptive_engine._compute_engines", return_value=mocked_engines(0.70)), \
             patch("python_engine.regime_adaptive_engine._regime", return_value="TRENDING"):
            result = evaluate(bars)
            self.assertEqual(result["confidence"], 70.0)
            self.assertEqual(result["signal"], "WEAK_BUY")
        with patch("python_engine.regime_adaptive_engine._indicator_values", return_value={"LAST_CLOSE": 100.0}), \
             patch("python_engine.regime_adaptive_engine._compute_engines", return_value=mocked_engines(0.80)), \
             patch("python_engine.regime_adaptive_engine._regime", return_value="TRENDING"):
            result = evaluate(bars)
            self.assertEqual(result["confidence"], 80.0)
            self.assertEqual(result["signal"], "BUY")
            self.assertFalse(result["autoTrading"])

    def test_below_70_percent_is_wait(self):
        with patch("python_engine.regime_adaptive_engine._indicator_values", return_value={"LAST_CLOSE": 100.0}), \
             patch("python_engine.regime_adaptive_engine._compute_engines", return_value=mocked_engines(0.69)), \
             patch("python_engine.regime_adaptive_engine._regime", return_value="TRENDING"):
            result = evaluate(make_bars())
            self.assertEqual(result["confidence"], 69.0)
            self.assertEqual(result["signal"], "WAIT")


if __name__ == "__main__":
    unittest.main()

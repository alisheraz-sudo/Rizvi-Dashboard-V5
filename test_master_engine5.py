"""Regression tests for isolated Master Engine 5. No network or live services required."""
import unittest
from python_engine.master_engine5 import evaluate


def sample_bars(count=80, step=0.1, start=1_800_000_000):
    bars = []
    previous = 2000.0
    for i in range(count):
        close = 2000.0 + i * step
        bars.append({
            "timestamp": start + i * 60,
            "open": previous,
            "high": max(previous, close) + 0.25,
            "low": min(previous, close) - 0.25,
            "close": close,
            "volume": 100 + i,
        })
        previous = close
    return bars


class MasterEngine5Tests(unittest.TestCase):
    EXPECTED_ENGINES = {
        "engine_1_trend", "engine_2_momentum",
        "engine_3_structure", "engine_4_volatility",
    }

    def test_returns_all_specialists_and_keeps_auto_trading_off(self):
        bars = sample_bars()
        result = evaluate(bars, symbol="XAUUSD", timeframe="1m",
                          now_seconds=bars[-1]["timestamp"] + 5)
        self.assertIn("signal", result)
        self.assertIn("structure", result)
        self.assertIn("weights", result)
        self.assertIn("engines", result)
        self.assertTrue(self.EXPECTED_ENGINES.issubset(result["engines"]))
        self.assertTrue(self.EXPECTED_ENGINES.issubset(result["weights"]))
        self.assertFalse(result["autoTrading"])
        self.assertAlmostEqual(sum(result["weights"].values()), 1.0, places=4)

    def test_stale_candles_force_wait(self):
        bars = sample_bars()
        result = evaluate(bars, symbol="XAUUSD", timeframe="1m",
                          now_seconds=bars[-1]["timestamp"] + 900)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_future_candles_force_wait(self):
        bars = sample_bars()
        result = evaluate(bars, symbol="XAUUSD", timeframe="1m",
                          now_seconds=bars[-1]["timestamp"] - 120)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_invalid_ohlcv_fails_safe(self):
        bars = sample_bars()
        bars[-1]["high"] = 1
        result = evaluate(bars, symbol="XAUUSD", timeframe="1m",
                          now_seconds=bars[-1]["timestamp"] + 5)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_structure_has_break_and_swing_context(self):
        bars = sample_bars()
        result = evaluate(bars, symbol="XAUUSD", timeframe="1m",
                          now_seconds=bars[-1]["timestamp"] + 5)
        self.assertIn("structure", result)
        self.assertIn(result["structure"]["breakout"],
                      {"BULLISH_BREAKOUT", "BEARISH_BREAKDOWN", "INSIDE_RANGE"})
        self.assertIn(result["structure"]["swing_structure"],
                      {"BULLISH", "BEARISH", "MIXED"})

    def test_unsupported_timeframe_fails_safe(self):
        bars = sample_bars()
        result = evaluate(bars, symbol="XAUUSD", timeframe="2m",
                          now_seconds=bars[-1]["timestamp"] + 5)
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])


if __name__ == "__main__":
    unittest.main()

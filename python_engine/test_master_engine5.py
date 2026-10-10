import unittest
from master_engine5 import evaluate


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
    def test_returns_adaptive_diagnostics_and_keeps_auto_trading_off(self):
        bars = sample_bars()
        result = evaluate(bars, symbol="XAUUSD", timeframe="1m", now_seconds=bars[-1]["timestamp"] + 5)
        self.assertIn("signal", result)
        self.assertIn("structure", result)
        self.assertIn("weights", result)
        self.assertIn("engines", result)
        self.assertFalse(result["autoTrading"])
        if result.get("weights"):
            self.assertAlmostEqual(sum(result["weights"].values()), 1.0, places=4)

    def test_stale_candles_force_wait(self):
        bars = sample_bars()
        result = evaluate(bars, symbol="XAUUSD", timeframe="1m", now_seconds=bars[-1]["timestamp"] + 900)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_structure_has_explicit_break_and_swing_context(self):
        bars = sample_bars()
        result = evaluate(bars, symbol="XAUUSD", timeframe="1m", now_seconds=bars[-1]["timestamp"] + 5)
        if result.get("ok"):
            self.assertIn(result["structure"]["breakout"], {
                "BULLISH_BREAKOUT", "BEARISH_BREAKDOWN", "INSIDE_RANGE"
            })
            self.assertIn(result["structure"]["swing_structure"], {"BULLISH", "BEARISH", "MIXED"})


if __name__ == "__main__":
    unittest.main()

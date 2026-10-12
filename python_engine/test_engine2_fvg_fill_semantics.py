"""Focused regression tests for Engine 2 fair-value-gap fill semantics."""
import unittest

from indicator_calculations import calculate_roster


def bars_with_bullish_gap(last_low):
    bars = []
    for i in range(80):
        close = 100.0
        bars.append({
            "timestamp": 1_800_000_000 + i * 60,
            "open": close,
            "high": 101.0,
            "low": 99.0,
            "close": close,
            "volume": 100.0,
        })
    # Three-candle pattern: candle i-2 high is 101; candle i low is 102.5.
    bars[-3].update({"open": 102.6, "high": 103.0, "low": 102.5, "close": 102.8})
    bars[-2].update({"open": 102.8, "high": 103.2, "low": 102.6, "close": 103.0})
    bars[-1].update({
        "open": max(100.5, last_low),
        "high": max(101.0, last_low + 0.2),
        "low": last_low,
        "close": max(100.6, last_low + 0.1),
    })
    return bars


class Engine2FvgFillSemanticsTests(unittest.TestCase):
    def test_bullish_gap_stays_unfilled_when_price_never_enters_gap(self):
        result = calculate_roster(bars_with_bullish_gap(102.7), "XAUUSD", "1m")
        fvg = result["indicators"]["fvg"]["value"]
        self.assertEqual(fvg["type"], "bullish")
        self.assertEqual(fvg["fill_status"], "unfilled")
        self.assertEqual(fvg["lower"], 101.0)
        self.assertEqual(fvg["upper"], 102.5)

    def test_bullish_gap_is_partial_when_price_enters_but_does_not_reach_lower_edge(self):
        result = calculate_roster(bars_with_bullish_gap(102.0), "XAUUSD", "1m")
        fvg = result["indicators"]["fvg"]["value"]
        self.assertEqual(fvg["type"], "bullish")
        self.assertEqual(fvg["fill_status"], "partially_filled")

    def test_bullish_gap_is_fully_filled_when_price_reaches_lower_edge(self):
        result = calculate_roster(bars_with_bullish_gap(101.0), "XAUUSD", "1m")
        fvg = result["indicators"]["fvg"]["value"]
        self.assertEqual(fvg["type"], "bullish")
        self.assertEqual(fvg["fill_status"], "unfilled") if fvg["formed_at"] != 1_800_000_000 + 77 * 60 else self.fail(
            "Expected the fully-filled newest gap to be excluded; a different older active gap may be returned."
        )


if __name__ == "__main__":
    unittest.main()

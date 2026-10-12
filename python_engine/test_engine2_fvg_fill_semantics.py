"""Focused regression tests for Engine 2 fair-value-gap fill semantics."""
import unittest

from indicator_calculations import calculate_roster


def bars_with_bullish_gap(last_low):
    bars = []
    for i in range(80):
        bars.append({
            "timestamp": 1_800_000_000 + i * 60,
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.0,
            "volume": 100.0,
        })

    # The actual three-candle formation is bars[-4], bars[-3], bars[-2].
    # bars[-4].high = 101 and bars[-2].low = 102.5 create [101, 102.5].
    # The final candle is a separate later candle used to test gap filling.
    bars[-3].update({"open": 100.2, "high": 103.0, "low": 99.8, "close": 102.8})
    bars[-2].update({"open": 102.6, "high": 103.2, "low": 102.5, "close": 103.0})
    bars[-1].update({
        "open": max(100.5, last_low),
        "high": max(103.1, last_low + 0.2),
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
        self.assertEqual(fvg["lower"], 101.0)
        self.assertEqual(fvg["upper"], 102.5)

    def test_bullish_gap_is_fully_filled_when_price_reaches_lower_edge(self):
        result = calculate_roster(bars_with_bullish_gap(101.0), "XAUUSD", "1m")
        self.assertIsNone(result["indicators"]["fvg"]["value"])


if __name__ == "__main__":
    unittest.main()

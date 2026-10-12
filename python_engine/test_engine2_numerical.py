"""Numerical regression tests for Engine 2 OHLCV diagnostics.

Synthetic candles use known price levels so the tests verify calculated values,
not just roster/mapping presence. These are deterministic unit tests, not live
market accuracy or profitability claims.
"""
import unittest

from indicator_calculations import calculate_roster


BASE_TS = 1_800_000_000


def flat_bars(count=60):
    bars = []
    for i in range(count):
        bars.append({
            "timestamp": BASE_TS + i * 60,
            "open": 2600.0,
            "high": 2601.0,
            "low": 2599.0,
            "close": 2600.0,
            "volume": 100.0,
        })
    return bars


def bullish_structure_bars():
    bars = flat_bars()
    # Two confirmed swing highs: 2605 then 2607.
    bars[10]["high"] = 2605.0
    bars[20]["high"] = 2607.0
    # Two confirmed swing lows: 2595 then 2597.
    bars[30]["low"] = 2595.0
    bars[40]["low"] = 2597.0
    # A small bullish final candle supports the descriptive continuation case.
    bars[-1].update({"open": 2599.8, "high": 2601.0, "low": 2598.8, "close": 2600.0})
    return bars


class Engine2NumericalTests(unittest.TestCase):
    def calculate(self, bars):
        return calculate_roster(bars, symbol="XAUUSD", timeframe="1m")["indicators"]

    def test_market_structure_uses_confirmed_swing_price_levels(self):
        values = self.calculate(bullish_structure_bars())
        structure = values["market_structure"]["value"]
        self.assertEqual(structure["trend"], "bullish_structure")
        self.assertIs(structure["higher_high"], True)
        self.assertIs(structure["higher_low"], True)
        self.assertAlmostEqual(structure["latest_swing_high"], 2607.0, places=8)
        self.assertAlmostEqual(structure["latest_swing_low"], 2597.0, places=8)
        self.assertEqual(values["market_structure"]["status"], "CALCULATED_CANDIDATE")

    def test_structure_prediction_is_descriptive_and_uses_expected_close_and_range(self):
        values = self.calculate(bullish_structure_bars())
        prediction = values["structure_prediction"]["value"]
        self.assertEqual(prediction["candidate"], "bullish_continuation_candidate")
        self.assertEqual(prediction["structure"], "bullish_structure")
        self.assertAlmostEqual(prediction["close"], 2600.0, places=8)
        self.assertAlmostEqual(prediction["prior_range_high"], 2601.0, places=8)
        self.assertAlmostEqual(prediction["prior_range_low"], 2597.0, places=8)
        self.assertEqual(values["structure_prediction"]["status"], "DESCRIPTIVE_CANDIDATE_ONLY")

    def test_bullish_engulfing_pattern_matches_known_candles(self):
        bars = flat_bars()
        bars[-2].update({"open": 2602.0, "high": 2603.0, "low": 2599.5, "close": 2600.0})
        bars[-1].update({"open": 2599.5, "high": 2604.0, "low": 2599.2, "close": 2603.0})
        values = self.calculate(bars)
        self.assertEqual(values["candle_patterns"]["value"], "bullish engulfing candidate")
        self.assertEqual(values["candle_patterns"]["status"], "CANDIDATE_REQUIRES_VALIDATION")

    def test_bullish_fvg_returns_exact_gap_boundaries(self):
        bars = flat_bars()
        bars[-3].update({"open": 2600.0, "high": 2601.0, "low": 2599.0, "close": 2600.0})
        bars[-2].update({"open": 2600.0, "high": 2603.0, "low": 2599.0, "close": 2601.0})
        bars[-1].update({"open": 2602.2, "high": 2604.0, "low": 2602.0, "close": 2603.8})
        fvg = self.calculate(bars)["fvg"]
        self.assertEqual(fvg["status"], "CALCULATED_CANDIDATE")
        self.assertEqual(fvg["value"]["type"], "bullish")
        self.assertAlmostEqual(fvg["value"]["lower"], 2601.0, places=8)
        self.assertAlmostEqual(fvg["value"]["upper"], 2602.0, places=8)
        self.assertEqual(fvg["value"]["fill_status"], "unfilled")

    def test_support_resistance_match_nearest_confirmed_pivots(self):
        levels = self.calculate(bullish_structure_bars())["support_resistance"]
        self.assertEqual(levels["status"], "CALCULATED_CANDIDATE")
        self.assertAlmostEqual(levels["value"]["resistance"], 2605.0, places=8)
        self.assertAlmostEqual(levels["value"]["support"], 2597.0, places=8)

    def test_support_resistance_fallback_matches_flat_range_when_no_pivots_exist(self):
        levels = self.calculate(flat_bars())["support_resistance"]
        self.assertEqual(levels["status"], "RECENT_RANGE_FALLBACK")
        self.assertAlmostEqual(levels["value"]["resistance"], 2601.0, places=8)
        self.assertAlmostEqual(levels["value"]["support"], 2599.0, places=8)


    def test_bearish_structure_uses_confirmed_lower_highs_and_lows(self):
        bars = flat_bars()
        bars[10]["high"] = 2607.0
        bars[20]["high"] = 2605.0
        bars[30]["low"] = 2597.0
        bars[40]["low"] = 2595.0
        bars[-1].update({"open": 2600.2, "high": 2601.0, "low": 2598.8, "close": 2600.0})
        structure = self.calculate(bars)["market_structure"]["value"]
        self.assertEqual(structure["trend"], "bearish_structure")
        self.assertIs(structure["higher_high"], False)
        self.assertIs(structure["higher_low"], False)
        self.assertAlmostEqual(structure["latest_swing_high"], 2605.0, places=8)
        self.assertAlmostEqual(structure["latest_swing_low"], 2595.0, places=8)

    def test_bearish_engulfing_pattern_matches_known_candles(self):
        bars = flat_bars()
        bars[-2].update({"open": 2600.0, "high": 2603.0, "low": 2599.5, "close": 2602.0})
        bars[-1].update({"open": 2602.5, "high": 2603.0, "low": 2598.5, "close": 2599.0})
        values = self.calculate(bars)
        self.assertEqual(values["candle_patterns"]["value"], "bearish engulfing candidate")

    def test_bearish_fvg_returns_exact_gap_boundaries(self):
        bars = flat_bars()
        bars[-3].update({"open": 2600.0, "high": 2601.0, "low": 2599.0, "close": 2600.0})
        bars[-2].update({"open": 2600.0, "high": 2601.0, "low": 2597.0, "close": 2598.0})
        bars[-1].update({"open": 2598.0, "high": 2598.0, "low": 2596.5, "close": 2597.0})
        fvg = self.calculate(bars)["fvg"]
        self.assertEqual(fvg["value"]["type"], "bearish")
        self.assertAlmostEqual(fvg["value"]["lower"], 2598.0, places=8)
        self.assertAlmostEqual(fvg["value"]["upper"], 2599.0, places=8)
        self.assertEqual(fvg["value"]["fill_status"], "unfilled")

    def test_invalid_ohlc_is_rejected_instead_of_scored(self):
        bars = flat_bars()
        bars[-1].update({"high": 2598.0, "close": 2600.0})
        with self.assertRaises(ValueError):
            self.calculate(bars)


if __name__ == "__main__":
    unittest.main()

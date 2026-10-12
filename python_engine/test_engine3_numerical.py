"""Deterministic regression tests for Engine 3 OHLCV/feed-gated diagnostics.

These tests verify the current calculation contract with synthetic candles. They do
not establish live XAU feed validity, broker delta accuracy, or profitability.
"""
import unittest
from indicator_calculations import calculate_roster


BASE_TS = 1_800_000_000


def flat_bars(count=60):
    return [
        {
            "timestamp": BASE_TS + i * 60,
            "open": 2600.0,
            "high": 2601.0,
            "low": 2599.0,
            "close": 2600.0,
            "volume": 100.0 + (i % 5) * 10.0,
        }
        for i in range(count)
    ]


class Engine3NumericalTests(unittest.TestCase):
    def calculate(self, bars, symbol="XAUUSD", trade_flow=None):
        return calculate_roster(
            bars, symbol=symbol, timeframe="1m", trade_flow=trade_flow
        )["indicators"]

    def test_volume_profile_is_explicitly_labeled_as_proxy(self):
        values = self.calculate(flat_bars())["volume_profile"]
        self.assertEqual(values["status"], "OHLCV_CLOSE_BIN_PROXY")
        self.assertIn("highest_close_bin", values["value"])
        self.assertIn("bin_low", values["value"])
        self.assertIn("bin_high", values["value"])
        self.assertIn("not tick-level", values["note"].lower())

    def test_volume_profile_constant_price_range_is_finite_and_bounded(self):
        bars = flat_bars()
        for bar in bars:
            bar.update({"open": 2600.0, "high": 2600.0, "low": 2600.0, "close": 2600.0})
        values = self.calculate(bars)["volume_profile"]
        self.assertEqual(values["status"], "OHLCV_CLOSE_BIN_PROXY")
        self.assertEqual(values["value"]["bin_low"], 2600.0)
        self.assertEqual(values["value"]["bin_high"], 2600.0)
        self.assertEqual(values["value"]["highest_close_bin"], 0)

    def test_volume_profile_is_unavailable_when_all_recent_volume_is_zero(self):
        bars = flat_bars()
        for bar in bars:
            bar["volume"] = 0.0
        values = self.calculate(bars)["volume_profile"]
        self.assertIsNone(values["value"])
        self.assertEqual(values["status"], "UNAVAILABLE_NO_VOLUME")

    def test_buy_side_sweep_candidate_detected_when_wick_breaks_prior_high_and_close_rejects(self):
        bars = flat_bars()
        bars[-1].update({"open": 2600.0, "high": 2603.0, "low": 2599.0, "close": 2600.0})
        values = self.calculate(bars)["liquidity_sweeps"]
        self.assertEqual(values["value"], "buy-side liquidity sweep candidate")
        self.assertEqual(values["status"], "CANDIDATE_REQUIRES_VALIDATION")

    def test_sell_side_sweep_candidate_detected_when_wick_breaks_prior_low_and_close_reclaims(self):
        bars = flat_bars()
        bars[-1].update({"open": 2600.0, "high": 2601.0, "low": 2597.0, "close": 2600.0})
        values = self.calculate(bars)["liquidity_sweeps"]
        self.assertEqual(values["value"], "sell-side liquidity sweep candidate")
        self.assertEqual(values["status"], "CANDIDATE_REQUIRES_VALIDATION")

    def test_no_sweep_when_latest_wick_does_not_break_prior_range(self):
        values = self.calculate(flat_bars())["liquidity_sweeps"]
        self.assertEqual(values["value"], "none")

    def test_delta_and_footprint_fail_closed_for_gold_without_validated_gold_feed(self):
        bars = flat_bars()
        flow = {
            "status": "LIVE",
            "source": "Delta Exchange public BTCUSD trades API",
            "instrument": "BTCUSD",
            "observed_at": BASE_TS + 59 * 60,
            "buy_volume": 120.0,
            "sell_volume": 80.0,
            "trade_count": 100,
            "footprint": {"2600.0": {"buy": 120.0, "sell": 80.0}},
        }
        values = self.calculate(bars, symbol="XAUUSD", trade_flow=flow)
        self.assertIsNone(values["delta_buy_sell"]["value"])
        self.assertEqual(values["delta_buy_sell"]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")
        self.assertIsNone(values["orderflow_footprint"]["value"])
        self.assertEqual(values["orderflow_footprint"]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")

    def test_unapproved_gold_flow_source_cannot_activate_delta_or_footprint(self):
        flow = {
            "status": "LIVE",
            "source": "Unverified Gold CFD trades API",
            "instrument": "XAUUSD",
            "observed_at": "2026-10-12T10:00:00Z",
            "buy_volume": 120.0,
            "sell_volume": 80.0,
            "trade_count": 100,
            "footprint": {"2600.00": {"buy_volume": 120.0, "sell_volume": 80.0, "trades": 100}},
        }
        values = self.calculate(flat_bars(), symbol="XAUUSD", trade_flow=flow)
        for indicator_id in ("delta_buy_sell", "orderflow_footprint"):
            self.assertIsNone(values[indicator_id]["value"])
            self.assertEqual(values[indicator_id]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")

    def test_equal_prior_high_or_low_is_not_a_liquidity_sweep(self):
        bars = flat_bars()
        bars[-1].update({"open": 2600.0, "high": 2601.0, "low": 2599.0, "close": 2600.0})
        values = self.calculate(bars)["liquidity_sweeps"]
        self.assertEqual(values["value"], "none")
        self.assertEqual(values["status"], "CANDIDATE_REQUIRES_VALIDATION")

    def test_delta_and_footprint_fail_closed_when_feed_is_missing(self):
        values = self.calculate(flat_bars())
        self.assertIsNone(values["delta_buy_sell"]["value"])
        self.assertEqual(values["delta_buy_sell"]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")
        self.assertIsNone(values["orderflow_footprint"]["value"])
        self.assertEqual(values["orderflow_footprint"]["status"], "UNAVAILABLE_UNLESS_VALIDATED_FEED")

    def test_invalid_ohlcv_is_rejected(self):
        bars = flat_bars()
        bars[-1]["high"] = 2598.0
        with self.assertRaises(ValueError):
            self.calculate(bars)


if __name__ == "__main__":
    unittest.main()

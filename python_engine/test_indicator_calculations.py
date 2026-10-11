import unittest

from indicator_calculations import calculate_roster
from regime_adaptive_engine import evaluate


def sample_bars(count=80):
    bars = []
    base = 2600.0
    for i in range(count):
        close = base + i * 0.1
        bars.append({
            "timestamp": 1_800_000_000 + i * 60,
            "open": close - 0.05,
            "high": close + 0.15,
            "low": close - 0.15,
            "close": close,
            "volume": 100 + i,
        })
    return bars


class IndicatorCalculationsTests(unittest.TestCase):
    def test_all_twenty_indicator_keys_are_returned(self):
        result = calculate_roster(sample_bars(), "XAUUSD", "1m")
        self.assertEqual(len(result["indicators"]), 20)
        self.assertFalse(result["ready_for_signal"])
        self.assertEqual(result["symbol"], "XAUUSD")

    def test_external_data_indicators_remain_unavailable(self):
        items = calculate_roster(sample_bars(), "XAUUSD", "1m")["indicators"]
        for key in ("delta_buy_sell", "orderflow_footprint", "dxy_inverse", "us_high_impact_news"):
            self.assertIsNone(items[key]["value"])
            self.assertIn("UNAVAILABLE", items[key]["status"])

    def test_ohlcv_proxy_indicators_are_labeled_as_proxies(self):
        items = calculate_roster(sample_bars(), "XAUUSD", "1m")["indicators"]
        self.assertEqual(items["vwap_filter"]["status"], "PROXY_NOT_SESSION_VWAP")
        self.assertEqual(items["volume_profile"]["status"], "OHLCV_CLOSE_BIN_PROXY")
        self.assertEqual(items["trading_sessions"]["status"], "UTC_TIME_BUCKET_ONLY")

    def test_higher_timeframe_trend_is_calculated_only_from_valid_timestamped_bars(self):
        base = sample_bars()
        result = calculate_roster(base, "BTCUSD", "1m", higher_timeframe_bars=base)
        trend = result["indicators"]["trend_5"]
        self.assertEqual(trend["status"], "CALCULATED_CANDIDATE")
        self.assertEqual(trend["value"]["bias"], "bullish")

    def test_structure_prediction_is_explicitly_candidate_only(self):
        result = calculate_roster(sample_bars(), "XAUUSD", "1m")
        item = result["indicators"]["structure_prediction"]
        self.assertEqual(item["status"], "DESCRIPTIVE_CANDIDATE_ONLY")
        self.assertIn("not a forecast", item["note"])

    def test_dxy_correlation_requires_matching_timestamps_and_enough_history(self):
        bars = sample_bars()
        result = calculate_roster(bars, "XAUUSD", "1m", dxy_bars=bars)
        item = result["indicators"]["dxy_inverse"]
        self.assertEqual(item["status"], "CALCULATED_CANDIDATE")
        self.assertIsNotNone(item["value"]["correlation"])
        mismatched = [dict(bar, timestamp=bar["timestamp"] + 5) for bar in bars]
        result = calculate_roster(bars, "XAUUSD", "1m", dxy_bars=mismatched)
        self.assertIsNone(result["indicators"]["dxy_inverse"]["value"])

    def test_invalid_bars_are_rejected(self):
        bars = sample_bars()
        bars[-1]["high"] = bars[-1]["low"] - 1
        with self.assertRaises(ValueError):
            calculate_roster(bars, "XAUUSD", "1m")

    def test_engine_exposes_diagnostics_but_never_emits_signal_yet(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        self.assertEqual(len(result["indicator_diagnostics"]["indicators"]), 20)
        self.assertEqual(result["signal"], "WAIT")
        self.assertIsNone(result["confidence"])
        self.assertFalse(result["autoTrading"])


if __name__ == "__main__":
    unittest.main()

import unittest
from datetime import datetime, timedelta, timezone

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

    def test_engine_1_ema_9_21_uses_sma_seed_and_reports_spread(self):
        bars = sample_bars()
        result = calculate_roster(bars, "BTCUSD", "1m")
        item = result["indicators"]["ema_9_21"]
        self.assertEqual(item["status"], "CALCULATED_CANDIDATE")
        self.assertIsNotNone(item["value"]["ema9"])
        self.assertIsNotNone(item["value"]["ema21"])
        self.assertEqual(item["value"]["bias"], "bullish")
        self.assertGreater(item["value"]["spread"], 0)
        self.assertGreater(item["value"]["spread_percent"], 0)
        bad = [dict(bar) for bar in bars]
        bad[-1]["close"] = float("nan")
        with self.assertRaises(ValueError):
            calculate_roster(bad, "BTCUSD", "1m")

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

    def test_news_filter_requires_validated_fresh_calendar_and_blocks_near_event(self):
        now = datetime.now(timezone.utc)
        event = {
            "feed_status": "LIVE",
            "validated": True,
            "source": "test-calendar",
            "currency": "USD",
            "impact": "high",
            "timestamp": (now + timedelta(minutes=10)).isoformat(),
            "observed_at": now.isoformat(),
            "title": "Test high-impact event",
        }
        result = calculate_roster(sample_bars(), "XAUUSD", "1m", news_events=[event])
        item = result["indicators"]["us_high_impact_news"]
        self.assertEqual(item["status"], "VALIDATED_EVENT_WINDOW")
        self.assertTrue(item["value"]["blocked"])

    def test_news_filter_fails_closed_on_unvalidated_calendar(self):
        event = {"currency": "USD", "impact": "high", "timestamp": "2026-10-11T18:00:00Z"}
        result = calculate_roster(sample_bars(), "XAUUSD", "1m", news_events=[event])
        item = result["indicators"]["us_high_impact_news"]
        self.assertIsNone(item["value"])
        self.assertIn("UNAVAILABLE", item["status"])

    def test_invalid_bars_are_rejected(self):
        bars = sample_bars()
        bars[-1]["high"] = bars[-1]["low"] - 1
        with self.assertRaises(ValueError):
            calculate_roster(bars, "XAUUSD", "1m")

    def test_engine2_rejects_non_chronological_candles(self):
        bars = sample_bars()
        bars[-1]["timestamp"] = bars[-2]["timestamp"]
        with self.assertRaisesRegex(ValueError, "strictly increasing"):
            calculate_roster(bars, "XAUUSD", "1m")

    def test_engine2_rejects_non_positive_prices(self):
        bars = sample_bars()
        bars[-1]["low"] = 0.0
        with self.assertRaisesRegex(ValueError, "non-positive OHLC prices"):
            calculate_roster(bars, "XAUUSD", "1m")

    def test_engine_exposes_diagnostics_but_never_emits_signal_yet(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        self.assertEqual(len(result["indicator_diagnostics"]["indicators"]), 20)
        self.assertEqual(result["signal"], "WAIT")
        self.assertIsNone(result["confidence"])
        self.assertFalse(result["autoTrading"])


    def test_engine_2_detects_recent_unfilled_fvg_and_marks_fill_state(self):
        bars = []
        for i in range(80):
            bars.append({"timestamp": 1_800_000_000 + i * 60, "open": 100.0,
                         "high": 101.0, "low": 99.0, "close": 100.0, "volume": 100.0})
        bars[-3].update({"open": 100.2, "high": 101.0, "low": 99.8, "close": 100.8})
        bars[-2].update({"open": 102.55, "high": 102.8, "low": 102.5, "close": 102.6})
        bars[-1].update({"open": 102.8, "high": 103.0, "low": 102.7, "close": 102.8})
        result = calculate_roster(bars, "BTCUSD", "1m")
        fvg = result["indicators"]["fvg"]
        self.assertEqual(fvg["status"], "CALCULATED_CANDIDATE")
        self.assertEqual(fvg["value"]["type"], "bullish")
        self.assertEqual(fvg["value"]["fill_status"], "unfilled")
        self.assertLess(fvg["value"]["lower"], fvg["value"]["upper"])

        # The later candle fully trades back through the gap's lower edge.
        bars[-1].update({"open": 100.4, "high": 100.8, "low": 100.0, "close": 100.2})
        result = calculate_roster(bars, "BTCUSD", "1m")
        self.assertNotEqual(result["indicators"]["fvg"]["value"], fvg["value"])

    def test_engine_2_detects_engulfing_candle_pattern(self):
        bars = sample_bars()
        bars[-2].update({"open": 2607.0, "high": 2607.2, "low": 2606.5, "close": 2606.6})
        bars[-1].update({"open": 2606.4, "high": 2607.5, "low": 2606.2, "close": 2607.3})
        result = calculate_roster(bars, "XAUUSD", "1m")
        self.assertEqual(result["indicators"]["candle_patterns"]["value"], "bullish engulfing candidate")

    def test_engine_2_support_resistance_is_explicitly_descriptive(self):
        result = calculate_roster(sample_bars(), "BTCUSD", "1m")
        item = result["indicators"]["support_resistance"]
        self.assertIn(item["status"], {"CALCULATED_CANDIDATE", "RECENT_RANGE_FALLBACK"})
        self.assertIn("support", item["value"])
        self.assertIn("resistance", item["value"])
        self.assertIn("not guaranteed", item["note"])



class Engine2GoldGateTests(unittest.TestCase):
    """Regression checks: Engine 2 outputs must stay visible but unapproved for scoring."""

    def test_engine2_has_exact_locked_five_indicator_mapping(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        engine2 = result["engines"]["engine_2"]
        expected = {
            "market_structure",
            "structure_prediction",
            "candle_patterns",
            "fvg",
            "support_resistance",
        }
        self.assertEqual({item["id"] for item in engine2["indicators"]}, expected)
        self.assertEqual(engine2["expected_indicators"], 5)
        self.assertEqual(engine2["returned_indicators"], 5)
        self.assertTrue(engine2["mapping_complete"])
        self.assertFalse(engine2["ready_for_signal"])

    def test_engine2_candidates_are_not_misreported_as_validated_live(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        engine2 = result["engines"]["engine_2"]
        self.assertTrue(all(item["status"] != "VALIDATED_LIVE" for item in engine2["indicators"]))
        self.assertFalse(engine2["data_validated"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_engine5_lists_unverified_engine2_ids_until_live_validation(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        unverified = set(result["engine_5"]["unverified_indicator_ids"])
        self.assertTrue({
            "market_structure", "structure_prediction", "candle_patterns",
            "fvg", "support_resistance",
        }.issubset(unverified))
        self.assertFalse(result["engine_5"]["ready_for_signal"])
        self.assertEqual(result["engine_5"]["signal"], "WAIT")


if __name__ == "__main__":
    unittest.main()

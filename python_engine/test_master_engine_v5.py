import unittest

from master_engine_v5 import evaluate_master, health


def aligned_votes(value=1.0):
    return {
        "trend": {"EMA": value, "MACD": value},
        "momentum": {"RSI": value, "ROC": value},
        "structure_liquidity": {"MARKET_STRUCTURE": value, "FVG": value},
        "volume_price_action": {"VWAP": value, "PRICE_ACTION": value},
    }


class MasterEngineV5Tests(unittest.TestCase):
    def test_strong_aligned_votes_produce_directional_signal(self):
        result = evaluate_master(
            aligned_votes(), regime="TRENDING", timeframe="5m",
            structure_score=1.0, price_action_score=1.0, symbol="XAUUSD",
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["signal"], "BUY")
        self.assertEqual(result["master_engine"]["supporting_engines"], 4)
        self.assertAlmostEqual(sum(result["weights"].values()), 1.0, places=3)
        self.assertFalse(result["autoTrading"])

    def test_bearish_votes_produce_sell(self):
        result = evaluate_master(aligned_votes(-1.0), regime="RANGING", timeframe="1m")
        self.assertEqual(result["signal"], "SELL")

    def test_stale_data_fails_closed(self):
        result = evaluate_master(aligned_votes(), regime="TRENDING", timeframe="1m", data_fresh=False)
        self.assertEqual(result["signal"], "WAIT")
        self.assertIn("stale", result["reason"])

    def test_fewer_than_three_engines_wait(self):
        result = evaluate_master(
            {"trend": {"EMA": 1}, "momentum": {"RSI": 1}},
            regime="TRENDING", timeframe="1m",
        )
        self.assertEqual(result["signal"], "WAIT")
        self.assertIsNone(result["confidence"])

    def test_invalid_timeframe_waits(self):
        result = evaluate_master(aligned_votes(), regime="TRENDING", timeframe="2m")
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")

    def test_missing_indicator_does_not_get_a_vote(self):
        result = evaluate_master(
            {
                "trend": {"EMA": 1, "MACD": None},
                "momentum": {"RSI": 1},
                "structure_liquidity": {"MARKET_STRUCTURE": 1},
                "volume_price_action": {"VWAP": 1},
            },
            regime="TRENDING", timeframe="15m",
        )
        self.assertEqual(result["engines"]["trend"]["indicator_count"], 1)
        self.assertEqual(result["master_engine"]["available_engines"], 4)

    def test_health_marks_signal_only(self):
        self.assertFalse(health()["autoTrading"])
        self.assertFalse(health()["confidence_is_win_probability"])


if __name__ == "__main__":
    unittest.main()

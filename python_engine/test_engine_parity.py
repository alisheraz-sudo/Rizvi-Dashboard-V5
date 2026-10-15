import unittest

from engine_parity import ALGORITHMS, calculate_features, evaluate, normalize_bars, score_algorithm


def sample_bars(n=80, direction=1):
    rows = []
    price = 2300.0
    for i in range(n):
        open_price = price
        price += direction * (0.15 + (i % 4) * 0.02)
        rows.append({
            "time": 1_800_000_000 + i * 60,
            "open": open_price,
            "high": max(open_price, price) + 0.1,
            "low": min(open_price, price) - 0.1,
            "close": price,
            "volume": 100 + i,
        })
    return rows


class EngineParityTests(unittest.TestCase):
    def test_all_five_algorithms_are_evaluated(self):
        report = evaluate(sample_bars())
        self.assertEqual(set(report["algorithms"]), set(ALGORITHMS))
        self.assertEqual(len(report["ranking"]), 5)

    def test_ohlc_aliases_normalize(self):
        bars = normalize_bars([{"t": 100, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}])
        self.assertEqual(len(bars), 1)
        self.assertEqual(bars[0]["close"], 1.5)

    def test_invalid_ohlc_rows_are_dropped(self):
        bars = normalize_bars([{"open": 1, "high": 2, "low": 0, "close": 1}, {"open": "bad", "high": 2, "low": 0, "close": 1}])
        self.assertEqual(len(bars), 1)

    def test_volume_profile_limitation_is_explicit(self):
        features = calculate_features(normalize_bars(sample_bars()))
        self.assertEqual(features["volumeProfile"], 0)

    def test_confidence_and_action_ranges(self):
        report = evaluate(sample_bars())
        for row in report["algorithms"].values():
            self.assertGreaterEqual(row["confidence"], 0)
            self.assertLessEqual(row["confidence"], 100)
            self.assertIn(row["action"], {"BUY", "SELL", "WAIT"})

    def test_zero_features_produce_wait(self):
        features = {key: 0 for key in ("trend", "vwap", "momentum", "rsi", "candle", "liquidity", "divergence", "volumeProfile")}
        row = score_algorithm("A_TREND", features)
        self.assertEqual(row["action"], "WAIT")
        self.assertEqual(row["confidence"], 50)

    def test_prototype_cannot_be_mistaken_for_production(self):
        self.assertFalse(evaluate(sample_bars())["production_ready"])


if __name__ == "__main__":
    unittest.main()

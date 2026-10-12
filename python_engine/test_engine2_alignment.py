"""Regression tests for canonical Engine 2 mapping and fail-closed validation."""
import unittest

from indicator_registry import roster_snapshot
from regime_adaptive_engine import evaluate


ENGINE_2_IDS = [
    "market_structure",
    "structure_prediction",
    "candle_patterns",
    "fvg",
    "support_resistance",
]


def sample_bars(count=100):
    bars = []
    start = 1_800_000_000
    price = 2600.0
    for i in range(count):
        open_ = price
        close = price + (0.25 if i % 3 else -0.15)
        high = max(open_, close) + 0.2 + (i % 4) * 0.01
        low = min(open_, close) - 0.18
        bars.append({
            "timestamp": start + i * 60,
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": 100 + i,
        })
        price = close
    return bars


class Engine2AlignmentTests(unittest.TestCase):
    def test_registry_keeps_five_approved_engine2_indicators(self):
        roster = roster_snapshot()
        engine2 = next(engine for engine in roster["engines"] if engine["id"] == 2)
        self.assertEqual(engine2["name"], "Structure & Liquidity")
        self.assertEqual([item["id"] for item in engine2["indicators"]], ENGINE_2_IDS)
        self.assertEqual(engine2["indicator_count"], 5)

    def test_engine2_report_routes_all_five_calculations_without_claiming_live_validation(self):
        result = evaluate(sample_bars(), symbol="XAUUSD", timeframe="1m")
        self.assertTrue(result["ok"])
        engine2 = result["engines"]["engine_2"]
        self.assertEqual(engine2["name"], "Structure & Liquidity")
        self.assertEqual(engine2["indicator_ids"], ENGINE_2_IDS)
        self.assertEqual(engine2["expected_indicators"], 5)
        self.assertEqual(engine2["returned_indicators"], 5)
        self.assertTrue(engine2["mapping_complete"])
        self.assertEqual(engine2["validated_calculations"], 0)
        self.assertFalse(engine2["data_validated"])
        self.assertFalse(engine2["ready_for_signal"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])


if __name__ == "__main__":
    unittest.main()

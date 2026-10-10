"""Tests for the isolated BTC feed-to-engine bridge; no network calls."""
import unittest
from python_engine.btc_bridge import normalize_btc_candles, evaluate_btc


def btc_bars(count=80, start=1_800_000_000):
    rows = []
    previous = 60000.0
    for i in range(count):
        close = 60000.0 + i * 5
        rows.append({
            "time": (start + i * 60) * 1000,
            "o": previous, "h": max(previous, close) + 10,
            "l": min(previous, close) - 10, "c": close, "v": 2.5 + i,
        })
        previous = close
    return rows


class BTCBridgeTests(unittest.TestCase):
    def test_normalizes_common_short_field_names_and_milliseconds(self):
        bars = normalize_btc_candles(btc_bars(2))
        self.assertEqual(len(bars), 2)
        self.assertEqual(bars[0]["timestamp"], 1_800_000_000)
        self.assertEqual(bars[0]["close"], 60000.0)
        self.assertEqual(bars[0]["volume"], 2.5)

    def test_normalizes_binance_kline_array(self):
        bars = normalize_btc_candles([[1_800_000_000_000, "60000", "60020",
                                      "59990", "60010", "1.2", 1_800_000_059_999]])
        self.assertEqual(bars[0]["timestamp"], 1_800_000_000)
        self.assertEqual(bars[0]["close"], 60010.0)

    def test_rejects_unclosed_websocket_candle(self):
        with self.assertRaisesRegex(ValueError, "still forming"):
            normalize_btc_candles({"k": {"t": 1_800_000_000_000, "o": "10",
                "h": "11", "l": "9", "c": "10", "v": "1", "x": False}})

    def test_rejects_empty_payload_safely(self):
        result = evaluate_btc([], now_seconds=1_800_000_100)
        self.assertFalse(result["ok"])
        self.assertEqual(result["signal"], "WAIT")
        self.assertFalse(result["autoTrading"])

    def test_routes_normalized_btc_into_master_engine_without_trading(self):
        rows = btc_bars()
        result = evaluate_btc(rows, timeframe="1m",
                              now_seconds=1_800_000_000 + 79 * 60 + 5)
        self.assertEqual(result["symbol"], "BTCUSD")
        self.assertEqual(result["bridge"]["normalized_bars"], 80)
        self.assertFalse(result["autoTrading"])
        self.assertIn(result["signal"], {"BUY", "SELL", "WAIT"})

    def test_rejects_duplicate_timestamps(self):
        rows = btc_bars(2)
        rows[1]["time"] = rows[0]["time"]
        with self.assertRaisesRegex(ValueError, "unique and increasing"):
            normalize_btc_candles(rows)


if __name__ == "__main__":
    unittest.main()

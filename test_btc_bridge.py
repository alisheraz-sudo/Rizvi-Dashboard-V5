"""Tests for the isolated BTC feed-to-engine bridge; no network calls."""
import unittest
import json
from unittest.mock import patch
from python_engine.btc_bridge import (normalize_btc_candles, evaluate_btc,
    fetch_binance_btc_candles)


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
        self.assertIn(result["signal"], {"BUY", "SELL", "WEAK_BUY", "WEAK_SELL", "WAIT"})

    def test_live_adapter_uses_only_closed_candles(self):
        now = 1_800_000_000
        rows = []
        for i in range(60):
            open_ms = int((now - 60 * (60 - i)) * 1000)
            rows.append([open_ms, "60000", "60010", "59990", "60005", "1", open_ms + 59999])
        rows.append([int(now * 1000), "60005", "60020", "60000", "60015", "1.1", int(now * 1000) + 59999])
        class FakeResponse:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return json.dumps(rows).encode("utf-8")
        with patch("python_engine.btc_bridge.urlopen", return_value=FakeResponse()):
            bars = fetch_binance_btc_candles("1m", 60, now_seconds=now)
        self.assertEqual(len(bars), 60)
        self.assertLess(bars[-1]["timestamp"], now)

    def test_live_adapter_rejects_unsupported_timeframe(self):
        with self.assertRaisesRegex(ValueError, "Unsupported Binance timeframe"):
            fetch_binance_btc_candles("2m", 60, now_seconds=1_800_000_000)

    def test_rejects_duplicate_timestamps(self):
        rows = btc_bars(2)
        rows[1]["time"] = rows[0]["time"]
        with self.assertRaisesRegex(ValueError, "unique and increasing"):
            normalize_btc_candles(rows)


if __name__ == "__main__":
    unittest.main()

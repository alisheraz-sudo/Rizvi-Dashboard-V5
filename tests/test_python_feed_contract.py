import unittest
from connectivity_py.feed_contract import validate_snapshot

NOW = 1_800_000_000.0

def make_snapshot(*, symbol="XAU/USD", timeframe="1M", status_ok=True, bars=None):
    if bars is None:
        bars = [{"t": NOW - (49 - i) * 60, "o": 4000+i, "h": 4002+i, "l": 3999+i, "c": 4001+i, "v": 10} for i in range(50)]
    return {
        "version": 1,
        "symbol": symbol,
        "timeframe": timeframe,
        "status": {"ok": status_ok, "stale": False, "symbol": symbol, "timeframe": timeframe},
        "bars": bars,
        "capturedAt": NOW * 1000,
    }

class FeedContractTests(unittest.TestCase):
    def test_accepts_fresh_consistent_gold_snapshot(self):
        result = validate_snapshot(make_snapshot(), now=NOW)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["symbol"], "XAU/USD")
        self.assertEqual(result["bar_count"], 50)
        self.assertFalse(result["signal_generation"])
        self.assertFalse(result["auto_trading"])

    def test_rejects_legacy_btc_symbol(self):
        result = validate_snapshot(make_snapshot(symbol="BTCUSD"), now=NOW)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "symbol_not_supported")

    def test_rejects_status_symbol_timeframe_mismatch(self):
        snapshot = make_snapshot()
        snapshot["status"]["symbol"] = "BTCUSD"
        result = validate_snapshot(snapshot, now=NOW)
        self.assertEqual(result["reason"], "status_snapshot_symbol_timeframe_mismatch")

    def test_rejects_unhealthy_feed(self):
        result = validate_snapshot(make_snapshot(status_ok=False), now=NOW)
        self.assertEqual(result["reason"], "feed_status_not_healthy")

    def test_rejects_stale_latest_bar(self):
        snapshot = make_snapshot()
        snapshot["bars"][-1]["t"] = NOW - 600
        result = validate_snapshot(snapshot, now=NOW)
        self.assertEqual(result["reason"], "latest_bar_stale")

    def test_rejects_malformed_ohlc(self):
        snapshot = make_snapshot()
        snapshot["bars"][4]["h"] = 1
        result = validate_snapshot(snapshot, now=NOW)
        self.assertEqual(result["reason"], "malformed_ohlc_bar")

    def test_rejects_insufficient_history(self):
        result = validate_snapshot(make_snapshot(bars=make_snapshot()["bars"][:10]), now=NOW)
        self.assertEqual(result["reason"], "insufficient_bars")

    def test_normalizes_epoch_milliseconds(self):
        snapshot = make_snapshot()
        snapshot["bars"][-1]["t"] *= 1000
        result = validate_snapshot(snapshot, now=NOW)
        self.assertTrue(result["ok"], result)
        self.assertLessEqual(result["latest_age_seconds"], 5)

if __name__ == "__main__":
    unittest.main()

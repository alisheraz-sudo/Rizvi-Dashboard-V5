import unittest
from datetime import datetime, timezone

from snapshot_recovery import assess_recovery, canonical_symbol, canonical_timeframe, epoch_ms, normalize_bars

NOW = 1_800_000_000_000


def good_bars(count=25, latest_age_ms=20_000):
    latest = NOW - latest_age_ms
    return [{"t": latest - (count - 1 - i) * 60_000, "o": 2300+i, "h": 2302+i,
             "l": 2299+i, "c": 2301+i, "v": 10} for i in range(count)]


def good_status(**overrides):
    data = {"ok": True, "live": True, "stale": False, "symbol": "XAU/USD",
            "timeframe": "1M", "updatedAt": NOW - 5_000}
    data.update(overrides)
    return data


class SnapshotRecoveryTests(unittest.TestCase):
    def test_epoch_units_and_iso_timestamp(self):
        self.assertEqual(epoch_ms(NOW / 1000), NOW)
        self.assertEqual(epoch_ms(NOW), NOW)
        iso = datetime.fromtimestamp(NOW / 1000, timezone.utc).isoformat()
        self.assertAlmostEqual(epoch_ms(iso), NOW, delta=1)

    def test_symbol_and_timeframe_aliases(self):
        self.assertEqual(canonical_symbol("XAU/USD"), "XAUUSD")
        self.assertEqual(canonical_symbol("GOLD"), "XAUUSD")
        self.assertEqual(canonical_timeframe("M1"), "1M")

    def test_fresh_snapshot_candidate_is_eligible(self):
        decision = assess_recovery(selected_symbol="XAU/USD", selected_timeframe="1M",
                                   status=good_status(), bars=good_bars(), now_ms=NOW,
                                   max_age_ms=180_000)
        self.assertTrue(decision.eligible, decision.reasons)
        self.assertEqual(decision.reasons, ())
        self.assertEqual(decision.valid_bars, 25)

    def test_rejects_symbol_and_timeframe_mismatch(self):
        decision = assess_recovery(selected_symbol="XAU/USD", selected_timeframe="1M",
                                   status=good_status(symbol="BTCUSD", timeframe="5M"),
                                   bars=good_bars(), now_ms=NOW, max_age_ms=180_000)
        self.assertIn("status-symbol-mismatch", decision.reasons)
        self.assertIn("status-timeframe-mismatch", decision.reasons)

    def test_rejects_stale_status_and_stale_latest_bar(self):
        decision = assess_recovery(selected_symbol="XAU/USD", selected_timeframe="1M",
                                   status=good_status(updatedAt=NOW-400_000),
                                   bars=good_bars(latest_age_ms=400_000), now_ms=NOW,
                                   max_age_ms=180_000)
        self.assertIn("status-age-out-of-range", decision.reasons)
        self.assertIn("latest-bar-stale-or-invalid", decision.reasons)

    def test_rejects_non_live_status_and_insufficient_bars(self):
        decision = assess_recovery(selected_symbol="XAU/USD", selected_timeframe="1M",
                                   status=good_status(live=False, stale=True), bars=good_bars(5),
                                   now_ms=NOW, max_age_ms=180_000)
        self.assertIn("status-not-live", decision.reasons)
        self.assertIn("status-stale", decision.reasons)
        self.assertIn("raw-bars-insufficient", decision.reasons)

    def test_rejects_invalid_ohlc_and_future_bars(self):
        rows = good_bars(22)
        rows[0]["h"] = 1
        rows.append({"t": NOW+60_000, "o": 1, "h": 2, "l": 0.5, "c": 1.5})
        normalized = normalize_bars(rows, NOW)
        self.assertEqual(len(normalized), 21)


if __name__ == "__main__":
    unittest.main(verbosity=2)

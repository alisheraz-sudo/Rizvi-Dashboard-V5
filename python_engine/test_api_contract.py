"""Request-contract tests for the engine HTTP API."""
import unittest
from api_contract import validate_evaluation_request


def make_bars(last=1_800_000_000, count=60, step=60):
    return [
        {"timestamp": last - (count - 1 - i) * step,
         "open": 2600.0, "high": 2601.0, "low": 2599.0,
         "close": 2600.5, "volume": 100.0}
        for i in range(count)
    ]


class ApiContractTests(unittest.TestCase):
    def request(self, **updates):
        payload = {"symbol": "XAUUSD", "timeframe": "1m", "bars": make_bars()}
        payload.update(updates)
        return payload

    def test_valid_gold_and_bitcoin_requests_pass(self):
        now = 1_800_000_000
        self.assertIsNone(validate_evaluation_request(self.request(), now=now))
        self.assertIsNone(validate_evaluation_request(
            self.request(symbol="BTCUSD", timeframe="5m", bars=make_bars(last=now, step=300)),
            now=now))

    def test_unsupported_symbol_and_timeframe_are_rejected(self):
        self.assertIn("symbol", validate_evaluation_request(self.request(symbol="UNKNOWN"), now=1_800_000_000))
        self.assertIn("timeframe", validate_evaluation_request(self.request(timeframe="2m"), now=1_800_000_000))

    def test_stale_and_future_candles_are_rejected(self):
        now = 1_800_000_000
        self.assertIn("stale", validate_evaluation_request(
            self.request(bars=make_bars(last=now - 181)), now=now))
        self.assertIn("future", validate_evaluation_request(
            self.request(bars=make_bars(last=now + 120)), now=now))

    def test_too_few_or_unordered_candles_are_rejected(self):
        now = 1_800_000_000
        self.assertIn("60", validate_evaluation_request(
            self.request(bars=make_bars(last=now, count=59)), now=now))
        bars = make_bars(last=now)
        bars[-1]["timestamp"] = bars[-2]["timestamp"]
        self.assertIn("strictly increasing", validate_evaluation_request(
            self.request(bars=bars), now=now))

    def test_iso_and_millisecond_timestamps_are_supported(self):
        now = 1_800_000_000
        iso_bars = make_bars(last=now)
        for bar in iso_bars:
            from datetime import datetime, timezone
            bar["timestamp"] = datetime.fromtimestamp(bar["timestamp"], timezone.utc).isoformat()
        self.assertIsNone(validate_evaluation_request(self.request(bars=iso_bars), now=now))
        ms_bars = make_bars(last=now * 1000)
        self.assertIsNone(validate_evaluation_request(self.request(bars=ms_bars), now=now))


if __name__ == "__main__":
    unittest.main()

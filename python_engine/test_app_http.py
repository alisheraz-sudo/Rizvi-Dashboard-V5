"""HTTP-level tests for the isolated indicator diagnostics API."""
import json
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import app


class IndicatorAppHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def bars(self, last_age=0):
        now = int(time.time()) - last_age
        rows = []
        for i in range(60):
            close = 2600.0 + i * 0.1
            rows.append({
                "timestamp": now - (59 - i) * 60,
                "open": close - 0.05,
                "high": close + 0.10,
                "low": close - 0.10,
                "close": close,
                "volume": 100 + i,
            })
        return rows

    def post(self, payload, content_type="application/json"):
        request = Request(
            self.base_url + "/evaluate",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": content_type},
            method="POST",
        )
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def test_health_exposes_locked_roster_and_keeps_trading_off(self):
        with urlopen(self.base_url + "/health", timeout=3) as response:
            body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(response.status, 200)
        self.assertEqual(body["indicator_inventory"], 20)
        self.assertEqual(body["indicator_engine_counts"], {"1": 6, "2": 5, "3": 4, "4": 5})
        self.assertEqual(body["engines"], 5)
        self.assertFalse(body["autoTrading"])
        self.assertFalse(body["indicator_roster_ready"])

    def test_valid_gold_request_returns_diagnostics_but_not_a_trade_signal(self):
        status, body = self.post({"symbol": "XAUUSD", "timeframe": "1m", "bars": self.bars()})
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["indicator_roster"]["actual_count"], 20)
        self.assertEqual(body["indicator_roster"]["engine_counts"], {"1": 6, "2": 5, "3": 4, "4": 5})
        self.assertEqual(body["signal"], "WAIT")
        self.assertIsNone(body["confidence"])
        self.assertFalse(body["autoTrading"])
        self.assertFalse(body["indicator_diagnostics"]["ready_for_signal"])


    def test_valid_btc_request_returns_diagnostics_but_not_a_trade_signal(self):
        status, body = self.post({"symbol": "BTCUSD", "timeframe": "1m", "bars": self.bars()})
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["indicator_roster"]["actual_count"], 20)
        self.assertEqual(body["indicator_roster"]["engine_counts"], {"1": 6, "2": 5, "3": 4, "4": 5})
        self.assertEqual(body["signal"], "WAIT")
        self.assertIsNone(body["confidence"])
        self.assertFalse(body["autoTrading"])
        self.assertFalse(body["indicator_diagnostics"]["ready_for_signal"])

    def test_stale_candles_fail_closed(self):
        status, body = self.post({"symbol": "BTCUSD", "timeframe": "1m", "bars": self.bars(last_age=600)})
        self.assertEqual(status, 422)
        self.assertEqual(body["signal"], "WAIT")
        self.assertIsNone(body["confidence"])
        self.assertFalse(body["autoTrading"])
        self.assertIn("stale", body["reason"])

    def test_wrong_content_type_is_rejected(self):
        status, body = self.post({"symbol": "XAUUSD", "timeframe": "1m", "bars": self.bars()}, "text/plain")
        self.assertEqual(status, 415)
        self.assertEqual(body["signal"], "WAIT")
        self.assertFalse(body["autoTrading"])


if __name__ == "__main__":
    unittest.main()

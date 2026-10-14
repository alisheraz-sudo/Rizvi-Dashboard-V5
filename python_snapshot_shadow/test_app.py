import json, os, subprocess, sys, time, unittest, urllib.error, urllib.request
ROOT = os.path.dirname(os.path.dirname(__file__))
APP = os.path.join(ROOT, "python_snapshot_shadow", "app.py")

class ShadowApiSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 18765
        cls.proc = subprocess.Popen([sys.executable, APP], env={**os.environ, "PYTHONPATH": ROOT, "PORT": str(cls.port), "SHADOW_API_TOKEN": "test-token"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.base = f"http://127.0.0.1:{cls.port}"
        for _ in range(40):
            try:
                urllib.request.urlopen(cls.base + "/health", timeout=0.2).read()
                break
            except Exception:
                time.sleep(0.05)
        else:
            raise RuntimeError("shadow API failed to start")
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=3)
    def request(self, path, payload=None, token=None):
        data = None if payload is None else json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}
        if token:
            headers["X-Rizvi-Shadow-Token"] = token
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method="GET" if data is None else "POST")
        try:
            with urllib.request.urlopen(req, timeout=2) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())
    def test_health_endpoint(self):
        code, body = self.request("/health")
        self.assertEqual(code, 200)
        self.assertEqual(body["mode"], "shadow-only")
    def test_assess_requires_auth(self):
        code, body = self.request("/assess", {"hello": "world"})
        self.assertEqual(code, 401)
        self.assertEqual(body["error"], "unauthorized")
    def test_assess_reports_eligible_without_mutating_anything(self):
        now = 1_800_000_000_000
        bars = [{"t": now-20_000-(24-i)*60_000, "o": 2300+i, "h": 2302+i, "l": 2299+i, "c": 2301+i} for i in range(25)]
        payload = {"selected_symbol": "XAU/USD", "selected_timeframe": "1M", "now_ms": now, "max_age_ms": 180000,
          "status": {"ok": True, "live": True, "stale": False, "symbol": "XAU/USD", "timeframe": "1M", "updatedAt": now-5000}, "bars": bars}
        code, body = self.request("/assess", payload, "test-token")
        self.assertEqual(code, 200, body)
        self.assertTrue(body["decision"]["eligible"], body["decision"]["reasons"])
        self.assertEqual(body["mode"], "shadow-only")

if __name__ == "__main__":
    unittest.main(verbosity=2)

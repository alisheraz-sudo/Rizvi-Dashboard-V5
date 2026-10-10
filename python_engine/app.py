"""Minimal HTTP wrapper for the isolated Master Engine 5.

Run with: python app.py
Endpoints: GET /health, POST /evaluate
Signal-only; no order execution and no UI dependencies.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    from .master_engine5 import evaluate
    from .regime_adaptive_engine import health
except ImportError:  # direct execution from python_engine directory
    from master_engine5 import evaluate
    from regime_adaptive_engine import health

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))
ALLOWED_ORIGIN = os.environ.get("DASHBOARD_ORIGIN", "").strip()
MAX_BODY_BYTES = 1_000_000


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self.headers.get("Origin", "")
        if ALLOWED_ORIGIN and origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        if ALLOWED_ORIGIN and origin == ALLOWED_ORIGIN:
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
            self.end_headers()
        else:
            self._send(403, {"ok": False, "error": "Origin not allowed"})

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self._send(200, health())
        else:
            self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/evaluate":
            self._send(404, {"ok": False, "error": "Not found"})
            return
        content_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if content_type != "application/json":
            self._send(415, {"ok": False, "signal": "WAIT", "error": "Content-Type must be application/json", "autoTrading": False})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(413, {"ok": False, "signal": "WAIT", "error": "Request body is empty or too large", "autoTrading": False})
            return
        try:
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("bars"), list):
                raise ValueError("JSON body must contain a bars array")
            result = evaluate(
                data["bars"],
                symbol=str(data.get("symbol", "BTCUSD"))[:32],
                timeframe=str(data.get("timeframe", "1m"))[:8],
                order_flow=data.get("order_flow") if isinstance(data.get("order_flow"), dict) else None,
            )
            self._send(200 if result.get("ok") else 422, result)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            self._send(400, {"ok": False, "signal": "WAIT", "error": str(exc), "autoTrading": False})

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

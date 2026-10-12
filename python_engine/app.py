"""Minimal HTTP wrapper for the isolated regime-adaptive engine.

Run with: python app.py
Endpoints: GET /health, POST /evaluate
No order execution. Configure DASHBOARD_ORIGIN if a browser client will call this API.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from api_contract import validate_evaluation_request
from regime_adaptive_engine import evaluate, health
from market_sources import fetch_delta_trade_flow

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8000"))
ALLOWED_ORIGIN = os.environ.get("DASHBOARD_ORIGIN", "").strip()
MAX_BODY_BYTES = 1_000_000


class Handler(BaseHTTPRequestHandler):
    server_version = "RizviRegimeEngine/1.0"

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
        # Query parameters must not turn the health route into a 404.
        if urlsplit(self.path).path.rstrip("/") == "/health":
            self._send(200, health())
        else:
            self._send(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if urlsplit(self.path).path.rstrip("/") != "/evaluate":
            self._send(404, {"ok": False, "error": "Not found"})
            return
        content_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if content_type != "application/json":
            self._send(415, {"ok": False, "signal": "WAIT", "confidence": None, "error": "Content-Type must be application/json", "autoTrading": False})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(413, {"ok": False, "signal": "WAIT", "confidence": None, "error": "Request body is empty or too large", "autoTrading": False})
            return
        try:
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("bars"), list):
                raise ValueError("JSON body must contain a bars array")
            contract_error = validate_evaluation_request(data)
            if contract_error:
                print("EVALUATION_REJECTED: %s" % contract_error, flush=True)
                self._send(422, {"ok": False, "signal": "WAIT", "confidence": None,
                                 "reason": contract_error, "autoTrading": False})
                return
            symbol = str(data.get("symbol", "BTCUSD")).strip().upper()[:32]
            order_flow = data.get("order_flow") if isinstance(data.get("order_flow"), dict) else None
            # Only map BTCUSD aliases to the matching Delta BTCUSD contract.
            # BTCUSDT is deliberately not substituted with BTCUSD.
            canonical_symbol = symbol.replace("/", "").replace("-", "")
            if order_flow is None and canonical_symbol == "BTCUSD":
                # Public exchange lookup is best-effort and must not stall the signal-only API.
                order_flow = fetch_delta_trade_flow("BTCUSD")
            result = evaluate(
                data["bars"],
                symbol=symbol,
                timeframe=str(data.get("timeframe", "1m")).strip().lower()[:8],
                order_flow=order_flow,
                dxy_bars=data.get("dxy_bars") if isinstance(data.get("dxy_bars"), list) else None,
                news_events=data.get("news_events") if isinstance(data.get("news_events"), list) else None,
                higher_timeframe_bars=data.get("higher_timeframe_bars") if isinstance(data.get("higher_timeframe_bars"), list) else None,
            )
            self._send(200 if result.get("ok") else 422, result)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            self._send(400, {"ok": False, "signal": "WAIT", "error": str(exc), "autoTrading": False})

    def log_message(self, fmt, *args):
        # Keep request logs concise; do not log market payloads.
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

"""Isolated HTTP API for shadow-testing Engine 5 snapshot recovery; never trades or mutates production state."""
from __future__ import annotations
import hmac, json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from snapshot_recovery import assess_recovery

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8080"))
TOKEN = os.environ.get("SHADOW_API_TOKEN", "")
MAX_BODY = 1_000_000

class Handler(BaseHTTPRequestHandler):
    server_version = "RizviSnapshotShadow/0.1"
    def _send(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self) -> None:
        if self.path == "/health":
            self._send(200, {"ok": True, "service": "rizvi-python-snapshot-shadow", "mode": "shadow-only"})
        else:
            self._send(404, {"ok": False, "error": "not-found"})
    def do_POST(self) -> None:
        if self.path != "/assess":
            self._send(404, {"ok": False, "error": "not-found"})
            return
        if not TOKEN:
            self._send(503, {"ok": False, "error": "shadow-api-token-not-configured"})
            return
        if not hmac.compare_digest(self.headers.get("X-Rizvi-Shadow-Token", ""), TOKEN):
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > MAX_BODY:
                self._send(413, {"ok": False, "error": "invalid-body-size"})
                return
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("body must be an object")
            required = ("selected_symbol", "selected_timeframe", "now_ms", "max_age_ms", "status", "bars")
            missing = [key for key in required if key not in payload]
            if missing:
                self._send(400, {"ok": False, "error": "missing-fields", "fields": missing})
                return
            decision = assess_recovery(selected_symbol=str(payload["selected_symbol"]),
                selected_timeframe=str(payload["selected_timeframe"]), status=payload["status"],
                bars=payload["bars"], now_ms=float(payload["now_ms"]), max_age_ms=float(payload["max_age_ms"]),
                minimum_bars=int(payload.get("minimum_bars", 21)))
            self._send(200, {"ok": True, "mode": "shadow-only", "decision": decision.to_dict()})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self._send(400, {"ok": False, "error": "invalid-request", "detail": str(exc)[:160]})
    def log_message(self, fmt: str, *args: Any) -> None:
        # Do not log secrets or market payloads.
        return

if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

"""Fail-closed API validation for normalized market-candle requests."""
from datetime import datetime, timezone
from math import isfinite
import time

SUPPORTED_TIMEFRAMES = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600}
SYMBOL_ALIASES = {
    "XAUUSD": "XAUUSD", "XAU/USD": "XAUUSD", "GOLD": "XAUUSD",
    "BTCUSD": "BTCUSD", "BTC-USD": "BTCUSD", "BTCUSDT": "BTCUSDT",
}


def _timestamp_seconds(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and isfinite(float(value)):
        stamp = float(value)
        if stamp > 100_000_000_000_000:
            return stamp / 1_000_000.0
        if stamp > 100_000_000_000:
            return stamp / 1000.0
        return stamp
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except ValueError:
            return None
    return None


def validate_evaluation_request(data, now=None):
    """Return a short rejection reason, or None when the request contract passes."""
    if not isinstance(data, dict):
        return "request must be a JSON object"
    symbol = str(data.get("symbol", "")).strip().upper()
    if symbol not in SYMBOL_ALIASES:
        return "unsupported or missing market symbol"
    timeframe = str(data.get("timeframe", "")).strip().lower()
    if timeframe not in SUPPORTED_TIMEFRAMES:
        return "unsupported or missing timeframe"
    bars = data.get("bars")
    if not isinstance(bars, list) or len(bars) < 60:
        return "at least 60 market candles are required"
    stamps = [_timestamp_seconds(bar.get("timestamp")) if isinstance(bar, dict) else None for bar in bars]
    if any(stamp is None for stamp in stamps):
        return "every candle must have a valid timestamp"
    if any(stamps[i] <= stamps[i - 1] for i in range(1, len(stamps))):
        return "candle timestamps must be strictly increasing"
    current = time.time() if now is None else float(now)
    age = current - stamps[-1]
    if age < -60:
        return "latest candle timestamp is in the future"
    max_age = max(180, SUPPORTED_TIMEFRAMES[timeframe] * 3)
    if age > max_age:
        return "latest candle is stale for the requested timeframe"
    return None

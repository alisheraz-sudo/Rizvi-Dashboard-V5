"""BTC feed bridge for Rizvi Dashboard V5's isolated Python signal engine.

This module is intentionally source-neutral: it accepts already-fetched BTC candles
from the dashboard/backend and normalizes them for Master Engine 5. It makes no
network requests, does not touch the UI, and never places orders.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

try:
    from .master_engine5 import evaluate as evaluate_master
except ImportError:  # direct execution from python_engine directory
    from master_engine5 import evaluate as evaluate_master


ALIASES = {
    "timestamp": ("timestamp", "time", "ts", "t", "open_time", "openTime"),
    "open": ("open", "o"),
    "high": ("high", "h"),
    "low": ("low", "l"),
    "close": ("close", "c"),
    "volume": ("volume", "vol", "v"),
}


def _first(row: Dict[str, Any], keys: Sequence[str]) -> Any:
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def _timestamp(value: Any) -> Any:
    """Preserve numeric seconds/ms and normalize ISO timestamps to UTC epoch seconds."""
    if isinstance(value, bool) or value is None:
        raise ValueError("BTC candle timestamp is missing or invalid")
    if isinstance(value, (int, float)):
        return value / 1000.0 if value > 100_000_000_000 else value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except ValueError as exc:
            # Numeric timestamps occasionally arrive as strings.
            try:
                number = float(value)
                return number / 1000.0 if number > 100_000_000_000 else number
            except ValueError:
                raise ValueError("BTC timestamp must be epoch seconds/ms or ISO-8601") from exc
    raise ValueError("BTC candle timestamp has unsupported type")


def _normalize_row(row: Any) -> Dict[str, Any]:
    # Binance REST/WebSocket kline arrays:
    # [openTime, open, high, low, close, volume, closeTime, ...]
    if isinstance(row, (list, tuple)):
        if len(row) < 6:
            raise ValueError("BTC kline array must contain timestamp and OHLCV")
        values = dict(zip(("timestamp", "open", "high", "low", "close", "volume"), row[:6]))
    elif isinstance(row, dict):
        # Binance WebSocket event wraps the actual candle in "k".
        candle = row.get("k") if isinstance(row.get("k"), dict) else row
        # If this is a websocket kline and it is explicitly unclosed, don't score it.
        if candle is not row and candle.get("x") is False:
            raise ValueError("BTC candle is still forming; pass closed candles only")
        values = {name: _first(candle, aliases) for name, aliases in ALIASES.items()}
    else:
        raise ValueError("Each BTC candle must be a dict or Binance kline array")

    ts = _timestamp(values["timestamp"])
    normalized: Dict[str, Any] = {"timestamp": ts}
    for field in ("open", "high", "low", "close", "volume"):
        try:
            normalized[field] = float(values[field])
        except (TypeError, ValueError) as exc:
            raise ValueError("BTC candle has missing/non-numeric " + field) from exc
    return normalized


def normalize_btc_candles(payload: Any) -> List[Dict[str, Any]]:
    """Normalize common feed payloads; newest candle must be last and all times unique."""
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), (list, tuple)):
            payload = payload["data"]
        elif isinstance(payload.get("candles"), (list, tuple)):
            payload = payload["candles"]
        elif isinstance(payload.get("k"), dict):
            payload = [payload]
        else:
            raise ValueError("BTC payload must contain a candles/data list or kline event")
    if not isinstance(payload, (list, tuple)):
        raise ValueError("BTC payload must be a candle list")
    bars = [_normalize_row(row) for row in payload]
    if not bars:
        raise ValueError("BTC candle feed is empty")
    bars.sort(key=lambda bar: bar["timestamp"])
    timestamps = [bar["timestamp"] for bar in bars]
    if any(timestamps[i] <= timestamps[i - 1] for i in range(1, len(timestamps))):
        raise ValueError("BTC candle timestamps must be unique and increasing")
    return bars


def evaluate_btc(payload: Any, timeframe: str = "1m",
                 now_seconds: Optional[float] = None,
                 order_flow: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Bridge BTC OHLCV into Master Engine 5; invalid input fails safely to WAIT."""
    try:
        bars = normalize_btc_candles(payload)
        result = evaluate_master(
            bars,
            symbol="BTCUSD",
            timeframe=timeframe,
            order_flow=order_flow,
            now_seconds=now_seconds,
        )
        result["bridge"] = {
            "name": "python-btc-bridge",
            "version": "1.0.0",
            "normalized_bars": len(bars),
            "source_connected_by_caller": True,
            "live_feed_verified": False,
        }
        return result
    except (TypeError, ValueError, KeyError, OverflowError) as exc:
        return {
            "ok": False,
            "symbol": "BTCUSD",
            "timeframe": timeframe,
            "signal": "WAIT",
            "reason": "BTC bridge rejected feed data: " + str(exc),
            "autoTrading": False,
            "bridge": {
                "name": "python-btc-bridge",
                "version": "1.0.0",
                "normalized_bars": 0,
                "source_connected_by_caller": False,
                "live_feed_verified": False,
            },
        }

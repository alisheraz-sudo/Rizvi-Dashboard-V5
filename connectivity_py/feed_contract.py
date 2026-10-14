"""Conservative, signal-agnostic validation for the Rizvi V5 canonical OHLC feed.

This module validates transport/data integrity only. It does not calculate indicators,
choose trade direction, alter Engine 5 thresholds, or enable order execution.
"""
from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any, Mapping

CONTRACT_VERSION = 1
MAX_SNAPSHOT_AGE_SECONDS = 45.0
TIMEFRAME_SECONDS = {"1M": 60, "5M": 300, "15M": 900, "30M": 1800, "1H": 3600, "1D": 86400}


def canonical_symbol(value: Any) -> str:
    raw = str(value or "").strip().upper()
    compact = "".join(ch for ch in raw if ch.isalnum())
    if compact in {"XAUUSD", "GOLD"}:
        return "XAU/USD"
    return "UNSUPPORTED"


def canonical_timeframe(value: Any) -> str | None:
    tf = str(value or "").strip().upper()
    return tf if tf in TIMEFRAME_SECONDS else None


def epoch_seconds(value: Any) -> float | None:
    """Accept epoch seconds, epoch milliseconds, numeric strings, or ISO timestamps."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
        if isfinite(number):
            if number > 1e12:
                number /= 1000.0
            return number if number > 0 else None
    except (TypeError, ValueError):
        pass
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except (TypeError, ValueError, OverflowError):
            return None
    return None


def normalize_bar(raw: Mapping[str, Any]) -> dict[str, float] | None:
    if not isinstance(raw, Mapping):
        return None
    stamp = epoch_seconds(raw.get("t", raw.get("time", raw.get("timestamp", raw.get("date")))))
    def number(*keys: str, default: Any = None) -> float | None:
        value = next((raw[k] for k in keys if k in raw and raw[k] is not None), default)
        if isinstance(value, bool):
            return None
        try:
            result = float(value)
            return result if isfinite(result) else None
        except (TypeError, ValueError):
            return None

    o, h, low, close = number("o", "open"), number("h", "high"), number("l", "low"), number("c", "close")
    volume = number("v", "volume", default=0.0)
    if stamp is None or None in (o, h, low, close, volume):
        return None
    if min(o, h, low, close) <= 0 or volume < 0:
        return None
    if h < max(o, low, close) or low > min(o, h, close):
        return None
    return {"t": stamp, "o": o, "h": h, "l": low, "c": close, "v": volume}


def validate_snapshot(snapshot: Any, *, now: float | None = None, min_bars: int = 50) -> dict[str, Any]:
    """Return an explicit validation result; invalid snapshots never become signal inputs."""
    try:
        current = datetime.now(timezone.utc).timestamp() if now is None else float(now)
    except (TypeError, ValueError, OverflowError):
        return {"ok": False, "reason": "invalid_validation_clock"}
    if not isfinite(current):
        return {"ok": False, "reason": "invalid_validation_clock"}
    if isinstance(min_bars, bool) or not isinstance(min_bars, int) or min_bars < 1:
        return {"ok": False, "reason": "invalid_minimum_bar_requirement"}
    if not isinstance(snapshot, Mapping):
        return {"ok": False, "reason": "snapshot_missing_or_not_object"}
    if snapshot.get("version") != CONTRACT_VERSION:
        return {"ok": False, "reason": "unsupported_snapshot_contract_version"}

    captured_at = epoch_seconds(snapshot.get("capturedAt"))
    if captured_at is None:
        return {"ok": False, "reason": "snapshot_capture_time_missing_or_invalid"}
    if captured_at > current + 5:
        return {"ok": False, "reason": "snapshot_capture_time_in_future"}
    capture_age = max(0.0, current - captured_at)
    if capture_age > MAX_SNAPSHOT_AGE_SECONDS:
        return {"ok": False, "reason": "snapshot_envelope_stale", "snapshot_age_seconds": round(capture_age, 3), "max_snapshot_age_seconds": MAX_SNAPSHOT_AGE_SECONDS}

    symbol = canonical_symbol(snapshot.get("symbol"))
    timeframe = canonical_timeframe(snapshot.get("timeframe"))
    if symbol != "XAU/USD":
        return {"ok": False, "reason": "symbol_not_supported", "symbol": symbol}
    if timeframe is None:
        return {"ok": False, "reason": "timeframe_not_supported"}

    status = snapshot.get("status")
    if not isinstance(status, Mapping) or status.get("ok") is not True or status.get("stale") is True:
        return {"ok": False, "reason": "feed_status_not_healthy", "symbol": symbol, "timeframe": timeframe}
    if canonical_symbol(status.get("symbol")) != symbol or canonical_timeframe(status.get("timeframe")) != timeframe:
        return {"ok": False, "reason": "status_snapshot_symbol_timeframe_mismatch", "symbol": symbol, "timeframe": timeframe}

    rows = snapshot.get("bars")
    if not isinstance(rows, list):
        return {"ok": False, "reason": "bars_missing_or_not_array", "symbol": symbol, "timeframe": timeframe}
    bars = [normalize_bar(row) for row in rows]
    if any(bar is None for bar in bars):
        return {"ok": False, "reason": "malformed_ohlc_bar", "symbol": symbol, "timeframe": timeframe}
    normalized = [bar for bar in bars if bar is not None]
    if len(normalized) < min_bars:
        return {"ok": False, "reason": "insufficient_bars", "bars": len(normalized), "required": min_bars}

    normalized.sort(key=lambda bar: bar["t"])
    stamps = [bar["t"] for bar in normalized]
    if len(stamps) != len(set(stamps)):
        return {"ok": False, "reason": "duplicate_bar_timestamps", "bars": len(normalized)}
    if stamps[-1] > current + 5:
        return {"ok": False, "reason": "latest_bar_in_future", "latest_bar_at": stamps[-1]}
    age = max(0.0, current - stamps[-1])
    max_age = max(180.0, 3.0 * TIMEFRAME_SECONDS[timeframe])
    if age > max_age:
        return {"ok": False, "reason": "latest_bar_stale", "latest_age_seconds": round(age, 3), "max_age_seconds": max_age}

    return {
        "ok": True,
        "contract_version": CONTRACT_VERSION,
        "symbol": symbol,
        "timeframe": timeframe,
        "bars": normalized,
        "bar_count": len(normalized),
        "latest_bar_at": stamps[-1],
        "latest_age_seconds": round(age, 3),
        "max_age_seconds": max_age,
        "snapshot_age_seconds": round(capture_age, 3),
        "max_snapshot_age_seconds": MAX_SNAPSHOT_AGE_SECONDS,
        "signal_generation": False,
        "auto_trading": False,
    }

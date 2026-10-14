"""Shadow-mode validator for Rizvi Dashboard V5 canonical OHLC snapshots.

This module deliberately does not trade, score indicators, or mutate production state.
It mirrors the existing Engine 5 recovery eligibility checks so the Python candidate
can be tested against captured feed/status payloads before any integration is enabled.
Standard library only; safe to run in a separate worker or test process.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from math import isfinite
from typing import Any, Mapping, Sequence


def epoch_ms(value: Any) -> float:
    """Normalize numeric epoch s/ms/us/ns or an ISO timestamp to milliseconds."""
    if value is None or isinstance(value, bool):
        return float("nan")
    number: float
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return float("nan")
        try:
            number = float(raw)
        except ValueError:
            try:
                parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return parsed.timestamp() * 1000
            except (ValueError, OverflowError):
                return float("nan")
    else:
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError):
            return float("nan")
    if not isfinite(number) or number <= 0:
        return float("nan")
    if number >= 1e17:  # ns
        number /= 1e6
    elif number >= 1e14:  # us
        number /= 1e3
    elif number >= 1e11:  # ms
        pass
    else:  # seconds
        number *= 1000
    return number


def canonical_symbol(value: Any) -> str:
    raw = "".join(ch for ch in str(value or "").upper() if ch.isalnum())
    if raw in {"XAUUSD", "GOLD"}:
        return "XAUUSD"
    if raw == "BTCUSD":
        return "BTCUSD"
    return raw


def canonical_timeframe(value: Any) -> str:
    raw = str(value or "").strip().upper()
    aliases = {"1": "1M", "M1": "1M", "1MIN": "1M", "5": "5M", "M5": "5M",
               "15": "15M", "M15": "15M", "30": "30M", "M30": "30M",
               "H1": "1H", "60": "1H", "D1": "1D", "1440": "1D"}
    raw = aliases.get(raw, raw)
    return raw if raw in {"1M", "5M", "15M", "30M", "1H", "1D"} else ""


def _number(row: Mapping[str, Any], *keys: str) -> float:
    for key in keys:
        if key in row and row[key] is not None:
            try:
                return float(row[key])
            except (TypeError, ValueError, OverflowError):
                return float("nan")
    return float("nan")


def normalize_bars(rows: Any, now_ms: float) -> list[dict[str, float]]:
    """Normalize/sort OHLC bars and reject invalid/future/malformed candles."""
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes, bytearray)):
        return []
    result: list[dict[str, float]] = []
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        stamp = epoch_ms(row.get("t", row.get("time", row.get("timestamp", row.get("date")))))
        o, h, low, c = (_number(row, *keys) for keys in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close")))
        v = _number(row, "v", "volume")
        if not isfinite(stamp) or stamp > now_ms + 5000:
            continue
        if not all(isfinite(x) and x > 0 for x in (o, h, low, c)):
            continue
        if h < max(o, c, low) or low > min(o, c, h):
            continue
        result.append({"t": stamp, "o": o, "h": h, "l": low, "c": c, "v": max(0.0, v) if isfinite(v) else 0.0})
    result.sort(key=lambda bar: bar["t"])
    return result


@dataclass(frozen=True)
class RecoveryDecision:
    eligible: bool
    reasons: tuple[str, ...]
    symbol: str
    timeframe: str
    status_age_ms: int | None
    latest_bar_age_ms: int | None
    raw_bars: int
    valid_bars: int

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["reasons"] = list(self.reasons)
        return data


def assess_recovery(*, selected_symbol: str, selected_timeframe: str,
                    status: Mapping[str, Any] | None, bars: Any,
                    now_ms: float, max_age_ms: float,
                    minimum_bars: int = 21) -> RecoveryDecision:
    """Assess eligibility using current Engine 5 recovery guardrails.

    Caller supplies the same timeframe-specific max_age_ms as the JS code.
    This function assesses only; it never alters a live snapshot.
    """
    status = status if isinstance(status, Mapping) else {}
    selected_symbol_c = canonical_symbol(selected_symbol)
    selected_tf_c = canonical_timeframe(selected_timeframe)
    status_age_raw = now_ms - epoch_ms(status.get("updatedAt"))
    status_age = int(round(status_age_raw)) if isfinite(status_age_raw) else None
    normalized = normalize_bars(bars, now_ms)
    latest_age_raw = now_ms - normalized[-1]["t"] if normalized else float("nan")
    latest_age = int(round(latest_age_raw)) if isfinite(latest_age_raw) else None
    status_symbol = canonical_symbol(status.get("symbol"))
    status_tf = canonical_timeframe(status.get("timeframe"))
    reasons: list[str] = []
    if status.get("ok") is not True:
        reasons.append("status-not-ok")
    if status.get("live") is not True:
        reasons.append("status-not-live")
    if status.get("stale") is True:
        reasons.append("status-stale")
    if status_age is None or status_age < 0 or status_age > max_age_ms:
        reasons.append("status-age-out-of-range")
    if status_symbol != selected_symbol_c:
        reasons.append("status-symbol-mismatch")
    if status_tf != selected_tf_c:
        reasons.append("status-timeframe-mismatch")
    if len(normalized) < minimum_bars:
        reasons.append("raw-bars-insufficient")
    if latest_age is None or latest_age < -5000 or latest_age > max_age_ms:
        reasons.append("latest-bar-stale-or-invalid")
    return RecoveryDecision(not reasons, tuple(reasons), selected_symbol_c, selected_tf_c,
                            status_age, latest_age, len(bars) if isinstance(bars, list) else 0,
                            len(normalized))

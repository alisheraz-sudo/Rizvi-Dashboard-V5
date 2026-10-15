"""Isolated Python reference port of the current five-algorithm scorer.

This module is an experiment only. It is not imported by the live dashboard and
must not be treated as a production replacement. The Engine 5 gates/settings
are intentionally outside this module and remain unchanged.
"""
from __future__ import annotations

from math import isfinite
from datetime import datetime
from typing import Any, Iterable


ALGORITHMS = {
    "A_TREND": {"trend": 30, "vwap": 25, "momentum": 20, "rsi": 15, "candle": 10},
    "B_MOMENTUM": {"momentum": 30, "rsi": 25, "trend": 15, "candle": 10},
    "C_LIQUIDITY": {"liquidity": 35, "candle": 20, "trend": 15, "momentum": 10, "vwap": 10, "divergence": 10},
    "E_REVERSAL": {"divergence": 35, "liquidity": 25, "rsi": 20, "candle": 15, "vwap": 5},
    "F_FULL": {"trend": 12, "momentum": 10, "rsi": 10, "vwap": 10, "candle": 10, "liquidity": 12, "divergence": 7, "volumeProfile": 7},
}


def _number(value: Any) -> float:
    try:
        result = float(value)
        return result if isfinite(result) else float("nan")
    except (TypeError, ValueError):
        return float("nan")


def _timestamp(value: Any) -> float:
    """Accept numeric epoch values and ISO/date strings like the browser feed."""
    numeric = _number(value)
    if isfinite(numeric):
        return numeric
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=__import__("datetime").timezone.utc)
            return parsed.timestamp()
        except ValueError:
            pass
    return float("nan")


def normalize_bars(rows: Iterable[dict[str, Any]]) -> list[dict[str, float]]:
    """Normalize OHLCV aliases the same way as the browser scorer."""
    out = []
    for row in rows:
        bar = {
            "time": _timestamp(row.get("time", row.get("timestamp", row.get("t", row.get("date"))))),
            "open": _number(row.get("open", row.get("o"))),
            "high": _number(row.get("high", row.get("h"))),
            "low": _number(row.get("low", row.get("l"))),
            "close": _number(row.get("close", row.get("c"))),
            "volume": _number(row.get("volume", row.get("v"))),
        }
        if all(isfinite(bar[k]) for k in ("open", "high", "low", "close")):
            out.append(bar)
    return out


def _ema(values: list[float], period: int) -> float:
    if len(values) < period:
        return float("nan")
    alpha = 2 / (period + 1)
    result = values[0]
    for value in values[1:]:
        result = value * alpha + result * (1 - alpha)
    return result


def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) <= period:
        return float("nan")
    gains = losses = 0.0
    for i in range(len(closes) - period, len(closes)):
        delta = closes[i] - closes[i - 1]
        if delta > 0:
            gains += delta
        else:
            losses -= delta
    return 100.0 if losses == 0 else 100 - 100 / (1 + gains / losses)


def calculate_features(bars: list[dict[str, float]], liquidity_direction: str | None = None) -> dict[str, Any]:
    """Port the currently deployed feature formulas, including known limitations."""
    closes = [b["close"] for b in bars]
    if not closes:
        return {"trend": 0, "momentum": 0, "rsi": 0, "vwap": 0, "candle": 0,
                "liquidity": 0, "divergence": 0, "volumeProfile": 0,
                "raw": {"ema20": float("nan"), "ema50": float("nan"), "rsi": float("nan"), "vwap": float("nan")}}
    last = closes[-1]
    ema20, ema50, rsi_value = _ema(closes, 20), _ema(closes, 50), _rsi(closes)
    pv = volume = 0.0
    for bar in bars[-100:]:
        v = bar["volume"]
        if not isfinite(v) or v <= 0:
            continue
        pv += ((bar["high"] + bar["low"] + bar["close"]) / 3) * v
        volume += v
    vwap_value = pv / volume if volume else float("nan")
    trend = 1 if last > ema20 and ema20 > ema50 else -1 if last < ema20 and ema20 < ema50 else 0
    momentum = 1 if len(closes) >= 6 and last > closes[-6] else -1 if len(closes) >= 6 and last < closes[-6] else 0
    rsi_bias = 1 if rsi_value >= 55 else -1 if rsi_value <= 45 else 0
    vwap_bias = 1 if isfinite(vwap_value) and last > vwap_value else -1 if isfinite(vwap_value) and last < vwap_value else 0
    candle = 1 if len(bars) >= 2 and last > bars[-1]["open"] else -1 if len(bars) >= 2 else 0
    liquidity = 1 if liquidity_direction == "bullish" else -1 if liquidity_direction == "bearish" else 0
    divergence = -1 if len(closes) >= 30 and rsi_value > 50 and last > closes[-11] else 1 if len(closes) >= 30 and rsi_value < 50 and last < closes[-11] else 0
    return {
        "trend": trend, "momentum": momentum, "rsi": rsi_bias, "vwap": vwap_bias,
        "candle": candle, "liquidity": liquidity, "divergence": divergence,
        # Kept as-is for parity; deployed JS has no real volume-profile input.
        "volumeProfile": 0,
        "raw": {"ema20": ema20, "ema50": ema50, "rsi": rsi_value, "vwap": vwap_value},
    }


def score_algorithm(name: str, features: dict[str, Any]) -> dict[str, Any]:
    weights = ALGORITHMS[name]
    weighted_direction = 0
    active = 0
    for key, weight in weights.items():
        bias = features.get(key) or 0
        if bias:
            weighted_direction += bias * weight
            active += 1
    weight_sum = sum(weights.values())
    direction = "BUY" if weighted_direction > 0 else "SELL" if weighted_direction < 0 else "WAIT"
    confidence = max(0, min(100, round(50 + abs(weighted_direction) / max(weight_sum, 1) * 50)))
    return {
        "name": name,
        "action": direction if confidence >= 70 else "WAIT",
        "confidence": confidence,
        # This mirrors the existing JS field; it is active-input coverage, not vote agreement.
        "agreement": round(active / max(len(weights), 1) * 100),
        "activeIndicators": active,
        "weights": dict(weights),
    }


def evaluate(bars: Iterable[dict[str, Any]], liquidity_direction: str | None = None) -> dict[str, Any]:
    normalized = normalize_bars(bars)
    features = calculate_features(normalized, liquidity_direction)
    algorithms = {name: score_algorithm(name, features) for name in ALGORITHMS}
    ranked = sorted(algorithms.values(), key=lambda row: (-row["confidence"], -row["agreement"]))
    master = ranked[0] if ranked else {"action": "WAIT", "confidence": 0, "name": None}
    return {
        "version": "python-parity-prototype",
        "bars": len(normalized),
        "features": features,
        "algorithms": algorithms,
        "ranking": [{"name": r["name"], "action": r["action"], "confidence": r["confidence"], "agreement": r["agreement"]} for r in ranked],
        "master": {"action": master["action"], "confidence": master["confidence"], "algorithm": master["name"]},
        "production_ready": False,
        "note": "Scorer parity prototype only; no live feed adapter, Engine 5 gate, or outcome-based accuracy validation.",
    }
